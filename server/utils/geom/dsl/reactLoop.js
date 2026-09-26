/**
 * ReAct 视觉闭环：让模型**看着自己画出来的图**改 DSL。
 *
 * 为什么需要它：DSL 解决的是"坐标靠目测"的问题，但解决不了"结构画错"——
 * 模型可能多画一条线、漏掉折叠点 C′、把 D 挂到错误的边上。
 * 生产数据里这一类比坐标错误多得多（见 geometryFreezeAudit / _auditGeomPipeline 的
 * `重绘结构与题干引用不符（多画/漏画）` 一桶）。
 *
 * 做法直接借鉴 GeoBuildBench（ooongs/GeoBuildBench, MIT）的 ReAct 模式：
 *   Thought → Action → **Observation（把渲染结果回灌给模型看）** → Reflect → 迭代。
 * 差别在于它的 observation 是 matplotlib 图 + 报错栈，我们的是
 * 「原题裁片 ‖ DSL 重绘」并排对照图 + 执行器报错列表。
 *
 * 三个刻意的设计：
 *   1. **单图**。视觉网关只支持一张图（config/ai.js buildVisionMessages），
 *      所以把两图并排拼成一张，并在 prompt 里写死"左原图 / 右重绘"的位置约定。
 *   2. **必须给完整 DSL**，不给 diff。diff 的解析脆弱，而完整重写模型做得更好，
 *      而且天然避免了"局部补丁把已对的部分改坏"。
 *   3. **终止条件保守**：明确 OK 才停；DSL 不再变化也停（避免无限来回）。
 *      轮数用尽仍未 OK → 交调用方决定（通常回退裁剪原图）。
 */

import { executeDsl } from './executor.js'
import { normalizeStructure } from '../structure.js'
import { commandReference } from './commands.js'
import { renderDslToSvg, rasterizeSvg, composeComparison, toDataUrl } from './render.js'
import { validateStructureAgainstContent } from '../../geometryContentGate.js'

/**
 * 弱 OK 降级（2026-09-19 用户拍板）：模型卡住（dsl_unchanged / 轮数用尽）时，
 * 若最后一版结构「执行合法 + 过内容闸门」，降级判成功。
 *
 * 依据：M5 实测 dsl_unchanged 样本普遍执行合法、结构合理，模型只是"看着不像就不敢说 OK"；
 * 内容闸门（题干 ↔ 结构交叉核对，纯文本零视觉）是第二道独立防线。
 * 代价：模型真实发现但改不动的问题会放行 → 调用方必须落 weak_ok 标记，前端可回退。
 *
 * @param {object|null} built 最后一轮 buildStructureFromDsl 的结果
 * @param {string} content 题干（含 parent_stem，与 worker 一致）
 * @returns {{weakOk:true, reason:'weak_ok'}|null}
 */
function weakOk(built, content) {
  if (!built || !built.ok || !built.structure) return null
  // 结构必须真正非空（2026-09-19 gemini 批次发现：空结构 pts=0/segs=0 也能过内容闸门，
  // 弱 OK 若放行空图 = 白画；宁可失败回退原图）
  const s = built.structure
  const nonEmpty = (s.points?.length || 0) + (s.segments?.length || 0) + (s.circles?.length || 0) > 0
  if (!nonEmpty) return null
  const v = validateStructureAgainstContent(s, content)
  if (!v || !v.ok) return null
  return { weakOk: true, reason: 'weak_ok' }
}

/** 复用 buildStructureFromDsl 的语义，但直接依赖 executor 避免与 index.js 形成循环 import */
const buildStructureFromDsl = (dsl) => {
  const r = executeDsl(dsl)
  return r.ok ? { ...r, structure: normalizeStructure(r.structure) } : { ...r, structure: null }
}

/** 单轮观察（用于日志与人工排查） */
const MAX_DSL_CHARS = 6000

/**
 * 构造 system prompt。命令表**由命令表代码生成**，避免 prompt 与实现漂移。
 */
