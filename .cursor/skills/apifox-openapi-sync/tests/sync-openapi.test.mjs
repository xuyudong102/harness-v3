import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ToolError,
  createReadOnlyApifoxAdapter,
  detectNamespaceCollisions,
  detectRemoteSchemaCollisions,
  diffSnapshots,
  ensureEnvironment,
  ensureProject,
  executeDiff,
  executeSync,
  loadManifest,
  normalizeOpenApi,
  runCommand,
  saveManifestAtomic,
  snapshotOpenApi,
  validateProjectConfig,
} from '../scripts/sync-openapi.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const baseConfig = () => readJson('project-config.json');
const baseSpec = () => readJson('openapi-base.json');
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apifox-openapi-test-'));

function snapshot(name, config = baseConfig()) {
  return snapshotOpenApi(normalizeOpenApi(readJson(name), config.services[0], config.contract));
}

class FakeAdapter {
  constructor({ projectMismatch = false, projectExists = true, importFailure = false, validationFailure = false, environmentExists = true, preserveStale = false, duplicateBranches = false, environmentUpdateNoop = false, schemas = [] } = {}) {
    this.projectMismatch = projectMismatch;
    this.projectExists = projectExists;
    this.importFailure = importFailure;
    this.validationFailure = validationFailure;
    this.preserveStale = preserveStale;
    this.duplicateBranches = duplicateBranches;
    this.environmentUpdateNoop = environmentUpdateNoop;
    this.importCount = 0;
    this.projectCreateCount = 0;
    this.environmentCreateCount = 0;
    this.environmentUpdateCount = 0;
    this.folderListCount = 0;
    this.endpointListCount = 0;
    this.schemaListCount = 0;
    this.schemas = schemas;
    this.folders = [];
    this.endpoints = [];
    this.environments = environmentExists ? [{ id: '501', name: 'DEV', baseUrls: { default: 'https://dev.example.invalid' } }] : [];
    this.environmentDetails = new Map(environmentExists ? [['501', {
      id: '501', name: 'DEV', baseUrls: { default: 'https://dev.example.invalid' },
      parameters: { cookie: [], query: [], body: [], header: [{ name: 'Authorization', value: '{{DEV_AUTHORIZATION}}', initialValue: '{{DEV_AUTHORIZATION}}' }] },
    }]] : []);
  }
  async projectGet() { return { id: '1001', name: this.projectMismatch ? 'Wrong API' : 'Example API', teamId: '2001' }; }
  async projectList() { return this.projectExists ? [{ id: '1001', name: this.projectMismatch ? 'Wrong API' : 'Example API', teamId: '2001' }] : []; }
  async projectCreate(project) { this.projectCreateCount += 1; return { id: '1001', name: project.name, teamId: project.teamId }; }
  async branchList() { return this.duplicateBranches ? [{ name: 'main', isArchived: false }, { name: 'main', isArchived: false }] : [{ name: 'main', isArchived: false }]; }
  async environmentList() { return this.environments; }
  async environmentGet(projectId, branch, id) { return this.environmentDetails.get(String(id)); }
  async environmentCreate(projectId, branch, environment) {
    this.environmentCreateCount += 1;
    const value = { id: '502', name: environment.name, baseUrls: { default: environment.baseUrl } };
    this.environments.push(value);
    this.environmentDetails.set('502', { ...value, parameters: { cookie: [], query: [], body: [], header: [] } });
    return value;
  }
  async environmentUpdate(projectId, branch, id, value) {
    this.environmentUpdateCount += 1;
    if (this.environmentUpdateNoop) return this.environmentDetails.get(String(id));
    this.environmentDetails.set(String(id), { id: String(id), ...value });
    return this.environmentDetails.get(String(id));
  }
  async importOpenApi(projectId, branch, spec) {
    this.importCount += 1;
    if (this.importFailure) throw new ToolError('IMPORT_FAILED', 'fixture import failed');
    if (!this.validationFailure) {
      const namespace = Object.values(spec.paths)[0].get?.tags?.[0]?.split('/')[0]
        || Object.values(spec.paths)[0].post?.tags?.[0]?.split('/')[0];
      this.folders = [{ id: '701', name: namespace, path: namespace }, { id: '702', name: 'Items', path: `${namespace}/Items` }];
      if (!this.preserveStale) this.endpoints = [];
      let endpointId = 800;
      for (const [apiPath, item] of Object.entries(spec.paths)) {
        for (const method of ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace']) {
          if (item[method] && !this.endpoints.some((endpoint) => endpoint.method === method.toUpperCase() && endpoint.path === apiPath)) {
            this.endpoints.push({ id: String(endpointId++), method: method.toUpperCase(), path: apiPath, folderId: '702' });
          }
        }
      }
    }
    return { success: true, counts: { createdCount: this.endpoints.length } };
  }
  async folderList() { this.folderListCount += 1; return this.folders; }
  async endpointList() { this.endpointListCount += 1; return this.endpoints; }
  async schemaList() { this.schemaListCount += 1; return this.schemas; }
}

