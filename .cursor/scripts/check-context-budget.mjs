#!/usr/bin/env node
/**
 * Context Diet regression check. Measures deterministically identifiable Harness context:
 * Always Apply Rule bodies, Auto Attached glob Rule bodies, and Hook discovery text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../..');
const platformArg = process.argv.find((item) => item.startsWith('--platform='));
const platform = platformArg?.split('=')[1] || 'cursor';

if (platform !== 'cursor') {
  throw new Error(`Unsupported platform: ${platform}`);
}

const configDir = path.join(root, `.${platform}`);
const extension = platform === 'cursor' ? '.mdc' : '.md';
const enginePath = path.join(configDir, 'hooks/lib/rules-engine.mjs');
const { buildInjectionMessage, globMatch, resolveRules } = await import(pathToFileURL(enginePath));

const cases = [
  {
    id: 'A-java-bugfix',
    prompt: '修复一个 Java 空指针问题。',
    paths: ['broker/src/main/java/com/broker/demo/UserService.java'],
  },
  {
    id: 'B-api-db-mq-tenant',
    prompt: '实现一个涉及 API、DB、MQ 和 tenant 的 Java 功能。',
    paths: [
      'broker/broker-service/src/main/java/com/broker/demo/OrderController.java',
      'broker/broker-service/src/main/resources/mapper/OrderMapper.xml',
      'broker/broker-service/src/main/java/com/broker/demo/mq/OrderProducer.java',
      'broker/broker-service/src/main/resources/application-dev.yml',
    ],
  },
  {
    id: 'C-java-code-review',
    prompt: '请对 Java 变更做 code review。',
    paths: ['broker/src/main/java/com/broker/demo/OrderService.java'],
  },
];

function parseFrontmatter(content) {
  return {
    alwaysApply: /^alwaysApply:\s*true$/m.test(content),
    globs: content.match(/^globs:\s*(.*)$/m)?.[1].trim().replace(/^"|"$/g, '') || '',
  };
}

function listRuleFiles(dir) {
  const rules = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rules.push(...listRuleFiles(filePath));
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(extension)) {
      const content = fs.readFileSync(filePath, 'utf8');
      rules.push({ path: path.relative(root, filePath).replace(/\\/g, '/'), content, ...parseFrontmatter(content) });
    }
  }
  return rules;
}

function sumChars(rules) {
  return rules.reduce((sum, rule) => sum + rule.content.length, 0);
}

function validateDiscovery(discovery, allRulePaths) {
  if (!discovery.startsWith('[Harness Rule Discovery]\n')) return 'missing discovery marker';
  if (discovery.length > 3000) return `discovery too large: ${discovery.length}`;
  for (const line of discovery.split('\n')) {
    if (line.startsWith('- ')) {
      if (!allRulePaths.has(line.slice(2))) return `non-Rule discovery entry: ${line}`;
      continue;
    }
    if (
      line !== '[Harness Rule Discovery]' &&
      !line.startsWith('场景: ') &&
      line !== '可能相关的规则：' &&
      line !== '这里只提供索引，未注入规则正文。根据实际变更按需读取，不要批量加载。'
    ) return `unexpected discovery content: ${line}`;
  }
  return '';
}

const allRules = listRuleFiles(path.join(configDir, 'rules'));
const allRulePaths = new Set(allRules.map((rule) => rule.path));
const alwaysRules = allRules.filter((rule) => rule.alwaysApply);
const alwaysChars = alwaysRules.reduce((sum, rule) => sum + rule.content.length, 0);
const results = cases.map((testCase) => {
  const resolved = resolveRules({ prompt: testCase.prompt, paths: testCase.paths });
  const discovery = buildInjectionMessage(resolved);
  const autoAttached = allRules.filter(
    (rule) => !rule.alwaysApply && rule.globs && testCase.paths.some((filePath) => globMatch(rule.globs, filePath)),
  );
  const autoAttachedChars = sumChars(autoAttached);
  const totalChars = alwaysChars + autoAttachedChars + discovery.length;
  return {
    case: testCase.id,
    alwaysApply: { rules: alwaysRules.length, chars: alwaysChars, estimatedTokens: Math.ceil(alwaysChars / 3) },
    autoAttached: { rules: autoAttached.length, chars: autoAttachedChars, estimatedTokens: Math.ceil(autoAttachedChars / 3) },
    discovery: { rules: resolved.rules.length, chars: discovery.length, estimatedTokens: Math.ceil(discovery.length / 3) },
    total: { chars: totalChars, estimatedTokens: Math.ceil(totalChars / 3) },
    sources: {
      alwaysApply: alwaysRules.map((rule) => rule.path),
      autoAttached: autoAttached.map((rule) => rule.path),
      discovery: resolved.rules.map((rule) => rule.relativePath),
      hook: `${configDir.replace(`${root}/`, '')}/hooks/handle-before-submit.mjs`,
    },
    discoveryError: validateDiscovery(discovery, allRulePaths),
  };
});

const MAX_AUTO_CONTEXT_CHARS = 12000;
const MAX_AUTO_ATTACHED_RULES = 4;
const broadJavaGlobs = allRules.filter((rule) =>
  rule.globs.split(',').some((glob) => glob.trim() === '**/*.java'),
);
const violations = [];
for (const result of results) {
  if (result.total.chars > MAX_AUTO_CONTEXT_CHARS) violations.push(`${result.case}: total chars ${result.total.chars}`);
  if (result.autoAttached.rules > MAX_AUTO_ATTACHED_RULES) violations.push(`${result.case}: auto-attached rules ${result.autoAttached.rules}`);
  if (result.discoveryError) violations.push(`${result.case}: ${result.discoveryError}`);
}
if (broadJavaGlobs.length > 0) violations.push(`broad **/*.java globs: ${broadJavaGlobs.map((rule) => rule.path).join(', ')}`);

const report = {
  platform,
  limits: { maxAutoContextChars: MAX_AUTO_CONTEXT_CHARS, maxAutoAttachedRules: MAX_AUTO_ATTACHED_RULES },
  measuredSources: ['Always Apply Rule bodies', 'Auto Attached glob Rule bodies', 'beforeSubmitPrompt discovery'],
  notMeasured: ['Cursor user/team rules', 'IDE built-in context', 'Workflow/Skill content explicitly loaded at runtime'],
  results,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.table(results.map((result) => ({
    case: result.case,
    alwaysRules: result.alwaysApply.rules,
    alwaysChars: result.alwaysApply.chars,
    autoAttachedRules: result.autoAttached.rules,
    autoAttachedChars: result.autoAttached.chars,
    discoveryRules: result.discovery.rules,
    discoveryChars: result.discovery.chars,
    totalChars: result.total.chars,
    estimatedTokens: result.total.estimatedTokens,
  })));
  for (const result of results) {
    console.log(`${result.case} always=${result.sources.alwaysApply.join(', ')}`);
    console.log(`${result.case} autoAttached=${result.sources.autoAttached.join(', ')}`);
    console.log(`${result.case} discovery=${result.sources.discovery.join(', ')}`);
    console.log(`${result.case} hook=${result.sources.hook}`);
  }
}

if (violations.length > 0) {
  console.error(`Context regression failed:\n- ${violations.join('\n- ')}`);
  process.exit(1);
}

if (!process.argv.includes('--json')) {
  console.log(`Context budget passed: ${platform}, ${results.length} cases.`);
}
