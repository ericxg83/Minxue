# 未走重绘产物的引图错题清单（2026-09-27 晚实况）

数据源：wrong_questions × questions 实时查询，展示类型判定与前端
src/utils/geometryDisplay.js getGeometryDisplayUrl 同源。重绘产物（svg_code）不列。

| 类别 | 数量 | 含义 |
|---|---|---|
| raw（原图裁片回退） | 6 | 重绘失败/被拒，展示原扫描裁片 |
| clean（描摹/URL 产物） | 39 | 展示描摹或历史 URL，非本次 DSL 重绘 |
| none（无图可显） | 0 | **最优先人工检查** |
| other | 0 | tikz 等遗留类型 |


## raw（6 道）

| # | 题目ID | 题干摘录 | 分组 | 资产状态 | 失败原因(last_error) | 当前展示图URL |
|---|---|---|---|---|---|---|
| 1 | `2d0554b8` | (1) 请求出这个二次函数的表达式； | 重绘失败待重试 | none | 人工复核：重绘丢失 4m/8m 尺寸数字且题干无此数据，图不足以解题，作废回退原图（两轮重试均缺） | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260926/14a58084-6ef1-4a3b-860f-62fe6350d35c.png |
| 2 | `3baefdea` | 如图，长方形内有两个相邻的正方形，其面积分别为4和10，则图中阴影部分面积为____. | 描摹/复核URL | pending | 图中无可重绘的几何结构（数轴/实物/统计图） | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bd31776e-6673-474c-ae1f-8a22d69cbd46/20260927/7e77c09a-87ed-4949-9966-fe9698bc3c54.png |
| 3 | `5621b755` | (2) 请在图(2)的两个3×3的正方形网格中分别画出与△ABC不全等的△A₁B₁C₁和△A₂B₂C₂，要求所画的三角形各顶点都在格点上，△A₁B₁C₁～△A₂B₂C₂～△ABC且B₁C₁:B₂C₂≠ | 描摹/复核URL | none | 图中无可重绘的几何结构（数轴/实物/统计图） | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260927/883e7f3e-181b-4583-b67d-7b1be46a0098.png |
| 4 | `9b409c35` | 2.二次函数的图像如图所示,则其表达式是 | 重绘失败待重试 | none | 人工复核：重绘网格缺数字刻度且题干无数据，表达式不可定，作废回退原图（两轮重试均缺） | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/afae6ef7-d071-42c5-b229-faaef0e443f7/20260915/5e3e2d68-e350-427f-a4b1-9ffd564b3810.png |
| 5 | `b77fd012` | 有一城门洞的横截面呈抛物线形，拱高4m(最高点到地面的距离)，把它放到如图所示的平面直角坐标系中，其表达式为y=−x²。(1)城门洞最宽处AB的长是多少？(2)现有一高为2.6m、宽为2.2m的运货车 | 描摹/复核URL | none | 人工复核：重绘丢失地面AB弦与拱高标注（结构与原图不符），作废回退原图 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/ee200770-3631-40b9-a60e-e4e275ac8495/20260917/37f8602a-04e6-4060-8260-e8480eeb4b89.png |
| 6 | `fe7f2bc4` | 实数a、b在数轴上所对应的点如图所示，则\|√3-b\|+\|a+√3\|+√(a^2)可化简为____。 | 重绘失败待重试 | none | 数轴目测重绘相对原图缺字母点/刻度标注（清晰但画错），回退裁剪原图: 数轴重绘相对原图缺字母点/刻度标注 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/9d8b442b-90dc-4bfa-af6a-74ec4c483fa8/20260927/0e4b842a-7b88-4b11-9199-5e3a4f1e2e2f.png |

## clean（39 道）

