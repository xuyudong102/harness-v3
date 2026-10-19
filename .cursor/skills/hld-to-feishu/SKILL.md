---
name: hld-to-feishu
description: >-
  Publish approved HLD to Feishu only when explicitly requested.
---

# HLD 发布到飞书

## 前置条件

- `{artifact_root}/design/hld.md` 已存在且通过当前设计门禁要求。
- 已具备飞书文档写入能力；缺少授权时停止并请求人工处理。

## 操作

1. 读取 HLD，保留标题层级、表格、代码块和 Mermaid 源码语义。
2. 检查 `{artifact_root}/delivery/publication-links.md`：
   - 有对应文档标识时更新原文档；
   - 无对应文档标识时新建文档。
3. 发布后回读标题、关键章节和文档标识，确认内容可访问且未截断。
4. 在 `delivery/publication-links.md` 追加发布时间、制品版本、文档标识和操作
   类型；不得覆盖历史记录。

## 失败处理

- 发布失败不得伪造链接或标记成功。
- 内容过长时按稳定章节拆分，并在主文档记录子文档关系。
- 更新目标不明确时停止，避免误覆盖其他任务文档。

## 输出

更新 `{artifact_root}/delivery/publication-links.md`，至少包含 HLD 制品路径、
飞书文档 URL/标识、发布时间和新建或更新状态。
