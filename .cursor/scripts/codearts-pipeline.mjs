#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironmentProfile, verifyPipelineBinding, ProfileError } from './environment-profile.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = 'codearts-pipeline-tool/v1';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'PAUSED', 'SUSPEND', 'ABORTED']);
const RETRYABLE_READS = new Set(['ListPipelines', 'ListPipelineRuns', 'ShowPipelineDetail', 'ShowPipelineRunDetail', 'ShowStepOutputs', 'ShowPipelineLog']);
export const DEFAULT_INIT_POLL_SECONDS = 10;
export const DEFAULT_ACTIVE_POLL_SECONDS = 15;
export const DEFAULT_INIT_NO_JOB_TIMEOUT_SECONDS = 180;
export const DEFAULT_WATCH_TIMEOUT_SECONDS = 1800;

class ToolError extends Error {
  constructor(code, message, evidence = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.evidence = evidence;
  }
}

function redact(value) {
  return String(value ?? '')
    .replace(/\b(authorization)(\s*[:=]\s*)(["']?)(bearer|basic)(\s+)([^\s,;}"']+)(["']?)/gi, '$1$2$3$4$5[REDACTED]$7')
    .replace(/(["'])(authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|security[_-]?token|token|access[_-]?key(?:[_-]?id)?|secret(?:[_-]?access)?[_-]?key|client[_-]?secret|api[_-]?key|private[_-]?key|password|credentials?)\1(\s*:\s*)(["'])([^"'\r\n]*)\4/gi, '$1$2$1$3$4[REDACTED]$4')
    .replace(/\b(bearer)(\s+)([A-Za-z0-9._~+/=-]{8,})/gi, '$1$2[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|security[_-]?token|token|access[_-]?key(?:[_-]?id)?|secret(?:[_-]?access)?[_-]?key|client[_-]?secret|api[_-]?key|private[_-]?key|password|credentials?)(\s*[:=]\s*)(["']?)([^\s,;}"']+)\3/gi, '$1$2$3[REDACTED]$3')
    .replace(/\b(AK|SK)(\s*[:=]\s*)(["']?)([^\s,;}"']+)\3/g, '$1$2$3[REDACTED]$3')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@')
    .slice(0, 4000);
}

export function sanitizeOutput(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(sanitizeOutput);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeOutput(item)]));
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError('INVALID_HCLOUD_RESPONSE', `${label} did not return JSON`, { output: redact(text) });
  }
}

function parseCli(argv) {
  const command = argv[0] || 'help';
  const options = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new ToolError('INVALID_ARGUMENT', `unexpected argument: ${token}`);
    const equal = token.indexOf('=');
    const key = equal >= 0 ? token.slice(2, equal) : token.slice(2);
    let value = equal >= 0 ? token.slice(equal + 1) : true;
    if (equal < 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) value = argv[++index];
    const values = options.get(key) || [];
    values.push(value);
    options.set(key, values);
  }
  return { command, options };
}

function one(options, key, { required = false, fallback } = {}) {
  const values = options.get(key) || [];
  if (values.length > 1) throw new ToolError('INVALID_ARGUMENT', `--${key} must be provided once`);
  const value = values[0] ?? fallback;
  if (required && (value === undefined || value === true || value === '')) {
    throw new ToolError('MISSING_ARGUMENT', `--${key} is required`);
  }
  return value;
}

function many(options, key) {
  return (options.get(key) || []).flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
}

function positiveNumber(options, key, fallback) {
  const value = Number(one(options, key, { fallback }));
  if (!Number.isFinite(value) || value <= 0) throw new ToolError('INVALID_ARGUMENT', `--${key} must be positive`);
  return value;
}

function hcloudBinary() {
  return process.env.CODEARTS_HCLOUD_BIN || 'hcloud';
}

function boundedWait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function transientReadFailure(error) {
  return error instanceof ToolError && /(DEVPIPE\.00011127|system busy|系统繁忙|temporarily unavailable)/i.test(error.message);
}

function runProcess(args, { timeout = 60_000 } = {}) {
  const result = spawnSync(hcloudBinary(), args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout,
    env: process.env,
  });
  if (result.error) throw new ToolError('HCLOUD_EXECUTION_FAILED', redact(result.error.message));
  if (result.status !== 0) {
    throw new ToolError('HCLOUD_COMMAND_FAILED', redact(result.stderr || result.stdout), { exitCode: result.status });
  }
  return parseJson(result.stdout, `${args[1] || 'hcloud'} response`);
}