export function buildDslPrompts({ content, dsl, errors, round }) {
  const systemPrompt = `你是几何作图专家。你的任务是把一道中文几何题的配图，用一套**构造命令 DSL** 精确重建。

## DSL 语法

格式：\`command : inputs -> outputs\`
- 一行一条命令；\`#\` 起注释
- 表达式内**绝对不能有空格**（\`100*cos(60°)\` 是一个 token，写成 \`100 * cos(60°)\` 会解析失败）
- 坐标用算式表达，**不要目测**。角度单位默认是度，可以写 \`60°\` 或 \`60\`
- 点坐标用极坐标表达最稳：距离 r、角度 θ 的点写成 \`r*cos(θ) r*sin(θ)\`
- 坐标系是数学坐标（y 轴向上），画布建议 0~200 之间
- **先定义后使用**；每个 label 只能定义一次

## 可用命令

${commandReference()}

## 完整示例（照这个风格写）

\`\`\`dsl
# 例 1：△ABC，M 是 AB 的中点，连接 CM
point : 0 0 -> A
point : 200 0 -> B
point : 100*cos(90°) 100*sin(90°) -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
midpoint : A B -> M
segment : C M -> CM
\`\`\`

\`\`\`dsl
# 例 2：Rt△AOB，AB⊥OB，F 是 A 到 OB 的垂足，标直角符号
point : 50 140 -> A
point : 0 0 -> O
point : 180 0 -> B
segment : O A -> OA
segment : O B -> OB
segment : A B -> AB
right_angle : A O B -> r1
foot : A OB -> F
segment : A F -> AF
\`\`\`

\`\`\`dsl
# 例 3：数轴（刻度数字 0/1/2 一律写在数轴下方）
point : 0 0 -> _ax0
point : 120 0 -> _ax1
segment : _ax0 _ax1 -> _axis
point : 112 3 -> _arr_t
point : 112 -3 -> _arr_b
segment : _arr_t _ax1 -> _a1
segment : _arr_b _ax1 -> _a2
point : 20 0 -> _t0
point : 60 0 -> _t1
point : 100 0 -> _t2
point : 18 -4 -> _t0b
point : 58 -4 -> _t1b
point : 98 -4 -> _t2b
segment : _t0b _t0 -> _tk0
segment : _t1b _t1 -> _tk1
segment : _t2b _t2 -> _tk2
point : 20 -9 -> 0
point : 60 -9 -> 1
point : 100 -9 -> 2
point : 40 0 -> P
\`\`\`

\`\`\`dsl
# 例 4：抛物线 y=ax²+bx 交 x 轴正半轴于 A，直线 y=2x 过顶点 M，对称轴为直线 x=1
# 先解出系数：对称轴 x=1 ⇒ b=-2a；M(1,a+b)=(1,-a) 在 y=2x 上 ⇒ a=-2 ⇒ y=-2x²+4x，A(2,0)
point : 0 0 -> O
point : 2 0 -> A
point : 1 2 -> M
point : 2.5 5 -> P
point : -0.6 0 -> _xmin
point : 3 0 -> _xmax
point : 0 -0.8 -> _ymin
point : 0 5.4 -> _ymax
segment : _xmin _xmax -> _xaxis
segment : _ymin _ymax -> _yaxis
curve : -2x^2+4x -0.6 2.6 -> k1
segment : O M -> OM
segment : M P -> MP
segment : A M -> AM
label : "y" -0.42 5.0 -> Ly
label : "x" 3.05 -0.5 -> Lx
\`\`\`

要点：先定义普通点（坐标用算式），再连线；派生点（中点/垂足/交点/对称像）用构造命令单独定义；
线段无向，AB 与 BA 是同一个对象，可以互相引用。
函数图象（抛物线/双曲线/一次函数）一律用 \`curve\` 画——它的坐标由解析式算出来，形状一定正确；
拿一堆目测点用 \`segment\` 连折线，画出来底部会带折角。

## 常见执行错误与修法

- \`UNDEFINED_ELEMENT:X\` —— X 还未定义：把它所在命令移到定义之后，或改用已定义对象的写法
- \`OUTPUT_COUNT_MISMATCH\` —— 输出名个数不对：先数清实际个数（直线与圆一般 2 个交点，按实际列出）
- \`ARG_COUNT_MISMATCH\` —— **一条命令里塞了多个元素**（如 \`point : 0 0 100 100 -> X Y\` 本应是两条）：
  **一条命令只定义一个元素**，拆成两行 \`point : 0 0 -> X\` 与 \`point : 100 100 -> Y\`；segment/label/intersect 同样，一个元素一行
- \`ARG_TYPE_MISMATCH\` —— 参数类型不对：检查传给命令的分别是点/线/圆/数字
- \`BAD_FUNCTION_EXPR\` —— \`curve\` 的第一个参数必须**只含变量 x**：系数要先按题干算成数字，
  不能写 \`a*x^2+b*x\` 这种把 a、b 当变量的式子（求不出值就没法采样）
- \`BAD_DOMAIN\` —— \`curve\` 的定义域写反了：必须是 \`<小数> <大数>\`（如 \`-1 4\`）
- \`UNKNOWN_COMMAND\` —— 命令名拼错或不存在：只能用「可用命令」里列出的名字
  （画函数图象是 \`curve\`，没有 \`parabola\`/\`function\` 这类命令）
- \`DUPLICATE_LABEL\` —— 名字重复定义：改新名字或删掉重复行
- \`NO_INTERSECTION\` —— 两对象不相交（平行线永不交）：检查构造是否合理
- \`DEGENERATE_*\` —— 退化（两点重合/三点共线）：检查输入点

## 硬性规则

1. 只画题干里出现过的元素。**多画一条线、多标一个点都是错误**。
2. 题干提到的每个元素都必须画出来。**漏画同样是错误**（尤其注意带撇点 A′/B′、垂足、中点、交点）。
3. **保持与原图相同的朝向**：原图里 A 在左、C 在上，重绘也应如此——不要旋转、不要镜像翻转。
   左右关系（谁在谁左边）、上下关系（谁在谁上方）必须和原图一致。
4. 不要输出 \`point\` 之外的目测坐标；所有构造点都用构造命令（midpoint / foot / intersect / mirror / …）算出。
5. 直线(\`line\`)/射线(\`ray\`)是**构造辅助对象，不会被画出来**；要让某条线可见，必须另外用 \`segment\` 画出它可见的那一段。
6. 求交点时，输出名个数必须等于实际交点数（直线与圆一般 2 个，线段与圆按落在段内的算）。
7. **判定 OK/FIX 只看拓扑结构，不看画风**：字体、字号、颜色、线宽、灰底/白底、网格、坐标轴装饰、
   整体缩放、平移留白等渲染风格差异**不构成 FIX 的理由**；只有点/线有无、派生关系、朝向、
   字母标签对应错误才判 FIX。
8. **生成顺序（自检清单）**：写 DSL 前先在脑中列出题干元素清单（点、线段、圆、派生点、标注），
   然后按固定顺序输出命令：① \`point\` 定义普通点（坐标用算式、极坐标最稳）→
   ② \`segment\`/\`line\`/\`circle\` 画可见元素 → ③ 构造命令（midpoint/foot/intersect/mirror/…）
   定义派生点 → ④ 最后加 right_angle/angle_mark/label。任何命令引用到的对象必须先定义。
9. **一条命令只定义一个元素**：\`point\`/\`segment\`/\`line\`/\`label\` 每条只对应一个对象，
   **禁止把多个元素合并进一条命令**（如 \`segment : A B C D -> AB CD\` 是错误写法，
   应写成两行 \`segment : A B -> AB\`、\`segment : C D -> CD\`）。只有 \`polygon\`/\`shade\`
   可以列多个点（它们是"一个多边形"）。
10. **对象的输出名（\`-> X\`）必须是题干里的数学符号命名**：点的名字用单个大写/小写字母
   （A、B、C、O、M、a、b…可带撇号 A'、下标 x₁），线段/圆名由两端点组成（AB、CD），
   数轴刻度点用真实刻度值（0、1、2、-1、-2…）。
   **禁止用英文描述性占位符当名字**（pt_a、arr_u、Axis_start、T1_b、T_n2_b、P_left、
   top_0、L、R 这类是变量名不是题面符号——一旦使用，图上会出现乱码标注）。
11. **只为"题面要标注的点"命名；画图必须用到的辅助位置不要命名**：
   - 函数图象（抛物线/双曲线/一次函数/反比例函数）一律用 \`curve\` 命令画（见规则 12），
     **绝不要**为采样点逐个 \`point\` 命名再用 \`segment\` 连成折线——那既会在图上印出
     P0、P1、P2… 一串假标注，折线本身还会带折角（抛物线底部会"折"一下）；
   - 阴影多边形、辅助线的顶点若题面没有标注，名字**必须以 \`_\` 开头**（如 \`_k1\`、\`_p1\`）：
     下划线开头的名字是"内部辅助点"，渲染时会自动隐藏标注，只画图形；
   - 反之，凡是题面/原图里出现的点（A、B、C、M、N、x₁…），必须用真实符号命名，
     否则该标注不会显示。
   - ⚠️ **原图和题干都没有字母的孤立标记点，一律用 \`_\` 开头命名，绝不能顺手给它起个字母**：
     圆心、图形中心、折叠点、垂足、交点、对称中心都属于这一类
     （例：两圆同心，圆心写 \`point : 0 0 -> _o\`，**不要**写 \`point : 0 0 -> O\`）。
     自造字母会被发布闸门判成"图上凭空多出一个点 O"，**整张重绘图被拒稿、退回原卷裁片**。
12. **函数图象必须用 \`curve\` 命令，一条曲线一行**，写法：
   \`curve : <含变量x的表达式> <x起> <x止> -> k1\`
   例：\`curve : -2x^2+4x 0 2 -> k1\`、\`curve : 1/x -3 3 -> k1\`、\`curve : x^2-2x-3 -1 4 -> k1\`。
   - 表达式用 \`*\` 连接、**不能有空格**（\`2x\` 与 \`2*x\` 都认）；
   - 定义域 \`<x起> <x止>\` 取**原图上曲线实际可见的左右端点**（原图画到哪就写到哪）；
   - 系数未直接给出时，先按题干条件把解析式**算出来**再写（例如"顶点在直线 y=2x 上、对称轴 x=1"
     可定出 a、b），不要用一串目测点去凑；
   - **题干给出的函数图象属于必须画出来的元素**：漏掉整条抛物线同样算漏画（规则 2）。
13. **数轴/坐标轴的数值标注（刻度数字与表示数的字母）写在轴的指定一侧，绝不能压在轴线上**：
   数轴的数值标注统一写在数轴**下方**（数轴画在 y=0 时，标注点就写 y≈-9），
   坐标轴的刻度数字写在轴的**下方/左侧**。
   - 这类标注包含**刻度数字**（\`0\`、\`1\`、\`-2\`）和**表示数的字母**（\`a\`、\`b\`、\`c\`）；
     它们都直接用一个 \`point\` 定位（\`point : 40 -9 -> 1\`），**不要**再用 segment 连回轴
     （那会凭空多出一条引线）；刻度小竖线另外用两个 \`_\` 开头的点加一条 \`segment\` 画。
   - **刻度小竖线「站在数轴上、朝数字的反侧」伸出一小截，绝不能穿过数轴**（原卷画法：
     数字写在轴下方时，刻度线自数轴**向上**伸出，长度约为轴长的 2%；两个 \`_\` 点一个
     落在轴上、一个在轴上方。穿轴、只挂下方都是错的）。
     轴在 y=0 时写成 \`point : 40 -2 -> _t1b\`、\`point : 40 2 -> _t1t\`（上下各 2），
     再 \`segment : _t1b _t1t -> tk_1\`。**不要**只写半截（如两个点都取 y=0 和 y=4，刻度就全在轴上方了）。
   - ⚠️ **这里的 y 只是告诉渲染器"文字放轴的上方还是下方"，不是几何事实**。渲染器会
     自动把圆点吸附回轴上、并把文字统一摆到轴的正下方/正上方居中。所以**不要**为了让
     标注"看起来更准"去改点的坐标或挪轴线 —— 那不会改变文字位置，只会把几何画错。
   - 数轴上的**点的标注**（P、Q、M、N… 有实际几何意义的点）与刻度数字**分写在两侧**：
     数字在下、点名在上（如轴上点 P 的标注写 \`point : 40 9 -> P\`），否则两串文字会挤在同一行里互相压住。
14. **原图画成虚线的元素，重绘也必须是虚线——用 \`dashed_segment\` 命令**：
   \`dashed_segment : <点1> <点2> -> ds_1\`，用法与 \`segment\` 完全一样，只是线型为虚线。
   - 最常见的虚线是**抛物线/图形的对称轴**；辅助线、延长线、折叠痕迹同理。
   - 画成实线属于"线型与原图不一致"，核对轮会判 FIX 要求改成虚线。
   - 对称轴一般是一条**贯穿图形上下的竖直虚线**，两端各用一个 \`_\` 开头的点定位
     （例如 \`point : 1 -1 -> _sym_bot\`、\`point : 1 3 -> _sym_top\`，
     再 \`dashed_segment : _sym_bot _sym_top -> ds_sym\`）。`

  const errBlock = (errors && errors.length)
    ? `\n## 上一版 DSL 的执行错误（必须全部修掉）\n${errors.map(e => `- 第 ${e.line} 行：${e.message}${e.hint ? ` —— ${e.hint}` : ''}`).join('\n')}\n`
    : ''

  const userPrompt = `## 题目

${content || '（题干为空）'}
${dsl
    ? `\n## 上一版 DSL\n\n\`\`\`dsl\n${String(dsl).slice(0, MAX_DSL_CHARS)}\n\`\`\``
    : '\n## 说明\n\n这次还没有 DSL —— 请根据左边的原题配图**从零生成**第一版 DSL。\n先按硬性规则 8 在脑中列出元素清单，再按「点→线→派生点→标注」顺序一次写全，尽量让第一版就能执行（避免 \`point\` 之外的目测坐标、输出名个数写全）。'}
