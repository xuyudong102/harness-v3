# Harness v3 使用指南

本文面向第一次安装 Harness、在 Cursor 或 Codex 中使用它，以及排查安装或资源问题的开发者。
架构原理见 [架构文档](architecture.md)，资源设计判断见
[资源放置指南](resource-placement-guide.md)。

## 1. 使用前准备

需要：

- Git；
- Node.js（运行 Hook、适配器和校验）；
- macOS/Linux 使用 Bash，Windows 使用 PowerShell；
- 一个真实业务项目目录；
- 至少一个已安装的宿主：Cursor 或 Codex。

Harness 通过链接或生成的薄适配器工作，不进入业务构建依赖，也不要求修改业务源码。

## 2. 获取 Harness

```bash
git clone https://github.com/xuyudong102/harness-v3.git
cd harness-v3
git status
```

用于团队分发时应选择已提交、已发布且工作区 clean 的版本。不要把未提交的 Harness 工作区当作正式同步源。

## 3. Cursor

### macOS / Linux

在 Harness 仓库根目录执行：

```bash
bash ./link-cursor-config.sh /path/to/business-project
```

脚本逐项链接 `.cursor` 与共享 docs；`docs/artifacts/work` 和 `docs/artifacts/archive`
保持目标项目本地目录，不链接回 Harness。

### Windows

```powershell
.\link-cursor-config.ps1 -Target "D:\path\to\business-project"
```

### 安装后检查

```bash
test -e /path/to/business-project/.cursor/AGENTS.md
test -e /path/to/business-project/.cursor/rules/execution-boundary.mdc
test -e /path/to/business-project/.cursor/workflows/bugfix.yaml
```

重新打开项目后，确认 Cursor 能发现 Rule、Skill、Agent 与 Hook。项目自己的 MCP 配置继续由项目管理。

### 已有同名文件

链接脚本默认跳过已有目标。先判断它是业务项目自有内容、旧 Harness 链接，还是当前 Harness 管理的链接。
不要为了省事直接使用 `-f`；只有明确要替换的 Harness 管理目标才能强制覆盖。

## 4. Codex

Codex 使用 Harness 仓库根目录的正式启动脚本和仓库内规范实现：

```text
sync-codex.sh
  → .cursor/scripts/sync-codex.mjs
```

在 Harness 仓库根目录执行：

```bash
bash ./sync-codex.sh
```

启动脚本根据自身位置解析 Harness 根目录，因此从其他工作目录使用其绝对或相对路径调用时，
仍会运行同一份规范实现；所有参数均原样转发。

同步内容：

- Harness 资源发现索引；
- 短 AGENTS 适配器；
- `$CODEX_HOME/harness/zfnjjs` 中每个规范 Skill 对应的同名薄 wrapper；
- `$CODEX_HOME/skills/<skill-name>` 到 wrapper 的发现链接。

公开 capability name 与 `.cursor/skills/<skill-name>` 目录名一致，不携带 `zfnjjs-` 前缀。`zfnjjs-harness`
是稳定 ownership identity，`$CODEX_HOME/harness/zfnjjs` 是 Adapter storage namespace；两者都不改变 Skill 名称。

不会修改：

- 个人 MCP 配置；
- IDE 设置；
- 非 Harness 用户 Skill；
- 业务项目源码或配置。

适配器只管理能证明由当前 Harness 生成的资源；遇到用户资源或外部所有权会停止。
同步不安装或执行 Cursor 的 `preToolUse` Hook。Codex 使用宿主实际配置的沙箱、审批与网络策略，
以及各 Helper 的前置校验；不能把 Cursor 的命令拦截测试当作 Codex 的等价安全保障。

## 5. 用自然语言开始任务

不需要要求模型“运行某 Workflow”。说明目标、范围、授权与验收即可。

### 只读排查

```text
只读排查订单创建后没有推送消息的问题。结合仓库和可用日志给出证据、结论和不确定性；不要修改文件。
```

预期：Coding Agent 按需读取项目 Rule、调用外部事实工具并给出结论，不进入代码修改审查。

### 普通 Bugfix

```text
修复这个空指针问题，保持接口兼容，补最小回归测试；完成前执行综合审查和基于当前变更的最终验证。
```

