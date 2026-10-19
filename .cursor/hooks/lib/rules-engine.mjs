/**
 * Harness 规则路由引擎（Hook 共享库）
 *
 * 职责：
 *   1. 定位项目根（含 link-cursor-config 链接后的业务项目）
 *   2. 从用户 prompt + 文件路径检测任务场景（java / api / database / …）
 *   3. 解析 rules-loader.mdc 场景表，合并 projects/* 下 globs 命中的项目特化规则
 *   4. 只组装简短发现索引；不读取、不注入 Rule 正文
 *
 * 消费者：
 *   - handle-before-submit.mjs（beforeSubmitPrompt 发现索引）
 *   - handle-session-start.mjs（清理过期状态）
 *
 * 注意：
 *   - alwaysApply: true 的规则已在 Cursor 上下文，发现索引中排除
 *   - 场景表变更须同步 rules-loader.mdc；SCENE_DETECTORS / SCENE_TO_ROW 须与表意一致
 *   - 双份维护校验：.cursor/scripts/check-rule-routing-sync.ps1
 *
 * SCENE_DETECTORS 与 SCENE_TO_ROW 的 key 必须一一对应；SCENE_TO_ROW 的 value
 * 必须是 rules-loader.mdc 场景表「任务场景」列的原文（含 tenant/mq 共用行）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One deterministic implementation; host adapters supply layout only.
export function createRulesEngine(platform = 'cursor') {
if (platform !== 'cursor') throw new Error(`Unsupported platform: ${platform}`);
const configName = '.cursor';
const extension = '.mdc';

/** 从 cwd 或脚本位置向上查找含 .cursor/hooks.json 的目录作为项目根 */
function findProjectRoot() {
  const candidates = [process.cwd(), path.resolve(__dirname, '../../..')];
  for (const startDir of candidates) {
    let dir = startDir;
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, configName, 'hooks.json'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
  }
  return path.resolve(__dirname, '../../..');
}

const PROJECT_ROOT = findProjectRoot();
const RULES_ROOT = path.join(PROJECT_ROOT, configName, 'rules');
const RULES_LOADER = path.join(RULES_ROOT, 'rules-loader.mdc');
const STATE_DIR = path.join(PROJECT_ROOT, configName, 'hooks', 'state');

/** 从 Rule frontmatter 计算默认常驻集合，避免再维护一份名称清单。 */
function listAlwaysApplyRuleNames() {
  if (!fs.existsSync(RULES_ROOT)) {
    return [];
  }
  return fs
    .readdirSync(RULES_ROOT, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(extension))
    .filter((entry) => parseFrontmatter(fs.readFileSync(path.join(RULES_ROOT, entry.name), 'utf8')).alwaysApply)
    .map((entry) => entry.name.slice(0, -extension.length));
}

const ALWAYS_APPLY = new Set(listAlwaysApplyRuleNames());