function profileRegion(profile) {
  const config = runProcess(['configure', 'show', `--cli-profile=${profile}`]);
  if (config.name !== profile) throw new ToolError('PROFILE_MISMATCH', `requested profile=${profile} actual=${config.name || 'unavailable'}`);
  if (!config.region) throw new ToolError('PROFILE_REGION_MISSING', `profile=${profile} has no Region`);
  return config.region;
}

function client(profile, projectRef) {
  if (!profile || profile === 'default') throw new ToolError('EXPLICIT_PROFILE_REQUIRED', 'a non-default named profile is required');
  if (!/^custom\.[A-Za-z][A-Za-z0-9_.-]*$/.test(projectRef)) {
    throw new ToolError('PROJECT_REFERENCE_REQUIRED', 'Project ID must use a KooCLI custom.* reference');
  }
  const region = profileRegion(profile);
  const call = (operation, params = [], settings = {}) => {
    const attempts = RETRYABLE_READS.has(operation) ? 3 : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return runProcess([
          'CodeArtsPipeline', operation,
          `--cli-profile=${profile}`,
          `--cli-region=${region}`,
          `--project_id=${projectRef}`,
          ...params,
        ], settings);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !transientReadFailure(error)) throw error;
        boundedWait(attempt * 1000);
      }
    }
    throw lastError;
  };
  return { profile, projectRef, region, call };
}

function definitionObject(detail) {
  const raw = detail.definition;
  if (!raw) throw new ToolError('PIPELINE_DEFINITION_UNAVAILABLE', 'ShowPipelineDetail returned no definition');
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ToolError('PIPELINE_DEFINITION_UNSUPPORTED', 'Pipeline definition is not JSON; no YAML parser is embedded');
  }
}

function pipelineIdOf(item) {
  return item.pipeline_id || item.id;
}

function presentIdentifier(value) {
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== '';
}

function validStatus(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value);
}

export function validateRunDetail(run, { expectedPipelineId, expectedRunId } = {}) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new ToolError('MALFORMED_RUN_DETAIL', 'Run detail must be a JSON object');
  }
  const actualRunId = run.id || run.pipeline_run_id;
  if (!presentIdentifier(actualRunId)) {
    throw new ToolError('MISSING_RUN_ID', 'Run detail has no run ID');
  }
  if (expectedRunId !== undefined && String(actualRunId) !== String(expectedRunId)) {
    throw new ToolError('RUN_ID_MISMATCH', 'Run detail identity does not match the requested run');
  }
  if (run.status === undefined || run.status === null || run.status === '') {
    throw new ToolError('MISSING_RUN_STATUS', 'Run detail has no status');
  }
  if (!validStatus(run.status)) {
    throw new ToolError('MALFORMED_RUN_STATUS', 'Run detail status is malformed');
  }
  if (expectedPipelineId !== undefined && run.pipeline_id !== undefined
    && String(run.pipeline_id) !== String(expectedPipelineId)) {
    throw new ToolError('PIPELINE_ID_MISMATCH', 'Run detail pipeline identity does not match the requested pipeline');
  }
  if (!Array.isArray(run.stages)) {
    throw new ToolError('MALFORMED_RUN_DETAIL', 'Run detail stages must be an array');
  }
  for (const stage of run.stages) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage) || !Array.isArray(stage.jobs)) {
      throw new ToolError('MALFORMED_RUN_DETAIL', 'Each run stage must contain a jobs array');
    }
    for (const job of stage.jobs) {
      if (!job || typeof job !== 'object' || Array.isArray(job) || !validStatus(job.status)) {
        throw new ToolError('MALFORMED_RUN_DETAIL', 'Each run job must contain a valid status');
      }
      if (job.steps !== undefined && !Array.isArray(job.steps)) {
        throw new ToolError('MALFORMED_RUN_DETAIL', 'Run job steps must be an array when present');
      }
    }
  }
  return run;
}

function revisionOf(run) {
  const sources = [];
  const visit = (item) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const revision = item.revision || item.commit_id || item.commitId || item.git_revision;
    if (typeof revision === 'string' && /^[0-9a-f]{7,40}$/i.test(revision)) sources.push(revision);
    Object.values(item).forEach(visit);
  };
  visit(run.sources || run.build_params || null);
  return [...new Set(sources)];
}

