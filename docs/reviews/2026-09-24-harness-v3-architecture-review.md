# Harness v3 Architecture Review

日期：2026-09-24。规范源：本仓库。只读审查，未改实现。证据来自资源文件、`rules-engine` 与 context budget。

这是一次时点审查记录，不是实施计划，也不改变现行架构文档的权威性。

## 1. Executive Summary

Harness v3 的控制面反转已经落地，不是文档口号。三个 playbook 没有 `steps` / `phases` / `next`，`check-workflow-diet.mjs` 把这条约束做成了回归。常驻上下文只有 `execution-boundary.mdc`（722 字符）。Codex wrapper 只写发现指针，不复制 Skill 正文。经纪商与云商的 glob / `alwaysApply` 隔离检查是通过的；`yunshang-esign-broker` 路径没有把经纪商规则拉进来。

它已经适合进入真实经纪商 / 云商任务。没有 P0。不必再做一轮基础设施开发，也不必先迁移到 `.harness`、合并 Skill 或折叠 Rule。

还没完全达到“通用 Skill + 项目事实”的理想形态。`runtime-snapshot` 把经纪商 / 云商和本机 `~/Workspace` 写进了规范 Skill。Cursor 的发现引擎在任意 “fix” 上默认挂 Java 场景，并在路径命中后列出该项目全部 Rule。这些会在非 Java 项目、第三个项目或开源时暴露，但不会阻止下一次经纪商 / 云商真实任务。

## 2. Design Principle Assessment

| Principle | Status | Evidence | Comment |
|---|---|---|---|
| Agent as Control Plane | PASS | `workflows/*.yaml` 的 `control_plane: current-coding-agent`；`check-workflow-diet.mjs` 禁止 `steps/phases/next`，并断言 handoff/phase/transition = 0 | 完成契约是证据条件，不是执行轨道 |
| Universal Skills | PARTIAL | `codearts-pipeline` 把租户留在项目 Rule；`runtime-snapshot/SKILL.md` 与 `runtime-snapshot.mjs` 只接受 `broker\|yunshang` | 多数方法 Skill 已通用；运行时快照不是 |
| Project Facts Separation | PARTIAL | 云商只有 `yunshang-facts.mdc`、`yunshang-codearts.mdc`；经纪商有 13 个文件；b2cmall 另有 11 个约定文件且没有 facts | 云商拆法符合新理念；经纪商 / b2cmall 仍是旧的主题分片 |
| On-demand Discovery | PARTIAL | budget 用例 A：常驻 1 条 / 722 字符，发现索引 27 条 / 1231 字符，合计 1953，低于 12000 | 正文没有预加载；索引本身偏宽，且 `rules-loader.mdc` 写了“合并加载所有相关规则” |
| Single Canonical Source | PARTIAL | `sync-codex.mjs` 的 wrapper 只含 canonical 路径；完成契约同时出现在 `AGENTS.md`、3 个 yaml、`done-verify`、`docs/architecture.md` | 生成物没有变成第二知识源；契约文本有五份 |
| Thin Host Adapter | PARTIAL | Codex `wrapperText()` 约 4 行指引；`createRulesEngine()` 对非 `cursor` 直接抛错 | Codex 薄。Cursor Hook 是另一套关键词路由器，不与 Codex 共享 |
| Project Isolation | PASS | `check-harness-resources.sh` 要求项目 Rule `alwaysApply: false` 且 glob 含项目名。探针：云商 Java 路径 16 条且仅 `yunshang`；`yunshang-esign-broker` 未串入 broker | 物理上 `link-cursor-config.sh` 会把全部 `projects/*` 链进每个业务仓，隔离靠发现不靠目录不可见 |
| Fail Closed | PASS | `sync-codex.mjs` 以 owner/generator/canonical 全等才视为拥有；同名用户 Skill 拒绝覆盖。link 默认 SKIP，只有 `-f` 才删。`hooks.json` 的 `preToolUse` 为 `failClosed: true` | 所有权不明确时不接管 |
| Portable Layout | PARTIAL | 项目事实写 `projects/mall/repos/b2b/backend/{broker,yunshang}`。`agentsConfigText()` 指向 `path.join(root, '../../personal/rules')`。快照脚本使用 `os.homedir()/Workspace/...` | 项目路径是环境事实。Adapter 和个人目录是架构硬依赖 |
| Evidence-driven Verification | PASS | `execution-boundary.mdc` 禁止用语言代替工具。`done-verify` 只补缺失、失败或 stale 的证据，并禁止伪造 PASS | 代码完成判断成立。MCP 注册表仍把名称当成能力清单，见第 9 节 |

