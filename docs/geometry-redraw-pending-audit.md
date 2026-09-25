# 几何重绘管线未出图资产排查报告

生成时间：2026-09-25。数据源：question_assets + questions（未删除题）。

## 总览

| 状态 | 数量 | 说明 |
|---|---|---|
| completed | 290 | 已重绘发布 |
| 判对降级（last_error为空，按2026-09-20 P0口径只重绘错题） | 72 | 不需要重绘，前端回退原图裁片 |
| 被闸门拒绝/失败（last_error非空） | 102 | 本报告重点，见下文分类 |
| 有geometry_image_url但从未登记asset行 | 44 | 均为2026-09数据，管线覆盖缺口 |

## 被拒资产分类

### A. 函数图象题——入口闸按设计拒绝（4张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| db561d37-21db-40e6-bae1-2efa3ccd9f78 | none |  | 如图，在抛物线 y=x² 的内部依次画正方形，使对角线在 y 轴上，另两个顶点落在抛物线上，按此规律类推，第 2026  |
| 56966fa2-7612-491b-87eb-1ee615be9347 | none |  | 6. 函数 y=a/x 与 y=-ax²-a(a≠0) 在同一平面直角坐标系中的大致图像可能是 |
| 9b8bf929-7c2a-4cbe-8e1c-115b4d91ee3c | none | 是 | (2) 如果水面上升 3 米，那么水面宽度减少多少米？ |
| 2d0554b8-9c5a-484f-b2c4-042eb2ed275d | none | 是 | (1) 请求出这个二次函数的表达式； |

### B. 题干未引用配图——入口闸正则误判（3张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| 2a7a961b-cd0a-40eb-b4ea-f9e1212d5737 | none |  | 在Rt△ABC和Rt△DEF中，∠C=∠F=90°，要使Rt△ABC和Rt△DEF相似，只要 |
| 02fbd9b8-30fb-44ed-b04a-35816d5ade3f | none |  | 已知BD是四边形ABCD的对角线，∠BDC=∠A。下列补充的条件中，不能判定△ABD与△DBC相似的是 ( )。 |
| c2332a0d-465e-4da9-830f-e37b4001f37b | none | 是 | （填序号）①∠A=55°，∠D=35°；②AC=9 BC=12，DF=6 EF=8；③AC=3，BC=4，DF=6，DE |

### C. 标记非几何内容——多为旧版本误标(数轴现已支持)（18张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| f30f042b-91c3-49ec-b69f-cedd971d1ff3 | none |  | 实数a、b在数轴上对应的点的位置如图所示，则|a-b|-|b+a|= ____. |
| 4dca950c-3785-4983-afe6-963b2076b6e8 | none | 是 | (1)实数m的值是____；(2)化简：$|m+1|+|m-1|$=____；(3)若在数轴上有C,D两点分别表示实数c |
| dc3abfab-5168-492b-8a51-c17598c909d5 | none |  | (数形结合)在数轴上表示有理数a、b、c、d,如图所示,则正确的结论是 |
| d6bdb7e3-39f3-482b-b366-b0455fb6797b | none |  | 实数$a$、$b$在数轴上所对应的点如图所示，则$|\ qrt{3}-b| + |a+\ qrt{3}| + \ qrt |
| 00dd9f69-c969-43b4-b754-19f57c822f2c | none |  | 如图，如果长方形代表整体1，试利用这个长方形表示$\frac{2}{3} \time  \frac{1}{2}$的意义。 |
| ef27a135-3295-4a90-8f92-8e3163db632a | none |  | 实数a 和b 在数轴上所对应的点如图所示。将a、—a、b、—b 按从小到大的顺序排列起来。 |
| e801e7aa-83c5-4706-815f-01b9960160bf | none |  | 如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上. 在△ABC、△ABD、△ABE和△ABF中，与涂色三角形相 |
| 5621b755-0c2d-4138-8c8d-6d43d45ae7e9 | none | 是 | (2) 请在图(2)的两个3×3的正方形网格中分别画出与△ABC不全等的△A₁B₁C₁和△A₂B₂C₂，要求所画的三角形 |
| 92f803de-d968-4a20-a962-e074c4d09639 | none |  | 有一个简易加密系统，其加密过程如图所示. 当输出的值为√3 时，则输入的 x = ______. |
| 6f04704c-9cd3-456a-8605-1af9b6b5dfe5 | none |  | 如图，已知：在△ABC中，点D、E分别在边AB、AC上，AD=6，EC=1,BD=6,AE=8.求证：∠AED=∠B |
| 8f4622b6-1770-4ea1-a59e-f391c1f55f68 | none |  | 10. 有一个简易加密系统，其加密过程如图所示。当输出的值为\(\ qrt{3}\)时，则输入的 x=______. |
| e92f35bb-c5b3-4dc6-a339-8e4cbd4b0400 | none | 是 | (2) 求证：△APQ∽△AQD |
| 97f33d34-9264-40ab-ae64-eabe0f9b70ff | none | 是 | (1) 求证：△ADQ∽△QCP |
| 5cb0484d-1902-48f4-920e-3f1733597df2 | none |  | 如图，在△ABC中，点D在边AB上，点E在边AC上，AD=5,BD=4,BC=6,AC=12，当AE=______时，△ |
| 3bf6cd04-3417-4a6c-b42e-fda405fa9c33 | none |  | 如图，已知直线 l₁ // l₂ // l₃，DE=2EF=6，BC=5，那么AB的长为____ |
| d6bdb7e3-39f3-482b-b366-b0455fb6797b | none |  | 实数$a$、$b$在数轴上所对应的点如图所示，则$|\ qrt{3}-b| + |a+\ qrt{3}| + \ qrt |
| 92f803de-d968-4a20-a962-e074c4d09639 | none |  | 有一个简易加密系统，其加密过程如图所示. 当输出的值为√3 时，则输入的 x = ______. |
| 5c0307ae-8d39-4048-a834-55228fe7aa46 | none |  | 在如图所示的数轴上分别标出-√3.6、∛9所对应的点的大致位置。 |