export function latestDeployment(api, pipelineName, pipeline = exactPipeline(api, pipelineName)) {
  const pipelineId = pipelineIdOf(pipeline);
  const response = api.call('ListPipelineRuns', [`--pipeline_id=${pipelineId}`, '--limit=1', '--offset=0']);
  const runs = response.pipeline_runs || response.runs || [];
  if (!runs.length) return { pipelineName, pipelineId, run: null };
  const item = runs[0];
  const revisions = revisionOf(item);
  return {
    pipelineName,
    pipelineId,
    run: {
      runId: item.pipeline_run_id || item.id || null,
      runNumber: item.run_number || null,
      status: item.status || null,
      revision: revisions.length === 1 ? revisions[0] : null,
      revisions: revisions.slice(0, 5),
      endTime: item.end_time || null,
    },
  };
}

function exactPipeline(api, pipelineName) {
  const response = api.call('ListPipelines', [
    `--name=${pipelineName}`,
    '--limit=50',
    '--offset=0',
  ]);
  const matches = (response.pipelines || []).filter((pipeline) => pipeline.name === pipelineName);
  if (matches.length !== 1) {
    throw new ToolError('PIPELINE_SELECTION_REQUIRED', `exact pipeline matches=${matches.length}`, {
      candidates: (response.pipelines || []).slice(0, 20).map((pipeline) => pipeline.name),
    });
  }
  return matches[0];
}

function sourceName(source) {
  const params = source.params || {};
  if (params.repo_name) return params.repo_name;
  if (params.human_name) return params.human_name;
  return String(params.git_url || '').split('/').pop()?.replace(/\.git$/, '') || 'unavailable';
}

function jobMatches(job, selector) {
  return job.identifier === selector || job.name === selector;
}

export function buildExecutionPlan(detail, { requestedJobs, branch }) {
  if (!branch) throw new ToolError('BRANCH_REQUIRED', 'target remote branch is required');
  if (!requestedJobs?.length) throw new ToolError('JOB_SELECTION_REQUIRED', 'at least one business build job is required');
  const definition = definitionObject(detail);
  const stages = definition.stages || [];
  const allJobs = stages.flatMap((stage) => (stage.jobs || []).map((job) => ({ stage, job })));
  const requested = [];
  for (const selector of requestedJobs) {
    const matches = allJobs.filter(({ job }) => jobMatches(job, selector));
    if (matches.length !== 1) {
      throw new ToolError('JOB_SELECTION_REQUIRED', `job selector=${selector} matches=${matches.length}`);
    }
    requested.push(matches[0]);
  }
  const chosen = new Map();
  for (const item of allJobs) {
    if (item.job.strategy?.select_strategy === 'always') chosen.set(item.job.identifier, item);
  }
  for (const item of requested) chosen.set(item.job.identifier, item);

  const chosenStages = stages.filter((stage) => (stage.jobs || []).some((job) => chosen.has(job.identifier)));
  if (!chosenStages.length) throw new ToolError('STAGE_SELECTION_REQUIRED', 'no stage contains the selected jobs');
  for (const stage of chosenStages) {
    if (!stage.identifier) throw new ToolError('STAGE_IDENTIFIER_MISSING', `stage=${stage.name} has no identifier`);
  }
  for (const { job } of chosen.values()) {
    if (!job.identifier) throw new ToolError('JOB_IDENTIFIER_MISSING', `job=${job.name} has no identifier`);
  }

  const sources = detail.sources || [];
  if (!sources.length) throw new ToolError('PIPELINE_SOURCES_MISSING', 'Pipeline has no source metadata');
  const runArgs = [];
  [...chosen.values()].forEach(({ job }, index) => runArgs.push(`--choose_jobs.${index + 1}=${job.identifier}`));
  chosenStages.forEach((stage, index) => runArgs.push(`--choose_stages.${index + 1}=${stage.identifier}`));
  sources.forEach((source, index) => {
    const number = index + 1;
    const params = source.params || {};
    const fields = {
      type: source.type,
      'params.git_type': params.git_type,
      'params.git_url': params.git_url,
      'params.default_branch': params.default_branch,
      'params.endpoint_id': params.endpoint_id,
      'params.codehub_id': params.codehub_id,
      'params.alias': params.alias,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') runArgs.push(`--sources.${number}.${key}=${value}`);
    }
    if (source.type === 'code') {
      runArgs.push(`--sources.${number}.params.build_params.build_type=branch`);
      runArgs.push(`--sources.${number}.params.build_params.event_type=Manual`);
      runArgs.push(`--sources.${number}.params.build_params.target_branch=${branch}`);
    }
  });

  return {
    pipelineId: detail.id || detail.pipeline_id,
    pipelineName: detail.name,
    branch,
    requestedJobs: requested.map(({ job, stage }) => ({ name: job.name, identifier: job.identifier, stage: stage.name })),
    alwaysJobCount: [...chosen.values()].filter(({ job }) => job.strategy?.select_strategy === 'always').length,
    chosenJobCount: chosen.size,
    chosenStages: chosenStages.map((stage) => ({ name: stage.name, identifier: stage.identifier })),
    sources: sources.map(sourceName),
    runArgs,
  };
}

