#!/usr/bin/env node
/**
 * Harness 规则发现 Hook — beforeSubmitPrompt
 *
 * 用途：
 *   编码请求只注入简短的相关 Rule 路径索引。Rule 正文保持可发现，
 *   由 Agent 根据实际任务和变更路径按需读取。
 *
 * 触发：
 *   .cursor/hooks.json → beforeSubmitPrompt（matcher: UserPromptSubmit）
 *
 * 输入（stdin JSON，字段因 Cursor 版本可能略有差异）：
 *   - prompt / user_message：用户消息
 *   - open_files / attached_files：上下文文件路径
 *
 * 输出（stdout JSON）：
 *   - 编码意图且命中规则 → { "additional_context": "[Harness Rule Discovery]..." }
 *   - 非编码或无规则     → {}
 *
 * 依赖：
 *   - Node.js（node 在 PATH 中）
 *   - ./lib/rules-engine.mjs
 *
 * 参见：.cursor/rules/rules-loader.mdc「Hook 自动化（Context Diet）」
 */
import {
  bootstrapRules,
  isCodingIntent,
  readStdinJson,
  writeJsonStdout,
} from './lib/rules-engine.mjs';

try {
  const input = readStdinJson();
  const { ctx, result, message } = bootstrapRules(input);

  // 非编码任务或未解析到规则：不注入，避免无关 token 开销
  if (!isCodingIntent(ctx) || result.rules.length === 0 || !message) {
    writeJsonStdout({});
    process.exit(0);
  }

  writeJsonStdout({
    additional_context: message,
  });
  process.exit(0);
} catch (error) {
  // 失败时不阻断用户发消息，仅 stderr 记录
  process.stderr.write(`rules-bootstrap beforeSubmitPrompt failed: ${error.message}\n`);
  writeJsonStdout({});
  process.exit(0);
}
