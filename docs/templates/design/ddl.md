# 数据库设计（DDL）

## 元数据

- 任务 ID：{task-id}
- 数据库/版本：{database-version}
- 设计时间：{timestamp}
- 状态：{DRAFT|APPROVED}

## 访问模式与数据规模

{reads-writes-cardinality-growth-hotspots-and-retention}

## Schema 设计

### {table-name}

| 字段 | 类型 | 空值/默认 | 约束 | 语义 |
|---|---|---|---|---|
| {column} | {type} | {nullable-default} | {constraint} | {meaning} |

### 索引与约束

| 名称 | 列/顺序 | 类型 | 对应查询/不变量 | 写入成本 |
|---|---|---|---|---|
| {index} | {columns} | {type} | {purpose} | {cost} |

## DDL 草案

可执行语句见 `design/sql/`；下表为索引，变更时须与脚本文件同步。

### 脚本文件

| 文件 | 用途 | 建议执行顺序 |
|---|---|---|
| `design/sql/001-forward-ddl.sql` | 向前 DDL | 1 |
| `design/sql/002-rollback-ddl.sql` | 回滚 DDL | — |
| `design/sql/{optional-backfill}.sql` | 回填/校验（可选） | 2 |

### 摘要（可选）

```sql
-- 与 design/sql/001-forward-ddl.sql 保持一致；勿在此单独维护另一份权威 DDL
{forward-ddl-summary}
```

## 迁移步骤

1. {compatible-schema-change}
2. {backfill-and-validation}
3. {read-write-switch}
4. {cleanup}

## 一致性与并发

{transaction-lock-idempotency-tenant-cache-mq-impact}

## 回滚与风险

{rollback-lock-time-window-data-repair-and-monitoring}
