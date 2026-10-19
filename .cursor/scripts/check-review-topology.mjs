#!/usr/bin/env node
/** Phase 2 topology, derived from the active Phase 4 completion contracts. */
import { loadPlaybooks, platformArg, read, validate } from './check-workflow-diet.mjs';

const platform = platformArg();
const books = loadPlaybooks(platform);
const failures = [];
const fail = (file, detail) => failures.push(file + ': ' + detail);
for (const {file, book} of books) {
  for (const error of validate(book)) fail(file, error);
  const code = book.completion.code_change;
  const allReviewers = [code.integrated_review.agent, ...code.specialists.map((item) => item.agent)];
  if (allReviewers.length !== 3 || new Set(allReviewers).size !== 3) fail(file, 'Review Committee or duplicate Reviewer');
  if (code.decision.agent || code.decision.authority !== 'deterministic') fail(file, 'AI implementation quality gate');
}
const agentPath = '.' + platform + '/agents/integrated-reviewer.md';
const agentText = read(agentPath);
if (agentText.length > 5000) fail(agentPath, 'prompt exceeds 5000 chars');
for (const marker of ['PASS', 'CHANGES_REQUIRED', 'HUMAN_REQUIRED', 'BLOCKER', 'WARNING', 'ADVISORY']) {
  if (!agentText.includes(marker)) fail(agentPath, 'missing output contract=' + marker);
}
const routingPath = '.' + platform + '/skills/quality-review-routing/SKILL.md';
const routing = read(routingPath);
if (!routing.includes('仅出现 `API`、`Controller`、`Service` 等通用词不得触发 Security')) fail(routingPath, 'generic API must not imply Security risk');
for (const name of ['static-analysis-reviewer', 'logic-correctness-reviewer', 'maintainability-reviewer', 'test-adequacy-reviewer', 'diagnosability-reviewer', 'consistency-reviewer', 'quality-gate-reviewer']) {
  if (routing.includes('`' + name + '`')) fail(routingPath, 'legacy review route=' + name);
}
if (failures.length) throw new Error(failures.join('\n'));
const scenarios = [['Normal', []], ['Security', ['agents/security-reviewer']], ['Data/Concurrency', ['agents/data-concurrency-reviewer']], ['Both', ['agents/security-reviewer', 'agents/data-concurrency-reviewer']]];
console.table(scenarios.map(([scenario, triggered]) => {
  const counts = books.map(({book}) => {
    const code = book.completion.code_change;
    return Number(code.integrated_review.required) + code.specialists.filter((item) => triggered.includes(item.agent)).length;
  });
  if (new Set(counts).size !== 1) throw new Error('playbook topology drift');
  return {scenario, requiredFreshReviewEvidence:counts[0]};
}));
console.log('Review topology passed: ' + platform + ', minimum fresh evidence=1, maximum risk-triggered reviewer types=3, AI gate=0; invocation count is not fixed.');