test('valid generic config passes', () => {
  assert.equal(validateProjectConfig(baseConfig()).project.label, 'example-project');
});

test('CLI adapter captures large JSON completely in an isolated working directory', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'fake-apifox');
  fs.writeFileSync(binary, `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.mkdirSync('.apifox');\nconst data = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), name: 'x'.repeat(80), cwd: process.cwd() }));\nprocess.stdout.write(JSON.stringify({ success: true, data }));\n`, { mode: 0o700 });
  const endpoints = createReadOnlyApifoxAdapter({ binary }).endpointList('1001', 'main');
  assert.equal(endpoints.length, 2000);
  assert.ok(endpoints[0].cwd.startsWith(fs.realpathSync(os.tmpdir())));
  assert.notEqual(endpoints[0].cwd, process.cwd());
});

test('malformed config fails fast', () => {
  const config = baseConfig();
  config.services[0].source = { type: 'unsupported', url: 'https://example.invalid' };
  assert.throws(() => validateProjectConfig(config), (error) => error.code === 'MALFORMED_SOURCE');
});

test('config-check rejects duplicate services, aliases and missing environments', () => {
  const duplicateService = baseConfig();
  duplicateService.services.push(structuredClone(duplicateService.services[0]));
  assert.throws(() => validateProjectConfig(duplicateService), (error) => error.code === 'DUPLICATE_SERVICE');

  const duplicateAlias = baseConfig();
  duplicateAlias.services.push({ ...structuredClone(duplicateAlias.services[0]), name: 'inventory-service', namespace: 'inventory', aliases: ['catalog'] });
  assert.throws(() => validateProjectConfig(duplicateAlias), (error) => error.code === 'DUPLICATE_ALIAS');

  const missingEnvironment = baseConfig();
  missingEnvironment.services[0].environment = 'unknown';
  assert.throws(() => validateProjectConfig(missingEnvironment), (error) => error.code === 'INVALID_ENVIRONMENT_REFERENCE');
});

test('first full sync imports, validates and creates v3 manifest', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const adapter = new FakeAdapter();
  const result = await executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  assert.equal(result.ok, true);
  assert.equal(result.services[0].status, 'SUCCESS');
  assert.equal(adapter.importCount, 1);
  const manifest = loadManifest(path.join(runtimeRoot, 'example-project-sync-manifest.json'), config, { allowMissing: false });
  assert.equal(manifest.schema, 'apifox-openapi-sync/v3');
  assert.equal(manifest.services['catalog-service'].validation.status, 'PASS');
});

test('same contract is unchanged and import is skipped', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const adapter = new FakeAdapter();
  await executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  const validationReads = { folders: adapter.folderListCount, endpoints: adapter.endpointListCount };
  const second = await executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot, authorizedMutation: true });
  assert.equal(second.ok, true);
  assert.equal(second.services[0].status, 'NO_CHANGE');
  assert.equal(adapter.importCount, 1);
  assert.deepEqual({ folders: adapter.folderListCount, endpoints: adapter.endpointListCount }, validationReads);
});

test('request contract change is detected', () => {
  const diff = diffSnapshots(snapshot('openapi-base.json'), snapshot('openapi-request-changed.json'));
  assert.equal(diff.change, 'CHANGED');
  assert.ok(diff.modified.count > 0);
});

test('response contract change is detected', () => {
  const diff = diffSnapshots(snapshot('openapi-base.json'), snapshot('openapi-response-changed.json'));
  assert.equal(diff.change, 'CHANGED');
  assert.ok(diff.modified.count > 0);
});