### D. 流程图/表格/多子图——DSL不支持,按设计拒绝（11张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| a7391231-2657-425f-bf8f-255ee18cefc3 | none |  | 输入：\frac{7}{10}, \frac{5}{6}, \frac{2}{3}, \frac{11}{15}。运算： |
| 4cdb90bb-8b86-485a-b619-0bedcfb35ed4 | none |  | 输入：______, \frac{9}{35}, \frac{22}{35}, \frac{1}{2}；运算：+ \fr |
| ae3183fb-a274-40eb-86b1-e8d7f29794c8 | none |  | 如图1，小明把长为2，宽为1的两个长方形沿对角线剪开，围成如图2所示的一个大正方形，则空白部分小正方形的边长x的值是 |
| 5de861ac-3a1a-4ff0-9b29-b529f93591cc | none |  | 如图1，小明把长为2，宽为1的两个长方形沿对角线剪开，围成如图2所示的一个大正方形，则空白部分小正方形的边长x的值是（  |
| 845802c9-eb75-410f-831f-eb0695e99388 | none |  | 如图1，小明把长为2，宽为1的两个长方形沿对角线剪开，围成如图2所示的一个大正方形，则空白部分小正方形的边长x的值是（  |
| 638cf374-e1a7-4689-872b-190fc2d2cf63 | none |  | 欢欢设计了一个数值转换器，它可以根据用户的输入，输出特定的数。数值转换器的工作流程如图所示。
欢欢请乐乐帮忙检查其可能存 |
| 43e21c56-734d-4ecd-8f33-1552154b15fc | none |  | 欢欢设计了一个数值转换器，它可以根据用户的输入，输出特定的数。数值转换器的工作流程如图所示。
欢欢请乐乐帮忙检查其可能存 |
| 3f6abe05-0beb-44ed-a5c1-1f50f47f8633 | none |  | 有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______. |
| 8bb45561-6d12-480a-a02f-9ceb65be7e87 | none |  | 有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______ |
| 43e21c56-734d-4ecd-8f33-1552154b15fc | none |  | 欢欢设计了一个数值转换器，它可以根据用户的输入，输出特定的数。数值转换器的工作流程如图所示。
欢欢请乐乐帮忙检查其可能存 |
| f54f7aa4-713d-4b18-b2aa-7aeb03581ee5 | none |  | 输入：\frac{7}{10}, \frac{5}{6}, \frac{2}{3}, \frac{11}{15}；运算： |