## 3. Current Architecture

```text
用户任务
    │
    ▼
Coding Agent（控制面）
    │
    ├─ Cursor
    │    sessionStart     清理 hook 状态
    │    beforeSubmitPrompt → rules-engine.mjs
    │         关键词场景 + 项目路径 → 只注入 Rule 路径索引
    │    preToolUse        只读/PRE/PROD/破坏性命令，失败即拒绝
    │    原生 .cursor/{rules,skills,agents,workflows}
    │
    └─ Codex
         ~/.codex/AGENTS.md
              → $CODEX_HOME/harness/zfnjjs/config/generated-harness-index.md
              → 按需打开 repo-local canonical
         $CODEX_HOME/skills/<skill>  → 薄 wrapper → .cursor/skills/<skill>/SKILL.md

规范源（唯一）
    .cursor/AGENTS.md
    .cursor/rules/**          77 个 .mdc，仅 execution-boundary alwaysApply
    .cursor/skills/**         16 个 SKILL.md
    .cursor/agents/**         6 个
    .cursor/workflows/**      bugfix | refactoring | feature-delivery
    .cursor/hooks/**          仅 Cursor
    .cursor/scripts/**        同步、预算、diet、隔离、CodeArts、runtime snapshot
    docs/templates/**         L2+ 才使用

业务项目
    link-cursor-config.sh 把 .cursor 与 docs 逐项软链进来
    docs/artifacts/{work,archive} 留在项目本地
    MCP 运行时在项目或宿主，不在 Harness 仓库

证据
    repo / git / build / test / lint
    项目事实里的宿主 MCP key（nacos-broker、nacos-yunshang、dbx、codegraph）
    KooCLI：codearts-pipeline.mjs，profile 来自项目 Rule
```

## 4. Findings

### P0

No issue found.

没有发现会导致错误执行、资源被覆盖、项目串读或控制面被 Workflow 抢走的现行缺陷。`yunshang-esign-broker` 这条最可疑的串项目路径，探针结果仍只有云商规则。

### P1

**1. `runtime-snapshot` 把具体项目和本机目录写进了规范 Skill**

- 路径：`.cursor/skills/runtime-snapshot/SKILL.md`，`.cursor/scripts/runtime-snapshot.mjs`
- 证据：Skill 参数只有 `--project=broker|yunshang`。脚本把 namespace、env 文件和 Pipeline 名做成常量表，并用 `os.homedir()/Workspace/projects/mall/...` 调 Nacos。未知项目直接 `INVALID_ARGUMENT`。
- 为什么是问题：这是公司运行时能力，不是通用工程能力。它违反“Skill 不认识固定项目、不依赖固定父目录”。
- 当前影响：经纪商 / 云商排查能用，并且对未知项目 fail closed，不会串环境。
- 未来影响：第三个项目或换机器布局时必须改 Harness core。
- 推荐：真实 case 证明这份快照比临时命令更稳之后，再把项目枚举移出规范 Skill。现在不要再包一层抽象。
- LATER

这是真实使用约束，不是纯理论问题。不改，现有两个项目继续可用。已有实现就是案例。再抽象会增加 Harness 复杂度。现在不值得改。

**2. 任意编码意图都会挂上 Java 场景**

- 路径：`.cursor/hooks/lib/rules-engine.mjs` 的 `isCodingIntent` 与 `detectScenes`
- 证据：`fix|bug|修改|code` 即加入 `java` 和 `change-implementation`。探针对 `services/api/app/main.py` + “fix a bug” 得到 17 条 Rule，项目集合为空，内容仍是 Java 风格规则。
- 为什么是问题：发现索引在替非 Java 任务建议一套 Java 手册。
- 当前影响：经纪商 / 云商本身是 Java，影响小。budget 仍只注入路径。
- 未来影响：Python / Go / Node 项目一开口就被指向 `naming.mdc`、`mybatis` 那一组。
- 推荐：等第一个非 Java 真实任务看模型是否真去读这些文件。不要预先做语言路由器。
- LATER

**3. 项目路径一命中，就列出该项目全部 Rule**

