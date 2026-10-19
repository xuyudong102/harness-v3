# Harness v3 架构图索引

本目录保存现行架构图。`.drawio` 是唯一可编辑图形源；同名 SVG 是其导出物，不独立维护。
图示是当前实现的人工校核视图，不是配置、Workflow 定义或运行时事实采集器。
架构语义以 [architecture.md](../../docs/architecture.md)、[资源放置指南](../../docs/resource-placement-guide.md) 和规范源码为准。

## 正式图示

| 主题 | 可编辑源 | 文档展示 | 主要观点 |
|---|---|---|---|
| 总体架构 | [overall-architecture.drawio](overall-architecture.drawio) | [SVG](overall-architecture.svg) | Coding Agent 是控制面，Harness 提供上下文、边界、能力与证据契约 |
| 控制面反转 | [control-plane-inversion.drawio](control-plane-inversion.drawio) | [SVG](control-plane-inversion.svg) | 历史固定轨道与当前动态行动选择对照，不是两个可串联流程 |
| 任务运行模型 | [agent-task-model.drawio](agent-task-model.drawio) | [SVG](agent-task-model.svg) | 按需发现、调用、证据反馈、重规划和可恢复人工协作；不是必经 Phase |
| 资源与分发 | [resource-distribution.drawio](resource-distribution.drawio) | [SVG](resource-distribution.svg) | 规范源、生成 Adapter 与本机状态分层；Cursor 链接、Codex 薄 wrapper |
| 工程能力 | [engineering-capabilities.drawio](engineering-capabilities.drawio) | [SVG](engineering-capabilities.svg) | 已有 Skill / Helper / Profile / 外部系统 / 证据映射，不构建跨系统 Orchestrator |
| 资源放置决策树 | [resource-placement.drawio](resource-placement.drawio) | [SVG](resource-placement.svg) | 规则、方法、机械动作、环境绑定、入口和临时事实各归其位 |
| 安全与证据 | [safety-evidence.drawio](safety-evidence.drawio) | [SVG](safety-evidence.svg) | 目标解析、权限、写入闭环、证据适用性与 freshness、变更披露和人工协作 |

每张图只表达一个主要关系。实线表示调用或事实关系，虚线表示按需参考；箭头不规定统一任务执行顺序。
采用 corporate 浅色风格：蓝色为上下文/控制面，紫色为安全约束，绿色为能力/证据，黄色为人工/验证缺口，
灰色为外部、本机或历史对照。仅显示各图实际使用的图例。正文使用 Arial 及系统中文回退字体，字号按文档可读性调整为 16–30。

## 实现依据与表达边界

校核基线：`791c0f5dfe7e92aa0d63238bbf960ef978a6ae53`（2026-10-14）。这是本次图示的源码快照，不是同步目标或长期版本契约。

| 图示关系 | 规范依据 |
|---|---|
| 动态规划、REPLAN / ASK_HUMAN、独立审查与证据完成契约 | [.cursor/AGENTS.md](../../.cursor/AGENTS.md)、[done-verify](../../.cursor/skills/done-verify/SKILL.md)、[task.md](../../docs/templates/task.md) |
| Rule 作用域与渐进披露 | [rules-loader.mdc](../../.cursor/rules/rules-loader.mdc)、[rules-engine.mjs](../../.cursor/hooks/lib/rules-engine.mjs)、[execution-boundary.mdc](../../.cursor/rules/execution-boundary.mdc) |
| Cursor 链接与 Codex 生成发现 | [link-cursor-config.sh](../../link-cursor-config.sh)、[sync-codex.sh](../../sync-codex.sh)、[sync-codex.mjs](../../.cursor/scripts/sync-codex.mjs) |
| 本机 Profile、凭据引用与目标隔离 | [environment-profile.mjs](../../.cursor/scripts/environment-profile.mjs)、[项目事实目录](../../.cursor/rules/projects/) |
| Apifox service-level 同步与 manifest | [Skill](../../.cursor/skills/apifox-openapi-sync/SKILL.md)、[sync-openapi.mjs](../../.cursor/skills/apifox-openapi-sync/scripts/sync-openapi.mjs) |
| CodeArts 生命周期与部署完成契约 | [Skill](../../.cursor/skills/codearts-pipeline/SKILL.md)、[codearts-pipeline.mjs](../../.cursor/scripts/codearts-pipeline.mjs) |
| Kubernetes 运行态读取与镜像关联 | [runtime-snapshot](../../.cursor/skills/runtime-snapshot/SKILL.md)、[kubernetes-read.mjs](../../.cursor/scripts/kubernetes-read.mjs) |
| Nacos 共享客户端、查询、字段编辑与单次发布 | [nacos-read](../../.cursor/skills/nacos-read/SKILL.md)、[nacos-config-write](../../.cursor/skills/nacos-config-write/SKILL.md)、[nacos-client.mjs](../../.cursor/scripts/nacos-client.mjs)、[nacos-config-edit.mjs](../../.cursor/scripts/nacos-config-edit.mjs)、[nacos-config-write.mjs](../../.cursor/scripts/nacos-config-write.mjs) |

