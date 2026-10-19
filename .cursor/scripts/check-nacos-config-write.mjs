#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execute, changeDisclosure, fingerprint } from './nacos-config-write.mjs';
import { editConfig, parseConfig } from './nacos-config-edit.mjs';
import { openNacosSession } from './nacos-client.mjs';

const password = 'CANARY_PRIVATE_PASSWORD', token = 'CANARY_PRIVATE_TOKEN', secret = 'CANARY_CONFIG_VALUE';
const username = 'CANARY_PRIVATE_USER';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const reply = (v, status = 200) => new Response(typeof v === 'string' ? v : JSON.stringify(v), { status });
const baseOptions = { platform: 'fixture', environment: 'DEV', 'namespace-id': 'nacos-only', group: 'GROUP', 'data-id': 'fixture.yaml', type: 'yaml', reason: 'authorized isolated test', authorize: true, 'acknowledge-non-atomic': true };
const baseContent = '# existing comment\nserver:\n  port: 8080 # retain port comment\n  name: "sample"\nsecurity:\n  password: "' + secret + '"\n';
async function isolated(fn) {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nacos-write-test-'));
  const profileRoot = path.join(temp, 'profiles'), backupRoot = path.join(temp, 'private-records');
  fs.mkdirSync(path.join(profileRoot, 'fixture'), { recursive: true });
  const authFile = path.join(temp, 'auth.env'), changesFile = path.join(temp, 'changes.json'), contentFile = path.join(temp, 'content.yaml');
  const profileFile = path.join(profileRoot, 'fixture/dev.json');
  const profile = { schema: 'harness-environment-profile/v1', platform: 'fixture', environment: 'DEV',
    runtime: { provider: 'kubernetes', cluster: 'fixture', context: 'fixture', namespace: 'k8s-different', kubeconfig: '/private/kube', apiServer: 'https://fixture.invalid' }, services: {},
    nacos: { consoleUrl: 'http://nacos.invalid:8848/nacos', serverAddress: 'nacos.invalid:8848', namespaceId: 'nacos-only', group: 'GROUP', authFile } };
  const write = (file, content) => fs.writeFileSync(file, content, { mode: 0o600 });
  write(profileFile, JSON.stringify(profile));
  write(authFile, `NACOS_BASE_URL=${profile.nacos.consoleUrl}\nNACOS_USERNAME=${username}\nNACOS_PASSWORD=${password}`);
  write(changesFile, JSON.stringify({ changes: [{ path: ['server', 'port'], value: 8081 }] })); write(contentFile, baseContent);
  const options = { ...baseOptions, 'changes-file': changesFile };
  try { await fn({ temp, profileRoot, backupRoot, profileFile, profile, authFile, changesFile, contentFile, options, write }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function mock({ content = baseContent, type = 'yaml', override, publish } = {}) {
  const calls = [], values = new Map(content === null ? [] : [['fixture.yaml', content]]);
  const state = { getCount: 0, publishCount: 0 };
  const detail = (id) => values.has(id) ? { dataId: id, group: 'GROUP', tenant: 'nacos-only', type,
    content: values.get(id), md5: md5(values.get(id)), encryptedDataKey: '', desc: 'keep description', appName: 'fixture-app', configTags: 'retain-tag' } : null;
  const fetchImpl = async (u, init) => {
    const url = new URL(u); calls.push({ url, init });
    const x = await override?.(url, init, { values, state, detail }); if (x) return x;
    if (url.pathname.endsWith('/auth/login')) return reply({ accessToken: token });
    assert(url.searchParams.get('accessToken') === token, 'request credential withheld');
    if (url.pathname.endsWith('/namespaces')) return reply({ code: 200, data: [{ namespace: 'nacos-only' }] });
    if (url.pathname.endsWith('/server/state')) return reply({ version: '2.3.1' });
    const id = url.searchParams.get('dataId');
    if (init.method === 'GET') { state.getCount++; return reply(detail(id)); }
    state.publishCount++;
    const p = new URLSearchParams(init.body);
    assert.equal(p.get('group'), 'GROUP'); assert.equal(p.get('tenant'), 'nacos-only');
    const effect = await publish?.(p, init, { values, state }); if (effect) return effect;
    values.set(p.get('dataId'), p.get('content')); return reply('true');
  };
  return { calls, values, state, fetchImpl };
}
const privacy = (v) => assert(![password, username, token, secret].some((s) => JSON.stringify(v).includes(s)), 'canary leaked; value withheld');
const run = (ctx, m, cmd = 'config-update', extra = {}) => execute(cmd, { ...ctx.options, ...extra }, { ...m, profileRoot: ctx.profileRoot, backupRoot: ctx.backupRoot });

test('CREATE succeeds only when absent; null/404 absence and later conflict do not overwrite', async () => isolated(async (c) => {
  const m = mock({ content: null });
  const create = { ...c.options, 'content-file': c.contentFile }; delete create['changes-file'];
  const r = await execute('config-create', create, { ...m, profileRoot: c.profileRoot, backupRoot: c.backupRoot });
  assert(r.ok); assert.equal(r.changeRecord.operation, 'CREATE'); assert.equal(r.changeRecord.backup, null); assert.equal(m.state.publishCount, 1);
  assert.equal(r.changeRecord.readBack, 'MATCH'); assert(m.values.get('fixture.yaml') === baseContent, 'expected config content mismatch; values withheld'); privacy(r);
  const conflict = await execute('config-create', create, { ...m, profileRoot: c.profileRoot, backupRoot: c.backupRoot });
  assert.equal(conflict.error.code, 'CONFIG_ALREADY_EXISTS'); assert.equal(m.state.publishCount, 1);
}));
test('APPEND adds multiple nested/dotted fields without rewriting comments or existing scalars', async () => isolated(async (c) => {
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['server', 'timeout'], value: 30 }, { path: ['broker.example'], value: true }, { path: ['new', 'nested', 'name'], value: 'hello' }] }));
  const m = mock(), r = await run(c, m, 'config-append'); assert(r.ok); assert.equal(r.changeRecord.addedFields.length, 3);
  const published = m.values.get('fixture.yaml');
  for (const line of baseContent.trimEnd().split('\n')) assert(published.includes(line), 'unrelated original line lost');
  assert(published.includes('  timeout: 30')); privacy(r);
  const repeat = await run(c, m, 'config-append'); assert.equal(repeat.error.code, 'FIELD_ALREADY_EXISTS'); assert.equal(m.state.publishCount, 1);
}));
test('UPDATE retains unrelated bytes/comments/metadata and makes private pre-write backup', async () => isolated(async (c) => {
  const m = mock(), r = await run(c, m); assert(r.ok); assert.equal(r.metrics.apiRequests, 7);
  assert(m.values.get('fixture.yaml') === baseContent.replace('8080 #', '8081 #'), 'unexpected content change; values withheld');
  assert(fs.readFileSync(r.changeRecord.backup, 'utf8') === baseContent, 'backup content mismatch; values withheld');
  assert.equal(fs.statSync(r.changeRecord.backup).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(r.changeRecord.backup)).mode & 0o777, 0o700);
  const receipt = JSON.parse(fs.readFileSync(r.changeRecord.evidence)); privacy(receipt);
  assert.equal(receipt.readBack, 'MATCH'); assert.deepEqual(receipt.deletedFields, []);
  const call = m.calls.find((x) => x.init.method === 'POST' && x.url.pathname.endsWith('/cs/configs'));
  assert.equal(call.init.headers.casMd5, undefined, 'never pretend unverified HTTP CAS is reliable');
  assert.equal(new URLSearchParams(call.init.body).get('desc'), 'keep description');
  assert.equal(new URLSearchParams(call.init.body).get('config_tags'), 'retain-tag');
}));
test('Properties editing is structural, preserves comments/delimiters and rejects continuations/escapes', () => {
  const s = '# comment\r\na.b : old\r\nuntouched=yes\r\n';
  const a = editConfig(s, 'properties', 'UPDATE', { changes: [{ path: ['a.b'], value: 'new' }] });
  assert.equal(a.content, s.replace('old', 'new'));
  const b = editConfig(a.content, 'properties', 'APPEND', { changes: [{ path: ['another'], value: '42' }] });
  assert.equal(b.content, a.content + 'another=42\r\n');
  for (const unsafe of ['key=value\\\ncontinued\n', 'k=\\u0041\n', 'k=1\nk:2\n']) assert.throws(() => parseConfig(unsafe, 'properties'));
});
test('Unsupported YAML structures, duplicate/coercive keys, ambiguous scalar and parent overwrite fail closed', () => {
  for (const s of ['a: [1, 2]\n', 'a:\n  - item\n', 'a: |\n  text\n', 'a: &x 1\nb: *x\n', 'a: yes\n', 'a: 01\n', 'a: 1\na: 2\n', 'a: !!str x\n', '---\na: 1\n', 'a:\n', 'a: 1\n  b: 2\n']) {
    assert.throws(() => parseConfig(s, 'yaml'), 'unsupported source must not publish');
  }
  assert.throws(() => editConfig('a: 1\n', 'yaml', 'APPEND', { changes: [{ path: ['a', 'b'], value: 2 }] }));
  assert.throws(() => editConfig('a: 1\n', 'yaml', 'UPDATE', { changes: [{ path: ['a'], value: {} }] }));
});
test('quoted #, single quotes, CRLF, numeric/string types and exact paths are retained', () => {
  const s = 'a: "text # value" # keep\r\nb: \'it\'\'s\'\r\ncount: 3\r\n';
  assert.equal(parseConfig(s, 'yaml').nodes.get('["a"]').value, 'text # value');
  const r = editConfig(s, 'yaml', 'UPDATE', { changes: [{ path: ['count'], value: '3' }] });
  assert.equal(r.content, s.replace('count: 3', 'count: "3"'));
});
test('Unicode line separators cannot be normalized into a different field value during YAML publication', async () => isolated(async (c) => {
  for (const separator of ['\u0085', '\u2028', '\u2029']) {
    const value = 'left' + separator + 'right';
    assert.throws(() => parseConfig('label: "' + value + '"\n', 'yaml'));
    for (const [command, field] of [['config-update', ['server', 'name']], ['config-append', ['added']]]) {
      c.write(c.changesFile, JSON.stringify({ changes: [{ path: field, value }] }));
      const m = mock(), r = await run(c, m, command); assert(!r.ok); assert.equal(m.state.publishCount, 0);
    }
    c.write(c.contentFile, 'label: "' + value + '"\n');
    const create = { ...c.options, 'content-file': c.contentFile }; delete create['changes-file'];
    const m = mock({ content: null }), r = await execute('config-create', create, { ...m, profileRoot: c.profileRoot, backupRoot: c.backupRoot });
    assert(!r.ok); assert.equal(m.state.publishCount, 0);
    assert.throws(() => editConfig('label: "old"\n', 'yaml', 'UPDATE', { changes: [{ path: ['label'], value }] }));
  }
}));
test('fingerprint drift between reads aborts before publish and retains receipt/backup', async () => isolated(async (c) => {
  let reads = 0;
  const m = mock({ override: (url, init, { values }) => {
    if (url.pathname.endsWith('/cs/configs') && init.method === 'GET' && ++reads === 2) values.set('fixture.yaml', baseContent + 'foreign: 1\n');
  } });
  const r = await run(c, m); assert.equal(r.error.code, 'FINGERPRINT_DRIFT'); assert.equal(m.state.publishCount, 0);
  assert.equal(r.changeRecord.publishAttempted, false); assert(fs.existsSync(r.changeRecord.backup)); privacy(r);
}));
test('concurrent creation before recheck aborts; non-atomic risk is explicit and never falsely called CAS', async () => isolated(async (c) => {
  let reads = 0;
  const cm = mock({ content: null, override: (u, init, { values }) => {
    if (u.pathname.endsWith('/cs/configs') && init.method === 'GET' && ++reads === 2) values.set('fixture.yaml', 'foreign: 1\n');
  } });
  const o = { ...c.options, 'content-file': c.contentFile }; delete o['changes-file'];
  const cr = await execute('config-create', o, { ...cm, profileRoot: c.profileRoot, backupRoot: c.backupRoot });
  assert.equal(cr.error.code, 'FINGERPRINT_DRIFT'); assert.equal(cm.state.publishCount, 0);
  assert.equal(cm.values.get('fixture.yaml'), 'foreign: 1\n');
  assert(cr.changeRecord.concurrency.includes('CAN_OVERWRITE_CONCURRENT_CHANGES'));
  const denied = mock(), r = await run(c, denied, 'config-update', { 'acknowledge-non-atomic': false });
  assert(!r.ok); assert.equal(denied.calls.length, 0);
}));
test('uncertain publish reads back once without repeating; matching content does not fabricate acknowledgement', async () => isolated(async (c) => {
  const m = mock({ publish: (p, _init, { values }) => { values.set(p.get('dataId'), p.get('content')); throw new Error(password); } });
  const r = await run(c, m); assert.equal(m.state.publishCount, 1); assert.equal(r.status, 'NEEDS_HUMAN'); assert.equal(r.ok, false);
  assert.equal(r.changeRecord.readBack, 'MATCH'); assert.equal(r.changeRecord.publication, 'OBSERVED_EXPECTED_CONTENT_ACK_UNAVAILABLE'); privacy(r);
}));
test('acknowledged publish with mismatched or unavailable read-back fails and keeps change disclosure', async () => isolated(async (c) => {
  for (const unavailable of [false, true]) {
    let posted = false;
    const m = mock({ publish: () => { posted = true; return reply('true'); }, override: (u, init) => {
      if (unavailable && posted && init.method === 'GET' && u.pathname.endsWith('/cs/configs')) return reply(token, 500);
    } });
    const r = await run(c, m); assert(!r.ok); assert.equal(m.state.publishCount, 1);
    assert.equal(r.changeRecord.publication, 'ACKNOWLEDGED_NOT_VERIFIED'); assert.equal(r.disclosure.entries.length, 1); privacy(r);
  }
}));
test('authorization absent/false/string, PRE/PROD, namespace/group/profile/auth mismatch reject without resource mutation', async () => isolated(async (c) => {
  for (const extra of [{ authorize: false }, { authorize: 'true' }, { environment: 'PRE' }, { environment: 'PROD' }, { environment: 'SIT' }, { 'namespace-id': 'other' }, { group: 'OTHER' }]) {
    const m = mock(), r = await run(c, m, 'config-update', extra); assert(!r.ok); assert.equal(m.state.publishCount, 0); assert.equal(m.calls.length, 0); privacy(r);
  }
  c.write(c.profileFile, JSON.stringify({ ...c.profile, platform: 'foreign' }));
  const m = mock(); assert.equal((await run(c, m)).error.code, 'PROFILE_TARGET_MISMATCH'); assert.equal(m.calls.length, 0);
}));
test('unauthenticated/permission failure, missing config, malformed detail/type, unsupported server cannot publish', async () => isolated(async (c) => {
  for (const [route, value, status] of [['/auth/login', password, 403], ['/cs/configs', {}, 200], ['/cs/configs', null, 200], ['/server/state', { version: '3.0.0' }, 200]]) {
    const m = mock({ override: (u) => u.pathname.endsWith(route) ? reply(value, status) : null });
    const r = await run(c, m); assert(!r.ok); assert.equal(m.state.publishCount, 0); privacy(r);
  }
}));
test('read-only transport cannot publish and has no DELETE route', async () => isolated(async (c) => {
  const m = mock(), session = await openNacosSession(baseOptions, { ...m, profileRoot: c.profileRoot });
  await assert.rejects(() => session.publish({ dataId: 'fixture.yaml', group: 'GROUP', tenant: 'nacos-only', content: 'x' }, md5(baseContent)));
  assert.equal(m.state.publishCount, 0);
}));
test('input/backup symlink escapes, permissive files and repository backup locations refuse publication', async () => isolated(async (c) => {
  fs.chmodSync(c.changesFile, 0o644); const m = mock(); assert(!(await run(c, m)).ok); assert.equal(m.calls.length, 0);
  fs.chmodSync(c.changesFile, 0o600); const symlink = path.join(c.temp, 'linked.json'); fs.symlinkSync(c.changesFile, symlink);
  assert(!(await run(c, m, 'config-update', { 'changes-file': symlink })).ok);
  const escaped = path.join(c.temp, 'escaped'); fs.symlinkSync(c.temp, escaped);
  const r = await execute('config-update', c.options, { ...m, profileRoot: c.profileRoot, backupRoot: path.join(escaped, 'records') });
  assert.equal(r.error.code, 'UNSAFE_BACKUP_PATH'); assert.equal(m.state.publishCount, 0);
  const repo = path.join(c.temp, 'repo'); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, '.git'));
  const rr = await execute('config-update', c.options, { ...mock(), profileRoot: c.profileRoot, backupRoot: path.join(repo, 'records') });
  assert.equal(rr.error.code, 'BACKUP_IN_REPOSITORY');
}));
test('secret values never enter stdout/receipt/Diff; backups alone retain before content privately', async () => isolated(async (c) => {
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['security', 'password'], value: 'NEW_CANARY_PRIVATE_SECRET' }] }));
  const m = mock(), r = await run(c, m, 'config-update', { reason: 'replace NEW_CANARY_PRIVATE_SECRET' }); assert(r.ok); privacy(r);
  const receipt = fs.readFileSync(r.changeRecord.evidence, 'utf8'); privacy(receipt);
  assert(!JSON.stringify(r).includes('NEW_CANARY_PRIVATE_SECRET') && !receipt.includes('NEW_CANARY_PRIVATE_SECRET'), 'new secret leaked; withheld');
  assert.deepEqual(r.changeRecord.changedFields, [['security', 'password']]); assert(!receipt.includes(baseContent), 'raw content leaked into evidence');
}));
test('numeric sensitive old/new values are withheld from free-text reason and identifiers', async () => isolated(async (c) => {
  const oldPin = 784123, newPin = 945672;
  const m = mock({ content: 'security:\n  password: ' + oldPin + '\n' });
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['security', 'password'], value: newPin }] }));
  const r = await run(c, m, 'config-update', { reason: 'rotate ' + oldPin + ' to ' + newPin }); assert(r.ok);
  const text = JSON.stringify(r) + fs.readFileSync(r.changeRecord.evidence, 'utf8');
  assert(!text.includes(String(oldPin)) && !text.includes(String(newPin)), 'numeric credential leaked; values withheld');
}));
test('ambiguous YAML source and appended keys are rejected before publication', async () => isolated(async (c) => {
  for (const key of ['true', 'false', 'null', 'yes', 'NO', 'on', 'off', 'Y', 'n']) {
    assert.throws(() => parseConfig(key + ': 2\n', 'yaml'));
    c.write(c.changesFile, JSON.stringify({ changes: [{ path: [key], value: 2 }] }));
    const m = mock(), r = await run(c, m, 'config-append'); assert(!r.ok); assert.equal(m.state.publishCount, 0);
  }
}));
test('unsafe integer credentials fail closed; exact decimal sensitive lexemes are redacted', async () => isolated(async (c) => {
  const large = '9007199254740993', decimal = '0.123456789012345678901';
  const old = mock({ content: 'security:\n  password: ' + large + '\n' });
  const a = await run(c, old, 'config-update', { reason: 'rotate ' + large }); assert(!a.ok); assert.equal(old.state.publishCount, 0);
  c.write(c.changesFile, '{"changes":[{"path":["security","password"],"value":' + large + '}]}');
  const newer = mock(), b = await run(c, newer); assert(!b.ok); assert.equal(newer.state.publishCount, 0);
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['added'], value: true }] }));
  const d = await run(c, mock({ content: 'security:\n  password: ' + decimal + '\n' }), 'config-append', { reason: 'rotate ' + decimal });
  assert(d.ok); assert(!JSON.stringify(d).includes(decimal) && !fs.readFileSync(d.changeRecord.evidence,'utf8').includes(decimal), 'exact decimal credential leaked; withheld');
}));
test('ordinary config values cannot corrupt generated receipt/backup paths or protocol enums', async () => isolated(async (c) => {
  for (const value of ['record', 'config', 'private', 'SUCCESS', 'UPDATE']) {
    const m = mock({ content: 'ordinary: "' + value + '"\nserver:\n  port: 8080\n' });
    const r = await run(c, m); assert(r.ok); assert.equal(r.changeRecord.operation, 'UPDATE');
    assert(fs.existsSync(r.changeRecord.backup) && fs.existsSync(r.changeRecord.evidence), 'generated path must remain usable');
    const stored = JSON.parse(fs.readFileSync(r.changeRecord.evidence, 'utf8'));
    assert.equal(stored.evidence, r.changeRecord.evidence); assert.equal(stored.backup, r.changeRecord.backup);
  }
}));
test('numeric secret prefix redaction cannot leave a credential suffix in reason', async () => isolated(async (c) => {
  const decimal = '0.100000000000000001';
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['added'], value: true }] }));
  const r = await run(c, mock({ content: 'security:\n  password: ' + decimal + '\n' }), 'config-append', { reason: 'rotate ' + decimal });
  assert(r.ok); assert.equal(r.changeRecord.reason, 'rotate [REDACTED]');
  assert.equal(JSON.parse(fs.readFileSync(r.changeRecord.evidence)).reason, 'rotate [REDACTED]');
}));
test('all multi-Data-ID records survive a later task failure; failed attempt is not called success', async () => isolated(async (c) => {
  const m = mock(); m.values.set('second.yaml', baseContent);
  const a = await run(c, m), b = await run(c, m, 'config-update', { 'data-id': 'second.yaml' });
  const third = await run(c, mock({ publish: () => reply('false') }));
  const d = changeDisclosure([a, b, third], 'FAILED');
  assert.equal(d.heading, 'Nacos 配置变更记录'); assert.equal(d.taskResult, 'FAILED'); assert.equal(d.entries.length, 3);
  assert(d.entries.every((x) => x.evidence && x.operation && x.group && x.namespaceId)); assert(!third.ok); privacy(d);
}));
test('no-op UPDATE publishes nothing and does not claim a remote change', async () => isolated(async (c) => {
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['server', 'port'], value: 8080 }] }));
  const m = mock(), r = await run(c, m); assert.equal(r.status, 'NO_CHANGE'); assert.equal(m.state.publishCount, 0);
  assert.equal(r.changeRecord.publishAttempted, false); assert.equal(r.changeRecord.publication, 'NOT_ATTEMPTED');
}));
test('invalid DELETE/unknown flags, overlapping changes and high-volume output cannot cause a publish', async () => isolated(async (c) => {
  const m = mock(); assert(!(await run(c, m, 'config-delete')).ok); assert(!(await run(c, m, 'config-update', { url: 'http://other' })).ok);
  c.write(c.changesFile, JSON.stringify({ changes: [{ path: ['server'], value: 1 }, { path: ['server', 'port'], value: 2 }] }));
  assert(!(await run(c, m)).ok); assert.equal(m.state.publishCount, 0);
  c.write(c.changesFile, JSON.stringify({ changes: Array.from({ length: 32 }, (_, i) => ({ path: Array.from({ length: 16 }, (_, j) => String.fromCharCode(97 + j) + String(i).padEnd(90, 'x')), value: i })) }));
  const r = await run(c, m, 'config-append'); assert.equal(r.error.code, 'OUTPUT_LIMIT'); assert.equal(m.state.publishCount, 0);
  assert(Buffer.byteLength(JSON.stringify(r)) < 16384);
}));
test('actual CLI against isolated HTTP service exits nonzero on ambiguous publish and does not leak secrets', async () => isolated(async (c) => {
  const m = mock({ publish: () => reply('false') });
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const b of req) body += b;
    const result = await m.fetchImpl(new URL(req.url, 'http://local'), { method: req.method, headers: req.headers, body });
    res.statusCode = result.status; res.end(await result.text());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const address = '127.0.0.1:' + server.address().port, consoleUrl = 'http://' + address + '/nacos';
    c.write(c.profileFile, JSON.stringify({ ...c.profile, nacos: { ...c.profile.nacos, serverAddress: address, consoleUrl } }));
    c.write(c.authFile, `NACOS_BASE_URL=${consoleUrl}\nNACOS_USERNAME=${username}\nNACOS_PASSWORD=${password}`);
    const child = spawn(process.execPath, [new URL('./nacos-config-write.mjs', import.meta.url).pathname, 'config-update',
      ...Object.entries(c.options).flatMap(([k, v]) => ['authorize', 'acknowledge-non-atomic'].includes(k) ? ['--' + k] : ['--' + k, v])],
      { env: { ...process.env, HARNESS_PROFILE_ROOT: c.profileRoot, HOME: c.temp } });
    let stdout = '', stderr = ''; child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 1); assert.equal(stderr, ''); privacy(stdout); assert(!JSON.parse(stdout).ok); assert.equal(m.state.publishCount, 1);
  } finally { await new Promise((r) => server.close(r)); }
}));
