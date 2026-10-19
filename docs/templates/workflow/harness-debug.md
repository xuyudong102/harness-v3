# Harness 调试日志

## Session

- 任务 ID：{task-id}
- Workflow：{workflow-name}
- 启动时间：{timestamp}
- 恢复自：{none-or-state-reference}
- artifact_root：`docs/artifacts/work/{task-id}`

## Event {NNN}

- 时间：{timestamp}
- Step：{step-id}
- Agent / Skill：{resource-or-none}
- 事件：{START|SKIP|PASS|FAIL|RETRY|HUMAN_CHECKPOINT|RESUME}
- 输入检查：{required-optional-result}
- 输出：{artifact-links}
- 摘要：{what-happened}
- 错误/降级：{none-or-details}
- 下一步：{next-step}

> 只记录编排事实与定位信息，禁止写入密钥、令牌和完整敏感数据。
