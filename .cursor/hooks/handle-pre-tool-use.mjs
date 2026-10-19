#!/usr/bin/env node
/**
 * Harness deterministic safety guard — preToolUse
 *
 * 本 Hook 只检查危险行为，不再以“是否注入过 Rule 正文”作为写码条件。
 * 普通 DEV/SIT 源码编辑直接放行；明确只读、PRE/PROD 写入和常见高风险命令被阻断。
 * 它是纵深防御 safety net，不代替平台权限、数据库权限或人工审批。
 */
import {
  collectPrompt,
  getToolName,
  getWriteTargetPath,
  isSourceWritePath,
  readStdinJson,
  writeJsonStdout,
} from './lib/rules-engine.mjs';

const WRITE_TOOLS = new Set(['write', 'strreplace', 'applypatch', 'editnotebook', 'edit']);
const COMMAND_TOOLS = new Set(['shell', 'runcommand', 'terminal', 'bash']);

function normalizeToolName(value) {
  return String(value || '').replace(/[\s_-]/g, '').toLowerCase();
}

function commandText(input) {
  const payload = input.tool_input || input.toolInput || input.input || input.arguments || {};
  if (typeof payload === 'string') return payload;
  return String(payload.command || payload.cmd || payload.script || payload.code || '');
}

function deny(reason) {
  writeJsonStdout({
    permission: 'deny',
    user_message: reason,
    agent_message: `Harness safety guard blocked the operation: ${reason}`,
  });
}

function isReadOnlyRequest(input) {
  const prompt = collectPrompt(input);
  const explicitlyWritable = /(分析并(?:直接)?修复|找到.{0,12}(?:直接)?修改|现在(?:可以|请)(?:直接)?(?:修改|修复)|(?:now|then)\s+(?:you\s+)?(?:may|can|please)\s+(?:edit|modify|fix))/i.test(prompt);
  if (explicitlyWritable) return false;
  return /(只读|只分析|不要修改|禁止修改|不要动代码|read[- ]?only|do not (?:edit|modify|write))/i.test(prompt);
}

function hasRestrictedEnvironment(text) {
  return /(?:^|[\s/_.-])(pre|prod|production)(?=$|[\s/_.-])/i.test(text);
}

