# Harness v2 → v3 迁移指南

本文面向使用过 Harness v2 的开发者，解释 v3 改了什么、为什么改，以及日常使用需要调整什么。
它不是阶段实施日志；详细资源处置证据见
[资源整合决策](decisions/2026-09-15-resource-consolidation.md)。

## 1. 一句话变化

v2 主要由 Workflow 和角色链组织模型工作；v3 由当前 Coding Agent 负责控制面（control plane），Harness
退回到工程环境角色：提供上下文、知识、工具、安全边界、审查和验证。

## 2. 为什么升级

Harness v3 面向具备仓库探索、工具调用、代码编辑和迭代验证能力的智能体编程模型。
对于这类模型，把需求理解、设计、计划和实施固定拆成岗位与阶段，会带来：

- 相同代码和需求被重复读取；
- 上下文、token 与延迟放大；
- 中间文档成为继续执行的文件门禁；
- 审查意见重复后仍需另一个模型裁决；
- 固定顺序限制模型根据真实证据调整行动。

这些能力边界不依赖某个具体模型代际。模型也不会自动获得企业事实、项目规范、真实运行状态、
权限或构建结果，因此 v3 删除的是提示词编排，不是外部能力与安全边界。

## 3. 核心变化

| 领域 | v2 使用方式 | v3 使用方式 |
|---|---|---|
| 控制面 | Workflow/角色链决定行动顺序 | 当前 Coding Agent 根据任务和证据决定 |
| Workflow | 固定阶段、转换、入口/出口 | 自适应 Playbook，仅保留指导、完成条件和升级条件 |
| 分析 / 设计 / 计划 / 实施 | 多个岗位 Agent | 当前 Coding Agent 的按需能力 |
| 审查 | 固定多 Agent 委员会 + AI gate | 综合审查 + 实际风险专项审查 + 确定性判定 |
| 制品 | 阶段文件和恢复状态 | L0–L4 渐进持久化 |
| 上下文 | 广泛自动加载和重复说明 | 1 条常驻 Rule + 路径索引 + 按需正文 |
| 恢复 | 阶段/状态/文件令牌 | 持久状态 + 重新建立当前仓库/运行时事实 |
| 分发 | 多份手工语义 | `.cursor` 规范源 + Codex 薄适配器 |

## 4. 有意移除的机制

v3 有意移除了以下活跃运行时概念：

- 固定 Feature 八阶段及阶段转换；
- 需求、架构、数据库、API、详细设计、计划、实施等模拟岗位链；
- 按静态分析、逻辑、可维护性、测试、一致性、可诊断性拆分的默认审查 Agent 委员会；
- AI Quality Gate 聚合裁决；
- L0/L1 的强制阶段制品；
- workflow-state、phase-index、current/next/completed phase 恢复；
- 为同步平台而维护的第二份手工语义正文。

这些内容仍可从 Git 历史和迁移决策中追溯，但不进入活跃发现范围。

## 5. 保留的工程能力

以下能力没有因为模型增强而删除：

- 仓库、Git、业务项目和领域事实；
- 企业编码 Rule、项目 Rule、权限和环境边界；
- Loki、Nacos、Swagger/Apifox、DB、CodeGraph 等外部能力；
- build、test、lint、schema、scanner 和运行时证据；
- 只读、PRE/PROD、凭证、破坏性操作和人工确认点；
- 完成时至少一个 current-diff fresh 独立综合审查结果；
- 真实安全/数据并发风险的专项审查；
- 确定性决策和基于当前变更的最终验证；
- L3/L4 的迁移、审批、回滚与审计证据。

## 6. 日常使用需要怎么改

### 不再要求模型运行固定 Workflow

v2 风格：

```text
进入某某阶段，调用某某 Agent，生成对应制品。
```

v3 推荐：

```text
修复订单重复消费问题，保持接口兼容，补回归测试；涉及并发或数据库迁移时升级专项审查并先确认高风险操作。
```

说明业务目标、范围、授权和验收标准即可。需要特定工具或证据时可以直接说明，但不必手工编排角色。

### 不再把缺失 Markdown 当作阻塞

