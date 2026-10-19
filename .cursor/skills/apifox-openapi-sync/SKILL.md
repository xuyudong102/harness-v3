---
name: apifox-openapi-sync
description: >-
  Discover, diff, bootstrap, sync and validate project-configured OpenAPI contracts in Apifox; use for initial project/environment onboarding, full import, incremental synchronization or convergence checks, not for implicit-target writes or storing credentials.
---

# Apifox OpenAPI Sync

## 前置条件

- 本机已登录官方 Apifox CLI。
- 项目事实来自 `references/projects/<project>.json` 或显式 `--config`；strict runtime validator 是唯一配置契约，拒绝未知字段、错误类型、重复 identity、无效 environment 引用和 credential-like 字段。
- DEV/SIT 地址可通过 config 的 `runtime.environmentProfiles` 绑定本地 `~/.harness/runtime/profiles/<platform>/<dev|sit>.json`。绑定后 source 与 Base URL 在 strict config validation 前后解析；缺少已验证 OpenAPI URL 时 fail-fast，不回退旧地址。Profile 不保存 Header 真值；environment 更新仍需要当前 mutation 授权。
- Project、branch、service、environment 与 OpenAPI source 必须由 config 唯一解析。Token、password、cookie 和 Header 真值只保留在 Apifox 或安全运行时，不写入 config、manifest、日志或报告。

## 能力入口

统一使用 deterministic helper，不让 Agent 手工比较大型 OpenAPI 或循环调用 CLI：

```bash
node .cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs config-check --project <project>
node .cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs diff --project <project> [service...]
node .cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs ensure-project --project <project>
node .cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs ensure-environment --project <project> --environment <key>
node .cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs validate --project <project> [service...]
```

`ensure-project` / `ensure-environment` 在目标已存在且匹配时只读复用。缺失资源的创建、环境更新和 OpenAPI import 都属于外部 mutation，只有当前用户已经明确授权时才追加 `--authorized-mutation`：

```bash
node .cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs sync \
  --project <project> --authorized-mutation [--full] [service...]
```

能力可按任务独立调用，不要求固定顺序。首次接入可按当前缺口选择 project/environment bootstrap；日常同步通常只需 `diff` 或 `sync`；调查任务可以只运行 `config-check` / `validate`。

## 服务级同步契约

- 同步粒度是完整 service，不是 endpoint/schema patch engine：fetch complete OpenAPI → minimal validation → normalize → service digest；changed service 整体 import，成功回读后才更新 manifest。
- fingerprint 覆盖完整 OpenAPI contract；request、response、schema、enum、required 和 operation add/remove 均参与 digest。它以防漏为先，允许少量顺序或扩展字段造成的保守重导入。
- `diff` 的 `added / removed / modified` 只用于诊断和证据，不驱动逐 endpoint mutation。
- `sync` 遇到 `NO_CHANGE` 只证明 source contract 未变化，默认不做完整 remote drift validation；不能据此声称远端未被人工修改。
- `validate` 才负责当前 source 与 Apifox 的深度一致性检查，适用于首次 baseline、import 后、怀疑 drift、用户明确要求或 fresh review。
- post-import validation 以批量列表核对 project、branch、service folder、method/path set、operation count、forbidden path、duplicate 和 environment binding。当前 CLI 无需 N × endpoint 查询即可证明这些事实；request/response/schema 的 field-level remote convergence 仍是明确限制。
- manifest 位于 `~/.harness/runtime/apifox/`，绑定 project ID、branch 和 config identity；使用同目录临时文件、fsync 和 atomic rename。

## 失败处理

- config 缺字段、重复 alias/service/namespace、无效 environment 引用或 target 不一致时 fail-fast。
- fetch、import 或 validate 任一失败时该 service 失败；多 service 可以继续收集证据，但 overall 为失败且进程非零。
- project/team/branch 不能唯一确定时停止并 `ASK_HUMAN`。不得依赖 CLI 默认 main。
- precise cleanup 不能由现有 CLI 安全完成时返回 `NEEDS_CLEANUP`；不要生成无限 delete 循环，也不要自动清空项目。
- 只通过 tags 建立 service 顶层目录；不改写 operationId、schema name 或 `$ref`。operationId 只要求 service 内唯一；Apifox Schema identity 是 project-global，changed service import 前以 remote inventory + manifest owner 做冲突检查。仅支持 OpenAPI 3.0.x/3.1.x 与 internal local `$ref`；external document/URL `$ref` 直接 `EXTERNAL_REF_UNSUPPORTED`，不下载或递归解析。
- 现有 CLI 没有事务化、可恢复的 service replacement；import 后仍有 stale endpoint 时返回 `NEEDS_CLEANUP`，不自动执行 folder/schema delete。

## 输出契约

所有命令输出单个 compact JSON object：`ok`、`status`、`command`、明确 target、每个 service 的状态和必要摘要。终态只使用 `SUCCESS / NO_CHANGE / FAILED / NEEDS_CLEANUP / NEEDS_HUMAN`；错误不得包含 token、Secret 或完整 CLI/OpenAPI 输出。

## 边界

- Coding Agent 仍负责 intent、scope、异常判断与是否请求人工协助；helper 只承担确定性机械操作。
- 不使用浏览器自动化，不实现第二套 REST client，不创建 provider framework、Workflow runtime 或复杂 cleanup framework。
- 不把 project facts 写入 generic Skill/script；新增项目只增加符合 schema 的 project config。
- 未经明确授权不得 create/update/import/delete。Secret 真值不得进入 Harness、Git、manifest 或普通输出。
