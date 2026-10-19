#!/usr/bin/env node
/** Read-only contract/complexity regression checks, not a Workflow runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const pathsFor = (platform) => ['bugfix', 'refactoring', 'feature-delivery'].map((name) => `.${platform}/workflows/${name}.yaml`);
export function platformArg() {
  const value = process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1] || 'cursor';
  if (value !== 'cursor') throw new Error(`Unsupported platform: ${value}`);
  return value;
}
export const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
// JSON-form YAML: standard YAML subset; no YAML library or executable DSL needed.
export const loadPlaybooks = (platform) => pathsFor(platform).map((file) => ({file, book: JSON.parse(read(file))}));

// Scoped contract checks for the control surfaces that previously carried known micro-workflows.
// Exact legacy clauses are used instead of broad keyword scanning so domain procedures remain valid.
function microWorkflowContracts(platform) {
  const base = `.${platform}`;
  return [
    {file:`${base}/CLAUDE.md`, forbidden:['循环验证直到确认通过','对于多步骤任务，列出简要计划','"修复 bug" → "编写复现 bug 的测试，然后让测试通过"']},
    {file:`${base}/rules/java-edit-self-check.${platform === 'cursor' ? 'mdc' : 'md'}`, forbidden:['[编码前声明]','### 强制流程','### 自检报告格式','自检通过后执行']},
    {file:`${base}/rules/change-implementation.${platform === 'cursor' ? 'mdc' : 'md'}`, forbidden:['先写测试再改代码','一次性改动超过 200 行须拆分','每次变更后按顺序检查']},
    {file:`${base}/rules/compile-guard.${platform === 'cursor' ? 'mdc' : 'md'}`, forbidden:['禁止在编译未通过的状态下进行下一步变更','编译失败必须**立即修复**']},
    {file:`${base}/rules/lint-guard.${platform === 'cursor' ? 'mdc' : 'md'}`, forbidden:['### 处理流程']},
    {file:`${base}/rules/test-guard.${platform === 'cursor' ? 'mdc' : 'md'}`, forbidden:['新增功能必须有对应测试','测试失败必须立即修复','### 测试失败处理']},
    {file:`${base}/skills/done-verify/SKILL.md`, forbidden:['重新执行受变更影响的机械检查','Review 后重新执行']},
    {file:`${base}/skills/systematic-debug/SKILL.md`, forbidden:['列出至少两个可区分的竞争假设']},
    {file:`${base}/skills/brainstorming/SKILL.md`, forbidden:['至少列出 2-3 种不同的技术方案','必须列出至少 2 种方案']},
  ];
}

function scanMicroWorkflow(contract, text) {
  return contract.forbidden.filter((marker) => text.includes(marker));
}

function validateControlSurface(platform) {
  const errors = [];
  let negativeTests = 0;
  for (const contract of microWorkflowContracts(platform)) {
    const text = read(contract.file);
    for (const marker of scanMicroWorkflow(contract, text)) errors.push(`${contract.file}: legacy micro-workflow clause=${marker}`);
    for (const marker of contract.forbidden) {
      negativeTests++;
      if (!scanMicroWorkflow(contract, `${text}\n${marker}\n`).includes(marker)) errors.push(`${contract.file}: detector failed marker=${marker}`);
    }
  }

  const required = [
    {file:`.${platform}/AGENTS.md`, markers:['information gain','cost','risk','reversibility','success probability','external dependency','REPLAN','ASK_HUMAN','WAITING_FOR_HUMAN']},
    {file:`.${platform}/rules/human-checkpoint.${platform === 'cursor' ? 'mdc' : 'md'}`, markers:['ASK_HUMAN','需要人做什么','为什么人来做更合适','Agent 已完成什么','什么信号代表完成','恢复后准备继续什么']},
    {file:`.${platform}/skills/done-verify/SKILL.md`, markers:['completeness','applicability','freshness','仅执行缺失、失败、stale']},
    {file:'docs/templates/task.md', markers:['ACTIVE|WAITING_FOR_HUMAN|WAITING_FOR_EXTERNAL|DONE','resume_anchors:','- repo:','branch:','head:','diff:','## Blockers','## Evidence Gaps','## Next Options','不是 `next` transition']},
  ];
  for (const contract of required) {
    const text = read(contract.file);
    for (const marker of contract.markers) if (!text.includes(marker)) errors.push(`${contract.file}: missing control-model contract=${marker}`);
  }
  return {errors, negativeTests};
}

export function validate(book) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(book.kind === 'adaptive-playbook' && book.version === 3, 'expected v3 adaptive playbook');
  check(book.control_plane === 'current-coding-agent', 'Coding Agent must be control plane');
  check(typeof book.intent === 'string' && book.intent.length > 0, 'intent missing');
  check(Array.isArray(book.guidance) && book.guidance.length > 0 && book.guidance.length <= 5, 'guidance must be small');
  check(JSON.stringify(book).length <= 6000, 'playbook exceeds context budget');
  const forbiddenKeys = new Set(['steps', 'phases', 'next', 'condition', 'parallel_groups', 'review_loop', 'entry_artifacts', 'exit_artifacts', 'current_phase', 'completed_phases', 'next_phase', 'mandatory_agents']);
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) errors.push(`state-machine/default-handoff key=${key}`);
      walk(item);
    }
  }
  walk(book);
  const allowedTop = new Set(['name', 'version', 'kind', 'control_plane', 'intent', 'guidance', 'optional_capabilities', 'completion', 'artifact_policy', 'bookkeeping', 'escalation', 'legacy_execution', 'authorization']);
  for (const key of Object.keys(book)) check(allowedTop.has(key), `unknown default-control field=${key}`);
  check(book.legacy_execution === 'disabled', 'legacy execution must be disabled');
  for (const level of ['L0', 'L1']) {
    check(Array.isArray(book.bookkeeping?.[level]) && book.bookkeeping[level].length === 0, `${level} bookkeeping must be zero`);
    check(Array.isArray(book.artifact_policy?.required?.[level]) && book.artifact_policy.required[level].length === 0, `${level} persistent artifacts must be zero`);
  }
  const optional = book.optional_capabilities;
  check(Array.isArray(optional?.skills) && Array.isArray(optional?.agents) && Array.isArray(optional?.tools), 'optional capability lists missing');
  const allowedOptionalAgents = book.name === 'bugfix' ? ['agents/issue-context-fetcher', 'agents/log-investigator'] : [];
  check((optional?.agents || []).every((ref) => allowedOptionalAgents.includes(ref)), 'optional Agent list must not recreate an author/review committee');
  // Authors/AI design gates must not be reachable from the default playbook.
  const authorAgents = /agents\/(?:requirements-analyst|problem-analyst|solution-architect|database-designer|api-designer|detail-designer|implementation-planner|refactoring-planner|implementer|consistency-reviewer|quality-gate-reviewer)\b/;
  check(!authorAgents.test(JSON.stringify(book)), 'auxiliary author or design gate Agent reintroduced');
  check(complexity(book).auxiliaryHandoffs === 0, 'unrecognized auxiliary Agent reference reintroduced');
  check(!/phase-\d|workflows\/feature-delivery\//.test(JSON.stringify(book)), 'legacy phase reference reintroduced');
  const code = book.completion?.code_change;
  for (const key of Object.keys(code || {})) check(['model', 'evidence_identity', 'freshness_policy', 'mechanical_verification', 'integrated_review', 'specialists', 'decision', 'final_verification', 'done'].includes(key), `unknown completion-control field=${key}`);
  check(code?.model === 'evidence-contract', 'completion must use evidence-contract model');
  for (const marker of ['repo', 'branch', 'HEAD-or-diff-fingerprint', 'evidence-type', 'result', 'applicability', 'freshness']) {
    check(code?.evidence_identity?.includes(marker), `evidence identity missing=${marker}`);
  }
  check(code?.freshness_policy?.some((line) => line.includes('review without code/config changes does not stale evidence')), 'unchanged review must preserve fresh evidence');
  check(code?.freshness_policy?.some((line) => line.includes('stale only evidence')), 'later changes must invalidate only affected evidence');
  check(code?.mechanical_verification?.required === true, 'mechanical verification missing');
  check(code?.mechanical_verification?.reuse?.includes('only missing, failed or stale'), 'mechanical evidence must be reused unless missing/failed/stale');
  check(code?.integrated_review?.agent === 'agents/integrated-reviewer' && code.integrated_review.required === true, 'Integrated Review evidence must be required');
  check(code?.integrated_review?.freshness?.includes('at least one fresh result') && code.integrated_review.freshness.includes('current diff'), 'at least one current-diff fresh Integrated Review result required at completion');
  check(code?.integrated_review?.rerun?.includes('stale'), 'Integrated Review may rerun when prior evidence becomes stale');
  check(!Object.hasOwn(code?.integrated_review || {}, 'invocations'), 'Integrated Review lifecycle must not define a fixed invocation count');
  const specialists = code?.specialists || [];
  check(specialists.length === 2 && new Set(specialists.map((item) => item.agent)).size === 2, 'exactly two optional Specialists expected');
  for (const [agent, risk] of [['agents/security-reviewer', 'actual-security-risk-or-integrated-escalation'], ['agents/data-concurrency-reviewer', 'actual-data-concurrency-risk-or-integrated-escalation']]) {
    check(specialists.some((item) => item.agent === agent && item.optional === true && item.when === risk), `${agent} must be risk-triggered`);
  }
  check(code?.decision?.authority === 'deterministic' && !code.decision.agent, 'decision must not invoke an AI gate');
  check(JSON.stringify(code?.decision?.statuses) === JSON.stringify(['PASS', 'CHANGES_REQUIRED', 'HUMAN_REQUIRED']), 'decision statuses drift');
  for (const marker of ['current diff causes applicable mechanical evidence required by hard acceptance to FAIL', 'missing/stale required current-diff review', 'external environment, permission or infrastructure', 'baseline failure unrelated to current diff', 'not blocking hard acceptance', 'WARNING/unverified disclosure', 'HUMAN_REQUIRED']) {
    check(JSON.stringify(code?.decision?.rules || []).includes(marker), `decision rule missing=${marker}`);
  }
  check(code?.decision?.required_specialist_results?.includes('all triggered Specialists'), 'triggered Specialist results cannot be dropped');
  check(code?.decision?.basis?.includes('complete, applicable and fresh evidence'), 'decision must consume the evidence contract');
  const final = code?.final_verification;
  for (const key of Object.keys(final || {})) check(['skill', 'required', 'mode', 'rerun', 'artifact_level_independent', 'unchanged_review_reuses_evidence'].includes(key), `unknown final-verification eligibility field=${key}`);
  check(final?.skill === 'skills/done-verify' && final.required === true && final.mode === 'evaluate evidence completeness, applicability and freshness' && final.artifact_level_independent === true && final.unchanged_review_reuses_evidence === true, 'done-verify must evaluate fresh evidence independently of Artifact Level');
  check(final?.rerun === 'only missing, failed or stale applicable evidence', 'completion must not unconditionally rerun evidence after Review');
  check((code?.done || []).some((line) => line.includes('decision PASS') && line.includes('complete, applicable and fresh evidence')), 'completion must require PASS from the evidence contract');
  check((code?.done || []).some((line) => line.includes('archive only actual durable files') && line.includes('never replaces evidence')), 'archive must be separate from evidence');
  check(book.escalation?.risk_level === 'L4', 'high-risk escalation missing');
  for (const marker of ['PRE/PROD', 'irreversible', 'DB', 'migration', 'business', 'security/compliance', 'organizational approval']) {
    check(JSON.stringify(book.escalation?.human_approval || []).includes(marker), `human approval missing=${marker}`);
  }
  if (book.name === 'bugfix') {
    check(book.authorization?.default_for_ones_link_only === 'investigation' && book.authorization.diagnosis_is_read_only === true && book.authorization.fix_requires_explicit_authorization === true, 'bugfix authorization drift');
    check(book.completion?.investigation?.code_changes === false && book.completion.investigation.review_required === false && book.completion.investigation.persistent_artifacts?.length === 0, 'investigation must terminate read-only with zero artifacts');
  } else if (book.name === 'refactoring') {
    check(book.authorization?.behavior_change_requires_confirmation === true, 'behavior preservation boundary missing');
  } else if (book.name === 'feature-delivery') {
    check(book.authorization?.external_publication_requires_explicit_request === true, 'publication authorization missing');
  } else errors.push('unknown playbook name');
  return errors;
}

export function complexity(book) {
  const text = JSON.stringify(book);
  const agentRefs = [...text.matchAll(/agents\/[a-z0-9-]+/g)].map((match) => match[0]);
  return {
    fixedItems: (book.steps || book.phases || []).length,
    fixedPhases: (book.phases || []).length,
    transitions: [...text.matchAll(/"on_(?:pass|fail|skip|human_required)"/g)].length,
    auxiliaryHandoffs: agentRefs.filter((name) => !['agents/integrated-reviewer', 'agents/security-reviewer', 'agents/data-concurrency-reviewer', ...(book.optional_capabilities?.agents || [])].includes(name)).length,
    designAIGates: agentRefs.filter((name) => /consistency-reviewer|quality-gate-reviewer/.test(name)).length,
    artifactBindings: [...text.matchAll(/"(?:entry_artifacts|exit_artifacts)"/g)].length,
    persistentStateL01: ['L0', 'L1'].reduce((sum, level) => sum + (book.bookkeeping?.[level]?.length || 0), 0),
    chars: text.length,
  };
}

// Baseline statistics are derived from git source, never stored as Actual constants.
function legacyMetrics(ref, platform, file) {
  const source = (p) => execFileSync('git', ['show', `${ref}:${p}`], {cwd: root, encoding: 'utf8'});
  const main = source(file);
  const phaseFiles = [...main.matchAll(/^    file: workflows\/feature-delivery\/([^\n]+\.yaml)$/gm)].map((m) => `.cursor/workflows/feature-delivery/${m[1]}`);
  const sources = [main, ...phaseFiles.map(source)];
  const blocks = sources.flatMap((text) => [...text.matchAll(/^  - id: ([^\n]+)\n[\s\S]*?(?=^  - id:|^[a-z_]+:|$(?![\s\S]))/gm)].map((m) => ({id:m[1], text:m[0]})));
  const normal = blocks.filter((item) => !['log-investigation', 'investigation-complete', 'security-review', 'data-concurrency-review', 'database-design', 'api-design', ...(main.includes('name: bugfix') ? ['implementation-plan'] : [])].includes(item.id));
  const aux = normal.filter((item) => /agent: agents\/(?!integrated-reviewer|consistency-reviewer|quality-gate-reviewer)/.test(item.text));
  const bindings = blocks.flatMap((item) => [...item.text.matchAll(/^    (?:entry_artifacts|exit_artifacts):.*(?:\n {6,}.*)*/gm)].map((m) => m[0]));
  let normalPathVisits = 0, normalExecutedAgents = 0;
  if (phaseFiles.length === 0) {
    const byId = new Map(blocks.map((item) => [item.id, item]));
    const skips = new Set(['initialize', 'log-investigation', 'implementation-plan', 'archive']);
    const visited = new Set();
    let id = 'initialize';
    while (id !== 'end') {
      if (visited.has(id)) throw new Error(`unexpected baseline loop=${id}`);
      visited.add(id);
      if (id === 'specialist-review') { id = main.match(/join_target:\s*([^\n]+)/)?.[1]; continue; }
      const item = byId.get(id);
      if (!item) throw new Error(`missing baseline path node=${id}`);
      normalPathVisits++;
      const event = skips.has(id) ? 'on_skip' : 'on_pass';
      if (!skips.has(id) && /agent: agents\//.test(item.text)) normalExecutedAgents++;
      id = item.text.match(new RegExp(`next:.*${event}:\\s*([^,}\\s]+)`))?.[1];
    }
  } else {
    normalPathVisits = phaseFiles.length; // main phase handoffs, leaf steps counted separately
    normalExecutedAgents = normal.filter((item) => /agent: agents\//.test(item.text)).length;
  }
  return {
    fixedItems: blocks.length, fixedPhases: phaseFiles.length,
    conditions: blocks.filter((item) => /^    condition: (?!null)/m.test(item.text)).length,
    transitions: blocks.reduce((sum, item) => sum + [...item.text.matchAll(/on_(?:pass|fail|skip|human_required):/g)].length, 0),
    allAgentBindings: blocks.filter((item) => /agent: agents\//.test(item.text)).length,
    normalAuxiliaryBindings: aux.length,
    designAIGates: blocks.filter((item) => /agent: agents\/quality-gate-reviewer/.test(item.text)).length,
    artifactBindings: bindings.reduce((sum, text) => sum + [...text.matchAll(/[A-Za-z0-9_{}./-]+\.md|(?:"?archive\/\{date\}-\{task-id\}\/"?)/g)].length, 0),
    bookkeepingBindings: bindings.reduce((sum, text) => sum + [...text.matchAll(/workflow\/[A-Za-z0-9-]+\.md|archive\/\{date\}-\{task-id\}\//g)].length, 0),
    normalPathVisits, normalExecutedAgents,
  };
}

export function run(platform, baseline) {
  const books = loadPlaybooks(platform);
  const controlSurface = validateControlSurface(platform);
  if (controlSurface.errors.length) throw new Error(controlSurface.errors.join('\n'));
  for (const {file, book} of books) {
    const errors = validate(book);
    if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
    for (const ref of [...book.optional_capabilities.skills, ...book.optional_capabilities.agents, book.completion.code_change.integrated_review.agent, ...book.completion.code_change.specialists.map((item) => item.agent), book.completion.code_change.final_verification.skill]) {
      const target = ref.startsWith('skills/') ? `.${platform}/${ref}/SKILL.md` : `.${platform}/${ref}.md`;
      if (!fs.existsSync(path.join(root, target))) throw new Error(`${file}: missing reference=${target}`);
    }
  }
  for (const platformDir of ['.cursor/workflows']) {
    const found = fs.readdirSync(path.join(root, platformDir)).filter((name)=>!name.startsWith('.'));
    if (found.some((name) => name.startsWith('phase-') || fs.statSync(path.join(root, platformDir, name)).isDirectory())) throw new Error('legacy phase resources must be physically removed');
  }
  console.table(books.map(({book}) => ({playbook:book.name, ...complexity(book)})));
  if (baseline) console.table(books.map(({file, book}) => ({playbook:book.name, ...legacyMetrics(baseline, platform, file)})));
  // Negative tests operate only on in-memory copies, never repository files.
  const mutations = [
    (b) => { b.steps = [{agent:'agents/implementer'}]; },
    (b) => { b.phases = ['HLD', 'LLD', 'Plan']; },
    (b) => { b.bookkeeping.L1 = ['workflow-state.md']; },
    (b) => { b.artifact_policy.required.L1 = ['plan.md']; },
    (b) => { b.completion.code_change.model = 'ordered-pipeline'; },
    (b) => { b.completion.code_change.evidence_identity = ['result']; },
    (b) => { b.completion.code_change.freshness_policy = []; },
    (b) => { b.completion.code_change.final_verification.required = false; },
    (b) => { b.completion.code_change.final_verification.artifact_level_independent = false; },
    (b) => { b.completion.code_change.final_verification.rerun = 'rerun everything after review'; },
    (b) => { b.completion.code_change.final_verification.after_review = true; },
    (b) => { b.completion.code_change.integrated_review.invocations = 1; },
    (b) => { b.completion.code_change.integrated_review.freshness = 'any historical result'; },
    (b) => { b.completion.code_change.integrated_review.rerun = 'never'; },
    (b) => { b.completion.code_change.decision.agent = 'agents/quality-gate-reviewer'; },
    (b) => { b.completion.code_change.specialists[0].optional = false; },
    (b) => { b.escalation.human_approval = []; },
    (b) => { b.completion.code_change.final_verification.levels = ['L3']; },
    (b) => { b.optional_capabilities.agents.push('agents/static-analysis-reviewer'); },
    (b) => { b.authorization.fix_requires_explicit_authorization = false; },
  ];
  for (const mutate of mutations) {
    const book = JSON.parse(JSON.stringify(books[0].book));
    mutate(book);
    if (validate(book).length === 0) throw new Error('Workflow Diet guard failed negative test');
  }
  const byName = (name) => books.find((item) => item.book.name === name).book;
  const cases = [
    ['A Read-only investigation', 'bugfix', [], 'L0', 'none'],
    ['B Small Bugfix', 'bugfix', [], 'L1', 'none'],
    ['C Difficult Bug', 'bugfix', [], 'L2', 'systematic-debug + runtime evidence, optional'],
    ['D Refactoring', 'refactoring', [], 'L1', 'safe-refactoring, optional'],
    ['E Existing return field', 'feature-delivery', [], 'L1', 'no design phase/gate'],
    ['F Multi-module + schema', 'feature-delivery', ['agents/data-concurrency-reviewer'], 'L3', 'design/migration as needed'],
    ['G Security + Payment', 'feature-delivery', ['agents/security-reviewer', 'agents/data-concurrency-reviewer'], 'L4', 'real approval boundary'],
  ];
  console.table(cases.map(([scenario, name, risks, level, optional]) => {
    const book = byName(name), code = book.completion.code_change;
    const investigation = level === 'L0';
    return {scenario, auxiliaryHandoffs:complexity(book).auxiliaryHandoffs, fixedPhases:complexity(book).fixedPhases,
      persistentCore:book.artifact_policy.required[level].length,
      requiredFreshReviewEvidence:investigation ? 0 : Number(code.integrated_review.required) + code.specialists.filter((item) => risks.includes(item.agent)).length,
      evidenceEvaluation:investigation ? 'read-only conclusion' : code.final_verification.mode,
      optional};
  }));

  const agentContract = read(`.${platform}/AGENTS.md`);
  const humanContract = read(`.${platform}/rules/human-checkpoint.${platform === 'cursor' ? 'mdc' : 'md'}`);
  const safetyGuard = read(`.${platform}/hooks/handle-pre-tool-use.mjs`);
  const taskTemplate = read('docs/templates/task.md');
  const usageGuide = read('docs/usage-guide.md');
  // Static control-contract checks only. Real Agent behavior is validated in real engineering tasks.
  const controlContractCases = [
    {
      controlContract: 'A Simple Java Bugfix',
      result: codeContract(byName('bugfix')) && !read(`.${platform}/rules/java-edit-self-check.${platform === 'cursor' ? 'mdc' : 'md'}`).includes('[编码前声明]')
        ? 'PASS: proportional evidence, no narration/order gate' : 'FAIL',
    },
    {
      controlContract: 'B Service discovery routing converged',
      result: ['REPLAN','ASK_HUMAN','根因类别已高置信收敛','已不太可能改变下一行动','相邻系统'].every((marker) => agentContract.includes(marker)) &&
        ['本机配置','服务路由','重复确认已有假设','能实质区分竞争假设','验证关键安全边界','WAITING_FOR_HUMAN'].every((marker) => humanContract.includes(marker)) &&
        ['本地 Biz 直连返回 200','Orch 失败','Feign 命中旧实例','tag','metadata','routing convention','ASK_HUMAN','相邻系统'].every((marker) => usageGuide.includes(marker)) &&
        taskTemplate.includes('WAITING_FOR_HUMAN')
        ? 'PASS: Biz direct 200 + Orch old-instance route => ask for tag/metadata convention before adjacent-system expansion' : 'FAIL',
    },
    {
      controlContract: 'C High-risk DB/concurrency',
      result: byName('feature-delivery').completion.code_change.specialists.some((item) => item.agent === 'agents/data-concurrency-reviewer' && item.optional === true) &&
        humanContract.includes('破坏性 DB 变更') && safetyGuard.includes('hasDangerousSql')
        ? 'PASS: destructive guard + risk Specialist + evidence contract' : 'FAIL',
    },
  ];
  function codeContract(book) { return book.completion.code_change.model === 'evidence-contract' && book.completion.code_change.final_verification.rerun.includes('missing, failed or stale'); }
  if (controlContractCases.some((item) => item.result.startsWith('FAIL'))) throw new Error('Control contract check failed');
  console.table(controlContractCases);
  console.log(`Workflow Diet regression passed: ${platform}; 3 adaptive playbooks; ${mutations.length + controlSurface.negativeTests} negative tests; 7 scenario contracts + 3 static control contracts; control-plane handoffs/phases/transitions=0.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(platformArg(), process.argv.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length));
}
