# Harness v3

**当前主线：Harness v3 · 支持 Cursor / Codex**

Harness v3 是面向企业研发的轻量 Harness（Thin Harness）：让 Codex / Cursor 在理解项目知识和企业规范的基础上，
使用外部工程系统和真实证据完成调查、开发、验证与交付。**Coding Agent 决定下一步，Harness 提供上下文、能力和安全边界。**

它帮助团队减少重复解释项目背景、手工搬运工具结果和冗长任务 Prompt；不向业务应用引入运行时依赖，也不要求遵循固定研发阶段。
已提供知识发现、代码验证、OpenAPI 同步、DEV 构建部署、Kubernetes 查询和 Nacos 受控配置能力；
外部能力能否使用，仍取决于本机认证、Environment Profile、网络与实际权限，安装 Harness 不等于完成这些配置。

> 仓库历史名称保留 `zfnjjs-harness-v2`，兼容现有路径、链接和同步脚本；当前实现与文档均为 Harness v3。
> Rule、Skill、Agent、Playbook 等正式资源类型保留英文，以便与实际资源对应。

## 1. 快速开始

### 获取 Harness

准备 Git、Node.js、Cursor 或 Codex，以及一个已有业务项目目录。以下命令适用于 macOS / Linux；
Windows 安装方式见[使用指南](docs/usage-guide.md#3-cursor)。

```bash
git clone https://github.com/xuyudong102/harness-v3.git
cd harness-v3
```

团队分发应使用已提交、已发布的版本，不以未提交工作区作为正式安装源。按实际使用的宿主安装即可：

### Cursor：链接到业务项目

在 Harness 仓库根目录执行，将示例路径换成真实项目目录：

```bash
bash ./link-cursor-config.sh /path/to/business-project
```

脚本默认跳过已有同名目标；不要未经所有权确认使用强制覆盖。安装后检查链接目标可读：

```bash
test -f /path/to/business-project/.cursor/AGENTS.md
test -f /path/to/business-project/.cursor/rules/execution-boundary.mdc
```

### Codex：同步本机资源发现入口

在 Harness 仓库根目录执行：

```bash
bash ./sync-codex.sh
```

无需外部 AI workspace。默认安装到 `$CODEX_HOME/harness/zfnjjs`，未设置 `CODEX_HOME` 时使用 `~/.codex`。
`$CODEX_HOME/skills/<skill>` 通过薄 wrapper 指向 Harness 中的规范 Skill；不复制或预加载正文，也不向业务仓库写入 wrapper。
同名用户 Skill 冲突时同步会拒绝覆盖。

安装后检查生成入口与一个 Skill 的链接目标：

```bash
test -f "${CODEX_HOME:-$HOME/.codex}/harness/zfnjjs/config/AGENTS.generated.md"
test -f "${CODEX_HOME:-$HOME/.codex}/skills/done-verify/SKILL.md"
```

参数、资源发现及排障见[使用指南的 Codex 章节](docs/usage-guide.md#4-codex)。

### 第一次使用：只读认识项目

重新打开业务项目或启动新的 Codex 会话，然后输入：

```text
只读介绍当前项目：先读取项目 AGENTS.md 和适用的项目规则，说明主要模块、构建与测试入口及其文件依据。
不要修改文件，不访问外部系统；找不到的信息请明确说明，不要猜测。
```

检查回答是否引用当前项目的真实文件、未混入其他项目规则。上面的文件检查只证明入口存在，不能替代宿主内的实际发现验证。

**通用安装与外部接入分开完成**：Apifox CLI、KooCLI、kubectl 等工具及其登录、Profile、凭据引用和平台权限需另行准备。
项目自身的 MCP 配置继续由项目或宿主管理；缺少绑定或权限时应报告缺口，不回退其他环境。
安装详情与排障统一见[使用指南](docs/usage-guide.md)。

## 2. 主要工程能力与示例

用自然语言说明**目标、范围、授权、验收**即可；不必记住 Skill 或 Agent 名称。
以下是已实现的能力入口，不表示每个项目或环境均已接通。

| 能力 | 可以这样说 | 关键边界 |
|---|---|---|
| 项目知识与规范发现 | “只读说明当前项目订单模块的职责和适用规范，给出文件依据。” | 按项目作用域读取 Rule，不加载其他项目知识 |
| 代码开发与验证 | “修复重复消费导致的状态错误，保持接口兼容，补回归测试并验证。” | 使用适用的机械证据和独立审查，不以模型声明代替工具结果 |
| [Swagger / Apifox 契约同步](.cursor/skills/apifox-openapi-sync/SKILL.md) | “检查指定项目的 OpenAPI 变化，先只读报告差异，不导入。” | 服务级同步；导入、项目或环境创建/修改须明确授权，目标必须唯一 |
| [CodeArts DEV 构建部署](.cursor/skills/codearts-pipeline/SKILL.md) | “把当前 broker 变更构建并部署到 DEV，不需要功能自测。” | 明确 DEV 部署请求才授权 Run；提交/push 不等于部署授权 |
| [Kubernetes 运行态查询](.cursor/skills/runtime-snapshot/SKILL.md) | “只读检查指定 DEV 服务的镜像、Ready、事件和近期日志。” | Helper 只读；修改须另行明确授权，经目标校验的 kubectl 执行 |
| [Nacos 配置查询](.cursor/skills/nacos-read/SKILL.md) | “只读查询指定 DEV 配置的摘要，并比较两份明确配置的差异。” | DEV/SIT Profile 定位；Node Helper 默认返回脱敏摘要，不依赖旧 Python MCP |
| [Nacos 受控写入](.cursor/skills/nacos-config-write/SKILL.md) | “在已确认的 DEV 配置中追加这些字段，保留其他内容并披露变更。” | 仅已确认的 DEV/SIT 目标；支持 CREATE / UPDATE / APPEND，不提供删除或自动重启 |

### 部署完成不等于流水线结束

Pipeline Run `COMPLETED` 不代表目标 Job 已执行，`UNSELECTED` 不算成功；Run 的 `SUCCESS` 也不能替代目标 Job 证据。
部署完成还须确认目标 Job 的实际成功结果、远程构建版本、构建产物/镜像关联及 Kubernetes 运行态收敛。

只要求部署时，取得最小必要的版本与 readiness 证据，不主动扩展为业务功能测试；
明确要求“部署并自测 / 功能验证 / 回归”时，才验证与变更匹配的功能。缺少证据必须如实披露。

### 配置写入有独立安全契约

Nacos 写入须明确目标和变更内容，复用 Profile 与凭据引用；写前备份、核对指纹，写后读回，
并在任务结果中逐项列出 **Nacos 配置变更记录**。配置发布不等于应用已加载，不自动重启服务。
当前编辑器只支持有限 YAML / Properties 结构；并发保护非原子，必须满足风险确认要求，不能宣称强一致性。
详情以 [Nacos Write Skill](.cursor/skills/nacos-config-write/SKILL.md) 为准。

## 3. 核心设计原则

**Strong Context + Guardrails + Capabilities · Weak Workflow · Dynamic Planning · Evidence-driven Completion**

![Harness v3 总体架构](image/architecture/overall-architecture.svg)

- **强上下文、按需读取**：项目事实与企业规范保存在可维护的仓库资源中，先发现候选，再读取适用正文。
- **强边界、强能力**：Harness 提供工具与权限约束；Coding Agent 使用真实 Repo、Git、测试和运行系统获取证据。
- **弱流程、动态规划**：Playbook 是建议，不是固定阶段；Agent 按信息增益、成本和风险选择行动，必要时重新规划或请求人工协作。
- **以证据完成**：代码变更需适用的机械验证、对应当前变更且仍有效的独立综合审查和风险触发的专项审查；只补齐缺失或失效证据，不无条件重跑。
- **最小持久化**：普通调查和小改动可以零制品完成；跨会话恢复、交接或审计才保存必要状态。

CLI、MCP、API 以及封装它们的 Helper 是可替换的能力入口；长期稳定的是能力、权限和证据契约，而不是某种协议。
Harness 不强制依赖 MCP，MCP 配置由项目或宿主管理（project-managed / host-managed）。
Cursor 与 Codex 共享 Harness `.cursor` 规范语义源，不维护两份实现。

**必要安全边界始终保留**：只读请求不授权写入；外部修改、PRE/PROD、破坏性 Git/文件/SQL 操作和凭据使用受具体授权约束，
本页 DEV/SIT 能力不得据此扩展到 PRE/PROD。Hook 不替代真实平台权限或人工审批；未执行、失败或不可用的验证不能报告为通过。
凭据、本地 Profile 和安全备份不进入 Git。

架构、审查和证据细节见[架构文档](docs/architecture.md)；图源与维护说明见[架构图索引](image/architecture/README.md)。

### 设计参考

Harness v3 是内部工程实践，部分方向与 OpenAI 公开的智能体优先工程实践相呼应：地图而非厚重手册、渐进披露、
仓库作为记录系统、运行时证据，以及工程化环境而非推理轨迹。这不代表 OpenAI 对本项目具体实现的背书，也不是其官方架构。
参见[《工程技术：在智能体优先的世界中利用 Codex》](https://openai.com/zh-Hans-CN/index/harness-engineering/)。

## 4. 文档导航与维护入口

| 你想做什么 | 推荐阅读 |
|---|---|
| 安装、配置、实际使用与排障 | [使用指南](docs/usage-guide.md) |
| 理解控制面、上下文发现、证据与分发机制 | [架构文档](docs/architecture.md) |
| 查看或编辑正式架构图 | [架构图索引](image/architecture/README.md) |
| 维护 Rule / Skill / Agent / Playbook | [资源放置指南](docs/resource-placement-guide.md) |
| 判断何时保存任务状态与制品 | [制品协议](docs/artifact-protocol.md) |
| 从 v2 迁移：由固定 Workflow 转向 Coding Agent 驱动 | [v2 → v3](docs/v2-to-v3.md) |
| 浏览完整文档和模板 | [文档索引](docs/README.md) |

新成员先完成只读首次使用；维护者修改或升级 Harness 后，在仓库根目录执行：

```bash
bash .cursor/scripts/check-harness-resources.sh
```

该检查验证 Harness 资源及适配器契约，不证明个人认证、外部系统连通或业务部署成功。
更多专项命令见[验证与排障](docs/usage-guide.md#10-验证与排障)。
