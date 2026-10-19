# 日志原始证据

## 查询信息

- 任务 ID：{task-id}
- 平台：{Loki|local|other}
- 环境：{environment}
- 时间范围：{start} ～ {end}
- 查询条件：{LogQL-or-command}
- 关联标识：{traceId-requestId-business-key}
- 采集时间：{timestamp}

## 原始片段

```text
{raw-log-lines}
```

## 完整性与脱敏

- 截断情况：{none-or-description}
- 脱敏字段：{none-or-list}
- 时区：{timezone}
- 查询限制：{none-or-description}

> 本文件只保存原始证据；推断和结论写入 `analysis/log-investigation.md`。
