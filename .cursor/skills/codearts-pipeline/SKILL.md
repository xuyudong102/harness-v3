---
name: codearts-pipeline
description: 使用 KooCLI 安全查询 CodeArts Pipeline，并在明确授权下执行租户隔离的 DEV 构建、部署、诊断和有界恢复。
---

# CodeArts Pipeline

## 何时使用

当任务需要查询 CodeArts Pipeline，或用户明确要求对当前项目完成 DEV 构建、部署或后续自测时使用。
本 Skill 是 CodeArts Pipeline 操作语义的唯一来源；当前项目 Rule 只提供 tenant、profile、Project 引用、Pipeline 与环境映射。
例如 broker 与 yunshang 各自有项目 Rule，本 Skill 不依赖其中任何一个才能执行。

先按用户意图区分完成契约：只要求构建/部署时使用 `deploy-only`；明确要求“自测”“验证功能”“回归”或等价语义时使用
`deploy-and-verify`。不得把 `deploy-only` 主动扩展为业务功能测试；意图不明确时按用户明确表达的最小范围执行。

DEV 可在当前授权下发布；SIT 只读查询，UAT/PRE/PROD 不在本能力边界内。不修改 Pipeline 配置，不替代代码修改、Review 或业务自测能力。

## 目标绑定与凭证边界

DEV/SIT 的有效绑定来自独立 Local Environment Profile：`~/.harness/runtime/profiles/<platform>/<dev|sit>.json`。它是当前环境唯一活动来源；旧 inventory/catalog 和历史云端流水线仅供溯源，不作为 fallback。通用实现不写具体流水线、集群、namespace 或 gateway。迁移期间的临时流水线名称只在本地 Profile 保存，运维调整时更新该 Profile。

执行任何命令前，明确并交叉核对：

- 目标项目：当前项目 Rule 声明的 tenant；
- KooCLI 命名 profile；
- 该 profile 当前配置的 Region；
- `custom.codeartsProjectId` 对应的 CodeArts Project；
- Pipeline 名称及由 List/Show 返回的真实 Pipeline ID；
- Git branch 与远程代码状态；
- 目标环境明确为 `DEV` 或只读 `SIT`；Run 必须为 `DEV`。

先确认 `hcloud version` 可用，并只查询命名 profile 所需的 Region 和 `custom.codeartsProjectId` 是否存在；
不得打印完整 profile。profile、Project 引用或凭证未配置时输出 `AUTHENTICATION_SETUP_REQUIRED`，说明目标租户和
KooCLI 本机配置字段，让用户在自己的 Terminal 中完成配置；不得要求用户把 Secret 发到对话中。

每条 KooCLI 命令都显式传入项目 Rule 指定的 `--cli-profile`；Region 使用该 profile 的当前配置，Project ID 使用
`custom.codeartsProjectId` 引用。禁止使用 `default` / current profile 隐式选择身份。任一绑定不一致时停止，
不得尝试另一租户身份。

AK、SK、Token 和其他 Secret 只能由 KooCLI 本机安全配置管理，不读取、不输出、不写入 Harness、Git、Prompt、
报告或普通日志。Project ID、Pipeline ID、run ID 可在当前工具调用中使用，但只在报告中保留完成核验所需的最小标识。

## 授权

- List、Show、Runs、Run Detail、Step 输出与日志等只读查询可以按任务需要执行。
- 用户明确要求完成当前项目 Rule 所绑定租户的 DEV 构建/部署时，视为对本任务、目标租户和 DEV 环境的一次 Run 授权，
  以及完成同一目标所必需且有证据支持的有界恢复授权。
- “提交代码”或“push 代码”本身不授权部署。
- DEV 授权不扩展到其他租户、SIT/UAT/PRE/PROD 写入、Pipeline 配置修改、删除资源或新的业务决策。
- Retry 需要真实失败证据和新的恢复依据；相同失败重复、信息增益下降、原因未知或依赖权限/基础设施/业务决策时，
  使用 `ASK_HUMAN`，禁止无限重试。
- Stop 仅可用于当前任务明确创建且继续运行会造成浪费或风险的异常 run；无法证明归属时不得停止。

## 只读调查

先从当前仓库与对应项目 Rule 确定目标。机械查询、执行与观察优先使用
`.cursor/scripts/codearts-pipeline.mjs`；它只封装官方 KooCLI v5，不保存凭证、Project ID 或 Pipeline ID。
底层事实源仍为：

- `ListPipelines`：按精确名称解析唯一 Pipeline；零个或多个候选时输出 `PIPELINE_SELECTION_REQUIRED` 并请用户选择；
- `ShowPipelineDetail`：读取真实 sources、definition / `yaml_definition`、variables 与执行方案，并从实际定义解析 stages/jobs；
- `ListPipelineRuns`：查询历史运行；
- `ShowPipelineRunDetail`：查询状态与 Job / Step 执行信息；
- `ShowStepOutputs`：读取失败 Step 的结构化输出；
- `ShowPipelineLog`：仅在诊断需要时读取必要日志范围，并对可能的 Secret 做脱敏。

