# Skill 模板

```markdown
---
name: <skill-name>
description: >-
  <执行什么复杂 HOW、什么请求或阶段应触发、明确不用于什么>
---

# <Skill 标题>

## 前置条件

## 操作流程

## 失败处理

## 输出契约

## 边界
```

## 编写约束

- 使用 lowercase-hyphen 名称，目录名必须与 `name` 一致。
- frontmatter 只允许 `name`、`description`。
- description 必须包含能力和触发场景；不得把触发条件只写在正文。
- 只保存可复用、可选、复杂 HOW，不保存角色职责或阶段编排。
- `SKILL.md` 保持精简，详细领域资料放 `references/`。
- 模板和可复制资源放 `assets/`；确定性重复操作才增加 `scripts/`。
- 不创建 README、CHANGELOG、空资源目录或占位文件。
- 不为了 Agent + Skill 对称而创建 Skill。

## 引用检查

- 搜索 Workflow `skills/<name>` 和 Agent 的 Skill 调用条件。
- 确认 optional capabilities 与 completion 引用符合实际按需或完成验证语义，不恢复固定阶段绑定。
- 更新资源数量校验与 README 能力概览。
- 新增脚本时必须实际运行；`.cursor/scripts/` 根目录限制不扩散到 Skill 自有资源。