- 当前正式宿主是 Cursor / Codex；不把历史 TRAE 分发路径画成当前实现。
- Codex Host bootstrap 的读取链是 `$CODEX_HOME/AGENTS.md` → `AGENTS.generated.md` → `generated-harness-index.md` → `rules-loader.mdc` → 匹配项目 Rule。项目 AGENTS 负责自身上下文，不重复宿主 bootstrap。
- Skill 发现链是 `$CODEX_HOME/skills/<skill>` → symlink → 生成的薄 wrapper → Harness canonical `SKILL.md`；正文不预加载，也不复制到业务项目。
- Environment Profile 是本机目标绑定，不是 Harness 内的凭据库。Nacos Namespace ID 与 Kubernetes Namespace 不同；未确认目标不回退其他环境。
- Skill 供 Agent 按需读取，Helper 由 Agent 调用；Profile 只解析目标。Validation 是证据检查契约，重规划与求助仍由 Coding Agent 决定。
- Pipeline Run `COMPLETED` 不代表目标构建或部署 Job 已执行；`UNSELECTED` 不算执行成功，Run 的 `SUCCESS` 也不能代替目标 Job 证据。部署需确认目标 Job 实际成功、构建产物/镜像版本及 Kubernetes Deployment/Pod Ready、observed generation 和运行态收敛。功能验证独立判断，只部署不自动扩展为功能测试。
- Kubernetes Helper 只读；经明确授权的 `kubectl` 修改是独立外部写操作，不属于该 Helper，也不由读取权限推导写权限。
- Nacos Write 支持 CREATE / UPDATE / APPEND，不提供 DELETE；复用唯一客户端，要求明确授权及非原子风险确认。读回成功不证明应用已加载，也不授权自动重启。
- Nacos Write 的有限 YAML/Properties 结构支持和非原子并发风险以 canonical Skill 为准；两次读取不能消除发布竞态，不承诺原子 CAS 或强一致性。测试和真实 E2E 结论留在相应验收记录，不放入静态架构图。
- L0/L1 不需要持久制品。L2+ 只保存真实恢复、交接或审计所需状态，不建立 phase / transition 服务。

## 既有图示盘点与处理

盘点范围为更新前基线的仓库图片、Markdown 图片引用及 Mermaid。未找到可编辑 `.drawio` 或 SVG 源。
下表的引用位置为更新前位置；历史 PNG 保持原文件、原路径和内容，不再由现行文档引用。

