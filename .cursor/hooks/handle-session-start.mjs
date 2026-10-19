#!/usr/bin/env node
/**
 * Harness 规则 Hook — sessionStart
 *
 * 用途：
 *   新 Agent 会话开始时，清理 .cursor/hooks/state/ 下超过 24 小时的注入状态文件，
 *   清理旧版 Hook 遗留的临时状态，避免磁盘堆积；当前安全门禁不依赖该状态。
 *
 * 触发：.cursor/hooks.json → sessionStart
 * 输出：{}（无 additional_context）
 */
import { pruneOldState, readStdinJson, writeJsonStdout } from './lib/rules-engine.mjs';

try {
  readStdinJson();
  pruneOldState();
  writeJsonStdout({});
  process.exit(0);
} catch (error) {
  process.stderr.write(`rules-bootstrap sessionStart failed: ${error.message}\n`);
  writeJsonStdout({});
  process.exit(0);
}
