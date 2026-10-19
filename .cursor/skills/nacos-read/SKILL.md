---
name: nacos-read
description: >-
  按明确的 Environment Profile 只读查询 Nacos 2.x 健康、配置摘要、配置差异和服务；用于 DEV/SIT 配置定位与诊断，不发布配置、不注册服务、不查询 PRE/PROD。
---

# Nacos 只读查询

## 前置条件

明确 `platform` 和 `DEV`/`SIT`。地址、Nacos Namespace ID、Group 和 `authFile` 来自既有 Local Environment Profile；缺失时停止，不借用其他平台或旧 MCP。Nacos Namespace 不等于 Kubernetes Namespace。

## 调用入口

确定性实现：[nacos-read.mjs](../../scripts/nacos-read.mjs)。从 Harness 根目录调用；业务目录下使用当前规范源脚本的绝对路径，不复制实现。

```bash
node .cursor/scripts/nacos-read.mjs health --platform <platform> --environment DEV
node .cursor/scripts/nacos-read.mjs config-search --platform <platform> --environment DEV --data-id '*keyword*' --limit 20
node .cursor/scripts/nacos-read.mjs config-get --platform <platform> --environment DEV --data-id <exact-data-id>
node .cursor/scripts/nacos-read.mjs config-diff --platform <platform> --environment DEV --data-id <left> --other-data-id <right>
node .cursor/scripts/nacos-read.mjs services --platform <platform> --environment SIT --limit 20
```

`--group` 按需显式指定；`--other-group` 仅用于 Diff 另一配置。`--namespace-id` 若提供必须等于 Profile。搜索/服务列表单页最多 50 条，用 `--page` 显式翻页；`services --service <exact-name>` 只读获取该服务必要元数据。

## 输出与失败

输出一行结构化 JSON，含目标、结果和内部 API 请求次数。配置默认只返回大小、行数、指纹；JSON 可解析时另提供安全键名。YAML/properties 等文本不解析或展示字段，`keyBasis=unavailable`，避免把多行敏感值误当键名。不证明配置合法或运行实例已加载。Diff 是对应行位置差异统计，不是语义 YAML Diff。

不提供原文或配置字段值模式；无法安全展示的值不输出。最多四次 API 请求，单次 8 秒、响应 1 MiB、输出 16 KiB。没有自动 Retry 或跨环境 fallback。

`CONFIG_NOT_FOUND`、认证/权限失败、网络失败、超时、`NACOS_SERVER_ERROR`、无效响应分别失败且进程非零；HTTP 500 不解释为 NOT_FOUND。根据真实结果选择下一行动，不能把 unavailable 当成功。

## 边界

只有认证登录允许 POST；其余请求为固定只读 API。凭据仅从 Profile 引用的私有 env 文件读取，Token 只在进程内存中。Cursor 使用本规范 Skill，Codex 经薄 wrapper 读取同一文件；不依赖 Python MCP、业务仓库工具或额外配置系统。