${errBlock}
## 你需要做的事

上图是并排对照：**左边是原题配图（真值），右边是按 DSL 重绘出来的图**。
（第 ${round} 轮）${dsl
    ? `

请逐项核对右边的图与左边的图，**只核对拓扑结构，不看画风**：

1. 点是否齐全？位置关系是否正确（谁在谁的边上、谁是谁的中点/垂足/交点/对称像）？
2. 线段/圆/圆弧是否齐全？有没有多画、漏画？
3. 直角标记/角标记/符号标注是否与左图一致？

**以下差异不算不一致，可以判 OK：**
- 字体、字号、颜色、线宽、灰底/白底、网格、坐标轴装饰等渲染风格差异
- 图形在画布里的整体缩放、平移、留白大小
- 文字标注位置的小幅偏移（只要仍指向正确的点/线）
- **数轴数值标注（刻度数字与 a/b/c 这类表示数的字母）的圆点与文字摆位**：渲染器会
  自动把圆点吸附到轴上、把文字统一摆正。**不要**因为标注的摆放位置差异判 FIX，
  更不要为了调整标注位置去改点的坐标或挪轴线。

**以下差异必须判 FIX：**
- 缺了点/线/圆，或多画了左图没有的元素（**含整条函数图象漏画**）
- **整体朝向颠倒**：先比对左图“最上方的点是谁、最下方的是谁、最左/最右是谁”，
  再看右图——若上下整体颠倒（左图 A/E/B 在底、D/C 在顶，右图却反过来）、或左右镜像、
  或整体旋转了 90°/180°，**一律判 FIX**（朝向是几何事实，不是画风）。
- **点未真正落在它所属的线上**：原图里某个字母点是“线与线的交点”或“某条线上的点”
  （如平行线题里 CD 两端点 C/D 是两条斜线与中间平行线的交点），右图却把它画成
  靠近但**不在线上**的自由点（线与点之间能看到明显缝隙/错开）——必须判 FIX，
  并改用 \`intersect\` 把该点派生成真实交点，而不是目测坐标。
- 函数图象画成了折线（底部有折角）或采样点被标了 P0/P1… 一串名字——必须改用 \`curve\` 重画
- **函数图象的形状与左图不符**：开口方向相反（该朝上画成朝下）、**原图有两支却只画了一支**、
  顶点或与坐标轴的交点位置明显不同、定义域取得太窄把曲线截掉一大段
  （形状是几何事实，不是画风——不要因为"有一条曲线"就判 OK；但**先看清左图画了几支**，
  原图只有一段时画一段就是对的）
- 刻度数字与轴线/刻度线**重叠到看不清**（只是离轴远近、或标在原图另一侧，**不算** FIX）
- 派生关系错误：该是中点/垂足/交点/对称像的点，位置不对
- 左右/上下朝向颠倒（旋转、镜像翻转）
- 字母标签对应错误（A 的位置标成了 B）
- **凭空多出的字母标注**：原图那个位置只有一个**没有字母**的点（圆心的实心小方块、交点、
  折叠点），重绘图却给它加了 O / M / P 这类字母。修法是**把名字改成 \`_\` 开头**（如 \`_o\`）
  —— 字母删掉、位置保留。留着自造字母会让整张图被发布闸门拒稿、退回模糊的原卷裁片。
- **阴影区域与原图不符**：阴影（填充）落在的**区域形状/位置**与左图不一致
  （如原图阴影是长方形内图形外的两块余料，却画成一个大三角形）。阴影属于几何事实，必须判 FIX。

**修正时：多画的元素直接删掉，不要保留；漏画的补上；写不下就少写，不要猜。**

判定样例：右图颜色/字体/背景不同 → OK；右图少一条边或多一条线 → FIX。`
    : ''}