需要直接排查 KooCLI 时仍必须显式绑定 profile 和本机 Project 引用，例如：

```bash
hcloud CodeArtsPipeline ListPipelines \
  --cli-profile="$PROFILE" \
  --project_id="custom.codeartsProjectId"

hcloud CodeArtsPipeline ShowPipelineRunDetail \
  --cli-profile="$PROFILE" \
  --project_id="custom.codeartsProjectId" \
  --pipeline_id="$PIPELINE_ID" \
  --pipeline_run_id="$PIPELINE_RUN_ID"
```

不要把命令输出整段写入制品；只保留结论所需的结构化事实和脱敏证据。

## 构建范围决策

1. 检查相关 Git repo 的 branch、HEAD、remote tracking、status 和待部署提交；只读调查不隐含 push 授权。
   Pipeline 构建版本以目标远程 branch/revision 与 Pipeline source 为准；本地 HEAD、ahead/behind 或工作区状态不能代替构建版本证据。
2. 用真实 diff / commits 得出发生变化的 repo、module 与部署单元，不把聊天描述当作变更事实。
3. 用 `ShowPipelineDetail` 取得 sources 和 definition / `yaml_definition`，从实际定义解析 stages、jobs 与依赖关系，
   再将变更范围映射到可选择项。
4. 默认选择受影响的可部署 job 及 Pipeline 真实要求的前置 build/deploy job，不因方便而运行全部综合 Pipeline。
5. 如果 source/job 映射不能由 Git、项目知识与 Pipeline metadata 唯一证明，使用 `ASK_HUMAN`，不得猜测。
6. Mutation 前确认本次待构建提交已存在于目标远程 branch；需要 push 时遵守独立 Git 授权。

环境 Profile 的 `ci.routingStatus` 必须为 `CONFIRMED`，pipeline ID/name、实际部署 Cluster/Namespace、执行机 context 的确认依据和部署 Step hash 必须一致。仅凭名称包含临时后缀不得确认目标。helper 每次从实时 metadata 复核绑定和部署 Step；漂移、缺失或多候选返回 `NEEDS_HUMAN`，不猜测、不回退旧 dev。显式参数不得覆盖 Profile 目标。当前 task 要求共享环境写入前确认时，遵守该授权边界。

Mutation 前形成简短 `BuildPlan`：tenant、profile、Region、Project 引用、Pipeline 名称、branch、environment、sources、jobs、
variables、选择依据、置信度和授权来源。它是可核验的行动摘要，不是新的审批阶段；当前用户请求已经明确授权 DEV 构建/部署时，
无需为同一 Run 再机械请求确认。

## Run 与状态观察

Coding Agent 只负责给出由真实变更证明的业务 build Job；helper 从实时 `ShowPipelineDetail` 自动：

- 精确解析 Pipeline、sources 与 definition；
- 将所有 `select_strategy=always` Job 和 Profile 确认的 `ci.requiredJobs` 前置/部署 Job 加入 `choose_jobs`；
- 只把实际包含已选 Job 的 Stage 加入 `choose_stages`，不把空 Stage 留给运行时猜测；
- 为所有 code source 绑定目标远程 branch；
- 返回 compact JSON，不把完整 Pipeline definition 和 Run detail 注入模型上下文。

helper 的 `run` 子命令调用官方 `RunPipeline`；不实现第二套 REST Client 或签名逻辑。

先执行只读 `preflight`；用户已明确授权当前租户 DEV Run 后，才可将子命令改为 `run` 并追加 `--authorized-dev-run`。
`--authorized-dev-run` 只记录调用方已核验授权，不能自行创造授权：

```bash
node .cursor/scripts/codearts-pipeline.mjs preflight \
  --project "$PLATFORM" --environment DEV \
  --branch "$BRANCH" --job "$BUILD_JOB"

node .cursor/scripts/codearts-pipeline.mjs watch \
  --project "$PLATFORM" --environment DEV \
  --pipeline-id "$PIPELINE_ID" --run-id "$PIPELINE_RUN_ID"
```

`watch` 内部在 Job 启动前每 10 秒、启动后每 15 秒查询一次；默认最多观察 30 分钟。对约 3 分钟的 DEV Run，
这能将模型侧多轮 CLI 调用收敛为一次，同时保持秒级到十几秒级的失败发现延迟。参数可在真实 Pipeline 特征变化时调整，
不是新的业务流程约束。

若 Run 在 `INIT` 且 180 秒内没有任何 Job 启动，helper 返回 `STALLED_INIT_NO_JOBS` 并停止轮询。
该信号表示执行范围或平台调度需要重新判断，不表示可直接 Retry；Coding Agent 应先核验 Run 归属、`choose_stages`、
`choose_jobs` 和 Pipeline metadata，再决定 Stop、REPLAN 或 `ASK_HUMAN`。

