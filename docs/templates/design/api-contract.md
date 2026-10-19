# API 契约

## 元数据

- 任务 ID：{task-id}
- 契约类型：{HTTP|RPC|Event}
- 版本：{version}
- 状态：{DRAFT|APPROVED|DEPRECATED}

## 调用方与兼容边界

{callers-authentication-authorization-and-compatibility}

## {接口/事件名称}

- 方法/主题：{method-path-or-topic}
- 语义：{command-query-event}
- 鉴权与资源归属：{auth-and-ownership}
- 超时/限流/幂等：{timeout-rate-limit-idempotency}

### 请求

| 字段 | 类型 | 必填 | 校验 | 语义 |
|---|---|---|---|---|
| {field} | {type} | {yes-no} | {validation} | {meaning} |

### 响应/事件

| 字段 | 类型 | 可空 | 语义 |
|---|---|---|---|
| {field} | {type} | {yes-no} | {meaning} |

### 错误与失败行为

| 错误码/场景 | 条件 | 调用方行为 | 是否可重试 |
|---|---|---|---|
| {code} | {condition} | {behavior} | {yes-no} |

### 示例

```json
{request-or-response-example}
```

## 兼容与废弃计划

{field-enum-default-version-migration-and-contract-tests}