/** 内部场景 ID → 检测函数（prompt 关键词 + 上下文路径） */
const SCENE_DETECTORS = {
  java: (ctx) =>
    ctx.paths.some((p) => /\.(java|kt)$/i.test(p)) ||
    /\b(java|controller|service|repository|mapper|entity|dto|vo|pojo|impl|enum)\b/i.test(ctx.prompt),
  database: (ctx) =>
    ctx.paths.some((p) => /\.(sql|xml)$/i.test(p) || /mapper/i.test(p)) ||
    /\b(mapper|mybatis|ddl|entity|sql|database|持久化|数据库)\b/i.test(ctx.prompt),
  'er-diagram': (ctx) =>
    /\b(er图|er diagram|实体关系)\b/i.test(ctx.prompt) ||
    ctx.paths.some((p) => /design\/.*\.md$/i.test(p.replace(/\\/g, '/'))),
  api: (ctx) =>
    ctx.paths.some((p) => /controller|api/i.test(p)) ||
    /\b(controller|api|接口|restful|endpoint)\b/i.test(ctx.prompt),
  tenant: (ctx) =>
    ctx.paths.some((p) => /application.*\.ya?ml$/i.test(p)) ||
    /\b(tenant|租户|ignore-urls|ignore-tables|多租户)\b/i.test(ctx.prompt),
  mq: (ctx) =>
    ctx.paths.some((p) => /mq|message|consumer|producer/i.test(p)) ||
    /\b(mq|消息队列|rocketmq|kafka|consumer|producer)\b/i.test(ctx.prompt),
  concurrency: (ctx) => /\b(并发|线程|锁|async|异步|synchronized|线程池)\b/i.test(ctx.prompt),
  datetime: (ctx) => /\b(localdate|localdatetime|时区|timestamp|日期时间)\b/i.test(ctx.prompt),
  logging: (ctx) => /\b(日志|log\.|slf4j|logger)\b/i.test(ctx.prompt),
  pojo: (ctx) => /\b(dto|vo|entity|pojo|请求体|响应体)\b/i.test(ctx.prompt),
  enums: (ctx) =>
    ctx.paths.some((p) => /Enum\.java$|\/enums\//i.test(p.replace(/\\/g, '/'))) ||
    /\b(枚举|枚举类|枚举值|Enum\b|enum\b)/i.test(ctx.prompt),
  testing: (ctx) =>
    ctx.paths.some((p) => /test|spec/i.test(p)) ||
    /\b(测试|test|junit|mockito|单元测试)\b/i.test(ctx.prompt),
  dependencies: (ctx) =>
    ctx.paths.some((p) => /pom\.xml$|build\.gradle/i.test(p.replace(/\\/g, '/'))) ||
    /\b(依赖|pom\.xml|gradle|maven)\b/i.test(ctx.prompt),
  architecture: (ctx) => /\b(模块|分层|包结构|架构|microservice|微服务)\b/i.test(ctx.prompt),
  redis: (ctx) =>
    ctx.paths.some((p) => /redis/i.test(p)) || /\b(redis|缓存键|redisdao)\b/i.test(ctx.prompt),
  obs: (ctx) =>
    ctx.paths.some((p) => /obs|storage|upload|file/i.test(p)) ||
    /\b(obs|对象存储|oss|上传|下载)\b/i.test(ctx.prompt),
  security: (ctx) => /\b(安全|鉴权|权限|csrf|脱敏|xss|sql注入)\b/i.test(ctx.prompt),
  'git-branch': (ctx) => /(?:分支|Git\s*(?:更新|同步|冲突|恢复)|Update\s+Project|Shelf|Unshelve|Stash|\b(?:branch|checkout|merge|rebase|cherry-pick)\b|\bgit\s+(?:pull|fetch|restore|reset)\b)/i.test(ctx.prompt),
  'git-commit': (ctx) => /\b(提交|commit|git commit)\b/i.test(ctx.prompt),
  'repository-hygiene': (ctx) =>
    ctx.paths.some((p) => /(^|\/)\.gitignore$/i.test(p.replace(/\\/g, '/'))) ||
    /(?:\.gitignore|仓库卫生|repository hygiene|git rm --cached|tracked.*ignored|ignored.*tracked|初始化.*(?:git|仓库)|git init)/i.test(ctx.prompt),
  'change-implementation': (ctx) =>
    /\b(实现|编码|修改代码|编写|开发|fix|bugfix|refactor|重构)\b/i.test(ctx.prompt),
  'task-decomposition': (ctx) => /\b(子任务|拆解|task decomposition)\b/i.test(ctx.prompt),
  'stage-contracts': (ctx) => /\b(制品|artifact|workflow|阶段)\b/i.test(ctx.prompt),
  mcp: (ctx) =>
    ctx.paths.some((p) => new RegExp(`\\.${platform}/(agents|skills)/`, 'i').test(p.replace(/\\/g, '/'))) ||
    /\b(mcp\.json|mcp 配置)\b/i.test(ctx.prompt),
  review: (ctx) => /\b(代码审查|code review|review)\b/i.test(ctx.prompt),
  'design-doc': (ctx) =>
    ctx.paths.some((p) => /design\/.*\.md$/i.test(p.replace(/\\/g, '/'))) ||
    /\b(hld|lld|概要设计|详细设计|设计文档)\b/i.test(ctx.prompt),
  'error-codes': (ctx) => /\b(错误码|errorcode|error code)\b/i.test(ctx.prompt),
  'cross-ref-guard': (ctx) =>
    ctx.paths.some((p) => p.toLowerCase().endsWith(extension) && p.toLowerCase().replace(/\\/g, '/').includes(`${configName}/rules/`)) ||
    (platform === 'cursor' ? /\b(规则文件|\.mdc|cross-ref)\b/i : /\b(规则文件|\.md|cross-ref)\b/i).test(ctx.prompt),
};

/** 内部场景 ID → rules-loader.mdc 场景表「任务场景」列文案 */
const SCENE_TO_ROW = {
  java: '编写/修改 Java 代码',
  database: '涉及数据库/Entity/Mapper',
  'er-diagram': '涉及 ER 图绘制/DDL 设计文档',
  api: '涉及 API/Controller',
  tenant: '涉及多租户/跨租户数据访问/`ignore-urls`/`ignore-tables`/MQ 或三方回调接入',
  mq: '涉及多租户/跨租户数据访问/`ignore-urls`/`ignore-tables`/MQ 或三方回调接入',
  concurrency: '涉及并发/多线程',
  datetime: '涉及日期时间处理',
  logging: '涉及日志',
  pojo: '涉及 DTO/VO/Entity 设计',
  enums: '涉及枚举类/枚举字段',
  testing: '涉及测试代码',
  dependencies: '涉及依赖/pom.xml',
  architecture: '涉及项目结构变更',
  redis: '涉及 Redis 缓存',
  obs: '涉及 OBS/对象存储/文件上传下载',
  security: '涉及应用安全/权限/脱敏/CSRF',
  'git-branch': '涉及 Git 分支、更新与冲突恢复',
  'git-commit': '涉及 Git 提交',
  'repository-hygiene': '涉及仓库初始化/.gitignore/提交前仓库卫生检查',
  'change-implementation': '涉及变更实施流程/渐进式改动',
  'task-decomposition': '涉及任务拆解/子任务规划',
  'stage-contracts': '涉及子代理产物交接',
  mcp: '涉及 MCP 配置/代理引用 MCP',
  review: '代码审查',
  'design-doc': '涉及概要/详细设计文档',
  'error-codes': '涉及错误码定义',
  'cross-ref-guard': `涉及规则文件维护/新增 ${extension}`,
};

/** 写码门禁关注的业务文件扩展名 */
const SOURCE_WRITE_PATTERN =
  /\.(java|kt|xml|sql|ya?ml|gradle|kts)$/i;
const SOURCE_WRITE_EXACT = /(?:^|[\\/])pom\.xml$/i;

function getProjectRoot() {
  return PROJECT_ROOT;
}

function getStateDir() {
  return STATE_DIR;
}

function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SyntaxError(`Hook stdin is not valid JSON: ${error.message}`);
  }
}