预期：根据实际难度决定是否使用系统化调试；代码变化完成后执行机械验证和综合审查。

### 简单 Feature

```text
在订单详情响应中返回现有的预计发货时间字段，不新增数据库字段，不改变其他接口。
```

预期：可以直接调查、编辑和测试，不强制生成设计、计划或制品。

### 高风险变更

```text
实现支付回调幂等改造。涉及数据库约束、并发、回滚和生产操作时先给出证据并请求确认，不要自行执行生产写入。
```

预期：触发 Data/Concurrency 或 Security 专项审查；需要新权限或不可逆动作时进入人工确认点，
必要时使用 L3/L4 持久化制品。

### 环境阻塞与人工协作

当编译、单元测试和审查已有可靠证据，但运行时验证被本地 MQ、服务发现、权限或外部环境阻塞时，
Coding Agent 不需要无界尝试所有启动方式。它应比较信息增益、成本、风险与成功概率，选择 `REPLAN`，
或用 `ASK_HUMAN` 说明具体人工动作、原因、已完成事项、完成信号和恢复后的下一目标。
例如本地 Biz 直连返回 200、Orch 失败且日志已确认 Feign 命中旧实例时，根因类别已收敛为 service-discovery routing。如果用户可低成本提供本机实例的 tag、metadata 或 routing convention，应先 `ASK_HUMAN`，不再跨数据库、业务实现等相邻系统重复确认已收敛的假设。

### CodeArts DEV 构建与部署

```text
把当前 broker 变更构建并部署到 DEV，不需要功能自测。

根据我们最近的变更，帮我完成 broker 项目 DEV 环境的构建、部署并自测。
```

此类请求按需加载 `.cursor/skills/codearts-pipeline/SKILL.md`。Skill 使用 KooCLI 的官方 CodeArts Pipeline v5 能力；
项目 Rule 引导到本机 Environment Profile，由 Profile 绑定命名认证 profile、Project 引用、Pipeline 与实际部署目标，禁止依赖 default profile 或回退旧环境。
AK、SK、Token 和实际 Project ID 只保存在本机 KooCLI 配置中，不进入 Harness 或业务仓库。

明确要求完成某一租户的 DEV 构建/部署，构成本任务对该目标的一次 Run 授权；单独的 commit/push 请求不授权部署，
DEV 授权也不扩展到其他租户或 SIT/UAT/PRE/PROD。Coding Agent 以真实 Git diff 与 Pipeline metadata 选择 sources/jobs，
失败时读取 Run/Job/Step/Log 证据后有界恢复。只要求部署时采用 `deploy-only`：Pipeline success 后复用 `runtime-snapshot`，
以本次构建镜像和 Profile 中目标的 Ready / Available / observedGeneration 证据确认部署；缺少构建镜像时不能宣称版本匹配。health/Swagger 可达性不能替代版本与 readiness 证据，不做 CodeGraph
调用链分析、业务 API 发现或功能级验证。只有用户明确要求自测、功能验证或回归时，才采用 `deploy-and-verify`，调用已有项目验证能力
完成与当前变更匹配的 DEV 自测。

Skill 优先调用 `.cursor/scripts/codearts-pipeline.mjs` 完成机械生命周期。`preflight` 自动补齐 Pipeline 定义中的
`always` Job，并只选择实际包含已选 Job 的 Stage；`watch` 内部低频轮询，遇到 `INIT` 且长时间没有 Job 启动时返回
`STALLED_INIT_NO_JOBS`，但不会自行 Retry 或 Stop。Coding Agent 仍负责选择业务 Job、核验远程 branch/revision、
分析失败、选择 Completion Contract 与决定自测；本地 HEAD 不是 Pipeline 构建版本证据。

## 6. 项目 Rule

项目专属知识位于：

```text
.cursor/rules/projects/<project>/
```

使用原则：

1. 只保存稳定项目事实和约束，不复制临时需求。
2. 使用精确 `globs` 将 Rule 绑定到真实项目路径。
3. 不把项目 Rule 设置为全局 always-apply。
4. 不把 Broker 规则复制到 Yunshang 或 B2C，反之亦然。
5. 修改规范 Rule 后运行路由同步和交叉引用校验。