| # | 题目ID | 题干摘录 | 分组 | 资产状态 | 失败原因(last_error) | 当前展示图URL |
|---|---|---|---|---|---|---|
| 1 | `033d6738` | 写出 y 与 x 的函数关系式及 x 的取值范围； | 描摹/复核URL | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260925/364b9630-fd08-4e35-a097-60b93db79e12.png |
| 2 | `168fe19e` | 如图，三个边长为1的正方形ABCD、ABEF、EFHG拼在一起，那么∠1+∠2=____ | 被内容闸拒绝 | none | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的线段 CF 在题干中无引用；重绘图上的线段 CH 在题干中无引用；题干说 正方形ABCD，重绘图各边长比达 2.25:1 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/afae6ef7-d071-42c5-b229-faaef0e443f7/20260926/b3ad229b-a303-4e7a-ab04-9bca28e9a892.png |
| 3 | `1db136a7` | 如图，已知小方格的边长均相等．下列选项中，所画的三角形与所给△ABC相似的是( ) | 描摹/复核URL | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/0575f64d-3c9e-42d5-a5e4-7a461ccef385/20260927/0efaea8e-4ab4-4d03-af97-8f403cd2d35c.png |
| 4 | `2373ea24` | 如图，已知平行四边形ABCD顶点A的坐标为(2,6)，点B在y轴上，且AD//BC//x轴，过B、C、D三点的抛物线的顶点坐标为(2,2)，则抛物线的表达式是y=______。 | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-2373ea24/20260920/064ddca2-3c95-46fc-b1bc-9ef36b34b89c.png |
| 5 | `248d6e9b` | 如图，阳光透过窗口照到室内，在地面上留下2.7m宽的亮区，已知亮区一边到窗下的墙脚距离CE为8.7m，窗口高AB=1m，那么窗口底边离地面的高度BC为____m. | 描摹/复核URL | pending |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/23aabcd4-e3a5-47e5-9170-78d2122255b3/20260927/c12d9645-49c7-4d5c-b9a2-60df5980f190.png |
| 6 | `2964cd93` | (1)求抛物线的表达式； | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-2964cd93/20260920/a17c4fdd-9787-485e-8f77-b67890a3f7f3.png |
| 7 | `29ea1e77` | 7.如图,抛物线 y=-x²+mx 的对称轴为直线 x=2.若关于 x 的一元二次方程 -x²+mx-t=0(t 为实数)在 1<x<3 的范围内有解,则 t 的取值范围是 | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-29ea1e77/20260920/9f3aa8fb-7188-42da-8487-a2a69e8a54cd.png |
| 8 | `325fd250` | 如图，已知小方格的边长均相等。下列选项中，所画的三角形与所给△ABC相似的是( ) | 描摹/复核URL | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/afae6ef7-d071-42c5-b229-faaef0e443f7/20260927/a9a8d1c0-42d6-40ba-9c42-0ef5bdddba03.png |
| 9 | `332711ac` | 如图，在平面直角坐标系中，正方形OABC的顶点A在y轴的负半轴上，顶点C在x轴的负半轴上。抛物线y=a(x+3)²+c(a>0)的顶点为E，且经过点A、B，若△ABE为等腰直角三角形，求a的值。 | DSL-20批次 | completed | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 题干说 正方形OABC，重绘图各边长比达 2.85:1 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-332711ac/20260920/0437afe8-e286-4740-902a-0a7dde3804fb.png |
| 10 | `3f6abe05` | 有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______. | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: flowchart | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/5c7a5ea1-d46b-40f1-a80b-a424aabe7303/20260926/a251f0a7-b204-4e89-9071-04b98788e6ad.png |
| 11 | `40bb33a0` | 如图，把A₀纸沿长边对折可得到A₁纸，把A₁纸沿长边对折可得到A₂纸，把A₂纸对折可得到A₃纸……，所有的A型纸张的长宽之比是一个定值，这个定值是____. | 重绘失败待重试 | none | DSL 强制通道未通过: no_dsl_in_reply:FIX [24h watchdog] 已超过 24h 且重试 >= 3 次,放弃 Vision 回退原图 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/cd4773e3-71da-4da3-a452-cfb7f9b6c33f/20260926/0bad88d0-ed6f-4178-9c58-621c285819ff.png |
| 12 | `43e21c56` | 欢欢设计了一个数值转换器，它可以根据用户的输入，输出特定的数。数值转换器的工作流程如图所示。 欢欢请乐乐帮忙检查其可能存在的漏洞，并提醒乐乐，这个数值转换器只能输入绝对值小于10的实数。乐乐发现，输入 | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: flowchart | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/91099a74-79f8-4de3-a178-2dc5594168c0/20260926/598ae053-b2d6-45e5-9fb5-dfd3e7b3c532.png |
| 13 | `4bb93a21` | 如图，把A₀纸沿长边对折可得到A₁纸，把A₁纸沿长边对折可得到A₂纸，把A₂纸对折可得到A₃纸……，所有的A型纸张的长宽之比是一个定值，这个定值是____. | 重绘失败待重试 | failed | 结构不可渲染: parse_fail | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bd31776e-6673-474c-ae1f-8a22d69cbd46/20260926/5663e8fb-40a4-4773-8d0f-6be310b4a085.png |
| 14 | `504368f9` | 在平面直角坐标系 xOy 中,将点 P₁(a,b-a) 定义为点 P(a,b) 的"关联点".已知点 A(x,y) 在函数 y=x² 的图像上(如图所示),点 A 的"关联点"是点 A₁. (1) 请 | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-504368f9/20260920/5eac4c14-7515-4baa-bc00-3d3853e11652.png |
| 15 | `56b77a92` | 如图,在平面直角坐标系中,点 A 在抛物线 y=x²-2x+2 上运动,过点 A 作 AC⊥x 轴于点 C,以 AC 为对角线作矩形 ABCD,连接 BD,则对角线 BD 的最小值为____. | DSL-20批次 | completed | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的点 O 在题干中未出现 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-56b77a92/20260920/67a3b878-a598-4323-93ba-21c001774296.png |
| 16 | `5de861ac` | 如图1，小明把长为2，宽为1的两个长方形沿对角线剪开，围成如图2所示的一个大正方形，则空白部分小正方形的边长x的值是（ ） | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: multi_panel | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/cd4773e3-71da-4da3-a452-cfb7f9b6c33f/20260926/21e04c10-b47d-4584-9a93-73e6a946e8fc.png |
| 17 | `602d324b` | 如图,抛物线 y=ax²+1(a<0) 与过点(0,-3)且平行于 x 轴的直线相交于点 A、B,与 y 轴交于点 C,若∠ACB 为直角,则 a= | DSL-20批次 | completed | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的点 O 在题干中未出现 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-602d324b/20260920/f23c5806-e8ef-4f33-8db7-750a1c7b4945.png |
| 18 | `622afd21` | 如图，在正方形ABCD中，E是边BC上一点，连接AE，过点B作BF⊥AE，过点D作DK⊥AE，过点C作CH⊥DK，垂足分别为F、K、H，交BF的延长线于点G. 以点F为圆心、以FA为半径画弧，交AD于 | 重绘失败待重试 | none | Vision 重建超过最大重试 (3),已回退裁剪原图。最后一次错误: 结构不可渲染: parse_fail | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/0575f64d-3c9e-42d5-a5e4-7a461ccef385/20260926/9f93f3eb-863e-421e-8d85-532ea8f86843.png |
| 19 | `638cf374` | 欢欢设计了一个数值转换器，它可以根据用户的输入，输出特定的数。数值转换器的工作流程如图所示。 欢欢请乐乐帮忙检查其可能存在的漏洞，并提醒乐乐，这个数值转换器只能输入绝对值小于10的实数。乐乐发现，输入 | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: flowchart | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/9d8b442b-90dc-4bfa-af6a-74ec4c483fa8/20260926/a14cf58c-bba6-48c2-972a-13eb746c2eb9.png |
| 20 | `6ef9c615` | 如图，已知直线l₁//l₂//l₃//l₄，AB:BC:CD=2:3:4，EG=10，那么EH的长为______。 | 被内容闸拒绝 | none | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的点 F 在题干中未出现 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260926/296830dd-ef22-4406-8416-19fabb509ede.png |
| 21 | `73954cd1` | 如图，抛物线 y=-x²+mx 的对称轴为直线 x=2。若关于 x 的一元二次方程 -x²+mx-t=0(t 为实数) 在 1<x<3 的范围内有解，则 t 的取值范围是 | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-73954cd1/20260920/9bfd810f-3bee-4df8-9c08-77b5a73a24a1.png |
| 22 | `7d5fda9a` | 6.如图,是由长方形和抛物线构成的图案,由6个全等的基本图案组成,建立如图所示的平面直角坐标系.若抛物线A₁的表达式为 y=-(x-6)²+4,则抛物线A₆的表达式为 | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-7d5fda9a/20260920/eafc0173-20d1-40ad-ab0e-446296d19012.png |
| 23 | `7e185d42` | 如图，已知小方格的边长均相等．下列选项中，所画的三角形与所给△ABC相似的是( ) | 描摹/复核URL | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/ee200770-3631-40b9-a60e-e4e275ac8495/20260927/dff35199-38d8-4c44-82a0-d5d4f8c5264e.png |
| 24 | `845802c9` | 如图1，小明把长为2，宽为1的两个长方形沿对角线剪开，围成如图2所示的一个大正方形，则空白部分小正方形的边长x的值是（ ） | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: multi_panel | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bd31776e-6673-474c-ae1f-8a22d69cbd46/20260926/9dc54be9-a86f-4df0-a09e-6bf29366a5cb.png |
| 25 | `8bb45561` | 有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______ | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: flowchart | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/49b7df03-f7e1-435d-986a-51ff983f7460/20260926/fa33d35a-25d1-4037-b1b1-c7410ec8ca83.png |
| 26 | `8f4622b6` | 10. 有一个简易加密系统，其加密过程如图所示。当输出的值为\(\sqrt{3}\)时，则输入的 x=______. | 描摹/复核URL | none | 图中无可重绘的几何结构（数轴/实物/统计图） | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/49b7df03-f7e1-435d-986a-51ff983f7460/20260926/800b4481-ddd4-4555-abc4-b2205e322334.png |
| 27 | `8fae272f` | 如图，阳光透过窗口照到室内，在地面上留下2.7m宽的亮区，已知亮区一边到窗下的墙脚距离CE为8.7m，窗口高AB=1m，那么窗口底边离地面的高度BC为____m. | 描摹/复核URL | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260926/b469335f-5345-4a46-9dcc-b9073c9c36f5.png |
| 28 | `92e10f22` | 如图，已知△ABC和△GAF是两个全等的等腰直角三角形，那么图中相似三角形（不包括全等）共有______对。 | 被内容闸拒绝 | none | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的点 D 在题干中未出现；重绘图上的点 E 在题干中未出现 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/ee200770-3631-40b9-a60e-e4e275ac8495/20260926/41b4daa1-57ff-4af9-b009-f5695add231f.png |
| 29 | `92f803de` | 有一个简易加密系统，其加密过程如图所示. 当输出的值为√3 时，则输入的 x = ______. | 描摹/复核URL | none | 图中无可重绘的几何结构（数轴/实物/统计图） | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/9d8b442b-90dc-4bfa-af6a-74ec4c483fa8/20260926/aa6856c6-285f-4b4e-a336-3d328c1d3e44.png |
| 30 | `9c34bed7` | (1)求抛物线的表达式； | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-9c34bed7/20260920/2ad221c2-62f2-49f2-baa4-1666ced92b02.png |
| 31 | `aec9e7c0` | (3)△OAB 的面积。 | 被内容闸拒绝 | none | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的点 G 在题干中未出现 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260926/52da92a2-fe1b-4626-9c8f-d8c2fb328f2f.png |
| 32 | `b9550fe9` | 如图，已知直线l₁//l₂//l₃，直线AC与DF相交于点H，如果AH=2，BH=1，BC=5，那么DE/EF的值为______。 | DSL-20批次 | completed | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的线段 AD 在题干中无引用；重绘图上的线段 BE 在题干中无引用；重绘图上的线段 CF 在题干中无引用 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-b9550fe9/20260920/13b760d8-a6c1-4d54-890c-d131fdbdc634.png |
| 33 | `cb625fc3` | (2) 如图，最下面是一个长方形，上面是10个小正方形，如果长方形的长为4cm，宽为小正方形边长的一半，那么这个图形的总面积S(cm²)是每个小正方形的边长x(cm)的函数。 | DSL-20批次 | completed | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的线段 AB 在题干中无引用；重绘图上的线段 CD 在题干中无引用；重绘图上的线段 EF 在题干中无引用；重绘图上的线段 GH 在题干中无引用；重绘图上的线段 IJ 在题干中无引用；重绘图上的线段 AC 在题干中无引用；重绘图上的线段 BD 在题干中无引用； | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-cb625fc3/20260920/b55173ff-d49d-4014-b671-505949ce6f3d.png |
| 34 | `cceab838` | 如图，已知小方格的边长均相等．下列选项中，所画的三角形与所给△ABC相似的是（ ） | 描摹/复核URL | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/3b78307f-867b-49ea-97d2-a59ab06015a8/20260927/12b366cd-c3d1-46fe-88c8-6b09248664e3.png |
| 35 | `d33fde11` | 有一座抛物线形拱桥，已知水位正常时，桥下水面宽度为20m，拱顶距水面5m。拱桥的截面图如图所示，其中桥拱截线是一段抛物线，平面直角坐标系的原点O是桥拱截线与正常水位的水面截线相交处的一点，x轴在水面截 | 被内容闸拒绝 | none | 重绘结构与题干引用不符（多画/漏画），回退裁剪原图: 重绘图上的线段 CO 在题干中无引用；重绘图上的线段 AO 在题干中无引用；重绘图上的线段 BC 在题干中无引用 | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260926/37175040-e215-4a7f-8071-9c9370459b21.png |
| 36 | `dc357206` | 如图，每个小正方形的边长均为1，点A、B、C均在格点上。请仅用无刻度的直尺作线段BC的三等分点E、F。（保留作图痕迹，不写作法） | 重绘失败待重试 | failed | 结构不可渲染: parse_fail | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/bf235b85-e5d4-4f50-9e42-af8330df9451/20260926/01678fcc-2d6f-4625-84b4-8fdf2d7e51fd.png |
| 37 | `e801e7aa` | 如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上. 在△ABC、△ABD、△ABE和△ABF中，与涂色三角形相似的是____ | 按设计不重绘 | none | 图内是文字/数值（流程图、数值转换器、输入输出表格）或多子图，不适用几何重绘，保留原卷裁片: grid_figure | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/afae6ef7-d071-42c5-b229-faaef0e443f7/20260926/67ce980b-3135-43d6-801c-a14a2b51451b.png |
| 38 | `eb51e564` | (2)点M(m,t),N(m+2,t)都在该抛物线上,求m的值. | DSL-20批次 | none |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-eb51e564/20260920/6a6dc046-c73a-4165-bee0-e2bae256a43a.png |
| 39 | `f5e4d499` | 已知二次函数 y=-2x²+4x+6. (1)求这个函数图像的顶点坐标,并指出它的变化情况; (2)如图,在平面直角坐标系 xOy 中,该函数图像与 x 轴正半轴交于点 A,与 y 轴交于点 C,顶点 | DSL-20批次 | completed |  | https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com/images/dsl-f5e4d499/20260920/11427273-6722-42d1-b824-9558bf149b2c.png |