- 路径：`rules-engine.mjs` 的 `resolveRules`；对照 `rules-loader.mdc` 第 76 行“多个场景重叠时，合并加载所有相关规则”
- 证据：用例 A「修复一个 Java 空指针」，路径只是 `com/broker/.../UserService.java`。发现列表 27 条，其中经纪商 13 条全在，包括 `broker-codearts`、`broker-job`、`broker-mq`。Hook 文案写“不要批量加载”，索引却把整个项目包递上去。
- 为什么是问题：按需发现的闸门在索引宽度，不在正文注入。强模型很容易把菜单当成必读清单。
- 当前影响：自动附加正文在用例 A 是 0。合计 1953 字符，预算通过。真正的成本发生在模型后续阅读。
- 未来影响：项目约定文件继续增加时，每次小修复的候选集线性变长。
- 推荐：若真实任务里模型把 codearts/job/mq 和空指针一起读完，再把索引收成“facts + 当前 glob 命中”。现在不要改路由表。
- LATER

**4. MCP 能力名和宿主真实 key 是两套名字**

- 路径：`.cursor/rules/mcp.mdc`；`broker-facts.mdc`；`yunshang-facts.mdc`；`check-resource-consolidation.mjs`
- 证据：`mcp.mdc` 要求 `-mcp` 后缀，登记 `loki-mcp`、`{env}-nacos-mcp`、`codegraph-mcp`，并写“MCP 不可用就停止”。项目事实写的是 Codex key：`nacos-broker`、`nacos-yunshang`、`codegraph`、`dbx`。同文件后半又说“以已经启用的 key 为准”。校验脚本只检查注册表字符串还在。
- 为什么是问题：规范同时说“必须用注册名”和“以宿主 key 为准”。模型可能因找不到 `loki-mcp` 而停，尽管宿主上有另一个已启用的日志入口。
- 当前影响：项目事实本身已经要求“没有该入口就说明缺失”，方向是对的。冲突来自通用注册表。
- 未来影响：每接一个宿主就要改注册表，否则校验和事实继续分叉。
- 推荐：下一次真实 MCP 调用以项目事实和宿主已启用 key 为准。注册表先当作历史清单，不要为对齐名字再做抽象层。调用失败再改那一处事实。
- DEFER

### P2

**5. 完成契约被抄了五份**

`AGENTS.md`、三个 playbook 的 `completion`、`done-verify/SKILL.md`、`docs/architecture.md` 描述同一套 PASS / CHANGES_REQUIRED / HUMAN_REQUIRED。diet 检查防止阶段机复活，不保证五段文字同步。漂移后模型会看到互相矛盾的完成条件。现在行为一致，所以只是维护负担。DEFER。

**6. 场景表和 Hook 引擎双份维护**

`rules-loader.mdc` 的场景表与 `SCENE_DETECTORS` / `SCENE_TO_ROW` 必须逐字对应，靠 `check-rule-routing-sync` 守着。这是为了发现而增加的 Harness 机制。Codex 根本不跑这个引擎，只让人去读 `rules-loader.mdc`。两套发现已经可能给出不同候选。DEFER，除非真实任务出现 Cursor 与 Codex 行为分叉。

**7. 经纪商 13 个约定文件与 b2cmall 11 个近乎镜像；云商没有这套**

`rules-loader.mdc` 明确推荐“跨项目复制”。云商事实写明不要套用经纪商的 Orch/API/Biz 和 `TenantContextHolder`，所以云商只有 facts + codearts，这是对的。b2cmall 仍整包留在规范树里，且没有 `b2cmall-facts.mdc`。77 这个数字里，约 26 个是项目文件，约 51 个是通用 Java / 工程规则。数量本身没有撑爆常驻上下文；负担在路由和镜像修改。DEFER。

**8. `.cursor` 同时是规范根和 Cursor 原生配置**

Hook、`hooks.json`、`session-title.mdc`（`rename_chat`）住在规范树里。Codex 同步时会把这些路径写进索引，但不会执行 Hook。这是已知的宿主不对称，架构文档第 12 节也承认 Hook schema 不能强行单源。现在能工作。迁到 `.harness` 只会把 Cursor 原生发现再做一层链接。DEFER。

### P3

**9. 每个 Skill 旁有一份 README，Agent 仍提到 legacy 制品路径**

