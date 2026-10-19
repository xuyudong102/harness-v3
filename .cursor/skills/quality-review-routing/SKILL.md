---
name: quality-review-routing
description: >-
  Route actual security/data risks; never decide default review or AI gates.
---

# Specialist 风险路由

## 前置输入

- 实际代码 diff 与变更文件列表
- 当前工具或 CI 中的机械证据
- 存在时才按需读取 `task.md`、`design.md`、change manifest 或 legacy evidence
- 仅在判定风险需要时读取的需求、设计、计划和影响分析片段

实际 diff 是默认 ground truth。只有 change manifest 承载部署范围、迁移顺序或外部协调语义时，二者不一致才需要停止确认。

## 生成路由

1. `integrated-reviewer` 是唯一默认 AI Review，不由本 Skill 决定是否启用。
2. 独立判断两个可选 Specialist：
   - Security：实际变更触及认证、授权、租户/数据范围、外部输入、上传下载、回调、凭证、加密签名、反序列化、注入或敏感数据边界。
   - Data/Concurrency：实际变更触及事务、幂等、锁、并发、Schema/迁移、MQ/缓存一致性、分布式事务、结算/支付/资金、重试或去重。
3. 证据优先级为实际 diff 与变更路径、依赖/API 变化、运行证据，最后才是用户 Prompt 或可选 manifest；仅出现 `API`、`Controller`、`Service` 等通用词不得触发 Security。
4. 对触发和不触发都记录具体路径、diff 片段或依赖/契约证据；信息不足且可能影响高风险边界时标记 `HUMAN_REQUIRED`。
5. Integrated Review 发现路由漏判时可以追加 Specialist escalation 证据，但不得创建第三类 Specialist。

## 输出契约

路由结论必须包含：

- 路由时间和对应代码/变更清单版本
- Integrated Review 固定为 `DEFAULT`
- Security 与 Data/Concurrency 的 `TRIGGERED`、`NOT_TRIGGERED` 或 `HUMAN_REQUIRED`
- 触发或不触发的具体证据
- 预期的 Specialist 结果（仅 L4 要求独立报告路径）
- 实际触发的 Specialist 清单（可独立或并行完成，不维护 Workflow group state）
- 确定性 Decision 需要的结构化结果清单，不要求实体报告

L0/L1 保留在当前会话；L2/L3 合并进 `task.md` 或 `verification.md`；L4 有审计要求时才使用 legacy `workflow/review-routing.md`。信息不足时不得默认关闭 Specialist；标记 `HUMAN_REQUIRED` 并进入人工检查点。

## 边界

- 不执行 Reviewer，不生成审查报告。
- 不以文件扩展名作为唯一风险证据。
- 不把普通 API/Controller 修改自动升级为 Security。
- 不新增 risk-router Agent 或 AI quality gate。
