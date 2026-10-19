#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execute, parseArgs, LIMITS } from './nacos-read.mjs';

const username = 'CANARY_USER_PRIVATE', password = 'CANARY_PASSWORD_PRIVATE';
const token = 'CANARY_ACCESS_TOKEN_PRIVATE', secret = 'CANARY_CONFIG_SECRET_PRIVATE';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.c2lnbmF0dXJlY2FuYXJ5';
const fixture = { schema: 'harness-environment-profile/v1', platform: 'fixture', environment: 'DEV',
  runtime: { provider: 'kubernetes', cluster: 'fixture', context: 'fixture', namespace: 'k8s-distinct', kubeconfig: '/fixture/config', apiServer: 'https://fixture.invalid' }, services: {},
  nacos: { consoleUrl: 'http://nacos.invalid:8848/nacos', serverAddress: 'nacos.invalid:8848', namespaceId: 'nacos-distinct', group: 'GROUP' } };
const options = { platform: 'fixture', environment: 'DEV' };
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
function mock({ config = `password: ${secret}\nAuthorization: Bearer ${jwt}\nnormal:\n  timeout: 3\n`, override } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    url = new URL(url); calls.push({ url, init });
    const special = await override?.(url, init);
    if (special) return special;
    if (url.pathname.endsWith('/auth/login')) return response({ accessToken: token });
    assert(url.searchParams.get('accessToken') === token, 'token must stay in request memory (value withheld)');
    if (url.pathname.endsWith('/namespaces')) return response({ code: 200, data: [{ namespace: 'nacos-distinct' }] });
    if (url.pathname.endsWith('/server/state')) return response({ version: '2.3.1' });
    if (url.pathname.endsWith('/service/list')) return response({ count: 1, doms: ['fixture-service'] });
    if (url.pathname.endsWith('/ns/service')) return response({ name: 'fixture-service', namespaceId: 'nacos-distinct', groupName: 'GROUP', clusters: [] });
    if (url.searchParams.has('search')) return response({ totalCount: 1, pageItems: [{ tenant: 'nacos-distinct', group: 'GROUP', dataId: 'fixture.yaml', content: config }] });
    return response(url.searchParams.get('dataId') === 'other.yaml' ? config + 'changed: true\n' : config);
  };
  return { calls, fetchImpl };
}
async function isolated(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-nacos-test-'));
  const profileRoot = path.join(temp, 'profiles'); fs.mkdirSync(path.join(profileRoot, 'fixture'), { recursive: true });
  const authFile = path.join(temp, 'private.env');
  fs.writeFileSync(authFile, `NACOS_BASE_URL=${fixture.nacos.consoleUrl}\nNACOS_USERNAME='${username}'\nNACOS_PASSWORD="${password}"\n`, { mode: 0o600 });
  const profile = { ...fixture, nacos: { ...fixture.nacos, authFile } };
  const profileFile = path.join(profileRoot, 'fixture/dev.json');
  fs.writeFileSync(profileFile, JSON.stringify(profile), { mode: 0o600 });
  try { await fn({ temp, profileRoot, profile, profileFile, authFile }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
const privacy = (result) => {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  assert([username, password, token, secret, jwt].every((value) => !text.includes(value)), 'sensitive canary leaked (value withheld)');
};

test('five commands use one profile and only allowlisted GET or authentication POST', async () => isolated(async ({ profileRoot }) => {
  for (const [command, specific] of [['health', {}], ['config-search', {}], ['config-get', { 'data-id': 'fixture.yaml' }], ['config-diff', { 'data-id': 'fixture.yaml', 'other-data-id': 'other.yaml' }], ['services', {}]]) {
    const m = mock(); const result = await execute(command, { ...options, ...specific }, { ...m, profileRoot });
    assert.equal(result.ok, true); assert.equal(result.schema, 'harness-nacos-read/v1');
    assert.equal(result.target.namespaceId, 'nacos-distinct'); assert.equal(result.metrics.apiRequests, command === 'config-diff' ? 4 : 3);
    for (const { url, init } of m.calls) assert(init.method === 'GET' || (init.method === 'POST' && url.pathname === '/nacos/v1/auth/login'));
    privacy(result);
  }
}));
test('summary and search discard raw YAML, JSON values, comments, multiline secrets and remote content', async () => isolated(async ({ profileRoot }) => {
  for (const config of [`password: |\n  ${secret}: multiline scalar\n# ${secret}\nAuthorization: Bearer ${jwt}\ncount: 3\n`, JSON.stringify({ password: secret, nested: { access_token: token }, normal: 3 }), `normal=3\npassword=\\\n${secret}:continued-value\n`]) {
    const m = mock({ config });
    for (const command of ['config-get', 'config-search']) {
      const result = await execute(command, { ...options, ...(command === 'config-get' ? { 'data-id': 'fixture.yaml' } : {}) }, { ...m, profileRoot });
      assert.equal(result.ok, true); privacy(result); assert(!JSON.stringify(result).includes('normal=3'), 'raw config leaked');
    }
  }
}));
test('redaction covers secrets even in metadata and key names, without corrupting protocol labels', async () => isolated(async ({ profileRoot, profileFile, profile, authFile }) => {
  const commonPassword = 'nacos';
  fs.writeFileSync(authFile, `NACOS_BASE_URL=${fixture.nacos.consoleUrl}\nNACOS_USERNAME=nacos\nNACOS_PASSWORD=${commonPassword}\n`);
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  const m = mock({ config: `nacos: 1\n${token}: 2\n${jwt}: 3\n` });
  const result = await execute('config-get', { ...options, 'data-id': 'fixture.yaml' }, { ...m, profileRoot });
  assert.equal(result.schema, 'harness-nacos-read/v1'); assert.equal(result.status, 'SUCCESS');
  assert(!JSON.stringify(result.data).includes(token), 'credential metadata leaked');
  assert(!JSON.stringify(result.data).includes(jwt), 'JWT metadata leaked');
}));
test('diff returns bounded statistics without config values; repeated reads are identical', async () => isolated(async ({ profileRoot, authFile, profileFile }) => {
  const before = [fs.readFileSync(authFile), fs.readFileSync(profileFile)];
  const specific = { ...options, 'data-id': 'fixture.yaml', 'other-data-id': 'other.yaml' };
  const a = await execute('config-diff', specific, { ...mock(), profileRoot });
  const b = await execute('config-diff', specific, { ...mock(), profileRoot });
  assert.deepEqual(a, b); assert.equal(a.data.identical, false); assert(a.data.differentLinePositions > 0); privacy(a);
  assert(fs.readFileSync(authFile).equals(before[0]) && fs.readFileSync(profileFile).equals(before[1]), 'source config was modified');
}));
test('incomplete/unknown profile, namespace and auth-target mismatch fail before network', async () => isolated(async ({ profileRoot, profileFile, profile, authFile }) => {
  const m = mock();
  for (const environment of ['PROD', 'PRE', 'unknown', 'SIT']) assert.equal((await execute('health', { ...options, environment }, { ...m, profileRoot })).ok, false);
  assert.equal((await execute('health', { ...options, 'namespace-id': 'other' }, { ...m, profileRoot })).error.code, 'TARGET_MISMATCH');
  fs.writeFileSync(profileFile, JSON.stringify({ ...profile, nacos: {} }));
  assert.equal((await execute('health', options, { ...m, profileRoot })).error.code, 'NACOS_PROFILE_INCOMPLETE');
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  fs.writeFileSync(authFile, `NACOS_BASE_URL=http://other.invalid/nacos\nNACOS_USERNAME=${username}\nNACOS_PASSWORD=${password}`);
  assert.equal((await execute('health', options, { ...m, profileRoot })).error.code, 'AUTH_TARGET_MISMATCH');
  assert.equal(m.calls.length, 0);
}));
test('namespace inventory must confirm exact target; remote search mismatch fails', async () => isolated(async ({ profileRoot }) => {
  for (const [route, body, code] of [['/namespaces', { code: 200, data: [] }, 'NAMESPACE_NOT_FOUND'], ['/namespaces', {}, 'MALFORMED_RESPONSE'], ['/cs/configs', { totalCount: 1, pageItems: [{ dataId: 'x', tenant: 'foreign', group: 'GROUP' }] }, 'RESPONSE_TARGET_MISMATCH']]) {
    const m = mock({ override: (u) => u.pathname.endsWith(route) ? response(body) : null });
    const result = await execute('config-search', options, { ...m, profileRoot });
    assert.equal(result.ok, false); assert.equal(result.error.code, code); privacy(result);
  }
}));
test('404 config, 403 token and 500 missing-service remain distinct; no retry', async () => isolated(async ({ profileRoot }) => {
  for (const [command, route, status, code] of [['config-get', '/cs/configs', 404, 'CONFIG_NOT_FOUND'], ['config-get', '/cs/configs', 403, 'AUTHENTICATION_OR_PERMISSION_FAILED'], ['services', '/ns/service', 500, 'NACOS_SERVER_ERROR']]) {
    const m = mock({ override: (u) => u.pathname.endsWith(route) ? response(`Authorization: Bearer ${token} ${secret}`, status) : null });
    const result = await execute(command, { ...options, ...(command === 'services' ? { service: 'missing' } : { 'data-id': 'missing.yaml' }) }, { ...m, profileRoot });
    assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(result.metrics.apiRequests, 3); privacy(result);
  }
}));
test('malformed auth/service/list responses never become success', async () => isolated(async ({ profileRoot }) => {
  for (const [command, route, body] of [['health', '/auth/login', '{}'], ['services', '/service/list', '{}'], ['config-search', '/cs/configs', 'not-json'], ['health', '/server/state', '{}']]) {
    const result = await execute(command, options, { ...mock({ override: (u) => u.pathname.endsWith(route) ? response(body) : null }), profileRoot });
    assert.equal(result.ok, false); privacy(result);
  }
}));
test('network failure, timeout and response-size bounds suppress raw errors', async () => isolated(async ({ profileRoot }) => {
  const network = await execute('health', options, { profileRoot, fetchImpl: async () => { throw new Error(`${password} ${token}`); } });
  assert.equal(network.error.code, 'NETWORK_FAILURE'); privacy(network);
  const timed = await execute('health', options, { profileRoot, limits: { ...LIMITS, timeoutMs: 5 }, fetchImpl: (_u, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error(secret)), { once: true })) });
  assert.equal(timed.error.code, 'REQUEST_TIMEOUT'); privacy(timed);
  const large = await execute('config-get', { ...options, 'data-id': 'x' }, { profileRoot, ...mock({ config: secret.repeat(100) }), limits: { ...LIMITS, responseBytes: 200 } });
  assert.equal(large.error.code, 'RESPONSE_LIMIT'); privacy(large);
}));
test('strict CLI/public API rejects mutation, raw output, secret and unbounded arguments', async () => isolated(async ({ profileRoot }) => {
  for (const argv of [['publish'], ['health', '--platform', 'fixture', '--environment', 'DEV', '--token', token], ['config-get', '--platform', 'fixture', '--environment', 'DEV', '--raw'], ['health', '--platform', 'fixture', '--platform', 'other']]) {
    assert.throws(() => parseArgs(argv), (e) => e.message === e.code);
  }
  const m = mock();
  assert.equal((await execute('services', { ...options, limit: 9999 }, { ...m, profileRoot })).error.code, 'INVALID_ARGUMENT');
  assert.equal((await execute('config-get', options, { ...m, profileRoot })).error.code, 'INVALID_ARGUMENT');
  assert.equal(m.calls.length, 0);
}));
test('timeout covers response streaming, not just connection/headers', async () => isolated(async ({ profileRoot }) => {
  const m = mock({ override: (url, init) => {
    if (!url.pathname.endsWith('/cs/configs')) return null;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(secret));
      init.signal.addEventListener('abort', () => controller.error(new Error(secret)), { once: true });
    } }));
  } });
  const r = await execute('config-get', { ...options, 'data-id': 'fixture.yaml' }, { ...m, profileRoot, limits: { ...LIMITS, timeoutMs: 5 } });
  assert.equal(r.error.code, 'REQUEST_TIMEOUT'); privacy(r);
}));
test('server pagination violations and oversized metadata output fail closed', async () => isolated(async ({ profileRoot, profileFile, profile }) => {
  const oversizedPage = mock({ override: (url) => url.pathname.endsWith('/service/list') ? response({ count: 51, doms: Array(51).fill('fixture') }) : null });
  assert.equal((await execute('services', { ...options, limit: 50 }, { ...oversizedPage, profileRoot })).error.code, 'MALFORMED_RESPONSE');
  const group = 'g'.repeat(160); fs.writeFileSync(profileFile, JSON.stringify({ ...profile, nacos: { ...profile.nacos, group } }));
  const m = mock({ override: (url) => url.pathname.endsWith('/cs/configs') ? response({ totalCount: 50,
    pageItems: Array.from({ length: 50 }, (_, i) => ({ dataId: String(i).padEnd(160, 'x'), tenant: 'nacos-distinct', group })) }) : null });
  const r = await execute('config-search', { ...options, limit: 50 }, { ...m, profileRoot });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'OUTPUT_LIMIT'); assert(Buffer.byteLength(JSON.stringify(r)) < LIMITS.outputBytes); privacy(r);
}));
test('real CLI process is independent of Python, nonzero on HTTP error, and stdout/stderr are private', async () => isolated(async ({ profileRoot, profileFile, profile, authFile }) => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    calls.push({ method: req.method, path: new URL(req.url, 'http://local').pathname });
    const u = new URL(req.url, 'http://local'); let body;
    if (u.pathname.endsWith('/auth/login')) body = JSON.stringify({ accessToken: token });
    else if (u.pathname.endsWith('/namespaces')) body = JSON.stringify({ code: 200, data: [{ namespace: 'nacos-distinct' }] });
    else { res.statusCode = 500; body = `${password} Authorization: Bearer ${token} ${secret}`; }
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `127.0.0.1:${server.address().port}`, consoleUrl = `http://${address}/nacos`;
    fs.writeFileSync(profileFile, JSON.stringify({ ...profile, nacos: { ...profile.nacos, serverAddress: address, consoleUrl } }));
    fs.writeFileSync(authFile, `NACOS_BASE_URL=${consoleUrl}\nNACOS_USERNAME=${username}\nNACOS_PASSWORD=${password}`);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./nacos-read.mjs', import.meta.url)), 'services', '--platform', 'fixture', '--environment', 'DEV', '--service', 'missing'], { env: { ...process.env, HARNESS_PROFILE_ROOT: profileRoot } });
    let stdout = '', stderr = ''; child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 1); assert.equal(JSON.parse(stdout).error.code, 'NACOS_SERVER_ERROR'); privacy(stdout + stderr); assert.equal(stderr, '');
    assert.equal(calls.length, 3); assert(calls.every((x) => x.method === 'GET' || x.path === '/nacos/v1/auth/login'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}));
