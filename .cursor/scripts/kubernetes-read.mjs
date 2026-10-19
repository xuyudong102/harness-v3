#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironmentProfile, localPath, ProfileError } from './environment-profile.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
export function redactRuntime(value) {
  return String(value || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED_AUTH]')
    .replace(/(["'])(?:password|passwd|secret|(?:access[_-]?|refresh[_-]?|id[_-]?)?token|client[_-]?secret|authorization|access.?key|private.?key|cookie|credentials?)\1\s*:\s*(["'])(?:\\[^\r\n]|(?!\2)[^\\\r\n])*?\2/gi, '"sensitive": "[REDACTED]"')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/((?:password|passwd|secret|token|authorization|access.?key|private.?key)\s*[:=]\s*)[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
}

function defaultRunner(args) {
  const result = spawnSync(process.env.HARNESS_KUBECTL_BIN || 'kubectl', args, { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new ProfileError('KUBERNETES_READ_UNAVAILABLE', redactRuntime(result.stderr || result.error?.message || 'kubectl read failed').slice(0, 400));
  try { return JSON.parse(result.stdout); } catch { throw new ProfileError('INVALID_KUBECTL_RESPONSE', 'kubectl did not return JSON'); }
}

export function kubernetesClient(profile, runner = defaultRunner) {
  const r = profile.runtime;
  const base = [`--kubeconfig=${localPath(r.kubeconfig)}`, `--context=${r.context}`, `--namespace=${r.namespace}`, '--request-timeout=12s'];
  const config = runner([...base, 'config', 'view', '-o', 'json']);
  const context = config.contexts?.find((item) => item.name === r.context);
  const cluster = config.clusters?.find((item) => item.name === context?.context?.cluster);
  if (cluster?.name !== r.cluster || cluster?.cluster?.server?.replace(/\/$/, '') !== r.apiServer.replace(/\/$/, '')) {
    throw new ProfileError('KUBERNETES_TARGET_MISMATCH', 'kubeconfig context/cluster/API server differs from the local profile');
  }
  return { base, read: (args) => runner([...base, ...args]) };
}

export function runtimeSnapshot(profile, serviceName, { expectedImage, runner } = {}) {
  const service = profile.services?.[serviceName];
  if (!service) throw new ProfileError('NEEDS_HUMAN', 'Service is not mapped in the environment profile');
  const client = kubernetesClient(profile, runner);
  const body = client.read(['get', service.kind.toLowerCase(), service.workload, '-o', 'json']);
  if (body.metadata?.namespace !== profile.runtime.namespace || body.metadata?.name !== service.workload) throw new ProfileError('KUBERNETES_TARGET_MISMATCH', 'Returned workload belongs to a different target');
  const labels = body.spec?.selector?.matchLabels;
  if (!labels || !Object.keys(labels).length) throw new ProfileError('UNSUPPORTED_SELECTOR', 'Workload requires an explicit label selector');
  const selector = Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(',');
  const allPods = client.read(['get', 'pods', '-l', selector, '-o', 'json']).items || [];
  const active = allPods.filter((pod) => !pod.metadata.deletionTimestamp && !['Succeeded', 'Failed'].includes(pod.status?.phase));
  const pods = active.map((pod) => ({
    name: pod.metadata.name,
    ready: pod.status?.conditions?.find((condition) => condition.type === 'Ready')?.status === 'True',
    phase: pod.status?.phase,
    containers: (pod.status?.containerStatuses || []).map((container) => ({ name: container.name, ready: container.ready, restarts: container.restartCount, image: container.image, imageId: container.imageID, state: Object.keys(container.state || {})[0] || null })),
  }));
  const images = (body.spec.template.spec.containers || []).map((container) => container.image);
  const desired = body.spec.replicas ?? 1;
  const status = body.status || {};
  const generationObserved = status.observedGeneration >= body.metadata.generation;
  const imagesMatch = expectedImage ? images.includes(expectedImage)
    && active.length > 0 && active.every((pod) => (pod.spec?.containers || []).some((container) => container.image === expectedImage)) : null;
  const ready = desired > 0 && generationObserved && status.updatedReplicas === desired
    && status.readyReplicas === desired && (service.kind === 'StatefulSet' || status.availableReplicas === desired)
    && active.length === desired && pods.every((pod) => pod.ready)
    && allPods.every((pod) => !pod.metadata.deletionTimestamp);
  return { cluster: profile.runtime.cluster, context: profile.runtime.context, namespace: profile.runtime.namespace,
    workload: service.workload, kind: service.kind, revision: body.metadata.annotations?.['deployment.kubernetes.io/revision'] || status.currentRevision || null,
    desired, readyReplicas: status.readyReplicas || 0, availableReplicas: status.availableReplicas || 0,
    generation: body.metadata.generation, observedGeneration: status.observedGeneration,
    images, imageMatches: imagesMatch, ready, pods: pods.slice(0, 10), podCount: pods.length,
    deploymentVerified: expectedImage ? ready && imagesMatch : false,
    verificationGap: expectedImage ? null : 'Expected build image is required to prove this deployment is the requested version' };
}

function parse(argv) {
  const options = {};
  const command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const match = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new ProfileError('INVALID_ARGUMENT', 'Only explicit named arguments are supported');
    options[match[1]] = match[2] ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i]) ?? true;
  }
  return { command, options };
}

export function readResources(profile, command, { serviceName, since = '5m', previous = false, limit = 50, runner } = {}) {
  const service = profile.services?.[serviceName];
  const client = kubernetesClient(profile, runner);
  if (['services', 'ingress', 'events', 'endpoints'].includes(command)) {
    let args;
    if (command === 'endpoints') {
      if (!service?.k8sService) throw new ProfileError('NEEDS_HUMAN', 'Kubernetes Service mapping missing');
      args = ['get', 'endpointslices', '-l', `kubernetes.io/service-name=${service.k8sService}`, '-o', 'json'];
    } else if (command === 'events') {
      if (!service) throw new ProfileError('NEEDS_HUMAN', 'Events require a mapped workload');
      args = ['get', 'events', '--field-selector', `involvedObject.name=${service.workload}`, '-o', 'json'];
    } else args = ['get', command === 'ingress' ? 'ingresses' : 'services', '-o', 'json'];
    const rows = client.read(args).items || [];
    return rows.slice(0, 30).map((row) => {
      if (command === 'services') return { name: row.metadata.name, type: row.spec.type, ports: row.spec.ports, externalIPs: row.spec.externalIPs || [] };
      if (command === 'ingress') return { name: row.metadata.name, rules: row.spec.rules, addresses: row.status?.loadBalancer?.ingress || [] };
      if (command === 'endpoints') return { name: row.metadata.name, ports: row.ports, endpoints: row.endpoints };
      return { name: row.metadata.name, reason: row.reason, message: redactRuntime(row.message).slice(0, 500), time: row.lastTimestamp || row.eventTime };
    });
  }
  if (command !== 'logs' || !service) throw new ProfileError('INVALID_ARGUMENT', 'Supported reads: snapshot, services, ingress, endpoints, events, logs');
  if (!/^([1-9]|1[0-5])m$/.test(since) || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new ProfileError('LIMIT_EXCEEDED', 'Logs must use 1..15m and 1..200 lines');
  if (runner) throw new ProfileError('INVALID_ARGUMENT', 'Logs require kubectl execution');
  const args = [...client.base, 'logs', `${service.kind.toLowerCase()}/${service.workload}`, `--since=${since}`, `--tail=${limit}`, '--limit-bytes=32768', '--all-containers=true', ...(previous ? ['--previous=true'] : [])];
  const result = spawnSync(process.env.HARNESS_KUBECTL_BIN || 'kubectl', args, { encoding: 'utf8', timeout: 20000, maxBuffer: 128 * 1024 });
  if (result.error || result.status !== 0) throw new ProfileError('KUBERNETES_READ_UNAVAILABLE', redactRuntime(result.stderr).slice(0, 400));
  return redactRuntime(result.stdout).split('\n').slice(-limit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  try {
    const { command, options } = parse(process.argv.slice(2));
    const { profile } = loadEnvironmentProfile(options.project, String(options.env || '').toUpperCase());
    const facts = command === 'snapshot'
      ? runtimeSnapshot(profile, options.service, { expectedImage: options['expected-image'] })
      : readResources(profile, command, { serviceName: options.service, since: options.since || '5m', previous: options.previous === true || options.previous === 'true', limit: Number(options.limit || 50) });
    console.log(JSON.stringify({ schema: 'kubernetes-read/v1', status: 'PASS', facts }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'NEEDS_HUMAN', code: error.code || 'READ_FAILED', message: redactRuntime(error.message) }));
    process.exitCode = 1;
  }
}
