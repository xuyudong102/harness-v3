---
name: codegen-guard
description: >-
  Check reuse and enterprise rules before creating source files.
---

# 代码生成合规守卫

## 用途
在生成新代码（新文件、新类、新接口、新方法）前，检查是否符合项目分层架构和编码规范，防止"能跑但不合规"的代码进入仓库。

## 触发时机
- 创建新的源代码文件时
- 在现有文件中新增类或接口时
- 由 `当前 Coding Agent` 子代理在生成新文件前强制调用
- 任何子代理创建 `.java`/`.kt`/`.xml`/`.yaml` 等源文件前

## 检查清单

### 0. 规则优先（写代码前，强制）

1. 读取 `rules-loader.mdc`，按当前文件类型/场景加载对应 rules（Java → 编写/修改 Java 代码；Mapper XML → mybatis 等）
2. **对照已加载 rules 设计实现**，而非打开同目录最近似文件照抄结构
3. 若需参考已有实现，仅提取分层与命名，**逐条核对**参考代码是否违反已加载 rules；违规处不得复制

### 1. 分层合规检查

验证新代码是否放置在正确的架构层：

| 层级 | 允许内容 | 禁止内容 |
|------|---------|---------|
| Controller | 接收请求、参数校验、调用 Service、返回 VO | 业务逻辑、直接操作数据库、跨模块调用 Repository |
| Service | 业务逻辑编排、事务管理、调用 Repository | HTTP 相关代码、直接返回 Entity 给前端 |
| Repository/Mapper | 数据持久化操作 | 业务逻辑、事务管理 |
| Domain/Entity | 领域模型定义 | 框架注解以外的业务逻辑（贫血模型场景） |
| DTO/VO | 数据传输/展示对象 | 业务逻辑、持久化注解 |

检查依赖方向：
```
Controller → Service → Repository → Entity
         ↘ DTO/VO ↗
```
禁止反向依赖（如 Service 依赖 Controller 的类）。

### 2. 包路径检查

验证新文件的包路径符合项目约定：
- 包名与目录结构一致
- 遵循模块化划分（如 `com.example.{module}.{layer}`）
- 同一功能的所有层级代码在同一模块包下

### 3. 命名合规检查

对照 loader 已加载的命名规范验证：

| 元素 | 命名规则 | 示例 |
|------|---------|------|
| 类名 | UpperCamelCase + 层级后缀 | `UserController`、`UserService`、`UserRepository` |
| 接口名 | UpperCamelCase，不加 I 前缀 | `UserService`（非 `IUserService`） |
| 方法名 | lowerCamelCase，动词开头 | `createUser`、`findById` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 枚举值 | UPPER_SNAKE_CASE | `ORDER_STATUS_PAID` |
| 包名 | 全小写，单词不分隔 | `com.example.usermanagement` |

### 4. 复用检查

在创建新文件前，搜索项目中是否已存在：
- 同名或相似命名的类/接口
- 功能相近的现有实现
- 可扩展而非重写的基类/接口

如发现可复用代码，输出建议：
```
⚠️ 发现可复用代码:
- `src/main/java/.../BaseService.java` 提供了通用 CRUD 能力
- 建议：继承 BaseService 而非重写 CRUD 方法
```

### 5. 必需元素检查

新创建的类/接口必须包含：
- [ ] 类级别的 Javadoc 注释（说明职责，非冗余描述）
- [ ] 正确的访问修饰符（优先最小可见性）
- [ ] 对应的分层注解（如 `@RestController`、`@Service`、`@Repository`）
- [ ] 日志声明（Service 及以上层级）

### 6. 与上游制品一致性检查

新代码必须与当前已确认的设计语义对齐。L0/L1 可直接使用会话、repo 和工具证据，不要求下列 legacy 文件；只有实际存在且权威时才读取：
- 类名/方法名与 `{artifact_root}/design/lld.md` 中的设计一致
- 接口路径与 `{artifact_root}/design/api-contract.md` 中的定义一致
- 实体字段与 `{artifact_root}/design/ddl.md` 及 `{artifact_root}/design/sql/` 中 DDL 一致

### 7. 禁止抄代码检查

- [ ] **规则先于参考**：已加载当前场景 rules，非仅凭同包/同模块文件写法落笔
- [ ] **`@author` 来源**：必须来自 `git config user.name`，**禁止**从参考类（如 `MallSeller*`、同模块已有类）复制作者名
- [ ] **`@date` 来源**：必须为当前本地日期时间，禁止复制参考类日期
- [ ] **元数据独立生成**：允许参考分层与命名，禁止整段复制类头 Javadoc 后只改 `@Description`
- [ ] **错误码/常量/配置**：禁止从参考类原样复制错误码号段、魔法值、`ignore-urls`/`ignore-tables` 条目——须对照当前任务 rules 重新核对
- [ ] **Mapper XML**：禁止因同模块其他 Mapper 已有 `<sql>`/`<include>`/拆 WHERE 片段而照搬——须对照 mybatis 规则独立编写

## 输出格式

检查全部通过：
```
## 代码生成合规检查 — 通过
- **文件**: {file-path}
- **类型**: {Controller/Service/Entity/...}
- **检查项**: 8/8 通过
- **状态**: 允许创建
```

检查有问题：
```
## 代码生成合规检查 — 阻塞
- **文件**: {file-path}
- **类型**: {Controller/Service/Entity/...}
- **通过**: N/8
- **问题**:
  1. [分层违规] Controller 中包含业务逻辑 → 移至 Service 层
  2. [命名不合规] 方法名 `process` 不符合动词+名词规则 → 建议改为 `processOrder`
- **处理**: 修正后重新检查
```

## 与 rules 的协作关系
本技能是**主动检查的编排者**，执行前须读取 `rules-loader.mdc`，按「编写/修改 Java 代码」「涉及项目结构变更」场景加载并遵守对应规则（命名、分层、方法设计、注释等）。

## 关键约束
- 检查在代码写入文件**之前**执行，不是事后审查
- 检查不通过时禁止创建文件，必须先修正
- 复用检查使用项目内搜索，不依赖外部索引
- 仅在显式 debug 或 Harness 故障诊断时把检查结果记录到 harness-debug.md
- 仅检查新增代码，不对已有代码做合规扫描（已有代码由机械工具与 integrated-reviewer 按变更范围检查）