然后**只输出**下面两行之一作为结论，格式必须严格：

如果右边与左边一致${dsl ? '（或这是第一版且你确信正确）' : '（你已完成生成且确信正确）'}：
VERDICT: OK

否则：
VERDICT: FIX
\`\`\`dsl
（这里放**修正后的完整 DSL**，从第一行到最后一行，不要只给片段）
\`\`\``

  return { systemPrompt, userPrompt }
}

/** 从模型回复里解析结论与 DSL */
export function parseDslReply(reply) {
  const s = String(reply || '')
  const block = s.match(/```(?:dsl)?\s*\n?([\s\S]*?)```/)
  const dsl = block ? block[1].trim() : null
  const verdictMatch = s.match(/VERDICT\s*[:：]\s*(OK|FIX)/i)
  let verdict = verdictMatch ? verdictMatch[1].toUpperCase() : null
  // 没写结论但给了 DSL → 按 FIX 处理（宽容；总比丢掉一次修正机会好）
  if (!verdict && dsl) verdict = 'FIX'
  if (!verdict) verdict = 'UNKNOWN'
  return { verdict, dsl }
}

/**
 * 跑 ReAct 闭环。
 *
 * @param {object} p
 * @param {string} p.content 题干（含 parent_stem）
 * @param {string} p.dsl 初始 DSL（由第一轮视觉调用产出）
 * @param {string|null} p.originalImageDataUrl 原题裁片的 data URL（可为 null）
 * @param {(o:{systemPrompt:string,userText:string,imageDataURL:string})=>Promise<string>} p.callVision
 *        注入的视觉调用（生产用 config/ai.js 的 callVendorVisionCompletion 包装）
 * @param {number} [p.maxRounds=3]
 * @param {(ev:object)=>void} [p.onEvent] 进度回调（日志/审计）
 * @returns {Promise<{ok:boolean, dsl:string, structure:object|null, rounds:number,
 *                    errors:object[], history:object[], reason?:string}>}
 */