test('component schema field addition is detected', () => {
  const diff = diffSnapshots(snapshot('openapi-base.json'), snapshot('openapi-component-field-added.json'));
  assert.equal(diff.change, 'CHANGED');
  assert.ok(diff.modified.count > 0);
});

test('enum and required changes are detected', () => {
  const diff = diffSnapshots(snapshot('openapi-base.json'), snapshot('openapi-enum-required-changed.json'));
  assert.equal(diff.change, 'CHANGED');
  assert.ok(diff.modified.count > 0);
});

test('operation addition is classified', () => {
  const diff = diffSnapshots(snapshot('openapi-base.json'), snapshot('openapi-operation-added.json'));
  assert.equal(diff.added.count, 1);
});

test('operation removal is classified', () => {
  const diff = diffSnapshots(snapshot('openapi-base.json'), snapshot('openapi-operation-removed.json'));
  assert.equal(diff.removed.count, 1);
});

test('service failure produces overall failure and non-zero command status', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const configFile = path.join(FIXTURES, 'project-config.json');
  const adapter = new FakeAdapter();
  const output = await runCommand(['sync', '--config', configFile, '--runtime-root', runtimeRoot, '--authorized-mutation'], {
    adapter,
    fetchJson: async () => { throw new ToolError('OPENAPI_FETCH_FAILED', 'fixture fetch failed'); },
  });
  assert.equal(output.result.ok, false);
  assert.notEqual(output.exitCode, 0);
});

test('import failure produces FAILED and leaves manifest unchanged', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const result = await executeSync({ config, services: config.services, adapter: new FakeAdapter({ importFailure: true }), fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.services[0].status, 'FAILED');
  assert.equal(fs.existsSync(path.join(runtimeRoot, 'example-project-sync-manifest.json')), false);
});

test('validate failure leaves manifest unchanged', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const adapter = new FakeAdapter({ validationFailure: true });
  const result = await executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, 'example-project-sync-manifest.json')), false);
});

test('malformed manifest fails explicitly', (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const file = path.join(runtimeRoot, 'example-project-sync-manifest.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => loadManifest(file, baseConfig()), (error) => error.code === 'MALFORMED_MANIFEST');
});

test('legacy manifest requires explicit full-sync migration', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const file = path.join(runtimeRoot, 'example-project-sync-manifest.json');
  fs.writeFileSync(file, `${JSON.stringify({ schema: 'apifox-openapi-sync/v1', project: {}, services: {} })}\n`);
  await assert.rejects(
    () => executeDiff({ config, services: config.services, fetchJson: async () => baseSpec(), runtimeRoot }),
    (error) => error.code === 'MANIFEST_MIGRATION_REQUIRED',
  );
  const result = await executeSync({ config, services: config.services, adapter: new FakeAdapter(), fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  assert.equal(result.ok, true);
  assert.equal(loadManifest(file, config, { allowMissing: false }).schema, 'apifox-openapi-sync/v3');
});

test('manifest refuses credential-like values', (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const file = path.join(runtimeRoot, 'manifest.json');
  assert.throws(
    () => saveManifestAtomic(file, { schema: 'apifox-openapi-sync/v3', token: 'fixture-secret-value-1234567890' }),
    (error) => error.code === 'SECRET_IN_MANIFEST',
  );
  assert.equal(fs.existsSync(file), false);
});

test('manifest accepts credential-named endpoint paths with contract digests', (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const file = path.join(runtimeRoot, 'manifest.json');
  const manifest = {
    schema: 'apifox-openapi-sync/v3',
    services: { example: { operations: {
      'POST /auth/wechat/access-token': 'a'.repeat(64),
      'PUT /account/password': 'b'.repeat(64),
    } } },
  };
  saveManifestAtomic(file, manifest);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), manifest);
});

test('manifest still refuses nested credential properties and bearer values', (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const file = path.join(runtimeRoot, 'manifest.json');
  for (const credentials of [
    { accessToken: 'fixture-secret-value-1234567890' },
    { authorization: 'fixture-secret-value-1234567890' },
    { password: 'fixture-secret-value-1234567890' },
    { cookie: 'fixture-secret-value-1234567890' },
    { client_secret: 'fixture-secret-value-1234567890' },
    { clientSecret: 'fixture-secret-value-1234567890' },
    { apiSecret: 'fixture-secret-value-1234567890' },
    { description: 'Bearer fixture-secret-value-1234567890' },
    { operations: { 'POST /auth/access-token': 'fixture-secret-value-1234567890' } },
    { operations: { token: 'a'.repeat(64) } },
  ]) {
    assert.throws(() => saveManifestAtomic(file, { services: { example: credentials } }),
      (error) => error.code === 'SECRET_IN_MANIFEST');
    assert.equal(fs.existsSync(file), false);
  }
});