---

## 逐题目检结论（2026-09-27 晚，45/45 检查完毕）

对比图：`server/_figcheck_0927b/sheets/sheet-01..09.png`（左=原图裁片，右=当前展示图）。

### ❌ 发现 3 道缺陷（✅ 已于当日修复，撤描摹落裁片，备份 scripts/logs/retract-trace-defects-backup-*.json）

| # | 题目 | 缺陷 | 建议处置 |
|---|---|---|---|
| 45 | e801e7aa | **描摹错位**：描摹管线描到了手写解答文字（"△ABC的三边长分别为√3…"），格点图未进描摹区域；原始裁片本身正确 | ✅ 已撤描摹落裁片（复查确认 geometry_image_url 裁片本身即正确格点图，无需重定位） |
| 9 | 248d6e9b | 描摹丢房子轮廓/地面线和 2.7/8.7/1m 标注，只剩两条射线+E/A/B/C（同题副本 8fae272f 的描摹质量良好，可对照） | ✅ 已撤描摹落裁片（裁片含房子与全部尺寸标注） |
| 11 | 7e185d42 | 描摹把原卷污渍放大成大黑块，吞掉左侧题图面板 | ✅ 已撤描摹落裁片 |

### ⚠️ 轻微瑕疵 3 道（可暂不动）