README 与 `SKILL.md` 并存。`systematic-debug`、`issue-context-fetcher` 仍指向 `context/issue-context.md` 等 legacy 文件，但是可选。不构成第二执行源。DEFER。

**10. 决策记录仍把 TRAE 写成活跃链接目标**

`docs/decisions/2026-09-15-resource-consolidation.md` 大量 “TRAE link”。活跃脚本和 README 已只支持 Cursor / Codex。历史决策可以留着。DEFER。

## 5. Skill Review

| Skill | Trigger 清晰度 | 通用性 | 重叠风险 | 结论 |
|---|---|---|---|---|
| systematic-debug | 清晰：难定位、证据不足时 | 通用 | 与 log-investigator 互补，不重复 | 保留 |
| tdd-bugfix | 清晰：已授权且要失败测试 | 通用 | 是 debug 之后的可选修法，不是必经步骤 | 保留 |
| feature-delivery-workflow | 弱：复杂功能或要恢复时 | 通用 | 只是 `feature-delivery.yaml` 的阅读说明 | 保留观察；不要再加阶段 |
| done-verify | 清晰：代码变更的完成判定 | 通用 | 与三个 playbook 的 completion 重复 | 保留；它是操作入口 |
| quality-review-routing | 清晰：只路由真实安全/数据风险 | 通用 | 不决定综合审查，边界写清了 | 保留 |
| safe-refactoring | 清晰，且标明 optional | 通用 | 与 refactor-plan 前后衔接 | 保留 |
| refactor-plan | 弱 | 通用 | 与 writing-plans、safe-refactoring 重叠 | 保留观察，不合并 |
| writing-plans | 弱，optional | 通用 | 同上 | 保留观察 |
| brainstorming | 清晰：方案不确定时 | 通用 | 低 | 保留 |
| codegen-guard | 过强：写新文件前“强制调用” | 偏 Java 企业规范 | 与 java-edit-self-check、一堆风格 Rule 重叠 | 缩小使用：仅新文件且项目 Rule 要求时 |
| git-worktree | 清晰 | 通用 | 低 | 保留 |
| codearts-pipeline | 清晰：明确授权的 DEV 流水线 | 工具通用，租户在项目 Rule | 与 runtime-snapshot 都碰部署状态，职责不同 | 保留 |
| runtime-snapshot | 清晰，但是项目枚举 | 不通用 | 与项目事实、CodeArts 查询重叠 | 保留到真实 case 验证；不要扩展第三个项目进 core |
| hld-to-feishu / lld-to-feishu | 清晰：明确要求才发布 | 组织工具 | 低 | 保留 |
| harness-resource-authoring | 清晰：改 Harness 时 | Harness 元能力 | 低 | 保留 |
| harness-debug-logger | 清晰：要记录适配器故障时 | Harness 元能力 | 低 | 保留 |

没有建议现在废弃的 Skill。`feature-delivery-workflow`、`refactor-plan`、`writing-plans` 是可选方法，重叠但没有形成第二套必跑流程。

## 6. Agent Review

| Agent | 是否真正需要独立 Agent | 与 Skill 重叠 | 建议 |
|---|---|---|---|
| integrated-reviewer | 需要。价值是实现者与审查者分离，且完成契约要求 current-diff fresh 结果 | 与 done-verify 衔接，不替代它 | 保留 |
| security-reviewer | 需要。只在真实安全边界命中时使用 | quality-review-routing 决定是否触发 | 保留 |
| data-concurrency-reviewer | 需要。事务、幂等、迁移与综合审查不同 | 同上 | 保留 |
| log-investigator | 弱。只读 Loki 查询更像 Skill | 与 systematic-debug 的证据来源重叠 | 保留观察。没有独立权限域，不必再加强制角色 |
| issue-context-fetcher | 不需要。整理用户已给的缺陷文本是模型自己的事 | 几乎无工具隔离 | 可以废弃，但现在没有真实伤害 |
| memory-consolidator | 需要，频率低。只写已批准的 Rule | 与 correction-detection 配对 | 保留。不要让它监控日常对话 |

三个审查 specialist 值得存在。日志和缺陷整理可以以后收成 Skill，现在删掉不会让真实任务更可靠。

## 7. Rules Review

77 个 `.mdc`：通用约 51，经纪商 13，b2cmall 11，云商 2。`alwaysApply: true` 只有 1 个。

路由有三条，互不替代：