test('project target mismatch fails closed', async () => {
  await assert.rejects(() => ensureProject(baseConfig(), new FakeAdapter({ projectMismatch: true })), (error) => error.code === 'PROJECT_TARGET_MISMATCH');
});

test('workspace project ID mismatch fails closed', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const settings = path.join(root, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ projectId: '9999' }));
  await assert.rejects(
    () => ensureProject(baseConfig(), new FakeAdapter(), { workspaceSettingsPath: settings }),
    (error) => error.code === 'PROJECT_TARGET_MISMATCH',
  );
});

test('workspace settings are optional but explicit settings must contain a numeric projectId', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(FIXTURES, 'project-config.json');
  await assert.doesNotReject(() => runCommand(['config-check', '--config', configFile]));
  await assert.doesNotReject(() => ensureProject(baseConfig(), new FakeAdapter()));

  const valid = path.join(root, 'valid.json');
  fs.writeFileSync(valid, JSON.stringify({ projectId: 1001 }));
  await assert.doesNotReject(() => runCommand(['config-check', '--config', configFile, '--workspace-settings', valid]));
  await assert.doesNotReject(() => ensureProject(baseConfig(), new FakeAdapter(), { workspaceSettingsPath: valid }));

  for (const [name, value] of [['empty', {}], ['wrong-type', { projectId: ['1001'] }]]) {
    const file = path.join(root, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    await assert.rejects(
      () => ensureProject(baseConfig(), new FakeAdapter(), { workspaceSettingsPath: file }),
      (error) => error.code === 'WORKSPACE_TARGET_MALFORMED',
    );
    await assert.rejects(
      runCommand(['config-check', '--config', configFile, '--workspace-settings', file]),
      (error) => error.code === 'WORKSPACE_TARGET_MALFORMED',
    );
  }
  await assert.rejects(
    runCommand(['config-check', '--config', configFile, '--workspace-settings', path.join(root, 'missing.json')]),
    (error) => error.code === 'WORKSPACE_TARGET_MISSING',
  );
});

test('missing project requires authorization and is created only when authorized', async () => {
  const config = baseConfig();
  delete config.project.apifoxProjectId;
  const adapter = new FakeAdapter({ projectExists: false });
  await assert.rejects(() => ensureProject(config, adapter), (error) => error.code === 'AUTHORIZATION_REQUIRED');
  const target = await ensureProject(config, adapter, { authorizedMutation: true });
  assert.equal(target.created, true);
  assert.equal(adapter.projectCreateCount, 1);
});

test('namespace collision fails config-check', () => {
  const config = baseConfig();
  config.services.push({ ...structuredClone(config.services[0]), name: 'other-service', aliases: ['other'] });
  assert.throws(() => validateProjectConfig(config), (error) => error.code === 'NAMESPACE_COLLISION');
});

