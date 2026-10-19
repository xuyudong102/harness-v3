#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillPath = path.join(root, '.cursor/skills/codearts-pipeline/SKILL.md');
const toolPath = path.join(root, '.cursor/scripts/codearts-pipeline.mjs');
const shellValidationPath = path.join(root, '.cursor/scripts/check-harness-resources.sh');
const powershellValidationPath = path.join(root, '.cursor/scripts/check-harness-resources.ps1');
const brokerRulePath = path.join(root, '.cursor/rules/projects/broker/broker-codearts.mdc');
const yunshangRulePath = path.join(root, '.cursor/rules/projects/yunshang/yunshang-codearts.mdc');
const errors = [];

function read(file) {
  if (!fs.existsSync(file)) {
    errors.push(`missing ${path.relative(root, file)}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function requireAll(label, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) errors.push(`${label} missing ${marker}`);
  }
}

function section(text, heading, nextHeading = '\n## ') {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const end = text.indexOf(nextHeading, start + heading.length);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

const skill = read(skillPath);
const tool = read(toolPath);
const shellValidation = read(shellValidationPath);
const powershellValidation = read(powershellValidationPath);
const broker = read(brokerRulePath);
const yunshang = read(yunshangRulePath);

const codeartsSkills = fs.readdirSync(path.join(root, '.cursor/skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.includes('codearts'))
  .map((entry) => entry.name);
if (codeartsSkills.length !== 1 || codeartsSkills[0] !== 'codearts-pipeline') {
  errors.push(`canonical skill expected=codearts-pipeline actual=${codeartsSkills.join(',') || 'none'}`);
}

requireAll('skill', skill, [
  'ListPipelines',
  'ShowPipelineDetail',
  'ListPipelineRuns',
  'ShowPipelineRunDetail',
  'ShowStepOutputs',
  'ShowPipelineLog',
  'RunPipeline',
  'RetryPipelineRun',
  'StopPipelineRun',
  'Region',
  'custom.codeartsProjectId',
  'ASK_HUMAN',
  'Pipeline → Job → Step',
  'codearts-pipeline.mjs',
  'STALLED_INIT_NO_JOBS',
  '飞书',
]);

requireAll('tool', tool, [
  'preflight',
  'run',
  'watch',
  'status',
  'failure-evidence',
  'authorized-dev-run',
  'STALLED_INIT_NO_JOBS',
  'MISSING_RUN_ID',
  'MISSING_RUN_STATUS',
  'MALFORMED_RUN_STATUS',
  'MALFORMED_RUN_DETAIL',
  'custom.',
  'ENVIRONMENT_PROFILE_REQUIRED',
  'verifyPipelineBinding',
  'ci.requiredJobs',
]);

const completionContract = section(skill, '## 成功后的 Completion Contract');
const deployOnlyContract = section(completionContract, '### `deploy-only`', '\n### ');
const deployAndVerifyContract = section(completionContract, '### `deploy-and-verify`', '\n## ');
requireAll('deploy-only completion contract', deployOnlyContract, [
  'terminal success',
  '远程 branch/revision',
  'readiness',
  'health/Swagger',
  '不得为此调用 CodeGraph',
]);
requireAll('deploy-and-verify completion contract', deployAndVerifyContract, [
  '明确要求自测、功能验证或回归',
  '当前 diff',
  'DEV 自测',
]);
if (/deploy-only[\s\S]{0,500}(?:必须|一律)[^\n]*(?:业务 API|功能|回归|CodeGraph)/.test(completionContract)) {
  errors.push('deploy-only must not require diff-driven business verification');
}
requireAll('shell validation', shellValidation, ['check-codearts-pipeline.mjs', 'CODEARTS_PIPELINE']);
requireAll('PowerShell validation', powershellValidation, ['check-codearts-pipeline.mjs', 'CODEARTS_PIPELINE']);

for (const forbidden of [
  'Broker_Service_One_Click_Build_DEV',
  'Yunshang_Service_One_Click_Build_DEV',
  '--cli-profile=broker',
  '--cli-profile=yunshang',
]) {
  if (skill.includes(forbidden)) errors.push(`generic skill contains project fact ${forbidden}`);
}

const mappings = [
  ['broker rule', broker, ['alwaysApply: false', 'tenant：`broker`', 'profile：`broker`', 'Local Environment Profile', 'custom.codeartsProjectId', '.cursor/skills/codearts-pipeline/SKILL.md']],
  ['yunshang rule', yunshang, ['alwaysApply: false', 'tenant：`yunshang`', 'profile：`yunshang`', 'Local Environment Profile', 'custom.codeartsProjectId', '.cursor/skills/codearts-pipeline/SKILL.md']],
];
for (const [label, text, markers] of mappings) {
  requireAll(label, text, markers);
  if (/hcloud\s+CodeArtsPipeline/.test(text)) errors.push(`${label} duplicates operation commands`);
}

for (const [label, text] of [['skill', skill], ['broker rule', broker], ['yunshang rule', yunshang]]) {
  if (/\b[0-9a-fA-F]{32}\b/.test(text)) errors.push(`${label} contains a hard-coded 32-character identifier`);
  if (/\b(?:AK|SK|Token)\s*[:=]\s*[^`\s]/i.test(text)) errors.push(`${label} appears to contain a credential value`);
}

