---
name: done-verify
description: >-
  Evaluate real evidence; rerun only missing, failed or stale applicable checks.
---

# 完成交付验证

## 前置条件

- 获取 Task Contract 与当前 repo、branch、HEAD 或 diff fingerprint；若存在 `task.md`、变更清单或 `artifact_root`，仅按需读取相关部分。
- 从项目配置与 Rule 解析可用命令和门禁阈值，不在本 Skill 重复阈值。

## Evidence Contract

先评估证据的 completeness、applicability 与 freshness，再决定是否需要执行工具。每项证据至少能够关联：

- repo、branch、HEAD 或 diff fingerprint
- evidence type 与适用范围
- command/source 与 result
- applicability、freshness 与未验证范围

工具输出、CI、Git 和运行环境是事实源；持久化方式由 Artifact level 决定：

- L0/L1：在当前会话中报告命令、结果和关键输出，不创建 Markdown 证据文件。
- L2：把必要摘要合并进 `task.md`，不为每种检查拆文件。
- L3：写入 `verification.md`；只有 substantial design 才另有 `design.md`。
- L4：按审计要求保留细粒度 evidence、审批、迁移、回滚和 Specialist 结果。

持久文件存在时，每次新增执行追加 `Run NNN`，记录代码基线、命令、结果、适用范围、freshness 和完整报告位置；禁止覆盖历史 Run。无对应工具时报告 `NOT_AVAILABLE` 及原因，不伪造 PASS。

### Evidence Integrity（条件触发）

- 当 diff 修改测试、Lint/覆盖率/扫描配置、排除项、suppression 或依赖/安全扫描配置时，确认适用检查未被实质弱化；不得以删除、绕过或缩小检查范围冒充修复。
- 仅当 scanner 结果被用作完成证据时，核对实际扫描范围、排除/suppression、相关工具或 ruleset 版本、规则/漏洞库时效性以及已知盲区；无 scanner 的任务不增加此检查。

## 完成判定

- 将 Task Contract 的硬验收条件映射到所需证据，确认每项是 `PASS`、`FAIL`、`NOT_AVAILABLE` 还是 `STALE`。
- 仅执行缺失、失败、stale 且当前适用的检查；Review 没有改变代码或配置时，不无条件重跑同一 diff 的已有成功证据。
- 后续代码或配置变化只使覆盖该变化的证据 stale；不相关证据继续有效。
- 确认至少一个 Integrated Review 结果与所有已触发 Specialist 结果仍对应当前 diff 且 fresh；Review evidence 因后续相关变更 stale 时按需重新审查。
- 以实际 diff 校验任务范围；只有 manifest 承载 Git 无法表达的部署或外部协调语义时才校验 manifest。
- 任务包含 Git 更新或本地修改恢复时，对照操作前的变更清单/恢复点，逐项确认修改已保留、双方语义和签名/测试一致、操作已结束；Shelf/Stash 中尚未恢复的项与失败验证必须披露。无未合并索引项不等于恢复完整，不从 Skip/Abort 后流程继续推导成功。仅此场景增加该检查。
- 当前 diff 导致适用于硬验收的 required mechanical evidence `FAIL`、未解决代码/审查 BLOCKER，或必需的 current-diff Review evidence 缺失/stale 时返回 `CHANGES_REQUIRED`。
- 硬验收证据因外部环境、权限或基础设施不可取得时返回 `HUMAN_REQUIRED` 或可恢复等待状态。
- 已确认与当前 diff 无关且不阻塞硬验收的 baseline failure 保留为 WARNING 与 unverified disclosure，不自动要求修改当前代码。
- 只有适用证据完整、fresh 且 Decision 为 `PASS` 时才能宣称完成；按 Artifact level 在会话、`task.md` 或 `verification.md` 中记录结果。
- 完成判定不受 Artifact Level 或归档资格影响；只有实际 durable files 才能归档。

## 关联 Rule

遵守 `compile-guard`、`test-guard`、`lint-guard`、`scope-guard`、`schema-guard` 和 `environment-boundary`。
