#!/usr/bin/env node
/** Cross-platform adversarial regression for the deterministic preToolUse safety net. */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const platform = process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1] || 'cursor';
if (platform !== 'cursor') throw new Error(`Unsupported platform: ${platform}`);
const handler = path.join(root, `.${platform}/hooks/handle-pre-tool-use.mjs`);

const write = (prompt, file = 'src/main/java/com/example/Foo.java') => ({
  tool_name: 'Write', tool_input: { path: file, content: 'value' }, prompt,
});
const shell = (command, field = 'command') => ({ tool_name: 'Shell', tool_input: { [field]: command } });
const cases = [
  ['normal DEV write', write('直接修复 DEV 问题'), 'allow'],
  ['explicit read-only', write('只读分析，不要修改'), 'deny'],
  ['analyze and fix', write('帮我分析并直接修复这个问题'), 'allow'],
  ['later explicit authorization', write('先只读分析，不要修改；现在请直接修复'), 'allow'],
  ['PRE config write', write('更新配置', 'src/main/resources/application-pre.yml'), 'deny'],
  ['PROD config write', write('更新配置', 'src/main/resources/application-prod.yml'), 'deny'],
  ['normal Git update', shell('git pull --ff-only'), 'allow'],
  ['normal Git merge', shell('git merge topic'), 'allow'],
  ['normal Git rebase', shell('git rebase main'), 'allow'],
  ['read-only Git with options', shell('git --no-optional-locks -C repo status --short'), 'allow'],
  ['git reset hard', shell('git reset --hard HEAD'), 'deny'],
  ['git reset hard with globals', shell('git --no-optional-locks -C "repo with spaces" -c core.pager=cat reset --hard HEAD'), 'deny'],
  ['git reset hard with no-pager', shell('git --no-pager -C repo reset --hard HEAD'), 'deny'],
  ['git clean with git-dir', shell('git --git-dir=repo/.git clean -fd'), 'deny'],
  ['git explicit force lease', shell('git -C repo push --force-with-lease=refs/heads/main:abc origin main'), 'deny'],
  ['git push -f', shell('git push -f origin branch'), 'deny'],
  ['git force-with-lease', shell('git push origin branch --force-with-lease'), 'deny'],
  ['git clean -fd', shell('git clean -fd'), 'deny'],
  ['git clean -df', shell('git clean -df'), 'deny'],
  ['git branch -D', shell('git branch -D feature-x'), 'deny'],
  ['rm -fr', shell('rm -fr ./target'), 'deny'],
  ['rm -r -f', shell('rm -r -f ./target'), 'deny'],
  ['plain rm', shell('rm file.tmp'), 'allow'],
  ['unbounded update with quoted where', shell("UPDATE users SET name='where';"), 'deny'],
  ['unbounded update with double-quoted where', shell('UPDATE users SET name="where";'), 'deny'],
  ['multiline delete', shell('DELETE\nFROM users;'), 'deny'],
  ['delete with comment where', shell('DELETE FROM users; -- WHERE reviewed'), 'deny'],
  ['multi-statement later where', shell('DELETE FROM users; SELECT * FROM audit WHERE id=1;'), 'deny'],
  ['bounded delete', shell('DELETE FROM users WHERE id=1;'), 'allow'],
  ['DEV deploy', shell('kubectl apply -f deployment-dev.yaml'), 'allow'],
  ['PRE deploy', shell('kubectl apply -f deployment-pre.yaml'), 'deny'],
  ['PROD deploy', shell('kubectl apply -f deployment-prod.yaml'), 'deny'],
  ['read production docs', shell('grep production release-notes.md'), 'allow'],
  ['diff production branch', shell('git diff production-release'), 'allow'],
  ['unknown command payload', shell('git push --force origin main', 'shell_command'), 'deny'],
];

function decision(stdout) {
  const parsed = JSON.parse(stdout);
  return platform === 'cursor' ? parsed.permission : parsed.hookSpecificOutput?.permissionDecision;
}

const failures = [];
for (const [name, input, expected] of cases) {
  const run = spawnSync(process.execPath, [handler], { input: JSON.stringify(input), encoding: 'utf8' });
  let actual = 'invalid-output';
  try { actual = decision(run.stdout); } catch {}
  if (run.status !== 0 || actual !== expected) failures.push(`${name}: expected=${expected} actual=${actual}`);
}

const malformed = spawnSync(process.execPath, [handler], { input: '{"tool_name":"Shell", bad', encoding: 'utf8' });
let malformedDecision = 'invalid-output';
try { malformedDecision = decision(malformed.stdout); } catch {}
if (malformedDecision !== 'deny') failures.push(`malformed JSON: expected=deny actual=${malformedDecision}`);

if (failures.length > 0) {
  console.error(`Safety guard regression failed (${platform}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Safety guard regression passed: ${platform}, ${cases.length + 1} cases.`);