- #7 033d6738：描摹缺「出口」文字标注、多几个点状伪影
- #10 325fd250：选项 C/D 原卷铅笔涂鸦被描摹放大（原卷本身脏）
- #15 cceab838：污渍轻度放大，可读

### ✅ 其余 39 道通过

- RAW 6 道：裁片内容正确（含作图题 5621b755、数字转录缺口 2d0554b8/9b409c35）
- GATEREJ 5 道当前展示图全部忠实；其中 168fe19e/6ef9c615 拒稿正确，
  **92e10f22/aec9e7c0/d33fde11 属闸门对子题干过严误杀**（重绘含原图标注点 D/E/G 但子题干未提及）——若要出真重绘需放宽子题干比对
- RETRY 4 道、DSL-20 14 道、BYDESIGN 其余 6 道：全部与原图一致

---

## 升级轮（2026-09-27 晚二）：4 道升到重绘级 + 渲染器弧镜像 bug 修复

**渲染器 bug（重要）**：`server/utils/geometrySvg.js` 的 `arcPathD` 自 2026-09-18 起
把数学坐标逆时针角配上 SVG sweep=1（视觉顺时针），所有 <180° 的弧圆心被镜像到弦的
另一侧。已修（sweep→0）+ 回归测试 `test/geometryArcSweep.test.mjs` 锁死。
实证发现：库内 0 条已发布结构含弧（带弧的重绘此前全被闸拒），零回溯影响；
golden 快照 43/43 通过。

