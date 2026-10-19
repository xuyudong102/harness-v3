---
name: git-worktree
description: >-
  Create isolated worktrees when parallel work is authorized.
---

# Git Worktree 隔离操作

- 从当前会话或必要的 task.md 获得任务范围；不要求 formal plan 或 Workflow phase。
- 先检查 Git 状态、现有 worktree、目标分支和文件重叠；有未提交改动时不得覆盖或擅自切换。
- 明确起点和目标目录；worktree 位于主仓库外，不推断用户要求的分支名称。
- 使用 `git worktree add <path> -b <authorized-branch> <confirmed-ref>` 创建隔离环境。
- 在各 worktree 验证本地变更与相关回归；只有用户明确要求才进行 commit、merge 或 push。
- 整合后的 diff 必须具有完整、适用且 fresh 的机械检查与综合 Review 证据。
- 清理前确认结果已保留、worktree 无未提交改动且目标明确；删除和 Git 历史操作需单独授权。
- Harness 诊断日志仅在显式 debug 时按需记录，不维护默认 decision log 或 worker state。
