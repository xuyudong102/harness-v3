# Progressive Artifact Protocol

Artifact 是需要跨越当前推理上下文的 durable state，不是默认思考输出。任务级别由当前
Coding Agent 根据生命周期和外部风险判断，不新增 Router Agent。

## Level

| Level | 适用场景 | 默认持久化 |
|---|---|---|
| L0 Ephemeral | 问答、只读定位、简单 investigation | 无 |
| L1 Normal | 单会话普通 Bugfix、小 Feature、小重构 | 无；用户要求时可保存最终验证摘要 |
| L2 Complex | 需要持久保存必要决策、恢复或交接信息的复杂任务，可单会话完成 | `task.md` |
| L3 Durable | 跨会话、跨仓、多人或多 Agent 接力 | `task.md`、`verification.md`；确有设计时增加 `design.md` |
| L4 Controlled | 生产、迁移、资金、安全、合规、不可逆或强审计任务 | L3 + 实际需要的迁移、审批、回滚和 Specialist 证据 |

## 选择规则

- 只有信息需要跨会话恢复、多人交接、外部审批、审计、迁移/回滚，或用户明确要求文档时才持久化。
- 修改多个文件或模块本身不触发 L2；无持久化需要时仍可按 L1 完成。一旦按实际需要选择 L2，最小制品仍为 `task.md`。
- L0/L1 允许直接使用 conversation、repository、Git diff、工具输出和运行时事实继续工作。
- Git、CI、测试、扫描器和外部系统已经保存的事实不再复制成 Markdown；持久文件只保留命令、结果、关键证据引用和未解决风险。
- 多阶段可以向同一个 `task.md` 或 `design.md` 追加相关章节；不要为了阶段对称拆文件。
- 信息不足但可能改变权限、迁移、资金或不可逆风险时升级 L4 或进入人工检查点。

## Consolidated Files

- `task.md`：Task Contract、可恢复 status、一个或多个 repo/branch/HEAD/diff resume anchors、Key decisions、Important evidence、Blockers、Evidence gaps、Changes、Verification、Open risks 与候选 Next Options。
- `status` 只描述 `ACTIVE`、`WAITING_FOR_HUMAN`、`WAITING_FOR_EXTERNAL` 或 `DONE`；evidence 状态独立记录，不用分析/实施 Phase 驱动 transition。
- Next Options 是恢复后由当前 Coding Agent 重新评估的候选，不是固定 `next` 动作。
- `design.md`：仅保存有独立价值的架构、数据、API 和重要实现决策。
- `verification.md`：保存需要恢复或审计的机械验证摘要及证据位置。
- `migration.md`：保存迁移顺序、审批、回滚、生产核验和责任边界。
- Security/Data-Concurrency 独立报告仅在 L4 或明确审计要求下保留。
- 设计由当前 Coding Agent 按需完成，不强制 Consistency/Quality Gate Agent；代码变更保留 Integrated Review 与真实风险专项审查，结构化结果可留在会话。

## Legacy Compatibility

主 playbook 不包含 entry/exit 文件令牌。保留的独立模板仅服务有真实消费者的 L4、发布或治理契约。
L0/L1 缺少这些文件不得阻塞任务；L2 优先合并到 `task.md`；L3/L4 仅在所选 Level
或外部生命周期明确要求时生成独立文件。旧 executable phases 和无消费者模板已删除；历史内容保存在 Git history。

## Archive

- L0/L1 不创建任务目录，也不归档。
- L2 只有用户明确要求或确需交接时归档实际存在的 durable files。
- L3/L4 在 evidence contract 达到 `PASS` 后归档实际文件；禁止创建空目录或只含模板的 archive。