**重跑 5 道（最新 worker 代码，视觉复核放行通道生效）**：

| 题目 | 结果 |
|---|---|
| d33fde11 | ✅ DSL 通道 2 轮（14点/8线），拱桥+虚线弦AB，目检通过 |
| 92e10f22 | ✅ DSL 通道 2 轮（7点/6线），双直角标记，目检通过 |
| aec9e7c0 | ✅ DSL 通道 3 轮（26点/13线），抛物线+直线+刻度，目检通过 |
| b77fd012 | 函数图象通道出 y=-x²，但缺地面线 AB 与阴影（与 0927 人工复核否掉的同缺陷）→ 已撤回落裁片 |
| fe7f2bc4 | ⛔ 数轴闭环闸再次正确拦截（缺字母标注），维持裁片 |

**622afd21 确定性构造（视觉 7 轮 parse_fail 的攻坚成功）**：
题干完全定死图形 → 解析几何解出全部 11 点精确坐标（BF=5/AF=12 → E=65/12，
NK=120/17 与标准答案吻合自检锁定）→ 走项目渲染器出图落库。
脚本 `server/scripts/construct-622afd21.mjs`（含数学自检闸，坐标不符即拒绝出图）。

**当前非重绘余量：45 → 41**（今日升级 4 道：d33fde11、92e10f22、aec9e7c0、622afd21）。