- Cursor 原生 glob 自动附加。高精度 glob 才附正文。用例 B 自动附加 2 条（`mybatis.mdc`、`broker-mq.mdc`），5997 字符。
- Hook 关键词 + 项目目录名，只给路径。
- Codex 读 `rules-loader.mdc`，再只搜 `rules/projects/<matching-project>/`。

项目作用域本身合理：空 glob 不自动附加，非空 glob 必须带项目特征，禁止 `**/*.java`。这次预算没有发现 broad Java glob。

重复事实：经纪商与 b2cmall 的 architecture / mq / job / naming / persistence 是有意复制。云商 facts 明确禁止从经纪商抄租户 API，这是正确的分化。

过时痕迹：b2cmall 没有 facts / codearts；决策文档仍写 TRAE。活跃隔离脚本仍把 b2cmall 列进检查，所以它还在规范里，不是死链接。

上下文风险不在 77 这个库存，而在一次 Java 任务索引 27–35 条。预算测量的是索引，不是模型随后读入的正文。70+ 作为文件柜可以接受；作为每次任务的建议阅读清单则偏多。不值得为了数量去做合并工程。

项目粒度：云商的“一份 facts + 少量专门规则”更符合 v3。经纪商按主题拆开，只在 mq / job / feign / error-code 这类能写高精度 glob 时有好处；architecture、naming、pagination、context 的 glob 是空的，全靠路径命中后整包出现。现在不要把经纪商合并成一个文件，等真实任务证明整包阅读发生后再收。

## 8. Adapter Review

### Cursor

不薄。`.cursor` 就是宿主格式，再加上 `rules-engine.mjs`（场景检测、项目正则、发现文案）和三个 Hook。这是发现与安全网，不是 Workflow 运行时：不保存阶段，不注入 Rule 正文。

`link-cursor-config.sh` 只做软链和本地制品目录。默认不覆盖已有路径；`-f` 会删目标侧已有项，这是显式强制，不是默默接管。它会把所有项目 Rule 链进每一个业务仓。隔离依赖 Hook 和 glob，不依赖文件不可见。

Host 逻辑留在 `.cursor/hooks` 和 `session-title.mdc`，没有写进 `systematic-debug` 这类方法 Skill。

### Codex

薄。`wrapper()` 只输出 name、description、owner、canonical 路径，以及“适用时再读、L0/L1 不建任务状态”。索引是目录，不是正文。所有权不匹配则不删。

泄漏点有两处，都在生成的 Adapter 文案里，不在 Skill 正文：

- canonical realpath 写进 owner 注释，这是生成物，可以接受。
- `agentsConfigText()` 把 `../../personal/rules` 写进每个 Codex 引导，并点名 `git-staging.md` 等个人文件。Harness 仓库不在 `Workspace/ai/harness/...` 时，这条路径是错的。

Cursor 与 Codex 没有两份 Skill 正文。它们有两套发现：关键词引擎，以及对 `rules-loader.mdc` 的阅读说明。这是真实不对称，不是重复维护同一段知识。

## 9. MCP / CLI Model Review

抽象只做了一半。

- 设计上的正确部分：Harness 仓库没有 MCP 运行时配置。索引写明 `MCP_EXTERNAL_CONFIGURATION: project-managed / host-managed`，并且 `runtimeConfigurationValidated: false`。CodeArts 用 KooCLI，profile 和 Project 引用在项目 Rule，Secret 不进仓库。
- 未解耦的部分：`mcp.mdc` 的注册名与经纪商 / 云商事实里的宿主 key 不一致。`dbx` 被登记为例外，因为它没有 `-mcp` 后缀。`check-resource-consolidation.mjs` 把注册表字符串当成必须存在的能力。
- 优先级：代码事实用仓库和测试。外部只读事实用项目事实里的那个已启用入口。CodeArts 执行用 CLI，不用 MCP。没有“MCP 失败再换 CLI”的统一阶梯，CodeArts 本来就只有 CLI。日志则是“宿主有 Loki 才查，没有就停”。这比假的 fallback 更安全。
- 验证：配置存在不等于可用。项目事实已经这样写。通用 `mcp.mdc` 的“停下来等用户到 Cursor Settings 打开注册名”会把缺失配置说成阻塞，即使另一个宿主 key 可用。
- 环境依赖：Nacos env 文件路径、`经纪商-` / `云商-` 连接名前缀、KooCLI profile 名，都属于这两个项目的事实，不应该升格成通用 Skill。

