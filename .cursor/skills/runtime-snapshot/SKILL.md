---
name: runtime-snapshot
description: >-
  通过当前 Local Environment Profile 读取 DEV/SIT Kubernetes 紧凑快照、镜像、Ready、日志及 Service/Ingress；用于迁移排查和 CodeArts 发布后验证。不写集群、不绕过租户权限，不用于 PRE/PROD。
---

# Runtime Snapshot

复用现有能力，目标来自 `~/.harness/runtime/profiles/<platform>/<dev|sit>.json`。通用脚本不保存平台地址、namespace、流水线名称或临时发布策略。旧 `inventory.yaml` / `env-catalog.yaml` 保留历史记录，DEV/SIT 不自动回退 CCE 或旧入口。

```bash
node .cursor/scripts/runtime-snapshot.mjs snapshot --project <platform> --env DEV --service <service>
node .cursor/scripts/kubernetes-read.mjs snapshot --project <platform> --env DEV --service <service> --expected-image <exact-build-image>
node .cursor/scripts/kubernetes-read.mjs services --project <platform> --env SIT
node .cursor/scripts/kubernetes-read.mjs ingress --project <platform> --env DEV
node .cursor/scripts/kubernetes-read.mjs endpoints --project <platform> --env DEV --service <service>
node .cursor/scripts/kubernetes-read.mjs events --project <platform> --env DEV --service <service>
node .cursor/scripts/kubernetes-read.mjs logs --project <platform> --env DEV --service <service> --since 5m --limit 50
```

## 安全与访问

- 优先 kubectl + 本地 kubeconfig；每次显式固定 kubeconfig、context、namespace，并将 API server/cluster 与 Profile 比对后读取 workload。不得依赖默认 context。
- 支持 Deployment/StatefulSet、Pod Ready/重启/镜像、Service/Ingress、EndpointSlice、Events、当前/previous 日志（`--previous=true`）。只使用读取命令，没有 exec、delete、patch、rollout restart、scale 或 apply 能力。
- 默认最小 namespace RBAC：get/list Deployment、StatefulSet、Pod、Service、Ingress、EndpointSlice、Events 和 get pods/log；不要求 cluster-admin。namespace/cluster 枚举额外需要对应 list 权限，缺失时如实说明，不为发现目标扩大授权。
- 日志时间窗 1..15m，行数 1..200，最多 32 KiB；脱敏后输出。不输出 kubeconfig auth 或容器 env。
- 本轮选择 CLI；没有必要安装 Kubernetes/Rancher MCP。只有可信只读 MCP 明显补足 CLI 缺口时才按现有 mcp 规则评估，不新建 MCP Server，不以浏览器替代 kubectl。

## Evidence 与失败

- Pod Running 不等于健康。只在 observed generation、所有副本及 Pod Ready 和目标镜像一致时给出 `deploymentVerified=true`；必须提供实际 CI build image，不能把 Git SHA 当镜像标签。
- Pipeline COMPLETED 不是 runtime convergence。缺少镜像关联时显示 evidence gap；服务发现、TM/TC/RM 和 HTTP 正常性需要独立证据。
- Nacos Console URL、server address、namespace ID、group、effective Data ID 分开记录。Config mutation gate 仍要求 live instance 和已验证 Data ID 来源；配置存在不证明运行时加载，YAML 必须处理全部文档。
- Profile 缺失/漂移、权限不足或不可达返回 `NEEDS_HUMAN`，不回退旧云端、不猜 IP、不自动写 Profile。PRE 保持 unavailable，本轮不查询、不修改。