test('removed operation that remains after import is reported as NEEDS_CLEANUP and does not update manifest', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const adapter = new FakeAdapter({ preserveStale: true });
  await executeSync({ config, services: config.services, adapter, fetchJson: async () => readJson('openapi-operation-added.json'), runtimeRoot, full: true, authorizedMutation: true });
  const file = path.join(runtimeRoot, 'example-project-sync-manifest.json');
  const before = fs.readFileSync(file, 'utf8');
  const result = await executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot, authorizedMutation: true });
  assert.equal(result.ok, false);
  assert.equal(result.services[0].status, 'NEEDS_CLEANUP');
  assert.ok(result.services[0].validation.extra.count > 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('existing matching environment is reused without mutation', async () => {
  const adapter = new FakeAdapter();
  const result = await ensureEnvironment(baseConfig(), 'dev', { projectId: '1001', branch: 'main' }, adapter);
  assert.equal(result.reused, true);
  assert.equal(adapter.environmentCreateCount, 0);
  assert.equal(adapter.environmentUpdateCount, 0);
});

test('missing environment is created and header references are configured when authorized', async () => {
  const adapter = new FakeAdapter({ environmentExists: false });
  const result = await ensureEnvironment(baseConfig(), 'dev', { projectId: '1001', branch: 'main' }, adapter, { authorizedMutation: true });
  assert.equal(result.created, true);
  assert.equal(adapter.environmentCreateCount, 1);
  assert.equal(adapter.environmentUpdateCount, 1);
});

test('strict config validation rejects unknown and wrong-type fields', () => {
  const unknown = baseConfig();
  unknown.project.accessToken = 'not-allowed';
  assert.throws(() => validateProjectConfig(unknown), (error) => error.code === 'MALFORMED_CONFIG');
  const wrongType = baseConfig();
  wrongType.services[0].aliases = 'catalog';
  assert.throws(() => validateProjectConfig(wrongType), (error) => error.code === 'MALFORMED_CONFIG');
});

test('malformed OpenAPI and broken internal refs fail before import', () => {
  const config = baseConfig();
  assert.throws(() => normalizeOpenApi({ paths: {} }, config.services[0], config.contract), (error) => error.code === 'MALFORMED_OPENAPI');
  const broken = baseSpec();
  broken.paths['/v1/items/{id}'].get.responses['200'].content['application/json'].schema.$ref = '#/components/schemas/Missing~1Schema';
  assert.throws(() => normalizeOpenApi(broken, config.services[0], config.contract), (error) => error.code === 'BROKEN_LOCAL_REF');
});

test('minimal OpenAPI validation rejects malformed versions, metadata and operations', () => {
  const config = baseConfig();
  const invalid = [
    { ...baseSpec(), openapi: 'garbage' },
    { openapi: 'garbage', info: {}, paths: { '/v1/x': { get: { responses: {} } } } },
    { swagger: '2.0', info: { title: 'Example', version: '1.0.0' }, paths: {} },
    { ...baseSpec(), info: { version: '1.0.0' } },
    { ...baseSpec(), info: { title: 'Example' } },
  ];
  const emptyResponses = baseSpec();
  emptyResponses.paths['/v1/items/{id}'].get.responses = {};
  invalid.push(emptyResponses);
  const badOperationId = baseSpec();
  badOperationId.paths['/v1/items/{id}'].get.operationId = 123;
  invalid.push(badOperationId);
  const badTags = baseSpec();
  badTags.paths['/v1/items/{id}'].get.tags = ['Items', 7];
  invalid.push(badTags);
  for (const spec of invalid) {
    assert.throws(() => normalizeOpenApi(spec, config.services[0], config.contract), (error) => error.code === 'MALFORMED_OPENAPI');
  }
});

test('external references fail while valid internal references pass', () => {
  const config = baseConfig();
  assert.doesNotThrow(() => normalizeOpenApi(baseSpec(), config.services[0], config.contract));
  for (const reference of ['https://example.invalid/common.yaml#/User', 'common.yaml#/User']) {
    const external = baseSpec();
    external.paths['/v1/items/{id}'].get.responses['200'].content['application/json'].schema.$ref = reference;
    assert.throws(() => normalizeOpenApi(external, config.services[0], config.contract), (error) => error.code === 'EXTERNAL_REF_UNSUPPORTED');
  }
});

test('operationId identity is service-local, including common create/page/list names', () => {
  const config = baseConfig();
  const serviceA = config.services[0];
  const serviceB = { ...structuredClone(serviceA), name: 'other-service', aliases: ['other'], namespace: 'other' };
  const makeSpec = (schemaName, prefix) => ({
    openapi: '3.0.3', info: { title: prefix, version: '1.0.0' },
    paths: Object.fromEntries(['create', 'page', 'list'].map((operationId) => [`/v1/${prefix}/${operationId}`, { get: { operationId, responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } } } } } }])),
    components: { schemas: { [schemaName]: { type: 'object' } } },
  });
  const entries = [
    { service: serviceA, spec: normalizeOpenApi(makeSpec('ServiceAResult', 'a'), serviceA, config.contract) },
    { service: serviceB, spec: normalizeOpenApi(makeSpec('ServiceBResult', 'b'), serviceB, config.contract) },
  ];
  assert.doesNotThrow(() => detectNamespaceCollisions(entries));

  const duplicate = makeSpec('ServiceAResult', 'a');
  duplicate.paths['/v1/a/second'] = { get: { operationId: 'create', responses: { 200: { description: 'OK' } } } };
  assert.throws(() => normalizeOpenApi(duplicate, serviceA, config.contract), (error) => error.code === 'NAMESPACE_COLLISION');
});