function writeJsonStdout(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function getSessionId(input) {
  return (
    input.conversation_id ||
    input.conversationId ||
    input.session_id ||
    input.sessionId ||
    input.chat_id ||
    input.chatId ||
    'default'
  );
}

function collectPaths(input) {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) {
      paths.add(value.replace(/\\/g, '/'));
    }
  };

  for (const key of ['open_files', 'attached_files', 'files', 'file_paths', 'context_files']) {
    const list = input[key];
    if (Array.isArray(list)) {
      list.forEach((item) => {
        if (typeof item === 'string') {
          add(item);
        } else if (item && typeof item === 'object') {
          add(item.path || item.file || item.uri);
        }
      });
    }
  }

  const toolInput = input.tool_input || input.toolInput || input.input || input.arguments || {};
  add(toolInput.path);
  add(toolInput.file_path);
  add(toolInput.filePath);
  add(toolInput.target_file);

  return [...paths];
}

function collectPrompt(input) {
  return String(
    input.prompt ||
      input.user_message ||
      input.userMessage ||
      input.message ||
      input.text ||
      '',
  );
}

function isCodingIntent(ctx) {
  if (ctx.paths.some((p) => SOURCE_WRITE_PATTERN.test(p) || SOURCE_WRITE_EXACT.test(p))) {
    return true;
  }
  return (
    /\b(实现|编码|修改|编写|开发|fix|bug|修复|重构|refactor|implement|code|controller|service|mapper|api|测试|单元测试|sql|ddl)\b/i.test(ctx.prompt) ||
    /(?:\.gitignore|git init|初始化.*(?:git|仓库)|Git\s*(?:更新|同步|冲突|恢复)|Update\s+Project|Shelf|Unshelve|Stash|\bgit\s+(?:pull|merge|rebase|cherry-pick|restore|reset)\b)/i.test(ctx.prompt)
  );
}

