#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvironmentProfile, validateProfile, verifyPipelineBinding, deploymentStepDigest, resolveApifoxProfile } from './environment-profile.mjs';
import { runtimeSnapshot, redactRuntime } from './kubernetes-read.mjs';
import { validateProjectConfig } from '../skills/apifox-openapi-sync/scripts/sync-openapi.mjs';

const tempBase = path.join(os.tmpdir(), 'zfnjjs-harness');
fs.mkdirSync(tempBase, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempBase, 'environment-profile-tests.'));
const keep = process.env.HARNESS_KEEP_TEMP === '1';
const cleanup = () => { if (!keep) fs.rmSync(temp, { recursive: true, force: true }); };
process.once('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.exit(128 + (signal === 'SIGINT' ? 2 : 15)); });
let checks = 0;
function check(fn) { fn(); checks++; }
const fixture = { schema: 'harness-environment-profile/v1', platform: 'fixture', environment: 'DEV',
  runtime: { provider: 'kubernetes', cluster: 'fixture-k8s', context: 'fixture-k8s', namespace: 'fixture-dev', kubeconfig: '/fixture/kube.yaml', apiServer: 'https://rancher.invalid/k8s/clusters/fixture' },
  ci: { profile: 'fixture', projectRef: 'custom.codeartsProjectId', pipelineId: 'fixture-pipeline', pipelineName: 'current-temporary-name', routingStatus: 'CONFIRMED', deploymentTarget: { cluster: 'fixture-k8s', namespace: 'fixture-dev' }, deploymentJobId: 'deploy', requiredJobs: ['deploy'] },
  services: { api: { kind: 'Deployment', workload: 'fixture-api', openapiUrl: 'https://gateway.invalid/v3/api-docs', openapiVerification: 'VERIFIED', baseUrl: 'https://gateway.invalid' } } };
const pipeline = { id: 'fixture-pipeline', name: 'current-temporary-name', definition: { stages: [{ jobs: [{ identifier: 'deploy', steps: [{ task: 'shell', inputs: [{ key: 'script', value: 'namespace=fixture-dev' }] }] }] }] } };
fixture.ci.deploymentStepSha256 = deploymentStepDigest(pipeline, 'deploy');
try {
  check(() => assert.equal(validateProfile(fixture, 'fixture', 'DEV'), fixture));
  check(() => assert.throws(() => validateProfile(fixture, 'another', 'DEV'), /does not match/));
  check(() => assert.throws(() => validateProfile({ ...fixture, token: 'CANARY_SECRET' }, 'fixture', 'DEV'), /never credentials/));
  check(() => assert.throws(() => validateProfile({ ...fixture, url: 'HTTPS://fixture.invalid/?token=CANARY_SECRET' }, 'fixture', 'DEV'), /contains credentials/));
  check(() => assert.throws(() => validateProfile({ ...fixture, url: ' https://fixture.invalid/?%74oken=CANARY_SECRET' }, 'fixture', 'DEV'), /contains credentials/));
  check(() => assert.throws(() => validateProfile({ ...fixture, nacos: { serverAddress: 'http://fixture.invalid:8848/nacos' } }, 'fixture', 'DEV'), /never a Console/));
  check(() => assert.throws(() => loadEnvironmentProfile('fixture', 'PROD', { root: temp }), /DEV\/SIT/));
  check(() => assert.throws(() => loadEnvironmentProfile('fixture', 'DEV', { root: temp }), /no legacy fallback/));
  fs.mkdirSync(path.join(temp, 'fixture'));
  fs.writeFileSync(path.join(temp, 'fixture/dev.json'), JSON.stringify(fixture));
  check(() => assert.equal(loadEnvironmentProfile('fixture', 'DEV', { root: temp }).profile.runtime.namespace, 'fixture-dev'));
  check(() => verifyPipelineBinding(fixture, pipeline));
  check(() => assert.throws(() => verifyPipelineBinding({ ...fixture, ci: { ...fixture.ci, routingStatus: 'NEEDS_HUMAN' } }, pipeline), /not confirmed/));
  check(() => assert.throws(() => verifyPipelineBinding(fixture, { ...pipeline, name: 'legacy-dev' }), /identity differs/));
  check(() => assert.throws(() => verifyPipelineBinding({ ...fixture, ci: { ...fixture.ci, deploymentTarget: { cluster: 'old-cloud', namespace: 'fixture-dev' } } }, pipeline), /target differs/));
  const changed = structuredClone(pipeline); changed.definition.stages[0].jobs[0].steps[0].inputs[0].value = 'namespace=wrong';
  check(() => assert.throws(() => verifyPipelineBinding(fixture, changed), /step changed/));
  const config = { runtime: { environmentProfiles: { 'dev-api': { platform: 'fixture', environment: 'DEV', service: 'api' } } }, services: [{ name: 'api', environment: 'dev-api', source: { type: 'direct', url: 'http://old.invalid' } }], environments: [{ key: 'dev-api', baseUrl: 'http://old.invalid' }] };
  check(() => { const resolved = resolveApifoxProfile(config, { root: temp }); assert.equal(resolved.services[0].source.url, fixture.services.api.openapiUrl); assert.equal(resolved.environments[0].baseUrl, fixture.services.api.baseUrl); assert.equal(config.services[0].source.url, 'http://old.invalid'); });
  check(() => {
    const unknown = structuredClone(fixture); unknown.services.api.openapiVerification = 'UNVERIFIED';
    fs.writeFileSync(path.join(temp, 'fixture/dev.json'), JSON.stringify(unknown));
    assert.throws(() => resolveApifoxProfile(config, { root: temp }), /Verified OpenAPI/);
    fs.writeFileSync(path.join(temp, 'fixture/dev.json'), JSON.stringify(fixture));
  });
  check(() => {
    const profileConfig = JSON.parse(fs.readFileSync(new URL('../skills/apifox-openapi-sync/tests/fixtures/project-config.json', import.meta.url), 'utf8'));
    profileConfig.runtime.environmentProfiles = Object.fromEntries(profileConfig.environments.map((env) => [env.key, { platform: 'fixture', environment: 'DEV', service: 'api' }]));
    profileConfig.services.forEach((service) => { service.source = { type: 'environment-profile' }; });
    profileConfig.environments.forEach((environment) => { delete environment.baseUrl; });
    validateProjectConfig(profileConfig);
    validateProjectConfig(resolveApifoxProfile(profileConfig, { root: temp }));
    delete profileConfig.runtime.environmentProfiles;
    assert.throws(() => validateProjectConfig(profileConfig));
  });
  const calls = [];
  const workload = { metadata: { namespace: 'fixture-dev', name: 'fixture-api', generation: 2, annotations: { 'deployment.kubernetes.io/revision': '7' } }, spec: { replicas: 1, selector: { matchLabels: { app: 'fixture-api' } }, template: { spec: { containers: [{ image: 'registry.invalid/api:new' }] } } }, status: { observedGeneration: 2, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1 } };
  const pods = { items: [{ metadata: { name: 'api-pod' }, spec: { containers: [{ image: 'registry.invalid/api:new' }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'api', ready: true, restartCount: 2, image: 'registry.invalid/api:new' }] } }] };
  const runner = (args) => {
    calls.push(args);
    assert(args.includes('--context=fixture-k8s')); assert(args.includes('--namespace=fixture-dev')); assert(args.includes('--kubeconfig=/fixture/kube.yaml'));
    if (args.includes('config')) return { contexts: [{ name: 'fixture-k8s', context: { cluster: 'fixture-k8s' } }], clusters: [{ name: 'fixture-k8s', cluster: { server: fixture.runtime.apiServer } }] };
    return args.includes('pods') ? pods : workload;
  };
  check(() => { const result = runtimeSnapshot(fixture, 'api', { expectedImage: 'registry.invalid/api:new', runner }); assert.equal(result.deploymentVerified, true); assert.equal(result.pods[0].containers[0].restarts, 2); });
  check(() => assert.equal(runtimeSnapshot(fixture, 'api', { expectedImage: 'registry.invalid/api:old', runner }).deploymentVerified, false));
  check(() => assert.equal(runtimeSnapshot(fixture, 'api', { runner }).deploymentVerified, false));
  check(() => { pods.items[0].metadata.deletionTimestamp = '2026-10-12T00:00:00Z'; assert.equal(runtimeSnapshot(fixture, 'api', { expectedImage: 'registry.invalid/api:new', runner }).deploymentVerified, false); delete pods.items[0].metadata.deletionTimestamp; });
  check(() => { const before = calls.length; assert.throws(() => runtimeSnapshot(fixture, 'api', { runner: (args) => { assert(args.includes('config')); return { contexts: [], clusters: [] }; } }), /differs/); assert.equal(calls.length, before); });
  check(() => assert.throws(() => runtimeSnapshot(fixture, 'unknown', { runner }), /not mapped/));
  check(() => assert.equal(redactRuntime('Authorization: Bearer CANARY_ACCESS_TOKEN password=CANARY_PASSWORD').includes('CANARY'), false));
  check(() => assert.equal(redactRuntime('{"password":"CANARY_JSON_SECRET", "token":"CANARY_TOKEN"}').includes('CANARY'), false));
  check(() => {
    for (const key of ['access_token', 'refresh_token', 'id_token', 'client_secret', 'accessToken', 'refresh-token']) {
      const value = 'CANARY_PREFIX_"_CANARY_SUFFIX';
      const result = redactRuntime(JSON.stringify({ [key]: value, message: 'connection refused', tokenCount: 7 }));
      assert.equal(result.includes('CANARY'), false, `credential redaction failed for ${key}`);
      assert.equal(result.includes('connection refused'), true);
      assert.equal(result.includes('tokenCount'), true);
    }
  });
  check(() => assert.equal(redactRuntime('-----BEGIN PRIVATE KEY-----\nCANARY_PEM\n-----END PRIVATE KEY-----').includes('CANARY'), false));
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'codearts-pipeline.mjs');
  check(() => { const result = spawnSync(process.execPath, [script, 'run', '--environment=DEV', '--profile=fixture', '--project-ref=custom.project', '--pipeline-name=legacy-dev', '--authorized-dev-run'], { encoding: 'utf8', env: { ...process.env, CODEARTS_HCLOUD_BIN: path.join(temp, 'must-not-execute') } }); assert.notEqual(result.status, 0); assert.match(result.stderr, /ENVIRONMENT_PROFILE_REQUIRED/); });
  console.log(JSON.stringify({ check: 'environment-profile-kubernetes-routing', status: 'PASS', checks }));
} finally {
  if (keep) console.log(`HARNESS_KEEP_TEMP=1 retained ${temp}`);
  cleanup();
}
