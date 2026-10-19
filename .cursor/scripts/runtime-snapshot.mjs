#!/usr/bin/env node
/** Compact read-only DEV/SIT snapshot, backed by the current local environment profile. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironmentProfile } from './environment-profile.mjs';
import { runtimeSnapshot, redactRuntime } from './kubernetes-read.mjs';
const SCRIPT = fileURLToPath(import.meta.url);
const SCHEMA = 'runtime-snapshot/v1';
export function effectiveConfigGate(input) {
  const required = ['project', 'environment', 'service', 'instance', 'nacos_namespace_id', 'nacos_data_id', 'evidence_source'];
  const missing = required.filter((key) => !input[key]);
  return {
    status: missing.length ? 'BLOCKED' : 'READY',
    missing_fields: missing,
    effective_data_id: input.nacos_data_id || null,
    evidence_source: input.evidence_source || null,
    rule: 'Config mutation requires project, environment, service, a live instance, Nacos namespace ID, and an inventory-verified effective DataId with provenance. Active profile is optional.',
  };
}

export function rolloutState(dep) {
  if (!dep || dep.replicas == null) return 'UNAVAILABLE';
  const old = dep.oldReplicas || 0;
  if (dep.updated < dep.replicas || old > 0) return 'ROLLING_OUT';
  if (dep.ready < dep.replicas || dep.available < dep.replicas) return 'DEGRADED';
  if (dep.replicas > 0 && dep.replicas === dep.updated && dep.replicas === dep.ready && dep.replicas === dep.available) return 'STABLE';
  return 'UNAVAILABLE';
}

export function resolveDataId(profile, dataIds) {
  if (!profile) return { data_id: null, reason: 'active profile is unavailable' };
  const exact = dataIds.filter((id) => id.includes(profile));
  if (exact.length !== 1) return { data_id: null, reason: 'profile does not select exactly one existing DataId' };
  return { data_id: exact[0], reason: 'unique DataId match for the evidenced profile' };
}

export function convergence(input) {
  const deployed = input.deployedRevision || null;
  const observed = input.observedRevisions || [];
  const deploymentCompleted = input.deploymentStatus === 'COMPLETED' ? true : (input.deploymentStatus && input.deploymentStatus !== 'unavailable' ? false : 'unavailable');
  const newRevisionObserved = !deployed || observed.length === 0 ? 'unavailable' : observed.includes(deployed);
  const oldStill = observed.length === 0 || !deployed ? 'unavailable' : observed.some((item) => item !== deployed);
  const converged = newRevisionObserved === true && oldStill === false ? true : 'unavailable';
  return {
    deployment_completed: deploymentCompleted,
    deployed_revision: deployed || 'unavailable',
    new_revision_observed: newRevisionObserved,
    new_instance_observed: input.pods.length > 0,
    new_instance_healthy: 'unavailable',
    old_revision_still_observed: oldStill,
    runtime_service_discovery_converged: converged,
  };
}


export function drift(recorded, live) {
  return live?.deploymentFound === false ? { status: 'DRIFT_DETECTED', field: 'deployment', recorded: recorded?.deployment, action: 'Reconfirm from the profile-bound Kubernetes runtime; never change profiles automatically' } : null;
}

function snapshot(options) {
  const project = String(options.project || '');
  const environment = String(options.env || '').toUpperCase();
  if (environment === 'PRE') return { schema: SCHEMA, status: 'PASS', facts: { project, environment, loki: { status: 'unavailable', reason: 'PRE is outside this migration and is not queried' } }, effective_config_gate: effectiveConfigGate({}), unavailable_fields: ['runtime', 'nacos_data_id'] };
  const since = String(options.since || '5m');
  const limit = Number(options.limit || 20);
  if (!/^([1-9]|1[0-5])m$/.test(since) || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('Bounds require 1..15m and 1..30 records');
  const { profile, file } = loadEnvironmentProfile(project, environment);
  const service = String(options.service || '');
  const runtime = runtimeSnapshot(profile, service, { expectedImage: options['expected-image'] });
  const binding = profile.services[service];
  const nacos = profile.nacos || {};
  const gate = effectiveConfigGate({ project, environment, service, instance: runtime.pods[0]?.name,
    nacos_namespace_id: nacos.namespaceId, nacos_data_id: binding.nacosDataId, evidence_source: binding.configEvidence });
  return { schema: SCHEMA, status: 'PASS', facts: { project, environment, service, profile_source: file, kubernetes: runtime,
    nacos: { console_url: nacos.consoleUrl, server_address: nacos.serverAddress, namespace_id: nacos.namespaceId, group: nacos.group, data_id: binding.nacosDataId || null },
    codearts: { status: 'NOT_REQUESTED', note: 'Pipeline success must be correlated with the expected image in this Kubernetes snapshot' } },
    effective_config_gate: gate, unavailable_fields: ['runtime_service_discovery', ...(!options['expected-image'] ? ['deployed_image_correlation'] : [])],
    bounds: { since, limit, raw_logs: 'omitted; use kubernetes-read.mjs logs explicitly' } };
}

function parse(argv) {
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) throw new Error('Explicit named arguments required');
    options[m[1]] = m[2] ?? argv[++i];
  }
  return { command: argv[0], options };
}
function selfCheck() {
  if (rolloutState({ replicas: 1, updated: 1, ready: 1, available: 1, oldReplicas: 0 }) !== 'STABLE') throw new Error('Rollout classifier failed');
  if (convergence({ pods: [], deploymentStatus: 'COMPLETED' }).runtime_service_discovery_converged === true) throw new Error('Pipeline success is not convergence');
  if (effectiveConfigGate({}).status !== 'BLOCKED') throw new Error('Missing effective config did not block mutation');
  return { schema: SCHEMA, status: 'PASS', check: 'self-check' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  try {
    const { command, options } = parse(process.argv.slice(2));
    if (!['snapshot', 'self-check'].includes(command)) throw new Error('Use snapshot or self-check');
    console.log(JSON.stringify(command === 'self-check' ? selfCheck() : snapshot(options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ schema: SCHEMA, status: 'NEEDS_HUMAN', code: error.code || 'SNAPSHOT_FAILED', message: redactRuntime(error.message) }));
    process.exitCode = 1;
  }
}