function publicPlan(plan) {
  return {
    pipelineId: plan.pipelineId,
    pipelineName: plan.pipelineName,
    branch: plan.branch,
    requestedJobs: plan.requestedJobs,
    alwaysJobCount: plan.alwaysJobCount,
    chosenJobCount: plan.chosenJobCount,
    chosenStages: plan.chosenStages,
    sourceCount: plan.sources.length,
    sources: plan.sources,
    runtimeTarget: plan.runtimeTarget,
    runtimeVerification: 'NOT_OBSERVED: verify the exact build image and Ready/Available in the profile-bound Kubernetes namespace',
    remoteRevision: 'verify against the actual remote branch before mutation; local HEAD is not build evidence',
  };
}

function allRunJobs(run) {
  return (run.stages || []).flatMap((stage) => (stage.jobs || []).map((job) => ({ stage, job })));
}

function statusCounts(jobs) {
  const counts = {};
  for (const { job } of jobs) counts[job.status || 'UNKNOWN'] = (counts[job.status || 'UNKNOWN'] || 0) + 1;
  return counts;
}

export function classifyRun(run, { now = run.current_system_time || Date.now(), initTimeoutSeconds = DEFAULT_INIT_NO_JOB_TIMEOUT_SECONDS } = {}) {
  const jobs = allRunJobs(run);
  const started = jobs.filter(({ job }) => ['RUNNING', 'QUEUED', 'COMPLETED', 'FAILED', 'CANCELED'].includes(job.status));
  const observedAt = TERMINAL_STATUSES.has(run.status) && run.end_time ? run.end_time : now;
  const ageSeconds = run.start_time ? Math.max(0, Math.floor((observedAt - run.start_time) / 1000)) : 0;
  if (TERMINAL_STATUSES.has(run.status)) return { observation: run.status, ageSeconds, jobsStarted: started.length };
  if (run.status === 'INIT' && started.length === 0 && ageSeconds >= initTimeoutSeconds) {
    return { observation: 'STALLED_INIT_NO_JOBS', ageSeconds, jobsStarted: 0 };
  }
  return { observation: run.status || 'UNKNOWN', ageSeconds, jobsStarted: started.length };
}

function compactJobs(items, limit = 16) {
  const values = items.slice(0, limit).map(({ stage, job }) => ({
    stage: stage.name,
    job: job.name,
    status: job.status,
    message: job.message ? redact(job.message) : undefined,
  }));
  return { values, truncated: Math.max(0, items.length - values.length) };
}

export function compactRun(run, settings = {}) {
  validateRunDetail(run);
  const jobs = allRunJobs(run);
  const classification = classifyRun(run, settings);
  const failed = jobs.filter(({ job }) => job.status === 'FAILED');
  const active = jobs.filter(({ job }) => ['RUNNING', 'QUEUED'].includes(job.status));
  const completed = jobs.filter(({ job }) => job.status === 'COMPLETED');
  return {
    runId: run.id || run.pipeline_run_id,
    runNumber: run.run_number,
    pipelineStatus: run.status,
    observation: classification.observation,
    ageSeconds: classification.ageSeconds,
    jobsStarted: classification.jobsStarted,
    jobStatusCounts: statusCounts(jobs),
    activeJobs: compactJobs(active),
    failedJobs: compactJobs(failed),
    completedJobs: compactJobs(completed),
    startTime: run.start_time || null,
    endTime: run.end_time || null,
    executor: run.executor_name || 'unavailable',
    description: run.description || '',
  };
}