export async function correctDslByVision({
  content,
  dsl,
  originalImageDataUrl = null,
  callVision,
  maxRounds = 3,
  onEvent = null
}) {
  const history = []
  // dsl 为 null/空 → 第一轮先从零生成；否则直接进入"执行+核对"。
  let cur = String(dsl || '').trim() || null
  let lastStructure = null
  let lastErrors = []
  let prevDsl = null
  // built 提升到循环外：max_rounds 终止后还要拿最后一版做弱 OK 判定
  let built = null

  for (let round = 1; round <= maxRounds; round++) {
    // ── 1. 执行 + 渲染（生成轮没有 DSL 可执行，渲染图只有左半）──
    built = null
    if (cur) {
      built = buildStructureFromDsl(cur)
      lastStructure = built.structure
      lastErrors = built.errors
    }

    const svg = cur && built ? (built.ok ? renderDslToSvg(built.structure) : null) : null
    const renderPng = svg ? await rasterizeSvg(svg) : null
    const originalBuf = dataUrlToBuffer(originalImageDataUrl)
    const composite = await composeComparison(originalBuf, renderPng)
    const imageDataURL = toDataUrl(composite) || originalImageDataUrl

    const ev = {
      round,
      phase: cur ? 'verify' : 'generate',
      dslOk: built ? built.ok : null,
      errors: built ? built.errors.map(e => `${e.message}${e.hint ? ' / ' + e.hint : ''}`) : [],
      hasRender: !!renderPng,
      stats: built ? built.stats : null
    }
    if (built && !built.ok) ev.note = 'executor_failed'

    // ── 2. 让模型看对照图 ──
    const { systemPrompt, userPrompt } = buildDslPrompts({
      content, dsl: cur, errors: built ? built.errors : [], round
    })
    let reply
    try {
      reply = await callVision({ systemPrompt, userText: userPrompt, imageDataURL })
    } catch (e) {
      ev.visionError = e.message
      history.push(ev)
      onEvent?.(ev)
      return { ok: false, weakOk: false, dsl: cur || '', structure: lastStructure, rounds: round, errors: lastErrors, history, reason: `vision_error:${e.message}` }
    }

    const { verdict, dsl: newDsl } = parseDslReply(reply)
    ev.verdict = verdict
    ev.replyHead = String(reply || '').slice(0, 400)
    history.push(ev)
    onEvent?.(ev)

    // ── 3. 终止判断 ──
    if (verdict === 'OK') {
      // 只有"执行得通 + 模型**看过渲染图**后确认"才算成功。
      if (built && built.ok) {
        return { ok: true, weakOk: false, dsl: cur, structure: built.structure, rounds: round, errors: [], history }
      }
      // 生成轮（还没渲染可看）或执行不通时的 OK 一律不可信：
      //   生成轮模型只是"自己觉得对"，没看过自己的图——必须进入目检轮才算数。
      if (!newDsl) {
        return { ok: false, weakOk: false, dsl: cur || '', structure: null, rounds: round, errors: lastErrors, history, reason: 'verdict_ok_without_dsl' }
      }
      prevDsl = cur
      cur = newDsl
      continue
    }
    if (!newDsl) {
      return { ok: false, weakOk: false, dsl: cur || '', structure: lastStructure, rounds: round, errors: lastErrors, history, reason: `no_dsl_in_reply:${verdict}` }
    }
    // 模型给的 DSL 与上一版逐字相同 → 卡住了，再问也没用
    if (newDsl === cur || newDsl === prevDsl) {
      const w = weakOk(built, content)
      if (w) {
        return { ok: true, weakOk: true, dsl: cur, structure: built.structure, rounds: round, errors: [], history, reason: 'weak_ok' }
      }
      return { ok: false, weakOk: false, dsl: cur || '', structure: lastStructure, rounds: round, errors: lastErrors, history, reason: 'dsl_unchanged' }
    }
    prevDsl = cur
    cur = newDsl
  }

  // 轮数用尽：同样先试弱 OK（最后一版执行合法 + 过内容闸门）
  const w = weakOk(built, content)
  if (w) {
    return { ok: true, weakOk: true, dsl: cur, structure: built.structure, rounds: maxRounds, errors: [], history, reason: 'weak_ok' }
  }
  return { ok: false, weakOk: false, dsl: cur || '', structure: lastStructure, rounds: maxRounds, errors: lastErrors, history, reason: 'max_rounds' }
}

/** data URL → Buffer（非 data URL 或空值返回 null） */
function dataUrlToBuffer(u) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(u || ''))
  if (!m) return null
  try { return Buffer.from(m[2], 'base64') } catch { return null }
}