function isSourceWritePath(filePath) {
  if (!filePath) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  if (
    normalized.includes(`/${configName}/rules/`) ||
    normalized.includes(`/${configName}/hooks/`) ||
    normalized.includes(`/${configName}/agents/`) ||
    normalized.includes(`/${configName}/skills/`) ||
    normalized.includes(`/${configName}/workflows/`)
  ) {
    return false;
  }
  return SOURCE_WRITE_PATTERN.test(normalized) || SOURCE_WRITE_EXACT.test(normalized);
}

function getToolName(input) {
  return String(input.tool_name || input.toolName || input.tool || input.name || '');
}

function getWriteTargetPath(input) {
  const toolInput = input.tool_input || input.toolInput || input.input || input.arguments || {};
  return toolInput.path || toolInput.file_path || toolInput.filePath || toolInput.target_file || '';
}

function escapeRegexChar(ch) {
  return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globMatch(pattern, filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const patterns = pattern.split(',').map((item) => item.trim()).filter(Boolean);
  return patterns.some((glob) => {
    let re = '^';
    for (let i = 0; i < glob.length; i += 1) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          re += '.*';
          i += 1;
          if (glob[i + 1] === '/') {
            i += 1;
          }
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else {
        re += escapeRegexChar(c);
      }
    }
    re += '$';
    return new RegExp(re, 'i').test(normalized);
  });
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { globs: '', alwaysApply: false };
  }
  const body = match[1];
  const globsMatch = body.match(/^globs:\s*(.*)$/m);
  const alwaysMatch = body.match(/^alwaysApply:\s*(true|false)$/m);
  return {
    globs: globsMatch ? globsMatch[1].trim().replace(/^"|"$/g, '') : '',
    alwaysApply: alwaysMatch ? alwaysMatch[1] === 'true' : false,
  };
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function parseScenarioTable(content) {
  /** 解析 rules-loader.mdc 中「场景加载指引」映射表 → Map<场景描述, 规则名[]> */
  const sectionMatch = content.match(
    /### 场景加载指引[\s\S]*?\n\n([\s\S]*?)\n\n(?:### |## )/,
  );
  const section = sectionMatch ? sectionMatch[1] : content;
  const table = new Map();
  const lines = section.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('任务场景') || line.includes('---')) {
      continue;
    }
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) {
      continue;
    }
    const scene = cells[0];
    const rules = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (rules.length > 0) {
      table.set(scene, rules);
    }
  }
  return table;
}

function listProjectRules() {
  const projectsDir = path.join(RULES_ROOT, 'projects');
  const rules = [];
  if (!fs.existsSync(projectsDir)) {
    return rules;
  }
  for (const projectDir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (projectDir.name.startsWith('.') || !projectDir.isDirectory()) {
      continue;
    }
    const dirPath = path.join(projectsDir, projectDir.name);
    for (const file of fs.readdirSync(dirPath)) {
      if (file.startsWith('.') || !file.endsWith(extension)) {
        continue;
      }
      const fullPath = path.join(dirPath, file);
      const meta = parseFrontmatter(fs.readFileSync(fullPath, 'utf8'));
      rules.push({
        name: file.slice(0, -extension.length),
        project: projectDir.name,
        relativePath: path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/'),
        globs: meta.globs,
      });
    }
  }
  return rules;
}

function loadRuleDescriptor(ruleName) {
  const direct = path.join(RULES_ROOT, `${ruleName}${extension}`);
  if (fs.existsSync(direct)) {
    return {
      name: ruleName,
      relativePath: path.relative(PROJECT_ROOT, direct).replace(/\\/g, '/'),
    };
  }
  return null;
}

function detectScenes(ctx) {
  const scenes = new Set();
  for (const [sceneId, detector] of Object.entries(SCENE_DETECTORS)) {
    if (detector(ctx)) {
      scenes.add(sceneId);
    }
  }
  if (ctx.paths.some((p) => isSourceWritePath(p)) || isCodingIntent(ctx)) {
    scenes.add('java');
    scenes.add('change-implementation');
  }
  return scenes;
}