function signalLines(value) {
  const strings = [];
  const visit = (item) => {
    if (typeof item === 'string') strings.push(...item.split(/\r?\n/));
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  const useful = strings.filter((line) => /(error|fail|exception|caused by|fatal|denied|timeout|timed out|not found|失败|异常|超时|拒绝)/i.test(line));
  return [...new Set(useful.map((line) => redact(line.trim())).filter(Boolean))].slice(0, 20);
}

export async function collectFailureEvidence(api, pipelineId, runId, existingRun) {
  const run = validateRunDetail(
    existingRun || api.call('ShowPipelineRunDetail', [`--pipeline_id=${pipelineId}`, `--pipeline_run_id=${runId}`]),
    { expectedPipelineId: pipelineId, expectedRunId: runId },
  );
  const failedJobs = allRunJobs(run).filter(({ job }) => job.status === 'FAILED');
  const failedSteps = failedJobs.flatMap(({ stage, job }) => (job.steps || [])
    .filter((step) => step.status === 'FAILED')
    .map((step) => ({ stage, job, step })));
  const warnings = [];
  let outputSignals = [];
  const stepIds = failedSteps.map(({ step }) => step.id || step.exec_id).filter(Boolean);
  if (stepIds.length) {
    try {
      const outputs = api.call('ShowStepOutputs', [
        `--pipeline_id=${pipelineId}`,
        `--pipeline_run_id=${runId}`,
        `--step_run_ids=${stepIds.join(',')}`,
      ]);
      outputSignals = signalLines(outputs);
    } catch (error) {
      warnings.push(`step outputs unavailable: ${redact(error.message)}`);
    }
  }
  const logSignals = [];
  for (const { job, step } of failedSteps.slice(0, 4)) {
    const jobRunId = job.id || job.exec_id;
    const stepRunId = step.id || step.exec_id;
    if (!jobRunId || !stepRunId) continue;
    try {
      const log = api.call('ShowPipelineLog', [
        `--pipeline_id=${pipelineId}`,
        `--pipeline_run_id=${runId}`,
        `--job_run_id=${jobRunId}`,
        `--step_run_id=${stepRunId}`,
        '--limit=80',
        '--sort=desc',
      ]);
      logSignals.push(...signalLines(log));
    } catch (error) {
      warnings.push(`log unavailable for step=${step.name || stepRunId}: ${redact(error.message)}`);
    }
  }
  return {
    pipelineStatus: run.status,
    failedJobs: failedJobs.map(({ stage, job }) => ({ stage: stage.name, job: job.name, message: redact(job.message || '') })),
    failedSteps: failedSteps.map(({ stage, job, step }) => ({
      stage: stage.name,
      job: job.name,
      step: step.name || step.identifier || 'unavailable',
      message: redact(step.message || ''),
    })),
    outputSignals,
    logSignals: [...new Set(logSignals)].slice(0, 24),
    warnings,
    decisionBoundary: 'Coding Agent decides fix, Retry, Stop, or ASK_HUMAN; the tool does not recover automatically.',
  };
}

export function pollDelaySeconds(run) {
  const classification = classifyRun(run, { initTimeoutSeconds: Number.MAX_SAFE_INTEGER });
  return classification.jobsStarted === 0 ? DEFAULT_INIT_POLL_SECONDS : DEFAULT_ACTIVE_POLL_SECONDS;
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function commonTarget(options, command) {
  const environment = String(one(options, 'environment', { required: true })).toUpperCase();
  if (!['DEV', 'SIT'].includes(environment)) throw new ToolError('DEV_SIT_ONLY', `environment=${environment} is outside this tool boundary`);
  if (command === 'run' && environment !== 'DEV') throw new ToolError('DEV_ONLY', 'SIT is read-only in this capability');
  const project = one(options, 'project');
  if (!project && ['run', 'preflight', 'latest'].includes(command)) {
    throw new ToolError('ENVIRONMENT_PROFILE_REQUIRED', '--project and the local environment profile are required; no legacy DEV pipeline fallback');
  }
  const environmentProfile = project ? loadEnvironmentProfile(project, environment).profile : null;
  const profile = one(options, 'profile', { fallback: environmentProfile?.ci?.profile, required: true });
  const projectRef = one(options, 'project-ref', { fallback: environmentProfile?.ci?.projectRef, required: true });
  if (environmentProfile && (profile !== environmentProfile.ci?.profile || projectRef !== environmentProfile.ci?.projectRef)) {
    throw new ToolError('PROFILE_TARGET_MISMATCH', 'KooCLI profile/project reference differs from the environment profile');
  }
  if (environmentProfile && environmentProfile.ci?.routingStatus !== 'CONFIRMED') {
    throw new ToolError('NEEDS_HUMAN', 'Current CI/runtime mapping is unconfirmed; never fall back to legacy dev');
  }
  return { profile, projectRef, environment, environmentProfile };
}

function pipelinePlan(api, options, target) {
  const ci = target.environmentProfile.ci;
  const pipelineName = one(options, 'pipeline-name', { fallback: ci.pipelineName, required: true });
  if (pipelineName !== ci.pipelineName) throw new ToolError('PROFILE_CI_DRIFT', 'Requested pipeline is not the current environment binding');
  const branch = one(options, 'branch', { required: true });
  const requestedJobs = many(options, 'job');
  const pipeline = exactPipeline(api, pipelineName);
  const pipelineId = pipelineIdOf(pipeline);
  const detail = api.call('ShowPipelineDetail', [`--pipeline_id=${pipelineId}`]);
  verifyPipelineBinding(target.environmentProfile, detail, { mutation: false });
  const plan = buildExecutionPlan(detail, { requestedJobs: [...requestedJobs, ...(ci.requiredJobs || [])], branch });
  if (plan.pipelineId && plan.pipelineId !== pipelineId) throw new ToolError('PIPELINE_ID_MISMATCH', 'List/Show pipeline identity mismatch');
  plan.pipelineId = pipelineId;
  plan.runtimeTarget = { cluster: target.environmentProfile.runtime.cluster, namespace: target.environmentProfile.runtime.namespace };
  return plan;
}

function runDetail(api, options) {
  const pipelineId = one(options, 'pipeline-id', { required: true });
  const runId = one(options, 'run-id', { required: true });
  const detail = validateRunDetail(
    api.call('ShowPipelineRunDetail', [`--pipeline_id=${pipelineId}`, `--pipeline_run_id=${runId}`]),
    { expectedPipelineId: pipelineId, expectedRunId: runId },
  );
  return {
    pipelineId,
    runId,
    detail,
  };
}

function usage() {
  return {
    schema: SCHEMA_VERSION,
    commands: {
      preflight: '--project PLATFORM --environment DEV|SIT --branch BRANCH --job JOB [--job JOB]',
      latest: '--project PLATFORM --environment DEV|SIT',
      run: 'same as preflight --authorized-dev-run [--description TEXT]',
      watch: '--project PLATFORM --environment DEV|SIT --pipeline-id ID --run-id ID [--init-timeout-seconds 180] [--timeout-seconds 1800]',
      status: '--project PLATFORM --environment DEV|SIT --pipeline-id ID --run-id ID',
      'failure-evidence': '--project PLATFORM --environment DEV|SIT --pipeline-id ID --run-id ID',
    },
    notes: [
      'All commands require an explicit non-default KooCLI profile and a custom.* Project reference.',
      'run requires current explicit DEV authorization; --authorized-dev-run records that the caller checked it but does not create authorization.',
      'watch detects INIT with no started jobs and returns; it never retries or stops a run.',
    ],
  };
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (command === 'help' || one(options, 'help')) return usage();
  const target = commonTarget(options, command);
  const requestedPipelineId = one(options, 'pipeline-id');
  if (target.environmentProfile && requestedPipelineId && requestedPipelineId !== target.environmentProfile.ci.pipelineId) {
    throw new ToolError('PROFILE_CI_DRIFT', 'Requested run belongs to a different environment pipeline');
  }
  const api = client(target.profile, target.projectRef);
  const binding = { profile: api.profile, region: api.region, projectRef: api.projectRef, environment: target.environment };

  if (command === 'latest') {
    const pipelineName = one(options, 'pipeline-name', { fallback: target.environmentProfile.ci.pipelineName, required: true });
    if (pipelineName !== target.environmentProfile.ci.pipelineName) throw new ToolError('PROFILE_CI_DRIFT', 'Requested pipeline differs from environment binding');
    const pipeline = exactPipeline(api, pipelineName);
    verifyPipelineBinding(target.environmentProfile, api.call('ShowPipelineDetail', [`--pipeline_id=${pipelineIdOf(pipeline)}`]));
    return { schema: SCHEMA_VERSION, command, ok: true, mutationPerformed: false, binding, deployment: latestDeployment(api, pipelineName, pipeline) };
  }
  if (command === 'preflight') {
    const plan = pipelinePlan(api, options, target);
    return { schema: SCHEMA_VERSION, command, ok: true, mutationPerformed: false, binding, plan: publicPlan(plan) };
  }
  if (command === 'run') {
    const authorized = one(options, 'authorized-dev-run');
    if (!(authorized === true || authorized === 'true')) {
      throw new ToolError('RUN_AUTHORIZATION_REQUIRED', 'run requires explicit user authorization and --authorized-dev-run');
    }
    const plan = pipelinePlan(api, options, target);
    const description = one(options, 'description', { fallback: '' });
    const args = [`--pipeline_id=${plan.pipelineId}`, ...plan.runArgs];
    if (description) args.push(`--description=${description}`);
    const response = api.call('RunPipeline', args, { timeout: 120_000 });
    if (!response.pipeline_run_id) throw new ToolError('RUN_CREATION_UNCONFIRMED', 'RunPipeline returned no pipeline_run_id');
    return {
      schema: SCHEMA_VERSION,
      command,
      ok: true,
      mutationPerformed: true,
      binding,
      plan: publicPlan(plan),
      run: { pipelineId: plan.pipelineId, runId: response.pipeline_run_id, status: 'CREATED' },
      next: 'watch',
    };
  }
  if (command === 'status') {
    const { detail } = runDetail(api, options);
    return { schema: SCHEMA_VERSION, command, ok: true, mutationPerformed: false, binding, run: compactRun(detail) };
  }
  if (command === 'failure-evidence') {
    const { pipelineId, runId, detail } = runDetail(api, options);
    return {
      schema: SCHEMA_VERSION,
      command,
      ok: true,
      mutationPerformed: false,
      binding,
      run: compactRun(detail),
      evidence: await collectFailureEvidence(api, pipelineId, runId, detail),
    };
  }
  if (command === 'watch') {
    const pipelineId = one(options, 'pipeline-id', { required: true });
    const runId = one(options, 'run-id', { required: true });
    const initTimeoutSeconds = positiveNumber(options, 'init-timeout-seconds', DEFAULT_INIT_NO_JOB_TIMEOUT_SECONDS);
    const timeoutSeconds = positiveNumber(options, 'timeout-seconds', DEFAULT_WATCH_TIMEOUT_SECONDS);
    const startedAt = Date.now();
    let detail;
    while (true) {
      detail = validateRunDetail(
        api.call('ShowPipelineRunDetail', [`--pipeline_id=${pipelineId}`, `--pipeline_run_id=${runId}`]),
        { expectedPipelineId: pipelineId, expectedRunId: runId },
      );
      const compact = compactRun(detail, { initTimeoutSeconds });
      if (TERMINAL_STATUSES.has(detail.status) || compact.observation === 'STALLED_INIT_NO_JOBS') {
        const result = { schema: SCHEMA_VERSION, command, ok: true, mutationPerformed: false, binding, run: compact };
        if (detail.status === 'FAILED') result.evidence = await collectFailureEvidence(api, pipelineId, runId, detail);
        if (compact.observation === 'STALLED_INIT_NO_JOBS') {
          result.actionRequired = 'Coding Agent must verify run ownership and execution scope, then decide Stop/replan; do not blind Retry.';
        }
        return result;
      }
      if ((Date.now() - startedAt) / 1000 >= timeoutSeconds) {
        return {
          schema: SCHEMA_VERSION,
          command,
          ok: false,
          mutationPerformed: false,
          binding,
          run: { ...compact, observation: 'WATCH_TIMEOUT' },
          actionRequired: 'Coding Agent decides whether to continue watching or ASK_HUMAN.',
        };
      }
      await sleep(pollDelaySeconds(detail));
    }
  }
  throw new ToolError('UNKNOWN_COMMAND', `unsupported command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(sanitizeOutput(result), null, 2)}\n`);
  }).catch((error) => {
    const body = error instanceof ToolError || error instanceof ProfileError
      ? { schema: SCHEMA_VERSION, ok: false, error: { code: error.code, message: redact(error.message), evidence: sanitizeOutput(error.evidence) } }
      : { schema: SCHEMA_VERSION, ok: false, error: { code: 'UNEXPECTED_ERROR', message: redact(error.stack || error.message) } };
    process.stderr.write(`${JSON.stringify(sanitizeOutput(body), null, 2)}\n`);
    process.exitCode = 1;
  });
}