---

## 升级轮三（2026-09-27 晚三）：读画分离管线落地，数字转录类 2 道拿下

**管线**：`server/scripts/construct-labeled-figures-0927.mjs`（可复用构造配方式管线）——
标注清单由人工对照原卷核实后写死在配方里（`verified: true` 显式信任级别），
图形本体用解析式采样 + 图元构造，数学自检（零点/顶点/关键点代入）不过即拒绝出图。

**配套基建**：
- `server/utils/geom/structure.js`：labels 过滤器加 `verified` 逃生口——isSymbolLabel
  过滤是针对视觉模型输出的信任边界（拦手写抄录），确定性配方的标注是人工核实常量，
  显式声明后绕过；默认无该字段，行为不变，存量零影响。
- 前置修复：渲染器弧镜像 bug（见升级轮二）。

**配方一 9b409c35** ✅：虚线网格 x∈[-2,4]/y∈[-1,6] + 抛物线 y=-x²+3x+4
（零点 -1/4、顶点 (1.5,6.25) 代入自检）+ 全套刻度数字 + 图题「第2题图」。
**配方二 2d0554b8** ✅：拱桥 y=-x²/4+2x（O 在左拱脚、拱顶 (4,4)、跨度 8m，
解析式代入自检）+ 4m/8m 尺寸标注 + 虚线引线。⚠️ 复盘发现：4米/8米本就在母题干
文字里（"拱顶离水面4米时水面宽8米"），0927 人工复核"题干无此数据"的结论是只看了子题干。