普通调查、Bugfix、Refactoring 和 Simple Feature 默认不创建持久文件。
会话、仓库、Git diff 和工具输出可以支持当前任务继续执行。

只有信息要跨会话、多人交接、审批、迁移、回滚或审计时，才选择 L2–L4 制品。

### 审查改为风险驱动

所有代码变更完成时仍需至少一个对应当前 diff 且 fresh 的独立综合审查结果；相关代码变化使 Review evidence stale 时允许按需重新审查。Security 与 Data/Concurrency 专项审查
只在实际变更、路径、依赖或契约显示相应风险时触发。不存在额外 AI Gate；结果由确定性规则得出。

### 验证仍然必须真实

代码变更完成后必须使用当前项目可用的真实 build/test/lint/schema/scanner/运行时检查。
Review 未改变代码或配置时，同一 diff 的已有成功证据可以继续使用；发生修复时，只把受影响证据标为 stale
并补齐。与当前 diff 不一致或前提已失效的旧 PASS 不可复用。

## 7. 资源兼容

### Agent 名称

旧角色型 Agent 不再是活跃资源。外部提示或文档不应要求调用已删除角色；应直接描述任务目标，
由当前 Coding Agent 完成相应认知工作。

### Workflow 引用

三个稳定入口仍为：

- `bugfix`
- `refactoring`
- `feature-delivery`

它们保留业务意图和完成契约，但不兼容阶段/转换驱动执行。引用旧阶段路径的集成应删除该依赖，
改为读取主 Playbook 或直接按自然语言意图工作。

### 制品路径

核心持久文件为 `task.md`、`design.md`、`verification.md`、`migration.md`。
现有 L4、发布或治理契约仍可使用模板索引中保留的独立文件；这些路径不构成普通任务门禁。

### 历史任务

历史归档保持只读。恢复旧任务时：

1. 先核对当前分支、commit、diff 和工具状态；
2. 只读取仍有价值的持久事实；
3. 不按历史 phase number 或 transition 继续；
4. 用当前 v3 审查、安全边界和最终验证完成后续工作。

## 8. 宿主迁移

### Cursor

使用当前 `link-cursor-config.sh/.ps1` 重新协调 Harness 管理的资源。
业务项目自己的 MCP 和本地制品目录保持项目管理。

### Codex

在 Harness 仓库根目录运行 `bash ./sync-codex.sh`。旧别名或 wrapper 由感知所有权的适配器
迁移为与规范 Skill 目录同名的 capability；不要按 `zfnjjs-*` 前缀批量删除，因为同前缀不能证明所有权。

## 9. MCP 兼容

v3 不在 Harness 仓库保存 MCP 运行时配置。已有业务项目 `.cursor/mcp.json` 或宿主 MCP 设置继续使用，
前提是 server name、权限和环境仍与当前 `.cursor/rules/mcp.mdc` 一致。

不要创建或依赖不存在的仓库内 MCP 模板。Harness 校验的 MCP 冒烟只验证引用和
`project-managed / host-managed` 模式，不代表实际 server 连通性已经测试。

## 10. 迁移检查表

- [ ] 使用已发布、工作区 clean 的 Harness v3 commit。
- [ ] 运行综合资源校验。
- [ ] 使用正式链接/安装/协调工具同步已启用宿主。
- [ ] Codex sync 连续运行两次并确认幂等。
- [ ] 活跃发现范围中只有 3 个自适应 Playbook，没有旧阶段。
- [ ] 旧角色型 Agent 和 AI Quality Gate 不再活跃。
- [ ] always-apply 保持最小，项目 Rule 没有跨作用域加载。
- [ ] 普通 L0/L1 任务可以不创建持久化制品而完成。
- [ ] 业务项目同步前后的非 Harness 管理 diff 和 hash 不变。
- [ ] MCP 配置仍由项目/宿主管理，没有被适配器覆盖。

## 11. 延伸阅读

- 当前整体模型：[架构文档](architecture.md)
- 安装与使用：[使用指南](usage-guide.md)
- 制品选择：[制品协议](artifact-protocol.md)
- 资源设计：[资源放置指南](resource-placement-guide.md)
- 逐资源处置证据：[资源整合决策](decisions/2026-09-15-resource-consolidation.md)
