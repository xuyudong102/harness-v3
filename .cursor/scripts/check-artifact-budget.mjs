#!/usr/bin/env node
/** Progressive persistence/termination checks against active playbooks, not legacy phases. */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaybooks, platformArg, read, root, validate } from './check-workflow-diet.mjs';

const platform = platformArg();
const books = loadPlaybooks(platform);
const failures = [];
const fail = (file, message) => failures.push(file + ': ' + message);
const agentRefs = new Set(), skillRefs = new Set();
function unconditionalOutputs(text) {
  const outputs = new Set();
  let section = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^## 输出制品\s*$/.test(line)) section = true;
    else if (/^##\s+/.test(line)) section = false;
    if (!(section || /必须(?:生成|写入|追加)|^追加\s/.test(line))) continue;
    if (/L[234]|Artifact [Pp]olicy|durable|审计|按需|仅在|可追加/.test(line)) continue;
    for (const match of line.matchAll(/`([^`]*\.md)`/g)) outputs.add(match[1]);
  }
  return [...outputs];
}
for (const {file, book} of books) {
  for (const message of validate(book)) fail(file, message);
  const policy = book.artifact_policy;
  for (const [level, expected] of Object.entries({L0:[], L1:[], L2:['task.md'], L3:['task.md','verification.md'], L4:['task.md','verification.md']})) {
    if (JSON.stringify(policy.required[level]) !== JSON.stringify(expected)) fail(file, level + ' persistence drift');
  }
  if (policy.legacy_bindings !== 'optional') fail(file, 'legacy binding must not require files');
  for (const [level, value] of Object.entries({L0:false,L1:false,L2:'on_demand',L3:true,L4:true})) {
    if (policy.archive[level] !== value) fail(file, level + ' archive policy drift');
  }
  for (const marker of ['design.md', 'migration.md', 'approval', 'rollback', 'quality/gates/implementation/security.md', 'quality/gates/implementation/data-concurrency.md']) {
    if (!policy.conditional.includes(marker)) fail(file, 'controlled evidence missing=' + marker);
  }
  const code = book.completion.code_change;
  [code.integrated_review.agent, ...code.specialists.map((item) => item.agent), ...book.optional_capabilities.agents].forEach((ref) => agentRefs.add(ref));
  [code.final_verification.skill, ...book.optional_capabilities.skills].forEach((ref) => skillRefs.add(ref));
}
// Only default/optional reachable resources are scanned; publishing skills explicitly request durable documents.
const contractFiles = [...agentRefs].map((ref) => '.' + platform + '/' + ref + '.md')
  .concat([...skillRefs].filter((ref) => !['skills/hld-to-feishu','skills/lld-to-feishu'].includes(ref)).map((ref) => '.' + platform + '/' + ref + '/SKILL.md'));
const forbidden = [/必须生成[^。\n]*\.md/i, /缺少[^。\n]*\.md[^。\n]*(?:停止|FAIL|失败)/i, /不得(?:以|使用)[^。\n]*(?:conversation|对话)[^。\n]*替代/i];
const unconditional = new Set();
for (const file of contractFiles) {
  const text = read(file);
  for (const pattern of forbidden) if (pattern.test(text)) fail(file, 'hard persistence contract=' + pattern);
  for (const output of unconditionalOutputs(text)) unconditional.add(output);
}
for (const file of ['task.md', 'design.md', 'verification.md', 'migration.md']) {
  if (!fs.existsSync(path.join(root, 'docs/templates', file))) fail('templates', 'missing=' + file);
}
for (const marker of ['approvals', 'Rollback Plan', 'Final Verification']) {
  if (!read('docs/templates/migration.md').includes(marker)) fail('migration.md', 'controlled evidence missing=' + marker);
}
const actual = (book, level) => [...new Set([...book.artifact_policy.required[level], ...unconditional])];
const find = (name) => books.find(({book}) => book.name === name).book;
const feature = find('feature-delivery');
const scenarios = [
  ['Investigation',find('bugfix'),'L0'], ['Normal Bugfix',find('bugfix'),'L1'],
  ['Refactoring',find('refactoring'),'L1'], ['Simple Feature',feature,'L1'],
  ['L2 Complex',feature,'L2'], ['L3 Durable',feature,'L3'], ['L4 Controlled',feature,'L4'],
];
for (const [name, book, level] of scenarios) {
  if (['L0','L1'].includes(level) && actual(book, level).length) fail(name, 'hidden persistent dependency');
}
// Termination proof: the same evidence contract applies at every level, while archive remains
// independent of evidence applicability/freshness and never becomes a control-flow transition.
for (const [name, book, level] of scenarios.filter(([, , level]) => level !== 'L0')) {
  const final = book.completion.code_change.final_verification;
  if (!final.required || final.mode !== 'evaluate evidence completeness, applicability and freshness' ||
      !final.artifact_level_independent || !final.unchanged_review_reuses_evidence ||
      final.rerun !== 'only missing, failed or stale applicable evidence') fail(name, level + ' evidence evaluation is skippable or ordered');
}
if (find('bugfix').completion.investigation.code_changes !== false || actual(find('bugfix'),'L0').length) fail('Investigation', 'read-only zero-artifact termination broken');
if (failures.length) throw new Error(failures.join('\n'));
console.table(scenarios.map(([scenario, book, level]) => ({
  scenario, actualRequired:actual(book,level).length, derivedArtifacts:actual(book,level).join(', ') || 'none',
  optional:level === 'L3' ? 'design.md' : level === 'L4' ? book.artifact_policy.conditional.join(', ') : '',
})));
console.log('Artifact reachability/completion coverage passed: ' + platform + '; L0 investigation terminates; L1 bugfix/refactoring/feature satisfy evidence contract without archive; L3 archives actual files only after PASS.');
console.log('Agent persistence contract passed: ' + platform + '; ' + agentRefs.size + ' reachable Agents and ' + (contractFiles.length-agentRefs.size) + ' non-publishing Skills checked.');
console.log('Artifact budget passed: ' + platform + '; Actual derived from 3 active playbook policies and reachable contracts; L0/L1=0, L2=1, L3=2 + optional design, L4 risk-driven.');