| 原始路径 | 更新前引用 | 主题与差异 | 处理 |
|---|---|---|---|
| [image/control_surface.png](../control_surface.png) | `docs/architecture.md`「控制面反转」 | 核心 v3 理念有效；无可编辑源，缺少现行证据/成本策略细节 | 原样保留为历史图片，现行引用改为 `control-plane-inversion.svg` |
| [image/run_the_model.png](../run_the_model.png) | `docs/architecture.md`「运行模型」 | 宿主与事实源职责有效；尚未表达可恢复人工协作和 freshness | 保留历史图片，改用 `agent-task-model.svg` |
| [image/resource_distribution.png](../resource_distribution.png) | `docs/architecture.md`「分发架构」 | 已过期：仍展示 TRAE；缺少当前 Codex bootstrap、薄 wrapper 和本机状态分层 | 保留历史图片，改用 `resource-distribution.svg` |
| [image/resource_decision.png](../resource_decision.png) | `docs/resource-placement-guide.md` | 基础分类有效；未区分本机 Profile、Workspace 入口和机械 Helper | 保留历史图片，改用 `resource-placement.svg`；Agent/Playbook/模板详细判据仍在正文 |
| [image/technical_architecture.png](../technical_architecture.png) | 无当前引用 | 已过期：机械验证 → 综合审查 → 最终验证容易被误读为固定轨道 | 保留历史图片，不重新加入 active 文档 |
| `docs/architecture.md` 的 3 个注释 Mermaid 块 | 同页旧 PNG 旁 | PNG 旁的独立文字图源无法保证一致 | 随正式 SVG 替换移除，避免维护双份图形定义 |
| `docs/resource-placement-guide.md` 的注释 Mermaid 块 | 旧决策图旁 | 同上 | 移除重复注释图源 |
| `README.md` 的旧 Mermaid | 原「工作原理」 | 与总体架构图和证据说明重复 | README 精简时已移除，保留总体 SVG 与必要文字，不维护第二份图源 |
| `docs/artifacts/work/member-level-benefit-20260714/design/hld-*.md`、`docs/design/member-level-points-api-contract.md`、`docs/design/u12-product-coupons-api-interface.md` 中的 Mermaid | 各自业务设计文档 | 业务设计，不属于 Harness 架构图 | 原样保留，不扩展本次范围 |

## 绘图工具与复现

创作工具为个人安装的 [Agents365-ai/drawio-skill](https://github.com/Agents365-ai/drawio-skill/tree/57270820d3cd71cbdf4fb6b2f7091d4fb37bb019)，MIT，版本 `3.4.3`，
固定上游 Commit：`57270820d3cd71cbdf4fb6b2f7091d4fb37bb019`。
个人 Skill 安装在 `$CODEX_HOME/skills/drawio-skill`；它不属于 Harness canonical Skills，也不是 Harness runtime 依赖。
本次使用本机 draw.io `24.7.8` 的直接 XML 路径，不需要 Graphviz、MCP、服务器或后台进程。
corporate 与 handdrawn 均已渲染对比，正式图统一采用更适合技术文档的 corporate 风格。

在 draw.io 打开并编辑对应 `.drawio`，保持语义 ID 和既有布局；完成后重新导出同名 SVG，不手改 SVG：

```bash
"/Applications/draw.io.app/Contents/MacOS/draw.io" \
  -x -f svg -e --embed-svg-images -b 30 \
  -o image/architecture/overall-architecture.svg \
  image/architecture/overall-architecture.drawio
```

其他系统使用当地可用的 draw.io CLI 路径。图内不依赖远端图标或字体下载。
SVG 内嵌可编辑 XML 仅为同源导出便利，维护时仍以仓库中的 `.drawio` 为准。

SVG 的 HTML 标签使用 `foreignObject`。验证需覆盖浏览器直接打开和 Markdown 常见的 `<img>` 嵌入方式，
并在目标文档平台实际页面抽查；不支持 `foreignObject` 的简化渲染器可能仅显示降级文字，不能据此判定布局错误。
若平台净化或不支持 HTML 标签，用同一 `.drawio` 按下方命令导出 PNG 作兼容展示；不手改 SVG，也不维护第二份图源。

验证时先执行 Skill 的结构校验，再导出不含嵌入 XML 的 PNG 供目视检查：

```bash
python3 "$CODEX_HOME/skills/drawio-skill/scripts/validate.py" \
  image/architecture/overall-architecture.drawio --strict --score
"/Applications/draw.io.app/Contents/MacOS/draw.io" \
  -x -f png --width 1500 -b 30 \
  -o /path/to/owned-scratch/overall-architecture.png \
  image/architecture/overall-architecture.drawio
```

未设置 `CODEX_HOME` 时先将命令中的 Skill 路径解析为 `$HOME/.codex/skills/drawio-skill`。
校验 XML、SVG、连接端点、布局和图片/文档引用，并逐张检查文字、箭头、图例与文档尺寸可读性。
结构校验不能代替渲染检查，图示验证不能代替外部系统 E2E 验证。