```bash
node .cursor/scripts/check-rule-routing-sync.mjs
bash .cursor/scripts/check-rule-cross-refs.sh
```

新增 Rule 前先读 [资源放置指南](resource-placement-guide.md) 和
`.cursor/skills/harness-resource-authoring/SKILL.md`。

## 7. MCP

Harness 不保存 MCP 运行时配置，也不会生成 `.cursor/mcp/mcp-template.json`。

MCP 配置位置：

- Cursor：业务项目自己的 `.cursor/mcp.json` 或 Cursor Settings → MCP；
- Codex：Codex 宿主 MCP 配置。

`.cursor/rules/mcp.mdc` 维护外部能力与实际 MCP 接入的命名和使用边界，不表示所有能力都必须通过 MCP。
CLI、API 与 MCP 可在相同能力契约和授权边界内替换，不以保留协议为目标。
Nacos 的旧 Python MCP 已退役；Read/Write 使用共享 Node 客户端的独立 Helper，
按需读取 [Nacos Read](../.cursor/skills/nacos-read/SKILL.md) 或 [Nacos Write](../.cursor/skills/nacos-config-write/SKILL.md)，不要求恢复旧 MCP。

注意：

- 不提交密码、Token、密钥或真实连接凭证。
- 使用前确认实际 server name、环境与权限。
- MCP 不可用时可选择同一契约下已具备的 CLI/API；所需能力或证据仍不可得时报告缺口，不猜测外部事实。
- PRE/PROD 写入、生产数据和破坏性操作仍需具体人工授权。

## 8. 制品

按持久化需要选择等级，跨文件修改本身不要求生成 `task.md`；选为 L2 后仍保留其最小制品要求：

- L0/L1：不创建 Markdown 或任务目录。
- L2：`docs/artifacts/work/{task-id}/task.md`。
- L3：`task.md` + `verification.md`，必要时 `design.md`。
- L4：在 L3 上按真实风险增加 `migration.md`、审批、回滚或专项审查证据。

不要从模板目录批量复制空文件。先确认未来状态确实需要离开当前会话，再选择最小模板。

详见 [制品协议](artifact-protocol.md) 和 [模板索引](templates/README.md)。

## 9. 完成一次代码任务

在声明完成前确认：

1. 用户授权的目标和边界已满足。
2. 当前变更已检查，没有无关修改。
3. 适用的 build/test/lint/schema/scanner/运行时检查有真实结果。
4. 至少一个独立、只读综合审查结果对应当前 diff 且保持 fresh。
5. 实际命中的 Security/Data-Concurrency 专项审查已返回终态。
6. 确定性决策（deterministic decision）为 `PASS`。
7. 所需证据均关联当前 repo、branch、HEAD 或 diff，且完整、适用并保持 fresh；只重跑了受影响的证据。
8. 未执行、不可用检查和剩余 WARNING/ADVISORY 已明确披露。

## 10. 验证与排障

### 快速健康检查

```bash
bash .cursor/scripts/check-harness-resources.sh
```

该命令串联 Cursor 规范资源与 Codex 适配器回归。PowerShell 可用时执行对应 `.ps1` 入口；
在 macOS 上 PowerShell 不可用应如实标记为未执行，不能声称 Windows 已验证。

### 维护者验证矩阵

| 目标 | 命令 |
|---|---|
| Rule 路由 | `node .cursor/scripts/check-rule-routing-sync.mjs` |
| Rule 引用 | `bash .cursor/scripts/check-rule-cross-refs.sh` |
| 上下文预算 | `node .cursor/scripts/check-context-budget.mjs --platform=cursor` |
| 安全保护 | `node .cursor/scripts/check-safety-guard.mjs --platform=cursor` |
| 审查拓扑 | `node .cursor/scripts/check-review-topology.mjs --platform=cursor` |
| 制品预算 | `node .cursor/scripts/check-artifact-budget.mjs --platform=cursor` |
| Workflow Diet | `node .cursor/scripts/check-workflow-diet.mjs --platform=cursor` |
| 资源整合 / 引用 | `node .cursor/scripts/check-resource-consolidation.mjs` |
| Hook 冒烟 | `bash .cursor/scripts/smoke-hooks.sh` |
| Playbook 冒烟 | `bash .cursor/scripts/smoke-workflows.sh` |
| 适配器安全性/幂等性 | `node .cursor/scripts/test-resource-adapters.mjs` |