## 10. Overengineering Review

已经偏重、但还没有失控的部分：

- 三个 playbook 的 guidance 各只有两三句，completion 块却各复制一整份证据协议。重量在重复，不在阶段机。
- `codegen-guard` 要求新文件前强制过企业清单，Java 场景再建议 13 条风格 Rule。这是为较弱模型防漏而做的，强模型会被它拉去读手册。
- `rules-loader` + `SCENE_DETECTORS` + 同步检查，是一套只为 Cursor 服务的发现编译器。Codex 用不了它。
- `issue-context-fetcher` 没有独立工具边界。
- L0/L1 的“零持久文件”已经写进契约，又在多个 Skill 里反复解释 legacy 路径。解释本身在占上下文。

建议：

- 删除：现在不删。`issue-context-fetcher` 是唯一接近可删的角色，删了也不改变真实任务。
- 简化：现在不简化 playbook，也不合并 Java Rule。
- 保留观察：发现索引是否被整包阅读；`codegen-guard` 是否在小改动里被当成门禁；Cursor 与 Codex 是否走出不同的 Rule 集合。

这些机制没有在当前经纪商 / 云商任务上表现出失败。为了“更像理想架构”去拆，会增加一轮迁移。默认不动。

## 11. New Project Test

一个陌生的 Python / Go / Node 仓库：

不需要改的：

- `systematic-debug`、`tdd-bugfix`、`done-verify`、`safe-refactoring`、`git-worktree`、三个审查 Agent、`execution-boundary.mdc`
- 安装仍然是 `link-cursor-config.sh <project>` 或现有 Codex sync

需要新增的：

- `.cursor/rules/projects/<name>/<name>-facts.mdc`：仓库在哪、怎么构建、怎么测、哪个证据入口可用
- 只有存在稳定且与通用规则不同的约定时，才加少量带高精度 glob 的专门 Rule

仍然会碰到 core 的地方：

- 若要使用 `runtime-snapshot`，必须改脚本里的项目枚举和本机路径。通用调试不需要它。
- `check-harness-resources.sh` 只对 broker、yunshang、b2cmall 做作用域断言。新目录不会自动获得同样的 fail。不改 core，新项目 Rule 仍能被路径正则发现，只是少一道校验。
- 只要用户说 “fix”，Cursor 仍会索引 Java 风格 Rule。这不阻止使用，但会污染建议清单。

因此：通用工程可以只加 project facts。公司运行时快照不行。

## 12. Recommended Actions

### NOW

没有必须在下一次真实任务前改的代码。

进入任务时遵守现有事实即可：MCP 以项目 Rule 里的已启用 key 为准；没有入口就说明缺失；不要因为 `mcp.mdc` 里有某个名字就认为当前宿主可用。

### LATER

真实 case 若出现下面任一情况，再改对应的一处：

- 模型按发现索引把经纪商 13 条 Rule 读完
- 云商任务读到经纪商事实，或相反
- 调用停在 `loki-mcp` / `{env}-nacos-mcp`，而宿主上实际是另一个 key
- 第三个项目或非 Java 仓库被 Java 场景和 `runtime-snapshot` 挡住

### DEFER

- 把规范根迁出 `.cursor`
- 合并 Skill、删除 Agent、折叠 70 条 Rule
- 统一 Cursor / Codex 发现引擎
- 为 playbook 契约做单一生成源
- 把 `runtime-snapshot` 再设计成通用运行时框架
- 清理 TRAE 历史决策或 Skill README

## 13. Final Verdict

1. 可以停止基础设施开发。控制面、薄 Codex wrapper、fail closed 和项目 glob 隔离已经够用。继续加机制，主要是在增加 Harness 自己的复杂度。
2. 应该进入真实经纪商 / 云商 case。没有 P0 挡在前面。
3. 最值得用真实任务验证的假设：
   - 模型不会把 27 条发现路径当成必读正文。
   - 经纪商与云商事实不会串读，包括名字里带 broker 的云商模块。
   - 外部证据使用项目事实中的宿主 key，而不是 `mcp.mdc` 注册名。
   - 小的代码修改只产生一次对应当前 diff 的综合审查和真实测试，不创建 L0/L1 文件，也不按 playbook 阶段推进。
   - Codex 只在 Skill 适用时打开 canonical `SKILL.md`。
