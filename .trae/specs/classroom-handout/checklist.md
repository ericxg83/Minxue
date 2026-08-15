# Checklist

- [x] 新模板 `classroomProjection.js` 存在且导出 `{ id: 'classroom_projection', label: '投屏备课讲义', ... }`
- [x] 模板在 `handoutTemplates/index.js` 中正确注册
- [x] `GET /api/handout/templates` 返回包含 `classroom_projection` 模板
- [x] `POST /api/handout/by-knowledge` 使用 `template: 'classroom_projection'` 能正常生成讲义
- [x] 封面页包含渐变背景、品牌标识、大标题、学科/时间信息
- [x] 知识点页包含知识卡片（四栏网格：定义/要点/易错点/口诀）
- [x] 知识点页包含时间建议（如"建议讲解 8-10 分钟"）
- [x] 错题以卡片形式展示，包含题型标签、题干、对比卡片、错因、讲解引导
- [x] 对比卡片（学生作答 vs 正确答案）视觉清晰可辨
- [x] 板书建议区域以黑板图标 + 虚线边框展示
- [x] 题型归纳页每种题型以独立卡片展示，有序号和颜色区分
- [x] 每页显示页眉（学科/知识点名）和页脚（页码）
- [x] 投屏级 CSS 生效：正文 ≥16px，标题 ≥24px，卡片有阴影和圆角
- [x] 浏览器验证：讲义预览页选择"投屏备课讲义"模板后视觉效果合格
- [x] 浏览器验证：截图确认无溢出、遮挡、对齐问题