### 常见问题

#### 链接脚本提示目标已存在

先检查目标类型和所有权。业务项目自有内容不得覆盖；旧 Harness 链接应先确认目标，再决定是否显式 `-f`。

#### Hook 没有产生 Rule 发现结果

确认 Node.js 在 PATH、Hook 已启用、请求具有编码意图且输入字段能被当前宿主识别。非编码请求或没有候选 Rule 时输出 `{}` 是正常行为。

#### 上下文突然变大

运行 Context Budget，检查新增 always-apply、宽泛 glob、重复正文或项目 Rule 作用域。不要通过扩大阈值隐藏回归。

#### Codex wrapper 冲突

适配器遇到同名用户 Skill、外部所有者或手工资源会在写入前停止。不要按名称删除或接管 `$CODEX_HOME/skills`；
只有 generated marker、稳定 owner、generator、canonical source 与确定性 wrapper body 能共同证明 Harness ownership。

#### MCP 未发现或不可用

检查业务项目或宿主 MCP 配置、server name、环境和认证。Harness 校验只验证引用与外部管理模式，
不证明运行时连通性。

## 11. 更新 Harness

1. 确认 Harness 仓库没有未提交用户修改。
2. 获取并切换到已发布 commit。
3. 运行综合健康检查。
4. 在 Harness 仓库根目录运行 `bash ./sync-codex.sh` 两次，确认幂等。
5. 对已安装业务项目使用 `link-cursor-config`。
6. 对比同步前后的业务项目状态和内容 hash，确保非 Harness 管理文件未改变。

更新 Harness 不授权 commit、push、部署或修改业务配置。

## 12. 维护者与适配器开发

本节面向维护 Harness 或适配器的开发者，普通使用者可以跳过。

### Codex 临时预检

正式变更前使用隔离目录：

```bash
set -euo pipefail
umask 077
HARNESS_SYSTEM_TEMP="${TMPDIR:-/tmp}"
mkdir -p "$HARNESS_SYSTEM_TEMP"
HARNESS_SYSTEM_TEMP="$(cd "$HARNESS_SYSTEM_TEMP" && pwd -P)"
HARNESS_TEMP_BASE="$HARNESS_SYSTEM_TEMP/zfnjjs-harness"
mkdir -p "$HARNESS_TEMP_BASE"
SYNC_ROOT="$(mktemp -d "$HARNESS_TEMP_BASE/codex-preflight.XXXXXX")"
cleanup_sync_root() {
  if [[ "${HARNESS_KEEP_TEMP:-0}" == "1" ]]; then
    printf 'HARNESS_TEMP_RETAINED path=%s\n' "$SYNC_ROOT" >&2
  else
    rm -rf -- "$SYNC_ROOT"
  fi
}
trap cleanup_sync_root EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
bash ./sync-codex.sh \
  --output "$SYNC_ROOT/output" \
  --skills-dir "$SYNC_ROOT/skills"
```

确认生成内容正确后再执行正式同步。同一同步执行两次应保持内容和 hash 稳定。临时目录默认在
系统临时空间中随 shell 退出清理；只有显式设置 `HARNESS_KEEP_TEMP=1` 时才保留并输出准确路径。

### 适配器所有权

Codex 适配器在变更前校验路径边界、符号链接链、wrapper 内容和所有者身份。
它只清理能证明由当前 Harness 生成器管理的过期资源；公开 Skill 名称没有 namespace，因此同名用户资源一律 fail closed。
从旧版迁移时，`zfnjjs-*` 仅用于发现候选，仍须验证旧 marker、owner、generator、canonical source、wrapper body
与 symlink target 后才能删除。无法证明归属的资源保持不变。
生成适配器的生命周期和可移植性边界见 [架构文档](architecture.md#11-生成资源生命周期)。

## 13. 推荐阅读路径

- 第一次使用：[README](../README.md) → 本指南
- 理解设计：[架构文档](architecture.md)
- 修改资源：[资源放置指南](resource-placement-guide.md)
- 选择制品：[制品协议](artifact-protocol.md)
- 从 v2 迁移： [v2 → v3](v2-to-v3.md)