function isEnvironmentMutationCommand(command) {
  if (!hasRestrictedEnvironment(command)) return false;
  return command.split(/(?:&&|\|\||[;\n])/).some((segment) => {
    const value = segment.trim();
    if (/^(?:grep|rg|cat|head|tail|less|git\s+(?:diff|show|log))\b/i.test(value)) return false;
    return (
      /\bkubectl\b[\s\S]*\b(apply|create|delete|edit|patch|replace|rollout|scale|set)\b/i.test(value) ||
      /\bhelm\b[\s\S]*\b(install|upgrade|uninstall|rollback)\b/i.test(value) ||
      /\bterraform\s+(apply|destroy|import)\b/i.test(value) ||
      /\bmvn\b[\s\S]*\bdeploy\b|\bgradle\b[\s\S]*\bpublish\b/i.test(value) ||
      /^(?:sudo\s+)?(?:bash\s+)?\S*(deploy|publish|release)\S*(?:\s|$)/i.test(value) ||
      /^(?:sudo\s+)?(?:sed\b[\s\S]*\s-i\b|tee\b|cp\b|mv\b|rm\b)/i.test(value) ||
      /\bcurl\b[\s\S]*(?:-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(value)
    );
  });
}

function hasDangerousGit(command) {
  // Normalize common Git global options; this remains a safety net, not a shell parser.
  const word = `(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s;&|]+)`;
  const globals = new RegExp(`\\bgit\\s+(?:(?:-C|-c|--git-dir|--work-tree)\\s+${word}\\s+|(?:--git-dir=|--work-tree=)${word}\\s+|(?:--no-optional-locks|--no-pager|--paginate)\\s+)+`, 'g');
  command = command.replace(globals, 'git ');
  if (/\bgit\s+push\b[^;&|\n]*(?:^|\s)(?:-f|--force|--force-with-lease(?:=[^\s;&|]+)?)(?=\s|$)/im.test(command)) return true;
  if (/\bgit\s+reset\b[^;&|\n]*(?:^|\s)--hard(?=\s|$)/im.test(command)) return true;
  if (/\bgit\s+branch\b[^;&|\n]*(?:^|\s)-D(?=\s|$)/im.test(command)) return true;
  for (const match of command.matchAll(/\bgit\s+clean\b\s+((?:-\S+\s*)+)/gi)) {
    if (match[1].trim().split(/\s+/).some((flag) => flag === '--force' || (/^-[^-]/.test(flag) && flag.includes('f')))) return true;
  }
  return false;
}

function hasRecursiveForcedRemove(command) {
  for (const match of command.matchAll(/(?:^|[;&|]\s*)rm\s+((?:-\S+\s*)+)/gi)) {
    const flags = match[1].trim().split(/\s+/);
    const recursive = flags.some((flag) => flag === '--recursive' || (/^-[^-]/.test(flag) && flag.includes('r')));
    const forced = flags.some((flag) => flag === '--force' || (/^-[^-]/.test(flag) && flag.includes('f')));
    if (recursive && forced) return true;
  }
  return false;
}

function stripSqlNoise(command) {
  return command
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'((?:''|[^'])*)'/g, (_, body) => /\b(update|delete|drop|truncate)\b/i.test(body) ? body : ' ')
    .replace(/"((?:\\"|[^"])*)"/g, (_, body) => /\b(update|delete|drop|truncate)\b/i.test(body) ? body : ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/--[^\n]*|#[^\n]*/g, ' ');
}

function hasDangerousSql(command) {
  const statements = stripSqlNoise(command).split(';');
  return statements.some((statement) => {
    if (/\b(drop\s+(table|database)|truncate\s+(?:table\s+)?)\b/i.test(statement)) return true;
    const mutation = /\bdelete\s+from\b|\bupdate\s+[\w.`"\[\]-]+\s+set\b/i.exec(statement);
    if (!mutation) return false;
    return !/\bwhere\b/i.test(statement.slice(mutation.index + mutation[0].length));
  });
}

function isDangerousCommand(command) {
  return hasDangerousGit(command) || hasRecursiveForcedRemove(command) || hasDangerousSql(command);
}

try {
  const input = readStdinJson();
  const toolName = normalizeToolName(getToolName(input));
  const targetPath = getWriteTargetPath(input);
  if (!toolName || (!WRITE_TOOLS.has(toolName) && !COMMAND_TOOLS.has(toolName))) {
    deny('无法识别安全关键工具类型；请检查 Hook 输入或临时停用故障 Hook 后人工处理。');
    process.exit(0);
  }

  if (WRITE_TOOLS.has(toolName)) {
    if (!targetPath) {
      deny('写入工具缺少目标路径，无法完成安全判断。');
      process.exit(0);
    }
    if (isReadOnlyRequest(input) && isSourceWritePath(targetPath)) {
      deny('当前请求明确为只读，不允许写入业务源码或配置。');
      process.exit(0);
    }
    if (hasRestrictedEnvironment(targetPath)) {
      deny('检测到 PRE/PROD 写入或部署目标，必须停止并由人工处理。');
      process.exit(0);
    }
    writeJsonStdout({ permission: 'allow' });
    process.exit(0);
  }

  if (COMMAND_TOOLS.has(toolName)) {
    const command = commandText(input);
    if (!command) {
      deny('命令工具缺少可识别的 command/cmd/script/code 字段。');
      process.exit(0);
    }
    if (isEnvironmentMutationCommand(command)) {
      deny('检测到指向 PRE/PROD 的变更命令，必须停止并由人工处理。');
      process.exit(0);
    }
    if (isDangerousCommand(command)) {
      deny('检测到破坏性文件、Git 或数据库命令，必须先获得明确人工确认。');
      process.exit(0);
    }
  }

  writeJsonStdout({ permission: 'allow' });
  process.exit(0);
} catch (error) {
  process.stderr.write(`Harness safety guard failed: ${error.stack || error.message}\n`);
  writeJsonStdout({
    permission: 'deny',
    user_message: 'Harness safety guard 执行失败，已按 fail-closed 阻断；请检查 Node.js、Hook 文件和输入 JSON 后重试。',
  });
  process.exit(0);
}