## 失败诊断与有界恢复

失败时按证据逐层收敛，而不是立即 Retry：

`Pipeline → Job → Step → Step Outputs / Log`

`watch` 在 FAILED 时自动汇总失败 Job/Step 和经脱敏、限长的关键输出；也可单独调用 `failure-evidence`。
helper 不调用 `RetryPipelineRun` 或 `StopPipelineRun`，避免把工程判断下沉成自动恢复 Workflow。

将失败归为：构建范围或 Job 遗漏、当前代码编译/测试问题、可恢复的瞬时失败、环境/权限问题、Pipeline 配置问题、无法判断。

- 构建范围遗漏：只有 metadata 证明遗漏且授权仍适用时，修正 BuildPlan 后重跑。
- 代码问题：回到正常 Harness 代码修改、机械验证和 Review 契约；本 Skill 不承担代码修复流程。
- 瞬时失败：存在明确瞬时证据、重试成功概率合理且成本可接受时，才使用 `RetryPipelineRun`。
- 环境/权限、Pipeline 配置、未知原因或重复同类失败：保留当前证据并 `ASK_HUMAN`。

需要停止当前任务创建的异常 run 时使用官方 `StopPipelineRun`，并在执行前再次核对 run 归属与目标绑定。

`ASK_HUMAN` 应说明需要人做什么、为何人工更合适、已经完成什么、完成信号，以及恢复后准备继续的动作。

## 成功后的 Completion Contract

Pipeline Run `COMPLETED` 仅表示运行达到终态，不代表目标 Job 已执行或成功；Run 级 `SUCCESS` 结果也不能替代目标 Job 的实际执行证据。
目标 Job 必须实际执行且成功，`UNSELECTED` 表示未执行，不得视为成功；部署完成还须满足下述 `deploy-only` 证据要求。

Coding Agent 应根据用户意图应用以下一个完成契约，不把两者串成固定流程。

### `deploy-only`

完成证据需要覆盖：目标租户与 DEV 绑定、实际远程 branch/revision、目标 run 的 terminal success，以及 Profile 绑定的本地 Kubernetes 中实际部署镜像与本次构建一致、Deployment/Pod Ready/Available、observed generation 和最小 readiness 证据。
CodeArts SUCCESS 不等于本地发布成功，Pod Running 也不证明版本正确。使用 `kubernetes-read.mjs snapshot --project "$PLATFORM" --env DEV --service "$SERVICE" --expected-image "$BUILD_IMAGE"` 验证。若 CodeArts 只构建，则关联独立发布记录后再验证；必要时以 health/Swagger 可达性检查补齐健康证据。不得为此调用 CodeGraph 分析 diff、发现业务 API、构造功能断言
或执行回归测试。readiness 证据 unavailable 时如实披露，不把 Pipeline success 伪装成服务可达。

### `deploy-and-verify`

用户明确要求自测、功能验证或回归时，在 `deploy-only` 证据之外，由 Coding Agent 根据当前 diff 选择已有 Swagger/API、项目验证、日志或
其他确定性能力完成匹配的 DEV 自测。无法取得的运行时证据必须标为 unavailable 并说明原因，不伪造通过结果。

飞书 Pipeline 成功/失败通知只作为 Human Notification Channel，不进入 Agent 控制链，也不替代
CodeArts API、`pipeline_run_id` 与 Run detail 的权威状态。业务自测中的单接口失败，应结合其他运行时证据判断适用性；
不得因一个非阻断 5xx 无界重试，也不得用其他接口成功掩盖 Task Contract 的硬验收失败。

最终报告至少包含：

- tenant/profile/Region/Project/Pipeline/branch/environment 绑定核验；
- Git 与远程提交证据；
- BuildPlan 的 sources/jobs 及选择依据；
- run 终态和必要的 Job/Step 证据；
- Retry/Stop/ASK_HUMAN 决策及其证据（如发生）；
- 所采用的 `deploy-only` 或 `deploy-and-verify` 完成契约、对应证据与残余风险。

## 实现边界

- 官方 KooCLI v5 已覆盖本 Skill 所需能力；没有新证据时不实现 REST Client。
- deterministic helper 只负责 preflight、Run、watch、status 与 failure evidence；Job 选择、故障归因、代码修复、Retry/Stop、
  Completion Contract 选择、DEV 自测策略和人工协作仍由 Coding Agent 决定。
- 不新增 Workflow、Phase、Agent handoff 或固定 job 清单。
- 不为 Broker 与 Yunshang 复制第二份操作 Skill。
- 项目路由事实只写入各自项目 Rule；敏感凭证和实际 ID 只留在本机 KooCLI 配置。
