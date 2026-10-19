import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Local non-secret environment bindings; never falls back to legacy cloud inventory. */
export class ProfileError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function localPath(value) {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

const identifier = /^[a-z0-9][a-z0-9.-]*$/;
function requireValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ProfileError('NEEDS_HUMAN', `${label} is not confirmed`);
  return value;
}

function noSecrets(value) {
  if (Array.isArray(value)) return value.forEach(noSecrets);
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/password|passwd|secret|token|authorization|private.?key|access.?key|api.?key|credentials?|cookie/i.test(key)) {
        throw new ProfileError('SECRET_IN_PROFILE', 'Environment profiles may contain credential file references, never credentials');
      }
      noSecrets(item);
    }
  } else if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
    const url = new URL(value.trim());
    if (url.username || url.password || [...url.searchParams.keys()].some((key) => /token|secret|password|authorization|credentials?|(?:api|access)[_-]?key/i.test(key))) {
      throw new ProfileError('SECRET_IN_PROFILE', 'Profile URL contains credentials');
    }
  }
}

export function validateProfile(profile, platform, environment) {
  if (!profile || profile.schema !== 'harness-environment-profile/v1'
      || profile.platform !== platform || profile.environment !== environment) {
    throw new ProfileError('PROFILE_TARGET_MISMATCH', 'Profile schema/platform/environment does not match the requested target');
  }
  noSecrets(profile);
  if (profile.nacos?.serverAddress && /[\/]/.test(profile.nacos.serverAddress)) {
    throw new ProfileError('INVALID_PROFILE', 'Nacos serverAddress must be host:port, never a Console URL/path');
  }
  if (!profile.runtime || profile.runtime.provider !== 'kubernetes') {
    throw new ProfileError('NEEDS_HUMAN', 'DEV/SIT requires an explicit Kubernetes runtime binding');
  }
  for (const key of ['cluster', 'context', 'kubeconfig', 'namespace', 'apiServer']) requireValue(profile.runtime[key], `runtime.${key}`);
  if (!identifier.test(profile.runtime.namespace)) throw new ProfileError('INVALID_PROFILE', 'Invalid namespace');
  if (!path.isAbsolute(localPath(profile.runtime.kubeconfig))) throw new ProfileError('INVALID_PROFILE', 'kubeconfig must use an absolute or home path');
  for (const [alias, service] of Object.entries(profile.services || {})) {
    if (!identifier.test(alias) || !identifier.test(service.workload || '')) throw new ProfileError('INVALID_PROFILE', 'Invalid service/workload name');
    if (!['Deployment', 'StatefulSet'].includes(service.kind)) throw new ProfileError('INVALID_PROFILE', 'Unsupported workload kind');
    if (service.k8sService && !identifier.test(service.k8sService)) throw new ProfileError('INVALID_PROFILE', 'Invalid Service name');
  }
  return profile;
}

export function loadEnvironmentProfile(platform, environment, { root = process.env.HARNESS_PROFILE_ROOT || path.join(os.homedir(), '.harness/runtime/profiles') } = {}) {
  if (!identifier.test(platform || '') || !['DEV', 'SIT'].includes(environment)) {
    throw new ProfileError('INVALID_TARGET', 'Explicit platform and DEV/SIT environment are required');
  }
  const file = path.join(localPath(root), platform, `${environment.toLowerCase()}.json`);
  if (!fs.existsSync(file)) throw new ProfileError('NEEDS_HUMAN', `Environment profile missing: ${file}; no legacy fallback`);
  let profile;
  try { profile = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new ProfileError('INVALID_PROFILE', 'Environment profile is not valid JSON'); }
  return { profile: validateProfile(profile, platform, environment), file };
}

export function deploymentStepDigest(detail, jobId) {
  const definition = typeof detail.definition === 'string' ? JSON.parse(detail.definition) : detail.definition;
  const job = definition?.stages?.flatMap((stage) => stage.jobs || []).find((item) => item.identifier === jobId);
  if (!job) throw new ProfileError('PROFILE_CI_DRIFT', 'Profile deployment job is absent from the live pipeline');
  return createHash('sha256').update(JSON.stringify({ steps: job.steps || [], resource: job.resource ?? null, env: job.env ?? null })).digest('hex');
}

export function verifyPipelineBinding(profile, detail, { mutation = false } = {}) {
  const ci = profile.ci;
  if (!ci || ci.routingStatus !== 'CONFIRMED') throw new ProfileError('NEEDS_HUMAN', 'CI deployment target is not confirmed; do not fall back to legacy dev');
  if ((detail.id || detail.pipeline_id) !== ci.pipelineId || detail.name !== ci.pipelineName) {
    throw new ProfileError('PROFILE_CI_DRIFT', 'Live pipeline identity differs from the environment profile');
  }
  if (ci.projectId && detail.project_id !== ci.projectId) throw new ProfileError('PROFILE_CI_DRIFT', 'Pipeline project differs from the environment profile');
  const target = ci.deploymentTarget;
  if (!target || target.cluster !== profile.runtime.cluster || target.namespace !== profile.runtime.namespace) {
    throw new ProfileError('PROFILE_CI_DRIFT', 'Pipeline deployment target differs from the runtime profile');
  }
  requireValue(ci.deploymentJobId, 'ci.deploymentJobId');
  requireValue(ci.deploymentStepSha256, 'ci.deploymentStepSha256');
  if (deploymentStepDigest(detail, ci.deploymentJobId) !== ci.deploymentStepSha256) {
    throw new ProfileError('PROFILE_CI_DRIFT', 'Live deployment step changed; reconfirm target and update only the local profile');
  }
  if (mutation && profile.environment !== 'DEV') throw new ProfileError('DEV_ONLY', 'SIT mutation is outside the current capability boundary');
}

export function resolveApifoxProfile(config, { root } = {}) {
  const result = structuredClone(config);
  const bindings = result.runtime?.environmentProfiles;
  if (!bindings) return result;
  for (const [environmentKey, binding] of Object.entries(bindings)) {
    const { profile } = loadEnvironmentProfile(binding.platform, binding.environment, { root });
    const environment = result.environments.find((item) => item.key === environmentKey);
    if (!environment) throw new ProfileError('INVALID_PROFILE_BINDING', 'Apifox profile references an unknown environment');
    const services = result.services.filter((item) => item.environment === environmentKey);
    for (const service of services) {
      const facts = profile.services[binding.service || service.name];
      if (!facts?.openapiUrl || !facts?.baseUrl || facts.openapiVerification !== 'VERIFIED') throw new ProfileError('NEEDS_HUMAN', `Verified OpenAPI/Base URL not confirmed for ${service.name}`);
      service.source = { type: 'direct', url: facts.openapiUrl, ...(service.source.headers ? { headers: service.source.headers } : {}) };
      environment.baseUrl = facts.baseUrl;
    }
    if (!services.length) throw new ProfileError('INVALID_PROFILE_BINDING', 'Apifox environment profile has no associated service');
  }
  return result;
}
