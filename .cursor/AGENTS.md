# Harness 资源约定

## Control Plane

当前 Coding Agent 决定下一步。Workflow = optional playbook + completion contract +
escalation guidance，不是普通任务的阶段、Agent handoff 或 state-machine authority。
Understand / investigate / design / plan 是当前模型按需执行的能力，不是固定 phase。

- Skill 保存复杂、可复用、可选的方法与工具操作；不自动加载所有 Skill。
- Rule 保存安全、权限、企业规范和客观验证约束；保持 Thin Context 按需发现。
- Repo / Git / MCP / 工具与运行时事实是 ground truth。
- Git 更新/冲突恢复按需读取 `rules/git-branch.mdc`；先保护本地成果，更新后逐项核对恢复完整性。复杂恢复使用 `skills/git-update-recovery/SKILL.md`，普通只读 Git 不增加审批或固定流程。
- 不新增 orchestrator / workflow-manager / router Agent 或替代状态引擎。

## Decision Policy

当前 Coding Agent 选择下一行动时，应结合 information gain、cost、risk、
reversibility、success probability、已有 evidence 与 external dependency 判断，
不为形式完整执行低价值步骤。

- 同类尝试反复失败、新尝试的信息增益下降、外部前置条件缺失或原计划前提失效时，执行 `REPLAN`。
- 当根因类别已高置信收敛到外部环境、本机配置、权限、凭证、服务路由或组织约定，人工可以低成本提供缺失事实或完成动作，且继续工具调查主要是重复确认当前假设、已不太可能改变下一行动时，优先执行 `ASK_HUMAN`，再决定是否扩大到相邻系统。
- 若仍存在能实质区分竞争假设、验证关键安全边界或直接解决问题的有界自主探针，且其预期信息增益与成本不劣于人工协作，继续自主排查；不得把所有环境问题立即升级，也不得设置“失败 N 次必须找人”的固定阈值。
- `ASK_HUMAN` 应说明需要人做什么、为何更合适、Agent 已完成什么、完成信号和恢复后继续事项；任务进入可恢复的 `WAITING_FOR_HUMAN`，不是被视为完成。
- 不得自行降低 Task Contract 的硬验收条件；无法取得必需证据时，返回 `HUMAN_REQUIRED`、`CHANGES_REQUIRED` 或明确的未完成状态。

## Playbook

三个稳定入口为 bugfix、refactoring、feature-delivery；按需读取主 playbook。
主文件采用 JSON-form YAML（标准 YAML 子集），无 steps、phases、next 或 entry/exit
文件门禁；guidance 只提供建议。没有自动执行 runtime 或全局注册表。

旧 Feature phase executable resources 已删除。历史制品仅作为事实参考；
恢复工作先核对当前仓库、必要 durable state 与证据版本，不恢复旧 transition。

## Agent 与 Review

当前 Coding Agent 自己分析、设计、计划和实施，普通任务辅助编排 handoff = 0。
issue-context-fetcher / log-investigator 可在确需独立工具调查时按需选择。
分析、设计、计划和实施不再提供独立角色文件；设计与实现不调用 AI Gate。

发生代码修改的任务必须满足 evidence contract：当前变更适用的机械证据、至少一个对应当前 diff 且 fresh 的只读
Integrated Review 结果、实际风险触发的 Security/Data-Concurrency Specialist、确定性 Decision，
以及 `done-verify` 对证据完整性、适用性和 freshness 的最终判定。
完成所需 fresh Review evidence 类型数 = 1/2/2/3；实现 AI Quality Gate = 0。审查不得由实现者自己宣布通过。

- Decision 仅允许 PASS、CHANGES_REQUIRED、HUMAN_REQUIRED。
- 当前 diff 导致适用于 Task Contract 硬验收的 required mechanical evidence `FAIL`、未解决代码/审查 BLOCKER，或必需的 current-diff Review evidence 缺失/stale => CHANGES_REQUIRED。
- 硬验收证据因外部环境、权限或基础设施不可取得 => HUMAN_REQUIRED 或可恢复 waiting state。
- 已确认与当前 diff 无关且不阻塞硬验收的 baseline failure => 保留 WARNING 与 unverified disclosure，不自动要求修改当前代码。
- 否则未解决风险/权威冲突或 HUMAN_REQUIRED => HUMAN_REQUIRED；其余 PASS。
- 所有已触发 Specialist 都必须返回终态，不能丢弃意见；不新增 AI 裁决层。
- 证据须关联 repo、branch、HEAD 或 diff fingerprint、类型、结果、适用性与 freshness。
- Review 未改变代码或配置时，针对同一 diff 的已有证据保持 fresh；后续变更只使受影响证据 stale，Integrated Review evidence stale 时允许按需重新审查。
- 仅补齐或重跑缺失、失败、stale 且适用的证据，不为满足固定顺序无条件重复全部检查。
- 只读 investigation 返回证据、结论和不确定性；不要求实施 Review 或归档。

## Authorization 与 Artifact

只有明确授权才修改代码；Issue 链接或“排查”不等于修复权限。
PRE/PROD、不可逆操作、破坏性 DB 变更、高风险迁移、关键业务/权限歧义、
合规与组织审批保留真实 Human Checkpoint；普通实现细节不强制人工 Gate。

Artifact 是 future durable state，不是 current control-flow token：
L0/L1 零持久文件、无 task directory、state/decision-log/current-phase/debug bookkeeping；
L2 task.md；L3 task.md + verification.md，必要时 design.md；L4 按风险保留迁移、
审批、回滚和专项证据。任何按需独立证据路径都不构成 L0/L1 文件门禁。
L2+ 活动文件仅按需进入 docs/artifacts/work/{task-id}/；归档仅移动实际文件，
归档前 evidence contract 必须达到 PASS。既有 archive 只读，历史 Check/Run 不覆盖。

## 资源归属

可复用的 Skill、Rule 和确定性 Agent 工具从 Harness v3 产生。业务仓库消费这些能力，可以保存业务代码、项目配置、task evidence 和运行产物，但不作为可复用 Agent 能力的主源，除非该能力本身就是产品运行时的一部分。

真实任务里出现可复用能力时：先分类资源，在 Harness 源实现，校验后经现有 Cursor / Codex 分发，再由业务项目调用。这是放置约束，不是新的开发流程。

## 修改资源

新增或调整 Agent/Skill/Rule 时读取 harness-resource-authoring 与对应模板。
保持扁平命名，不新增 Registry、alias、domain、tags；不复制完整思维/流程链。
重复纠正的 Rule 写入仍须用户批准：memory-change 候选为 PENDING，只有包含批准
记录的 APPROVED 候选才能由 memory-consolidator 归入目标语义章节并标为 APPLIED。
运行资源、Workflow Diet、Context/Safety/Review/Artifact 与引用回归检查。
