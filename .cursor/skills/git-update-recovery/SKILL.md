---
name: git-update-recovery
description: >-
  Protect local changes before Git updates and reconcile Git, Stash or IDEA Shelf recovery conflicts with source evidence; use for dirty updates, skipped restoration or semantic three-way recovery, not ordinary read-only Git queries or automatic remote writes.
---

# Git 更新与本地修改恢复

## 前置条件

- 明确实际 Git 根、更新/恢复授权和禁止操作。多仓库逐仓库处理；不要求临时 Commit 或个人分支。
- 先读取共享 Git 安全规则；已有报告/补丁是线索，当前 Git 与文件才是事实。
- 可运行本 Skill 的只读快照工具：`node <skill-dir>/scripts/inspect-git.mjs <repo>`。它不 Fetch、不写索引、不恢复文件；输出哈希/状态，不能证明业务语义正确。

## 操作流程

### 更新前保护

1. 核对分支、HEAD、upstream、暂存/未暂存/未跟踪文件、未合并索引项和操作状态。
2. 干净工作区在授权内正常同步；脏工作区选择适当恢复点。已有提交只能保护已提交内容；Stash 需核对是否包含未跟踪文件，Shelf 需核对文件/补丁范围，Diff 备份需配合完整新增/未跟踪文件。
3. 恢复点应保留 HEAD、索引条目及暂存/未暂存 Diff、关键文件指纹和原始补丁。先验证备份内容再更新；有本地提交时优先 fast-forward，分叉不自动覆盖或改写。
4. 保留原暂存边界；对已有用户修改不批量 add，不删除恢复点。

### 识别冲突来源

| 证据 | 判定边界 |
| --- | --- |
| MERGE_HEAD 与未合并索引项 | Git merge 正在进行；不要与恢复阶段混为一谈 |
| rebase-merge/rebase-apply，必要时 REBASE_HEAD | Git rebase 状态；不能仅依据 Log 中存在 Merge Commit 推断 |
| CHERRY_PICK_HEAD / sequencer | 核对 cherry-pick 或序列操作 |
| 无上述状态，但 Stash Apply/Pop 后有未合并项 | 很可能为 Stash 恢复冲突；对照命令、reflog、原 Stash 和源码确认 |
| HEAD 已 fast-forward，IDE 日志开始 Unshelve，活动 Shelf 剩余 patch | 本地修改恢复冲突；Git 更新成功与补丁恢复成功分别报告 |

Stash 与 Shelf 是不同恢复点。IDEA Shelf 以实际项目配置定位；读取 XML、活动/Recently Deleted patch 的 Index、Base revision、hunk，与工作区和 HEAD 对比。`recycled`/`deleted`/`toDelete` 或文件数量不能单独证明恢复结果，按钮动作没有日志时明确标记推测。

### 语义合并

1. 确认 Base，分别列出本地与远程有效意图；对照工作区、索引、HEAD/upstream 和原 patch。
2. 已恢复的文件/hunk不重复应用；未恢复的修改仍在恢复点，不等于永久丢失。
3. 以当前合理基线做精确块级合并，保留双方签名、调用链、异常与测试；上下文冲突可能只是附近插入代码，不一定存在业务互斥。
4. 不机械选择 Yours/Theirs/Both，不把旧完整文件覆盖新版本。关键契约互斥或无法证明应保留哪一侧时，仅暂停有关变更并给出具体待确认问题。

### 更新后完整性

1. 逐原修改核对：已恢复/已被新实现等价保留/明确待恢复；新增文件实际存在且 Git 状态明确。
2. 检查操作状态、`git ls-files -u`、冲突标记、双方最终 Diff 和暂存边界；若还有 Shelf/Stash 残留，区分已恢复的副本与尚未恢复的有效修改。
3. 对受影响签名与业务规则执行必要编译和定向测试。未解决冲突、重大源码/测试矛盾或失败验证不能宣称全部完成。
4. 给出回退方式，只撤销本次操作产生的块；有后续编辑时再次三方比较，不能用批量 reset/restore 抹掉其他成果。

## 失败处理

- 更新、恢复或测试失败时保留现场、补丁及恢复点，报告已经完成的部分与剩余项；Skip/Abort 不构成成功证据。
- 丢弃价值不明的成果、共享远程改写或破坏性覆盖须请求明确确认。普通可逆且有证据的块级恢复自主执行。

## 输出契约

- 各仓库前后 branch/HEAD/upstream、修改与操作状态。
- 恢复点与指纹、逐项保留结果、双方语义、实际冲突来源与不确定性。
- 本次独立 Diff、机械验证、未完成项和精确回退范围；不把快照检查当作语义合并验收。

## 边界

- 这是按需 HOW，不启动 Workflow 或审批控制平面；不替代用户授权、项目分支策略及现有安全 Hook。
- 工具只读本地，不自动 Commit/Push、应用补丁、清理 Shelf/Stash 或获取远程引用。