function resolveRules(ctx) {
  /** 合并场景表规则 + 项目路径索引，返回候选 Rule 描述符。 */
  const loaderContent = fs.readFileSync(RULES_LOADER, 'utf8');
  const scenarioTable = parseScenarioTable(loaderContent);
  const scenes = detectScenes(ctx);
  const ruleNames = new Set();

  for (const sceneId of scenes) {
    const rowKey = SCENE_TO_ROW[sceneId];
    if (!rowKey) {
      continue;
    }
    const rules = scenarioTable.get(rowKey) || [];
    rules.forEach((rule) => ruleNames.add(rule));
  }

  const projectRules = listProjectRules();
  // Root-only tasks may have no attached file; use the actual linked workspace.
  const projectPaths = ctx.paths.length ? ctx.paths : [PROJECT_ROOT];
  for (const projectRule of projectRules) {
    const projectPattern = new RegExp(
      `(?:^|/)(?:com/)?${projectRule.project}(?:/|-|$)`,
      'i',
    );
    const matched = projectPaths.some(
      (filePath) =>
        (projectRule.globs && globMatch(projectRule.globs, filePath)) ||
        projectPattern.test(filePath.replace(/\\/g, '/')) ||
        (projectRule.project === 'b2cmall' && /(?:^|\/)repos\/b2c\/backend(?:\/|$)/i.test(filePath.replace(/\\/g, '/'))),
    );
    if (matched) {
      ruleNames.add(projectRule.name);
    }
  }

  for (const alwaysName of ALWAYS_APPLY) {
    ruleNames.delete(alwaysName);
  }

  const loaded = [];
  for (const ruleName of [...ruleNames].sort()) {
    const projectRule = projectRules.find((item) => item.name === ruleName);
    if (projectRule) {
      loaded.push(projectRule);
      continue;
    }
    const general = loadRuleDescriptor(ruleName);
    if (general) {
      loaded.push(general);
    }
  }

  return {
    scenes: [...scenes],
    rules: loaded,
  };
}

function buildInjectionMessage(result) {
  if (result.rules.length === 0) {
    return '';
  }

  const header = [
    '[Harness Rule Discovery]',
    `场景: ${result.scenes.join(', ') || '通用编码'}`,
    '可能相关的规则：',
    ...result.rules.map((rule) => `- ${rule.relativePath}`),
    '这里只提供索引，未注入规则正文。根据实际变更按需读取，不要批量加载。',
  ].join('\n');
  return header;
}

function stateFilePath(sessionId) {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(STATE_DIR, `${safe}.json`);
}

function readSessionState(sessionId) {
  const filePath = stateFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSessionState(sessionId, payload) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const filePath = stateFilePath(sessionId);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        sessionId,
        updatedAt: new Date().toISOString(),
        ...payload,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function bootstrapRules(input) {
  /** Hook 入口：从 Cursor stdin 载荷解析上下文并完成规则解析与消息组装 */
  const ctx = {
    prompt: collectPrompt(input),
    paths: collectPaths(input),
  };
  const result = resolveRules(ctx);
  const message = buildInjectionMessage(result);
  return { ctx, result, message };
}

function pruneOldState(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(STATE_DIR)) {
    return;
  }
  const now = Date.now();
  for (const file of fs.readdirSync(STATE_DIR)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const fullPath = path.join(STATE_DIR, file);
    const stat = fs.statSync(fullPath);
    if (now - stat.mtimeMs > maxAgeMs) {
      fs.unlinkSync(fullPath);
    }
  }
}

return { getProjectRoot, getStateDir, readStdinJson, writeJsonStdout, getSessionId, collectPaths, collectPrompt, isCodingIntent, isSourceWritePath, getToolName, getWriteTargetPath, globMatch, parseScenarioTable, detectScenes, resolveRules, buildInjectionMessage, stateFilePath, readSessionState, writeSessionState, bootstrapRules, pruneOldState, SCENE_DETECTORS, SCENE_TO_ROW, ALWAYS_APPLY };
}
export const { getProjectRoot, getStateDir, readStdinJson, writeJsonStdout, getSessionId, collectPaths, collectPrompt, isCodingIntent, isSourceWritePath, getToolName, getWriteTargetPath, globMatch, parseScenarioTable, detectScenes, resolveRules, buildInjectionMessage, stateFilePath, readSessionState, writeSessionState, bootstrapRules, pruneOldState, SCENE_DETECTORS, SCENE_TO_ROW, ALWAYS_APPLY } = createRulesEngine('cursor');