for (const dir of ['.cursor/agents', '.cursor/workflows']) {
  const matches = fs.readdirSync(path.join(root, dir)).filter((name) => /codearts/i.test(name));
  if (matches.length) errors.push(`${dir} must not add CodeArts orchestration: ${matches.join(',')}`);
}

if (/api\.call\(['"](?:RetryPipelineRun|StopPipelineRun)['"]/.test(tool)) {
  errors.push('deterministic tool must not make Retry/Stop decisions');
}

if (fs.existsSync(toolPath)) {
  const {
    buildExecutionPlan,
    classifyRun,
    collectFailureEvidence,
    compactRun,
    pollDelaySeconds,
    sanitizeOutput,
    validateRunDetail,
    latestDeployment,
    DEFAULT_ACTIVE_POLL_SECONDS,
    DEFAULT_INIT_POLL_SECONDS,
  } = await import(pathToFileURL(toolPath));
  const fixture = {
    id: 'fixture-pipeline',
    name: 'fixture',
    sources: [{ type: 'code', params: { repo_name: 'repo-a', git_type: 'git', git_url: 'https://example.invalid/repo-a.git' } }],
    definition: JSON.stringify({
      stages: [
        { name: 'unused prerequisites', identifier: 'stage-unused', jobs: [{ name: 'optional dependency', identifier: 'job-optional', strategy: { select_strategy: 'selected' } }] },
        { name: 'clone', identifier: 'stage-clone', jobs: [{ name: 'clone dependencies', identifier: 'job-clone', strategy: { select_strategy: 'always' } }] },
        { name: 'build', identifier: 'stage-build', jobs: [
          { name: 'target build', identifier: 'job-build', strategy: { select_strategy: 'selected' } },
          { name: 'target deploy', identifier: 'job-deploy', strategy: { select_strategy: 'always' } },
        ] },
        { name: 'notify', identifier: 'stage-notify', jobs: [{ name: 'human notification', identifier: 'job-notify', strategy: { select_strategy: 'always' } }] },
      ],
    }),
  };
  try {
    const latestCalls = [];
    const latestApi = { call(operation) {
      latestCalls.push(operation);
      if (operation === 'ListPipelines') return { pipelines: [fixture] };
      if (operation === 'ListPipelineRuns') return { pipeline_runs: [{ pipeline_run_id: 'fixture-run', status: 'COMPLETED' }] };
      throw new Error('Unexpected latest read');
    } };
    const originalLatest = latestDeployment(latestApi, fixture.name);
    if (latestCalls.join(',') !== 'ListPipelines,ListPipelineRuns') errors.push('latest standalone lookup regression');
    latestCalls.length = 0;
    const resolvedLatest = latestDeployment(latestApi, fixture.name, fixture);
    if (latestCalls.join(',') !== 'ListPipelineRuns' || JSON.stringify(originalLatest) !== JSON.stringify(resolvedLatest)) {
      errors.push('latest must reuse the already validated pipeline without changing the result');
    }
    const plan = buildExecutionPlan(fixture, { requestedJobs: ['job-build'], branch: 'feature/test' });
    const stageIds = plan.chosenStages.map((stage) => stage.identifier);
    if (stageIds.join(',') !== 'stage-clone,stage-build,stage-notify') {
      errors.push(`tool selected wrong stages: ${stageIds.join(',')}`);
    }
    if (plan.alwaysJobCount !== 3 || plan.chosenJobCount !== 4) {
      errors.push(`tool always-job expansion mismatch always=${plan.alwaysJobCount} chosen=${plan.chosenJobCount}`);
    }
    if (plan.runArgs.some((arg) => arg.includes('stage-unused'))) {
      errors.push('tool included a stage with no selected job');
    }
    const stalled = classifyRun({
      status: 'INIT',
      start_time: 1_000,
      current_system_time: 182_000,
      stages: [{ jobs: [{ name: 'target build', status: 'INIT', start_time: null }] }],
    });
    if (stalled.observation !== 'STALLED_INIT_NO_JOBS') errors.push(`INIT/no-job detection failed: ${stalled.observation}`);
    const running = {
      status: 'RUNNING',
      start_time: 1_000,
      current_system_time: 182_000,
      stages: [{ jobs: [{ name: 'target build', status: 'RUNNING', start_time: 2_000 }] }],
    };
    if (classifyRun(running).observation !== 'RUNNING') errors.push('running job misclassified as stalled');
    const completed = classifyRun({ status: 'COMPLETED', start_time: 1_000, end_time: 170_000, current_system_time: 999_000, stages: [] });
    if (completed.ageSeconds !== 169) errors.push(`terminal duration must use end_time: ${completed.ageSeconds}`);
    if (pollDelaySeconds({ status: 'INIT', start_time: 1_000, stages: [{ jobs: [{ status: 'INIT' }] }] }) !== DEFAULT_INIT_POLL_SECONDS) {
      errors.push('INIT polling interval regression');
    }
    if (pollDelaySeconds(running) !== DEFAULT_ACTIVE_POLL_SECONDS) errors.push('active polling interval regression');

    const invalidRunDetails = [
      ['empty run detail', {}, 'MISSING_RUN_ID'],
      ['missing run id', { status: 'RUNNING', stages: [] }, 'MISSING_RUN_ID'],
      ['missing run status', { id: 'run-missing-status', stages: [] }, 'MISSING_RUN_STATUS'],
      ['malformed run status', { id: 'run-bad-status', status: 'running now', stages: [] }, 'MALFORMED_RUN_STATUS'],
      ['missing stages', { id: 'run-missing-stages', status: 'RUNNING' }, 'MALFORMED_RUN_DETAIL'],
      ['missing nested jobs', { id: 'run-missing-jobs', status: 'RUNNING', stages: [{}] }, 'MALFORMED_RUN_DETAIL'],
    ];
    for (const [label, run, expectedCode] of invalidRunDetails) {
      try {
        validateRunDetail(run);
        errors.push(`${label} was accepted`);
      } catch (error) {
        if (error.code !== expectedCode) errors.push(`${label} returned the wrong stable error category`);
      }
    }

    const completed5597 = {
      id: '5597',
      pipeline_id: 'fixture-pipeline',
      status: 'COMPLETED',
      start_time: 1_000,
      end_time: 170_000,
      current_system_time: 999_000,
      stages: [{ name: 'build', jobs: [{ name: 'target build', status: 'COMPLETED', steps: [] }] }],
    };
    validateRunDetail(completed5597, { expectedPipelineId: 'fixture-pipeline', expectedRunId: '5597' });
    const completedSummary = compactRun(completed5597);
    if (completedSummary.observation !== 'COMPLETED' || completedSummary.ageSeconds !== 169) {
      errors.push('Broker #5597 completed fixture regression');
    }

    const canaries = {
      authorization: 'CANARY_AUTHORIZATION_SECRET_001',
      bearer: 'CANARY_BEARER_SECRET_002',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.canarysignature1234567890',
      token: 'CANARY_JSON_TOKEN_SECRET_003',
      accessToken: 'CANARY_ACCESS_TOKEN_SECRET_004',
      idToken: 'CANARY_ID_TOKEN_SECRET_005',
      refreshToken: 'CANARY_REFRESH_TOKEN_SECRET_006',
      ak: 'CANARY_AK_SECRET_007',
      sk: 'CANARY_SK_SECRET_008',
      clientSecret: 'CANARY_CLIENT_SECRET_009',
    };
    const failed5593 = {
      id: '5593',
      pipeline_id: 'fixture-pipeline',
      status: 'FAILED',
      start_time: 1_000,
      end_time: 20_000,
      stages: [{
        name: 'build',
        jobs: [{
          id: 'job-run-1',
          name: 'target build',
          status: 'FAILED',
          message: `ERROR AK=${canaries.ak} SK=${canaries.sk}`,
          steps: [{ id: 'step-run-1', name: 'compile', status: 'FAILED', message: `ERROR Bearer ${canaries.bearer}` }],
        }],
      }],
    };
    const fixtureApi = {
      call(operation) {
        if (operation === 'ShowStepOutputs') {
          return {
            output: [
              `ERROR Authorization: Bearer ${canaries.authorization}`,
              `ERROR {"token":"${canaries.token}","access_token":"${canaries.accessToken}","client_secret":"${canaries.clientSecret}"}`,
            ],
          };
        }
        if (operation === 'ShowPipelineLog') {
          return {
            logs: [
              `ERROR Bearer ${canaries.jwt}`,
              `ERROR {"id_token":"${canaries.idToken}","refresh_token":"${canaries.refreshToken}"}`,
            ],
          };
        }
        throw new Error('fixture received an unexpected operation');
      },
    };
    const evidence = await collectFailureEvidence(fixtureApi, 'fixture-pipeline', '5593', failed5593);
    const serializedEvidence = JSON.stringify(sanitizeOutput({ evidence, error: failed5593 }));
    if (Object.values(canaries).some((canary) => serializedEvidence.includes(canary))) {
      errors.push('credential redaction adversarial regression failed');
    }
    if (sanitizeOutput('ERROR basic configuration remains diagnostic text') !== 'ERROR basic configuration remains diagnostic text') {
      errors.push('credential redaction removed ordinary diagnostic text');
    }
    if (!serializedEvidence.includes('[REDACTED]') || evidence.failedJobs.length !== 1 || evidence.failedSteps.length !== 1) {
      errors.push('historical failed Run evidence fixture lost diagnostic structure');
    }
  } catch (error) {
    errors.push(`tool behavior contract threw unexpectedly: ${error.code || error.name || 'unknown error'}`);
  }
}

if (errors.length) {
  console.error(`CodeArts Pipeline contract validation failed: ${errors.length} error(s)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('CodeArts Pipeline contract validation passed: canonical_skill=1 deterministic_tool=1 tenant_routes=2 always_apply=0 INIT_no_job_guard=1 credential_redaction_guard=1 malformed_run_guard=1');