### E. 重绘结构与题干引用不符——内容闸(疑含子题误杀)（48张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| b537a703-1c51-4b2f-b88e-b0c0826e2b1f | none | 是 | 求 BC₁ 的长； |
| 9de0ddaf-23e1-4162-8f43-3ecc81bad954 | none |  | 如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上. 在△ABC、△ABD、△ABE和△ABF中，与涂色三角形相 |
| 5f3e2291-4e10-46db-af9f-fb4d7e90ea84 | none |  | 如图，在平行四边形ABCD中，E是AD上一点，连接CE并延长，交BA的延长线于点F. 下列结论中，错误的是（ ） |
| 86a83ef5-44a6-48f0-b337-84c048600eff | none |  | 如图，在线段AB同侧有CA⊥AB于点A,DB⊥AB于点B，且AB=11,AC=4,BD=6，点P在AB上运动，当AP=_ |
| 345eb27f-6eef-4ff8-bc04-8df5b0bd803f | none |  | 实数 a、b 在数轴上对应的点的位置关系如图所示. 化简：\(\ qrt{a^2} - \ qrt{b^2} - \ q |
| 92e10f22-b9fd-4d89-ae55-3b8d5fe18310 | none |  | 如图，已知△ABC和△GAF是两个全等的等腰直角三角形，那么图中相似三角形（不包括全等）共有______对。 |
| a72288e3-1f99-4bf3-8a0e-7fb9aa083ffd | none |  | 如图，每个小正方形的边长均为1，点A、B、C均在格点上.请仅用无刻度的直尺作线段BC的三等分点E、F.（保留作图痕迹，不 |
| 9eb7ab98-ff6b-478d-b596-3f6b6028d7f3 | none |  | 如图，l₁//l₂，若 AF:FB=2:5, BC:CD=4:1，则 AE:EC= ______. |
| 4c8f1346-d3f4-436c-83bc-0be05b583e39 | none | 是 | 按上述操作，猜想BCₙ的长为______。 |
| e1edd2c9-6787-4bed-8fbc-b42b762fde76 | none |  | 如图，已知直线l₁//l₂//l₃//l₄,AB:BC:CD=2:3:4,EG=10，那么EH的长为______. |
| 0b54a932-8379-426c-b843-180b6c5b4a3a | none |  | 如图，两个圆的圆心相同，圆环的面积是小圆面积的2倍。若大圆的半径是√15 cm，求小圆的半径。 |
| 6954d042-5114-473a-b601-04c40c0df183 | none |  | 如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上。在△ABC、△ABD、△ABE和△ABF中，与涂色三角形相似 |
| 0b31b1fa-b457-4a85-9224-e7f0cf7a6e5c | none |  | 定义：如果直线y=-1与开口向下的抛物线有两个交点，那么这两个交点之间的距离叫作这条抛物线的“反碟长”。如图，抛物线L₁ |
| ecf44430-6265-4805-9a01-cb10284fafa2 | none | 是 | (4) 按上述操作，猜想BCₙ的长为______。 |
| 4673c23c-5d5e-4584-a907-1e8cd48badf0 | none |  | 如图，矩形ABCD的四个顶点分别在直线l₃、l、l₂、l₁上。若直线l₁//l₂//l₃//l且间距相等，CB交直线l₃ |
| 4e3fb804-09ea-49b1-95ec-3ea9a98fb58e | none |  | 如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上. 在△ABC、△ABD、△ABE和△ABF中，与涂色三角形相 |
| 747d133c-4a2d-4f1c-927e-93d7368b9c91 | none |  | 已知线段a、b、c，作线段x，使ax=bc。那么下列作法中（不含作图痕迹，各图中两条虚线平行），正确的是（ ） |
| 3b526f9e-976c-4868-8441-76adcbc97b87 | none | 是 | (2)在(1)的情况下，指出抛物线y=ax²+n的开口方向、对称轴和顶点坐标。 |
| f0ca0f00-4cd7-4d60-809c-0562dcdc5a3c | none | 是 | 如图2，E₂为E₁C上的点，E₁E₂=1/3 E₁C，作D₁E₁∥BC交AB于点D₁，连接D₁E₂并延长交BC的延长线于 |
| 72f64a8e-534e-4990-9f54-f616c3d4d98d | none | 是 | (2) 如果BF=2,EF=15，求AF的长. |
| d50459ad-39eb-4b62-b269-f5b3d1f59b84 | none |  | 如图，已知：△ABC是等边三角形，点D、E分别在边BC、AC上，∠ADE=60°.求证：AD/DE = BD/CE |
| ede11635-af27-4c7f-a927-d1c9641149c1 | none |  | 如图，在线段AB同侧有CA⊥AB于点A,DB⊥AB于点B，且AB=11,AC=4,BD=6，点P在AB上运动，当AP=_ |
| 2962b505-9779-47ba-a2fc-a5b9d563c077 | none |  | 如图，在△ABC中，点D、E分别在边AB、AC上，DE//BC, F为边BC上一点，连接AF交DE于点G. 下列结论中， |
| 9b8315ca-5dd6-46d8-8f89-0b8ab969cb66 | none |  | 已知抛物线 y=ax²+n(a>0) 与抛物线 y=-2x² 的形状相同，且其图像上与 x 轴最近的点到 x 轴的距离为 |
| 248d6e9b-a73d-490e-959b-09d02366669c | none |  | 如图，阳光透过窗口照到室内，在地面上留下2.7m宽的亮区，已知亮区一边到窗下的墙脚距离CE为8.7m，窗口高AB=1m， |
| 7dca2aad-ef55-4c74-a9d1-62e7a75b9910 | none | 是 | (1) 求证：△ABG∽△BCE. |
| 168df635-a860-4a60-8d1b-6894e3f8c85b | none | 是 | （2）如果AD=3，AE=2，求BE的长. |
| 1655ab69-3ac6-4c85-98f4-0b418037663a | none |  | 如图，在△ABC中，点D在边AB上，点E在边AC上，AD=5,BD=4,BC=6,AC=12，当AE=____时，△AD |
| 74a4114d-c75d-4067-9394-10667ba25fde | none |  | 如图，已知直线 l₁∥l₂∥l₃，AC=6，DE=3，EF=2，那么BC的长为____ |
| 63ca8f95-1465-414d-8612-d3cedb88fc76 | none |  | 下列平行线分线段的作图中，不能得到 ax=bc 的是 |
| 26c1c239-038b-47e3-a0f1-a65fd2406281 | none | 是 | (2) 如图2，E₂为E₁C上的点，E₁E₂=1/3 E₁C，作D₁E₁//BC交AB于点D₁，连接D₁E₂并延长交BC |
| b1855f33-a7fe-49e4-8996-42efecfdfbbe | none | 是 | (3)求证：BG·DF = 2CE². |
| 2c0a80f5-c457-464f-856c-4984f1f381fe | none |  | 如图，已知在△ABC中，点D在边AB上．下列条件中，能判定△ACD与△ABC相似的是( ) |
| 9fa16fed-b625-4156-9595-6db90e83713a | none |  | 如图，已知：在Rt△ABC中，∠C=90°，点D在边BC上，且AB·BC=AC·BD. 求证：∠A=∠DBC. |
| 03c65605-1f63-4236-946c-4e4f1de6c599 | none |  | 如图，在△ABC中，点D在边AB上，点E在边AC上，AD=5, BD=4, BC=6, AC=12，当AE=____时， |
| 123e12b4-d92d-44cf-a84f-897465c76d41 | none | 是 | （1）求证：△ABC∽△ADE. |
| 1bf5bf2e-e95f-40af-9bb9-f323ff2a2f8d | none |  | 如图，在线段AB同侧有CA⊥AB于点A, DB⊥AB于点B，且AB=11, AC=4, BD=6，点P在AB上运动，当A |
| 370371ce-8c50-4b50-9598-e74f226e15f0 | none |  | 如图，把A₀纸沿长边对折可得到A₁纸，把A₁纸沿长边对折可得到A₂纸，把A₂纸对折可得到A₃纸……，所有的A型纸张的长宽 |
| 74176f82-095b-4bf3-979c-e24de4606141 | none | 是 | (3) 求证：BG·DF = 2CE². |
| 168fe19e-f8f2-4d23-b58a-97805a08e75f | none |  | 如图，三个边长为1的正方形ABCD、ABEF、EFHG拼在一起，那么∠1+∠2=____ |
| 7a20490c-2942-4d50-9ba4-9d53e1fe06f7 | none |  | 如图，在数轴上有A，B，C，D四个点，则下列说法正确的是（ ） |
| ad501690-3d58-44a6-b7f2-0313b7805906 | none | 是 | ②如图(3)，当点Q与点B重合，点R与点C重合时，已知BC=10，△PMN周长的最小值为12，AB的长为____。 |
| 80ef9ba2-31d7-4c3a-be33-4826e1153b3d | none |  | 如果一条直线把一个图形的周长等分成两个部分，那么我们称这条直线为“绝美分割线”.如图，在梯形ABCD中，AD//BC,A |
| 85ae9aca-1322-464b-bb72-ac2374ed0f66 | none | 是 | (1) 求证：△ABG∽△BCE. |
| ded441ca-748d-45f9-8b6d-6c48e34bc2fe | none |  | 如图，已知：在Rt△ABC中，∠C=90°，点D在边BC上，且AB·BC=AC·BD. 求证：∠A=∠DBC. |
| d2d11a78-d663-45e2-90ab-0bf5b3547fbc | none |  | 如图，两条不平行的直线l₁与l₂相交于点O，四条平行线分别交直线l₁于点A、B、C、D，分别交直线l₂于点A₁、B₁、C |
| b456c04d-f0a6-453f-97ff-49c5a5debfa6 | none |  | 定义：如果直线y=-1与开口向下的抛物线有两个交点，那么这两个交点之间的距离叫作这条抛物线的“反碟长”。如图，抛物线L₁ |
| b3a21d15-8845-4db4-a7c9-db9a90428f46 | none |  | 如图，阳光透过窗口照到室内，在地面上留下2.7m宽的亮区，已知亮区一边到窗下的墙脚距离CE为8.7m，窗口高AB=1m， |

### F. DSL自修正失败——技术性失败(部分仍会自动重试)（16张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| 577d7fcd-591f-4cbe-a856-31df257db64a | failed(r3) | 是 | (3) 按上述操作，则BC₃的长为______； |
| 622afd21-6c3d-4283-83b8-199749ada64c | failed(r3) |  | 如图，在正方形ABCD中，E是边BC上一点，连接AE，过点B作BF⊥AE，过点D作DK⊥AE，过点C作CH⊥DK，垂足分 |
| 9dd117c1-b447-4913-a0e1-d8b6dd00bfeb | failed(r3) | 是 | (2) 如果BF=2,EF=15，求AF的长. |
| e54d9fa5-4f2f-4c45-a116-0cfba47b9023 | failed(r3) |  | 如图，在线段AB同侧有CA⊥AB于点A,DB⊥AB于点B，且AB=11,AC=4,BD=6，点P在AB上运动，当AP=_ |
| fc327608-4e8c-4b82-bc43-5deb38522b56 | failed(r3) |  | 如图，将三个全等的正方形拼成一个矩形ADHE，，则∠ABE+∠ACE+∠ADE的度数为____. |
| 7e185d42-4453-46b9-9f2f-15f1fcf75308 | failed(r3) |  | 如图，已知小方格的边长均相等．下列选项中，所画的三角形与所给△ABC相似的是( ) |
| 7ddc666d-5a9c-4b82-92c7-6e92a69a7a61 | failed(r1) |  | 如图，面积为a(a>1)的正方形ABCD的边AB在数轴上，点B表示的数为1.将正方形ABCD沿着数轴水平移动，移动后的正 |
| 61eb2c1f-8002-4fee-b879-0bf1cf75fa21 | none | 是 | （2）求证：AD²=AC·BE. |
| c83560af-cae3-403b-af8e-f9457445a72c | none |  | 如图，在6×6的菱形网格中，连接两网格线上的点A、B，线段AB与网格线的交点为M、N，则AM:MN:NB=____。 |
| 913d70a3-2cc9-4dfe-ab96-f3bc5590c998 | none |  | 如图，已知：△ABC是等边三角形，点D、E分别在边BC、AC上，∠ADE=60°.求证：AD/DE = BD/CE |
| d079ed76-2236-42c6-b0fd-370e8d319387 | failed(r1) |  | 已知数轴上的点A、B、C分别表示实数a、b、c，它们在数轴上的位置关系如图所示。化简：$\ qrt{a^2}-|c-a| |
| 76a0e2b7-ebb6-46ef-9aa0-36a44094133d | none | 是 | （3）如果BE=2，求AC的长. |
| fe7f2bc4-3ef7-4c3c-9725-41695c924312 | failed(r1) |  | 实数a、b在数轴上所对应的点如图所示，则|√3-b|+|a+√3|+√(a^2)可化简为____。 |
| eeb4ec52-08b6-4910-b18d-425e4af2df63 | failed(r1) |  | 如图，面积为a(a>1)的正方形ABCD的边AB在数轴上，点B表示的数为1.将正方形ABCD沿着数轴水平移动，移动后的正 |
| a472e76e-e745-4ca6-b64c-b03596732b29 | none |  | 如图，已知小方格的边长均相等．下列选项中，所画的三角形与所给△ABC相似的是( ) |
| 3e47df1c-7ec1-484e-8763-8a255e0ee6b3 | failed(r1) |  | 如图，面积为a(a>1)的正方形ABCD的边AB在数轴上，点B表示的数为1.将正方形ABCD沿着数轴水平移动，移动后的正 |

### G. 产物过期stale——直接重跑即可（1张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| 4145e541-2bd2-40c9-ba83-46113c9bfd12 | none |  | 如图，在数轴上，-\ qrt{2}与\ qrt{5}之间的整数的个数是____. |

### H. 结构解析失败(24h watchdog放弃)（1张）

| question_id | status | 有parent | 题干摘录 |
|---|---|---|---|
| 12285fad-9c49-41cf-bd0a-ef5d61ba566f | none |  | 如图，已知直线 l₁∥l₂∥l₃，AB=3，AC=9，DE=2，那么DF的长是（ ） |

## 判对降级清单（共72张，无需处理）

- 00525d07-e124-49c2-b453-2c3f2b1ef1d3 (geometry_image) 如图，在△ABC中，点D、E分别在边AB、AC上，DE//BC,F为边BC上一点，连接AF交DE于点G. 下列结论中，正
- 02cfd2eb-b0de-4f6f-9447-54f423269168 (geometry_image) 如图，已知：在四边形ABCD中，∠BAC=∠ADC=90°，AD=a，BC=b，AC=√ab. 求证：DC⊥BC.
- 084dba01-e4ba-4fa6-b6cb-f6303d6c1da8 (geometry_image) 如图，已知直线l₁//l₂//l₃//l,AB:BC:CD=2:3:4, EG=10，那么EH的长为______.
- 0aa7ab0d-a543-4f9e-8cf5-0bf7b629c605 (geometry_image) 已知线段a、b、c，作线段x，使ax=bc.那么下列作法中（不含作图痕迹，各图中两条虚线平行），正确的是 ( )
- 0b11579d-4d73-4708-9aa5-85a767b215d8 (geometry_image) 如图，已知：在 Rt△ABC 中，∠C=90°，点 D 在边 BC 上，且 AB/DA = BC/AC. 求证：∠B=∠
- 0b8f1392-5c49-410f-89f9-828ab1e987f1 (geometry_image) 如图，在平行四边形ABCD中，E是AD上一点，连接CE并延长. 交BA的延长线于点F. 下列结论中，错误的是
- 0bbf1f54-c7da-4f27-80ba-e5f2cb43faa7 (geometry_image) 如图，在$\triangle ABC$中，$DE // BC$，分别交$AB$、$AC$于点$D$、$E$，且$\fra
- 0f230edf-c2ee-4be7-acbf-40f9999ee86f (geometry_image) 已知线段a、b、c，作线段x，使ax=bc. 那么下列作法中（不含作图痕迹，各图中两条虚线平行），正确的是（ ）
- 1434c429-a516-48f0-b66e-4282fa64f3f7 (geometry_image) 如图，已知在四边形ABCD中，∠BAC=∠ADC=90°，那么可以添加条件“AC²=______”，利用定理“斜边和一条
- 198a3707-b801-4d74-ae23-29cae8beba67 (geometry_image) 如图，点D在△ABC的AB边上，当AD/AC=____时，△ACD与△ABC相似．
- 1bf20a1d-ab21-4c89-a929-524f0b258510 (geometry_image) 如图，在△ABC中，点D在边AB上，点E在边AC上，AD=5,BD=4,BC=6,AC=12，当AE=____时，△AD
- 1e2d190c-6e4e-45d5-b1a6-5c89b46663ff (geometry_image) 如图，已知DE//BC，那么下列结论中，不正确的是
- 22e78842-d5c6-454f-b20d-e39a8adc0d4e (geometry_image) 如图，已知直线l₁//l₂//l₃，直线AC与DF相交于点H，如果AH=2,BH=1,BC=5，那么DE/EF的值为 _
- 30be3454-668b-426a-8b65-ba2edd781e59 (geometry_image) 如图，已知：在△ABC中，点D、E分别在边AB、AC上，AD=6，EC=1,BD=6,AE=8.求证：∠AED=∠B
- 322c4489-3a84-48c6-b75c-6a7105270ed6 (geometry_image) 如图，两个圆的圆心相同，圆环的面积是小圆面积的2倍。若大圆的半径是√15 cm，求小圆的半径。
- 334e26cf-acf5-437d-a2cd-e965e0913149 (geometry_image) 五角星是生活中常见的一种图形．如图，已知C、D为线段AB的黄金分割点，AB=2，那么线段CD的长为 ____ .
- 33ece6f8-94df-4916-9bfa-d981efd7ca4d (geometry_image) 如图，已知：△ABC是等边三角形，点D、E分别在边BC、AC上，∠ADE=60°.求证：AD/DE = BD/CE
- 34416003-bbe7-445f-80ac-1bed4f8da26d (chart_image) 已知 k、b 均为常数，在同一平面直角坐标系中，一次函数 y = kx + b 与二次函数 y = kx² + b 的大
- 34bbc424-040f-4153-b46d-b5ad7a9fd42f (geometry_image) 求证：(1) △BCD∽△CDE。
- 3b11339a-e092-42ed-bc02-7d7133253ead (geometry_image) 如图，已知直线 l₁∥l₂∥l₃，那么下列结论中，正确的是（ ）
- 3b429e41-1487-4941-abbf-29d73af506d6 (chart_image) 第 36 题
- 3d276a9d-6e5a-49de-a671-416819778b72 (geometry_image) 如图，已知直线 l₁ // l₂ // l₃，那么下列结论中，正确的是（ ）
- 40488d5c-272c-40f3-9ede-9320ba328792 (chart_image) 有一个简易加密系统，其加密过程如图所示. 当输出的值为 $\ qrt{3}$ 时，则输入的 $x=$______.
- 46118ede-d267-4de1-a6fb-ef17023a9086 (geometry_image) 如图，在△ABC中，M、N分别是AB、BC的中点，连接AN、CM交于点G，GF//AC，交BC于点F，那么S△NGF/S
- 467f9ac9-fefc-46f1-94b7-5f6f19efe408 (geometry_image) 如图，已知直线$l_1//l_2//l_3$，AB=3，AC=9，DE=2，那么DF的长是 ( )
- 4ecb2264-ceab-4621-9b7d-0629f8f85ac0 (geometry_image) 如图，在△ABC中，D、E分别是边AB、AC上的点且$\frac{AD}{AB}=\frac{AE}{AC}$，如果AD
- 52fe7be0-823d-4a0f-ab2b-f3cbfefe3dbb (geometry_image) 如图，已知：在△ABC中，点D、E分别在边AB、AC上，AD=6，EC=1,BD=6,AE=8.求证：∠AED=∠B
- 558ecaa4-8963-432b-94c5-af07e670f346 (geometry_image) ① 如果MN=4，那么线段QR的长为____.
- 56f720b1-f46c-43a3-9965-d086cdd9e1b9 (geometry_image) 如图，已知直线$l_1//l_2//l_3$，DE=2，EF=6，BC=5，那么AB的长为 ______
- 5f46fcf6-8d7f-451f-9bbb-fdfaff6e8ffd (geometry_image) (1) 求证：△ADQ∽△QCP
- 623def96-5c34-4159-aa8d-256b09ccdbee (geometry_image) 如图，已知：在△ABC与△A₁B₁C₁中，AB=AC，A₁B₁=A₁C₁，BD⊥AC，B₁D₁⊥A₁C₁，垂足分别为D、
- 699691ca-a76c-43f0-b665-ba319d002dd7 (geometry_image) 如图，已知四边形ADEF是菱形，顶点D、E、F分别在△ABC的边AB、BC、AC上，CF/AF=1/2. 求AF/BD的
- 6c7c73ae-4413-4c59-ad9a-1fc06d123327 (geometry_image) 如图，已知直线l₁//l₂//l₃，直线AC与DF相交于点H，如果AH=2,BH=1,BC=5，那么DE/EF的值为__
- 70c65ca9-3df3-44a8-9056-5157b59494bf (chart_image) (1) 求抛物线 C₁ 的表达式和点 D 的坐标；
- 73224884-fd3d-4de1-b6b8-86c548b8cb0b (geometry_image) 如图，在△ABC中，点D、E分别在边AC、AB上，△ADE∽△ABC，M、N分别是DE、BC的中点。如果AM/AN=1/
- 77cb8027-0b4b-45ea-897f-79e35c1c12ed (chart_image) (1)求 a 和 k。
- 837494c8-614e-4875-8694-771137f4df1d (geometry_image) 如图，在□ABCD中，E是BA延长线上一点，CE与边AD相交于点F. 如果AF/FD = 1/2，那么EA/AB =
- 83b41911-64c8-4151-bc4f-3aa373d8a023 (geometry_image) 如图，每个小正方形的边长均为1，点A、B、C均在格点上. 请仅用无刻度的直尺作线段BC的三等分点E、F. （保留作图痕迹
- 841af484-dbfa-4cbb-b003-1b352dacf6ef (chart_image) 输入：______, ______, ______, ______。运算：+ \frac{1}{7}。输出：\frac{
- 8cfb7993-094a-419f-a351-9de0f5d1af01 (chart_image) (2)求点 B 坐标。
- 8f51028a-7c61-498e-9f8e-8f867c726f3c (geometry_image) 如图，$DE // BC$，$DF // AC$，$AB = 3BD$，$DE = 12$，则$BF$的长为
- 93762de2-5a81-449c-bb37-2425868fd3d6 (geometry_image) (2) 求证：△APQ∽△AQD
- 986d4700-2b25-4068-865a-68a1fa5c06d9 (geometry_image) 如图，已知直线l₁//l₂//l₃//l,AB:BC:CD=2:3:4,EG=10，那么EH的长为 ______.
- 99a75eb7-3825-4a8b-b56d-9ec27c03b7c2 (geometry_image) (2) CD²/BC² = AD/AB
- a170d8e7-3cba-4c36-adda-912f68097dc9 (geometry_image) 如图，在$\ quare ABCD$中，对角线$AC$、$BD$交于点$O$，$E$为$OB$的中点，连接$AE$并延长
- a3b47a5d-0157-4536-be88-7a38adaf7f4f (geometry_image) 如图，已知直线$l_1 \parallel l_2 \parallel l_3$，AC=6，DE=3，EF=2，那么BC
- a6afb7e1-7a7b-44d4-bcee-90551dd34677 (geometry_image) 如图，在$\triangle ABC$和$\triangle ACD$中，点$E$、$G$、$F$分别在边$AB$、$A
- ad3070c4-868b-4d42-99e3-e9eadbe0f00f (geometry_image) 如图，已知在△ABC中，DE//BC，S△ADE:S四边形BCED=3:5，BC=2√6. 求DE的长.
- aec9e7c0-ebbb-4da5-a16b-ea8808285f5d (chart_image) (3)△OAB 的面积。
- b38285cf-fb72-47fb-b4af-9b0d6edcc3ea (geometry_image) 如图，已知直线$l_1//l_2//l_3$，$\frac{AG}{GB} = \frac{2}{3}$，那么$\fra
- b4e30eab-7327-405e-99b7-2b8d639b02fd (chart_image) 通过分析数据，发现可以用函数刻画 y₁ 与 x，y₂ 与 x 之间的关系。在同一平面直角坐标系 xOy 中，已经画出 y
- b6b1112e-0e56-457b-b053-69f88c51bf86 (chart_image) 如图，数轴上有 O、A、B、C、D 五个点，分别表示数 0、2、3、4、5，则表示数 \ qrt{2}\time \ q
- be2bc039-07a2-4de9-a119-527c72abc4ed (geometry_image) (2) CD²/BC² = AD/AB
- c0671da1-a0d8-4a10-ab18-aeb243091fbd (geometry_image) 如图，在△ABC中，点D、E分别在边AC、AB上，△ADE∽△ABC，M、N分别是DE、BC的中点. 如果AM/AN =
- c4fcea63-0a95-47f9-8805-d366e4d87e49 (geometry_image) 如图，已知∠B=∠E=90°，AB=6，BF=3，CF=5，DE=15，DF=25. 求证：GF=GC.
- c5dfb79f-b001-405c-b4b2-8df47f77b09d (geometry_image) 如图，在△ABC中，点D、E分别在边AB、AC上，且DE//BC. 如果 AD=4, DB=2，那么CE/AC的值为
- c91c891c-c7a6-4e3b-9968-bb12ceefbca6 (geometry_image) 如图，$F$是平行四边形$ABCD$的边$CD$上一点，直线$BF$交$AD$的延长线于点$E$，有下列结论：①$\fr
- c96c58f0-d572-41bc-a132-db32faa72536 (geometry_image) 如图，已知在△ABC中，DE//AB，BE/EC=2/5，S△CDE=25，那么S四边形ABED=______。
- ca4afd8e-4de1-4758-a4ec-58e307899686 (geometry_image) 如图，已知：在△ABC中，点D、E分别在边AB、AC上，AD=6，EC=1,BD=6,AE=8.求证：∠AED=∠B
- caf1a317-e09b-485b-85fd-f8915574c2e0 (geometry_image) 如图，已知在△ABC中，点D在边AB上．下列条件中，能判定△ACD与△ABC相似的是( )
- cb6b60e9-5857-4d8f-a40b-0225154c7813 (geometry_image) 有一城门洞的横截面呈抛物线形，拱高4m(最高点到地面的距离)，把它放到如图所示的平面直角坐标系中，其表达式为y=-x²。
- cc89628b-59f2-402e-a901-19bea764f4d8 (geometry_image) 求证：(1) △BCD∽△CDE。
- d3bd5ed2-0c02-4aef-913b-fcde3cf239f9 (geometry_image) 如图，如果长方形代表整体1，试利用这个长方形表示\(\frac{2}{3} \time  \frac{1}{8}\)的意
- dfeae4a7-43c5-4ad1-b35c-da498b83b508 (geometry_image) 求证：△ABC∽△DEC.
- e13f384e-7e90-4195-b3bc-0d939b271814 (geometry_image) 如图，AB // CD，AD与BC相交于点O. 如果AO=1 BO=1.2,OD=2.5，那么CO=
- e18290b1-bf3c-4a65-b97c-571c75bbf2b3 (chart_image) (2) 如果抛物线 C₂ 是 C₁ 的“子抛物线”，且 C₂ 经过原点，顶点为 E。① 求证：抛物线 C₁ 也是抛物线 
- e2ada4d1-0a26-4460-9183-a3f27188d61c (geometry_image) 如图，已知直线 l₁ // l₂ // l₃，AB=3，AC=9，DE=2，那么DF的长是（ ）
- e5fa2635-c993-41a4-a1a2-82667cce2d2e (chart_image) 已知 k、b 均为常数，在同一平面直角坐标系中，一次函数 y=kx+b 与二次函数 y=kx²+b 的大致图像可能是（ 
- eb51e564-616d-46b5-94bd-9894f73331d5 (geometry_image) (2)点M(m,t),N(m+2,t)都在该抛物线上,求m的值.
- f13a517f-6f44-4400-a077-19e596ca06ae (geometry_image) ①如果MN=4，那么线段QR的长为______.
- fa45eb77-f490-4c14-a7f8-b250e99321a4 (chart_image) 已知 k、b 均为常数，在同一平面直角坐标系中，一次函数 y=kx+b 与二次函数 y=kx²+b 的大致图像可能是（ 
- fb2c5445-b4c9-44e3-887a-b50f07eb6f55 (geometry_image) 如图，已知在△ABC中，DE // BC, EF // AC, BE=2AE BF=8，那么DE的长为

## 从未登记asset行的题（共44张）

- 02199368-7b60-4d6c-9166-f9310cd100c3 上述表格中：m=____；
- 0499130b-1107-4bb9-8bf7-7bbaa810178f 如图，点D在△ABC的AB边上，当AD/AC = ____时，△ACD与△ABC相似.
- 19d9768f-676d-451b-bad8-455ea9e5ec53 √(-2x+3)
- 261956e9-e4ef-4263-8664-db8bd0e2ab41 (______) + (______) = (______)
- 277ad68c-efd1-4db8-b71e-064777eb6451 如图，三个边长为1的正方形ABCD、ABEF、EFHG拼在一起，那么∠1+∠2=____。
- 2b4aaeec-3d98-467e-831e-9c4109462d78 已知线段a、b、c，作线段x，使ax=bc。那么下列作法中（不含作图痕迹，各图中两条虚线平行），正确的是（  ）
- 2cd1d22b-72c9-4388-987c-f158982fc778 (1) 填空：BC/AC=____；∠BCA=____.
- 301c9a19-cee1-495f-879e-98a125eeeacd 如图，已知直线$l_1 \parallel l_2 \parallel l_3$，那么下列结论中，正确的是 ( )
- 34416003-bbe7-445f-80ac-1bed4f8da26d 已知 k、b 均为常数，在同一平面直角坐标系中，一次函数 y = kx + b 与二次函数 y = kx² + b 的大
- 3b429e41-1487-4941-abbf-29d73af506d6 第 36 题
- 3f7c7b3a-949b-488c-b124-0c72da47cd80 成绩在70分~89分的中等学生的人数占全班总人数的几分之几？
- 40488d5c-272c-40f3-9ede-9320ba328792 有一个简易加密系统，其加密过程如图所示. 当输出的值为 $\ qrt{3}$ 时，则输入的 $x=$______.
- 4cdb90bb-8b86-485a-b619-0bedcfb35ed4 输入：______, \frac{9}{35}, \frac{22}{35}, \frac{1}{2}；运算：+ \fr
- 5af431ca-2e14-4836-abee-b633ba19c1ff （结合时事）最近几年时间，全球的新能源汽车发展迅猛，尤其对于我国来说，新能源汽车产销量都大幅增加。小明家新换了一辆新能源
- 6433d66f-539c-41fa-9ce8-5d95e5bd2f96 如图，将三个全等的正方形拼成一个矩形ADHE，则∠ABE+∠ACE+∠ADE的度数为____.
- 66a74c8f-bc90-4cd3-a6fa-b7fae5e3f62d (1) 如果 0<x₁<x₂，那么 y₁ ___ y₂；（填“>”、“=”或“<”）
- 70c65ca9-3df3-44a8-9056-5157b59494bf (1) 求抛物线 C₁ 的表达式和点 D 的坐标；
- 76ac4e24-031c-4321-b246-8bed68744c5b 如图，已知：AB/AD = AC/AE = BC/DE，求证：AB·CE=AC·BD
- 76c6c09c-2560-4975-bc8b-9d6e84ef850f 已知某函数的图像如图所示。
(1)求这个函数的表达式；
(2)求这个函数的对称轴及顶点坐标；
(3)根据图像，求当x为何
- 77cb8027-0b4b-45ea-897f-79e35c1c12ed (1)求 a 和 k。
- 7d5a2ba0-d55f-4d6a-8d76-adc62bfbd3f8 已知实数 a、b 在数轴上的位置如图所示，化简：√((a+1)²) + 2√((b-1)²) - |a-b|
- 8143bc98-498b-4858-a4b1-3c122a8dbce4 如图，已知在四边形ABCD中，∠BAC=∠ADC=90°，那么可以添加条件“AC^2=____”，利用定理“斜边和一条直
- 841af484-dbfa-4cbb-b003-1b352dacf6ef 输入：______, ______, ______, ______。运算：+ \frac{1}{7}。输出：\frac{
- 86d2b985-8871-48d8-bb8b-92c3cb0321e3 如图，已知在△ABC中，D、E分别是边AB、AC上的点，∠AED=∠B，AD=2，AC=3，△ABC的角平分线AF交DE
- 86f6d652-3b0a-434b-a5c1-8323e50dcd32 5. 已知一条抛物线经过 A(0,10), B(m+2,n), C(4-m,n), D(3,1) 四点，则抛物线的表达式
- 8b9ea14a-5a8b-46d8-99b9-3e38ce5ad80f 如图，点D在△ABC的AB边上，当AD/AC = ____时，△ACD与△ABC相似．
- 8cfb7993-094a-419f-a351-9de0f5d1af01 (2)求点 B 坐标。
- 993d86f4-9109-4f40-98aa-0fe9492fd278 如图，已知直线 l₁ // l₂ // l₃，AC=6，DE=3，EF=2，那么BC的长为____
- 995d56a8-b141-4a67-a74e-d69f1301cd8a 如图，已知：在△ABC中，点D、E分别在边AB、AC上，AD=6，EC=1, BD=6, AE=8. 求证：∠AED=∠
- a7391231-2657-425f-bf8f-255ee18cefc3 输入：\frac{7}{10}, \frac{5}{6}, \frac{2}{3}, \frac{11}{15}。运算：
- aec9e7c0-ebbb-4da5-a16b-ea8808285f5d (3)△OAB 的面积。
- b4e30eab-7327-405e-99b7-2b8d639b02fd 通过分析数据，发现可以用函数刻画 y₁ 与 x，y₂ 与 x 之间的关系。在同一平面直角坐标系 xOy 中，已经画出 y
- b5ad38fc-017e-4dca-af7f-039209340528 如图，在Rt△ABC和Rt△DEF中，∠BAC=∠EDF=90°，AB=3,AC=4,DE=4 DF=8. 点M在边BC
- bd01edff-b4ee-402f-9dc4-9d667cea67de 如图，以下是用"尺规作图"将一个三角形分割成一个小三角形和一个四边形的四种作法，在下列图形中，△ABC与△AEF相似的有
- bd6ec7cd-129b-4a9e-8c68-0c6e64fbb247 已知整数n满足：n < √2026 < n+1，参考下表数据，判断n的值为（ ）
- be97c7d3-8123-4bed-8e6b-c72c3f304108 如图，在Rt△ABC中，∠ACB=90°，CD是边AB上的高. 已知BC=4BD=2，那么AD的长为____
- d8bd0cff-e475-49ca-902e-65c3bcf431cd 填空：BC/AC=____，∠BCA=____
- da830599-df42-4def-a88e-6e36d2fdf518 如图，已知：AB/AD = AC/AE = BC/DE，求证：AB·CE=AC·BD
- e18290b1-bf3c-4a65-b97c-571c75bbf2b3 (2) 如果抛物线 C₂ 是 C₁ 的“子抛物线”，且 C₂ 经过原点，顶点为 E。① 求证：抛物线 C₁ 也是抛物线 
- e19aae64-2236-4111-b5cb-3368194967ae 求证：PM=QM。
- e5c89685-58c3-4fbc-8664-b5aa6f814610 如图，已知直线 l₁ // l₂ // l₃，AG/GB = 2/3，那么 (AG+CH)/(AB+CD) 的值为___
- e5fa2635-c993-41a4-a1a2-82667cce2d2e 已知 k、b 均为常数，在同一平面直角坐标系中，一次函数 y=kx+b 与二次函数 y=kx²+b 的大致图像可能是（ 
- f54f7aa4-713d-4b18-b2aa-7aeb03581ee5 输入：\frac{7}{10}, \frac{5}{6}, \frac{2}{3}, \frac{11}{15}；运算：
- fa45eb77-f490-4c14-a7f8-b250e99321a4 已知 k、b 均为常数，在同一平面直角坐标系中，一次函数 y=kx+b 与二次函数 y=kx²+b 的大致图像可能是（ 