test('project-global schema collisions use manifest ownership and remote inventory', () => {
  const config = baseConfig();
  const entry = { service: config.services[0], snapshot: { schemaNames: ['Shared'] } };
  const remote = [{ id: '1', name: 'Shared', folderId: 0 }];
  assert.doesNotThrow(() => detectRemoteSchemaCollisions([entry], remote, { services: { 'catalog-service': { schemaNames: ['Shared'] } } }));
  const foreign = { service: { name: 'other-service' }, snapshot: { schemaNames: ['Shared'] } };
  assert.throws(
    () => detectRemoteSchemaCollisions([foreign], remote, { services: { 'catalog-service': { schemaNames: ['Shared'] } } }),
    (error) => error.code === 'NAMESPACE_COLLISION' && error.details.conflicts[0].owners.includes('catalog-service'),
  );
  assert.doesNotThrow(() => detectRemoteSchemaCollisions([foreign], remote, { services: {} }, { allowFullAdoption: true }));
});

test('missing or legacy manifest allows complete full sync to establish schema ownership', async (t) => {
  for (const lifecycle of ['missing', 'legacy']) {
    const runtimeRoot = tempRoot();
    t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
    const config = baseConfig();
    const file = path.join(runtimeRoot, 'example-project-sync-manifest.json');
    if (lifecycle === 'legacy') fs.writeFileSync(file, `${JSON.stringify({ schema: 'apifox-openapi-sync/v1', project: {}, services: {} })}\n`);
    const adapter = new FakeAdapter({ schemas: Object.keys(baseSpec().components.schemas).map((name, index) => ({ id: String(index + 1), name, folderId: 0 })) });
    const result = await executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(adapter.importCount, 1);
    const manifest = loadManifest(file, config, { allowMissing: false });
    assert.equal(manifest.schema, 'apifox-openapi-sync/v3');
    assert.deepEqual(manifest.services['catalog-service'].schemaNames, ['CreateItem', 'Error', 'Item']);
  }
});