**当前非重绘余量：41 → 39。**

## 剩余 39 道的升级路径（按性价比排序）

1. **数轴枚举类**：fe7f2bc4（a、-√3、0、b、√3）——numberAxis 枚举模式（b6b1112e 先例）
   理论可做，卡点在 a/b 位置是目测值，需原图对照校验。
2. **可构造类**：40bb33a0/4bb93a21（A纸折叠/嵌套正方形，题干定死）、1db136a7 等
   多面板格点题（网格+三角形构造器）。逐题写配方。
3. **描摹维持类约 25 道**：内容正确的描摹/裁片，无数学信息损失，升级性价比最低；
   其中按设计不重绘（流程图/作图题）7 道不建议动。

---

## 升级轮四（2026-09-27 晚四）：读画分离再下 2 城

- **fe7f2bc4** ✅：数轴 a<-√3<0<b<√3 配方（原卷为扫描旋转的竖放数轴，按标准横轴重绘；
  刻度线用 `_` 辅助点画，-√3/√3 用 verified 标注）。
- **4bb93a21** ✅：A 系纸嵌套折叠图配方（外框 A₃ 竖折得 A₄、左半逐次横/竖折得 A₅..A₈；
  全部折线与标签位置用裁片 5 标签像素坐标反推验证吻合，缺边界由折纸规律唯一确定）。
- 40bb33a0：裁片顶部被切，禁止残缺构造 → 待 relocate 重裁。

**当前非重绘余量：39 → 37。** 目标模式手册与全部踩坑记录：`docs/geometry-redraw-goal-mode.md`。

---

## 升级轮五（2026-09-27 晚五）：重裁+构造 3 道，恢复误伤 2 道，余量 37 → 35

- **40bb33a0** ✅：relocate 重裁（原裁片顶被切）→ A₀..A₈ 嵌套折叠图配方（逐次对折链
  全部 √2 比例自检），标签像素反推验证吻合。
- **d6bdb7e3** ✅：原裁片竟是学生手写算式；relocate 重载数轴（模型框人工目检 +
  `--no-refine` 过收紧闸）→ fe7f2bc4 同款数轴配方。
- **033d6738** ✅：羊圈示意图配方（矩形+墙 hatch 12 道+出口 E/F）。
- **回归修复**：扩围 apply（未带 --ids）误伤了 3 道已有重绘：e92f35bb、6f04704c
  视觉重跑恢复 ✅；d6bdb7e3 配方恢复 ✅。教训已写入手册坑 17（扩围还会清已重绘产物）。

**当前：229 道引图错题 = 194 重绘级（85%）+ 29 描摹 + 6 raw 裁片。**

---

## 升级轮六（2026-09-27 晚六·目标模式收官）：可构造类清零

- **dc357206** ✅：4×3 格点三等分作图题。破译：原卷斜线痕迹 = 网格对角线
  y=x-1 / x-2 / x-3，与 BC（B(0,0)→C(4,1)）的交点恰为三等分点 E(4/3,1/3)、F(8/3,2/3)。
- **7e185d42 / 1db136a7 / 325fd250 / cceab838** ✅：同一道"格点相似三角形"选择题的
  重复收录，共用一个五面板配方（题图 △ABC 边 {√2,√10,4}，仅选项 C 放大 2 倍相似，
  A/B/D 不相似——转录自洽闸 + cceab838 原卷学生手写边长标注逐边交叉验证）。

**最终：229 道引图错题 = 199 重绘级（87%）+ 25 描摹/URL + 5 raw 裁片。**
剩余 30 道的构成与不再强攻的理由见 docs/geometry-redraw-goal-mode.md。
