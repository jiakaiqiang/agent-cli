# CLAUDE.md

## 技能路由

当用户请求匹配可用技能时，始终把调用 Skill 工具作为第一步。不要直接回答，也不要先使用其他工具。
技能内置了专门工作流，通常比临时回答效果更好。

关键路由规则：
- 产品想法、“这个值得做吗”、头脑风暴 → 调用 office-hours
- Bug、错误、“为什么坏了”、500 错误 → 调用 investigate
- 发布、部署、推送、创建 PR → 调用 ship
- QA、测试站点、找 bug → 调用 qa
- 代码审查、检查 diff → 调用 review
- 发布后更新文档 → 调用 document-release
- 周复盘 → 调用 retro
- 设计系统、品牌 → 调用 design-consultation
- 视觉审计、设计打磨 → 调用 design-review
- 架构审查 → 调用 plan-eng-review
- 保存进度、检查点、恢复 → 调用 checkpoint
- 代码质量、健康检查 → 调用 health
