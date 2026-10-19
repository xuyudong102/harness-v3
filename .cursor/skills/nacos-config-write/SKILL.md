---
name: nacos-config-write
description: >-
  在用户明确要求修改 Nacos 配置时，按已确认的 DEV/SIT Profile 创建配置或追加、修改字段，并逐项披露写入证据；不用于查询任务、删除、PRE/PROD 或未确认的目标。
---

# Nacos 受控配置写入

## 授权与目标

只有当前用户明确要求创建/修改 Nacos 配置，目标与字段可准确确定时才使用。普通排查、日志或查询不授权发布；使用 `nacos-read`。`--authorize` 记录本次任务授权，不代替用户授权，不从 commit/push/部署推导。共享配置、影响多个服务、高风险或目标歧义先 ASK_HUMAN。

必须显式提供 platform、DEV/SIT、Nacos Namespace ID、Group、Data ID、type 和 reason；Namespace/Group 必须等于既有 Environment Profile。缺失绑定不猜测，不借用 Kubernetes Namespace，不允许外部 URL/Token 参数。当前写入只对已只读核验 API 的 Nacos 2.3.1 开放，真实账号权限仍由服务端核验。

## 单一 Helper

[nacos-config-write.mjs](../../scripts/nacos-config-write.mjs) 复用现有 Profile、凭据引用和共享 Nacos transport。不复制到业务仓库；从 Harness 根目录或使用规范源绝对路径执行。

```bash
node .cursor/scripts/nacos-config-write.mjs config-create --platform <platform> --environment DEV --namespace-id <nacos-id> --group <profile-group> --data-id <id> --type yaml --content-file /absolute/private/content.yaml --reason <reason> --authorize --acknowledge-non-atomic
node .cursor/scripts/nacos-config-write.mjs config-append --platform <platform> --environment DEV --namespace-id <nacos-id> --group <profile-group> --data-id <id> --type yaml --changes-file /absolute/private/changes.json --reason <reason> --authorize --acknowledge-non-atomic
node .cursor/scripts/nacos-config-write.mjs config-update --platform <platform> --environment SIT --namespace-id <nacos-id> --group <profile-group> --data-id <id> --type properties --changes-file /absolute/private/changes.json --reason <reason> --authorize --acknowledge-non-atomic
```

输入文件须当前用户所有、普通文件、权限 0600，不使用 symlink；敏感值放私有文件，不放命令/报告/Git。Changes 格式：`{"changes":[{"path":["server","port"],"value":8080}]}`。path 为真实键数组，带点的键作为一个元素；Properties 的 path 只有一个键且 value 为字符串。

Helper 保留原文、注释与换行，仅编辑明确字段。支持保守的 YAML block mapping + 单行 scalar、无转义/续行的 Properties；拒绝序列、流式集合、多行值、锚点、标签、重复键、歧义标量或空 mapping。不强行格式化复杂配置，不改用原文拼接。CREATE 仅创建不存在 Data ID；APPEND 不覆盖已有字段；UPDATE 不删除字段或替换 mapping。

写前保存私有备份与结构化字段 Diff、再次核对指纹后单次发布。不能确认 Nacos 2.3.1 HTTP CAS 的可靠性，不发送可能无效的 CAS 参数，也不静默降级。必须另带 `--acknowledge-non-atomic`：仅当任务授权已覆盖这项并发风险时使用，否则先 ASK_HUMAN。两次读取不能消除读取到发布之间的竞态，包括 CREATE 的并发创建覆盖风险；共享或并发编辑频繁的配置不适合本能力，不能宣称强一致性。

超时或异常后只读回一次，不自动重发。结果含 `publication` 与 `readBack`：只有内容匹配才声明目标内容已验证；缺少发布确认时仍保留 UNKNOWN/ack unavailable 的归属不确定性。写成功不证明应用加载，不自动刷新或重启 Kubernetes。

## 任务完成契约：Nacos 配置变更记录

每次可能发生发布后，保留 Helper 的 `changeRecord` 和私有 `evidence` 路径。跨多个 Data ID 汇总全部记录，不因主任务失败丢弃先前写入。Helper `changeDisclosure(results, taskResult)` 可机械聚合已有结果；不成为任务状态服务。

最终任务输出必须有独立的 **Nacos 配置变更记录** 章节，逐项说明：platform/environment、Namespace/Group/Data ID、CREATE/UPDATE/APPEND、新增/修改字段、删除字段（本能力始终为无）、原因、发布结果、读回结果、是否需要服务刷新/重启及备份/证据路径。密码、Token、密钥、数据库凭据只展示字段名和脱敏说明，不展示值。

未执行发布不得声称修改成功；发布结果不明确或主任务中途失败仍披露 attempted/UNKNOWN 与已观察状态。进程中断时读取本地 `record.json` 的 pending/UNKNOWN 记录恢复判断，不能直接重发。缺少该逐项披露不得宣布任务完成。只有模拟测试通过不能声称真实远端写入成功。
