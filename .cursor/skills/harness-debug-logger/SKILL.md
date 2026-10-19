---
name: harness-debug-logger
description: >-
  Record real Harness adapter or hook failures when debug is requested.
---

# Harness 故障诊断记录

- 记录失败命令、时间、输入条件（脱敏）、实际输出、相关资源路径和仍未确认的假设。
- 优先使用工具输出和当前会话；L0/L1 不建立任务目录或 debug 文件。
- 需要跨会话诊断或独立审计时，可使用 `workflow/harness-debug.md`，不得记录密钥或个人敏感数据。
- 日志不表示 Review PASS、任务完成、阶段状态或恢复入口。
- 持久诊断追加记录，不覆盖历史证据；不为防止模型漏读而扫描或加载全部资源。