test('valid v3 manifest keeps unmanaged schema fail-closed during complete full sync', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  await executeSync({ config, services: config.services, adapter: new FakeAdapter(), fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  const file = path.join(runtimeRoot, 'example-project-sync-manifest.json');
  const before = fs.readFileSync(file, 'utf8');
  const changed = baseSpec();
  changed.components.schemas.UnmanagedRemote = { type: 'object' };
  const adapter = new FakeAdapter({ schemas: Object.keys(changed.components.schemas).map((name, index) => ({ id: String(index + 1), name, folderId: 0 })) });
  await assert.rejects(
    () => executeSync({ config, services: config.services, adapter, fetchJson: async () => changed, runtimeRoot, full: true, authorizedMutation: true }),
    (error) => error.code === 'NAMESPACE_COLLISION' && error.details.conflicts.some((conflict) => conflict.name === 'UnmanagedRemote' && conflict.owners.includes('unmanaged-remote')),
  );
  assert.equal(adapter.importCount, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('remote schema owned by another service blocks import before mutation', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  await executeSync({ config, services: config.services, adapter: new FakeAdapter(), fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });

  const second = { ...structuredClone(config.services[0]), name: 'other-service', aliases: ['other'], namespace: 'other', source: { type: 'direct', url: 'https://example.invalid/other/openapi.json' } };
  config.services.push(second);
  const adapter = new FakeAdapter({ schemas: [{ id: '1', name: 'Item', folderId: 0 }] });
  await assert.rejects(
    () => executeSync({ config, services: [second], adapter, fetchJson: async () => baseSpec(), runtimeRoot, authorizedMutation: true }),
    (error) => error.code === 'NAMESPACE_COLLISION' && error.details.conflicts[0].owners.includes('catalog-service'),
  );
  assert.equal(adapter.importCount, 0);
});

test('partial service sync fetches only the selected Swagger source', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const second = { ...structuredClone(config.services[0]), name: 'other-service', aliases: ['other'], namespace: 'other', source: { type: 'direct', url: 'https://example.invalid/other/openapi.json' } };
  config.services.push(second);
  const fetched = [];
  const result = await executeSync({
    config, services: [config.services[0]], adapter: new FakeAdapter(), runtimeRoot, authorizedMutation: true,
    fetchJson: async (url) => { fetched.push(url); return baseSpec(); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fetched, [config.services[0].source.url]);
});

test('service scoping changes tags only and preserves source identities', () => {
  const config = baseConfig();
  const normalized = normalizeOpenApi(baseSpec(), config.services[0], config.contract);
  assert.equal(normalized.paths['/v1/items/{id}'].get.operationId, 'getItem');
  assert.ok(normalized.components.schemas.Item);
  assert.equal(normalized.components.schemas.catalog__Item, undefined);
  assert.deepEqual(normalized.paths['/v1/items/{id}'].get.tags, ['catalog/Items']);
});

test('cross-service schema collision fails fast without silent rewrite', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const second = structuredClone(config.services[0]);
  second.name = 'other-service';
  second.aliases = ['other'];
  second.namespace = 'other';
  config.services.push(second);
  await assert.rejects(
    () => executeDiff({ config, services: config.services, fetchJson: async () => baseSpec(), runtimeRoot }),
    (error) => error.code === 'NAMESPACE_COLLISION',
  );
});

test('sync without mutation authorization performs no external write', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  const adapter = new FakeAdapter();
  await assert.rejects(
    () => executeSync({ config, services: config.services, adapter, fetchJson: async () => baseSpec(), runtimeRoot }),
    (error) => error.code === 'AUTHORIZATION_REQUIRED',
  );
  assert.equal(adapter.importCount, 0);
});

test('project/config conflict, missing explicit workspace and duplicate branch fail closed', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    runCommand(['config-check', '--project', 'broker', '--config', path.join(FIXTURES, 'project-config.json')]),
    (error) => error.code === 'PROJECT_CONFIG_CONFLICT',
  );
  await assert.rejects(
    () => ensureProject(baseConfig(), new FakeAdapter(), { workspaceSettingsPath: path.join(root, 'missing.json') }),
    (error) => error.code === 'WORKSPACE_TARGET_MISSING',
  );
  await assert.rejects(
    () => ensureProject(baseConfig(), new FakeAdapter({ duplicateBranches: true })),
    (error) => error.code === 'BRANCH_AMBIGUOUS',
  );
});

test('manifest identity mismatch fails closed', async (t) => {
  const runtimeRoot = tempRoot();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  const config = baseConfig();
  await executeSync({ config, services: config.services, adapter: new FakeAdapter(), fetchJson: async () => baseSpec(), runtimeRoot, full: true, authorizedMutation: true });
  const changedTarget = structuredClone(config);
  changedTarget.project.name = 'Different API';
  assert.throws(
    () => loadManifest(path.join(runtimeRoot, 'example-project-sync-manifest.json'), changedTarget, { allowMissing: false }),
    (error) => error.code === 'MANIFEST_TARGET_MISMATCH',
  );
});

test('environment mutation must converge on read-back', async () => {
  const adapter = new FakeAdapter({ environmentUpdateNoop: true });
  adapter.environmentDetails.get('501').baseUrls.default = 'https://wrong.example.invalid';
  await assert.rejects(
    () => ensureEnvironment(baseConfig(), 'dev', { projectId: '1001', branch: 'main' }, adapter, { authorizedMutation: true }),
    (error) => error.code === 'ENVIRONMENT_CONVERGENCE_FAILED',
  );
});

test('read-only adapter does not expose mutation methods and cleans temp files on failure', () => {
  const root = tempRoot();
  const binary = path.join(root, 'failing-apifox');
  fs.writeFileSync(binary, '#!/bin/sh\nprintf malformed\nexit 3\n', { mode: 0o700 });
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('apifox-cli-output-')));
  const adapter = createReadOnlyApifoxAdapter({ binary });
  assert.equal(adapter.importOpenApi, undefined);
  assert.throws(() => adapter.endpointList('1001', 'main'), (error) => error.code === 'APIFOX_COMMAND_FAILED');
  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('apifox-cli-output-') && !before.has(name));
  assert.deepEqual(after, []);
  fs.rmSync(root, { recursive: true, force: true });
});
