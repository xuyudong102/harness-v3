#!/usr/bin/env node
/** Bounded Nacos 2.x reads. No resource mutation, shell, raw-config or credential output. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NacosError as NacosReadError, fail, object, identifier, sanitize, json, errorCode, openNacosSession, LIMITS } from './nacos-client.mjs';
export { NacosReadError, LIMITS };

const SCRIPT = fileURLToPath(import.meta.url);
const SCHEMA = 'harness-nacos-read/v1';
const COMMANDS = new Set(['health', 'config-search', 'config-get', 'config-diff', 'services']);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const normalNamespace = (v) => v === 'public' ? '' : v;

/** No YAML parser: opaque text cannot safely promote scalar lines into public key names. */
export function configSummary(content) {
  const keys = new Set();
  let format = 'opaque-text', keyBasis = 'unavailable';
  const add = (k) => { if (typeof k === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/.test(k)) keys.add(k); };
  try {
    const json = JSON.parse(content); format = 'json'; keyBasis = 'parsed-json';
    const visit = (v, depth = 0) => {
      if (depth > 32) return;
      if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
      else if (object(v)) for (const [k, x] of Object.entries(v)) { add(k); visit(x, depth + 1); }
    };
    visit(json);
  } catch { /* Withhold opaque-text keys rather than risk returning multiline scalar secrets. */ }
  return { bytes: Buffer.byteLength(content), lines: content.split(/\r?\n/).length, format,
    sha256: createHash('sha256').update(content).digest('hex'), keyBasis, keyCount: format === 'json' ? keys.size : null,
    keys: [...keys].sort().slice(0, 40), keysTruncated: keys.size > 40, valuesReturned: false };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) fail('INVALID_COMMAND');
  const common = ['platform', 'environment', 'namespace-id'];
  const specific = { health: [], 'config-search': ['data-id', 'group', 'page', 'limit'],
    'config-get': ['data-id', 'group'], 'config-diff': ['data-id', 'other-data-id', 'group', 'other-group'],
    services: ['service', 'page', 'limit', 'group'] };
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const match = rest[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match || ![...common, ...specific[command]].includes(match[1]) || Object.hasOwn(options, match[1])) fail('INVALID_ARGUMENT');
    const value = match[2] ?? rest[++i];
    if (typeof value !== 'string' || value.startsWith('--')) fail('INVALID_ARGUMENT');
    options[match[1]] = identifier(value);
  }
  if (!options.platform || !['DEV', 'SIT'].includes(options.environment)) fail('INVALID_TARGET');
  return { command, options };
}

export async function execute(command, options, { fetchImpl = globalThis.fetch, profileRoot, limits = LIMITS } = {}) {
  const metrics = { apiRequests: 0, responseBytes: 0 };
  const secrets = [];
  let target;
  const finish = (result) => {
    // Fixed protocol labels are not remote text (a username may itself be "nacos").
    const output = { schema: SCHEMA, ...result,
      ...(result.data ? { data: sanitize(result.data, secrets) } : {}),
      ...(target ? { target: sanitize(target, secrets) } : {}), metrics };
    if (Buffer.byteLength(JSON.stringify(output)) > LIMITS.outputBytes) return { schema: SCHEMA, ok: false, status: 'FAILED', error: { code: 'OUTPUT_LIMIT' }, metrics };
    return output;
  };
  try {
    // Public API and CLI share strict option validation; callers cannot bypass target checks.
    const parsed = parseArgs([command, ...Object.entries(options).flatMap(([k, v]) => ['--' + k, String(v)])]);
    options = parsed.options;
    const limit = options.limit === undefined ? 20 : Number(options.limit), page = options.page === undefined ? 1 : Number(options.page);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.results || !Number.isSafeInteger(page) || page < 1 || page > 1000) fail('INVALID_ARGUMENT');
    if (['config-get', 'config-diff'].includes(command)) identifier(options['data-id']);
    if (command === 'config-diff') identifier(options['other-data-id']);
    const session = await openNacosSession(options, { fetchImpl, profileRoot, limits, metrics, secrets, onTarget: (value) => { target = value; } });
    target = session.target;
    const { request } = session;
    const { namespaceId: namespace, group } = target;
    if (command === 'health') {
      const state = json(await request('/v1/console/server/state'));
      if (!object(state) || typeof state.version !== 'string' || !/^2\.\d+\.\d+(?:[-.\w]*)$/.test(state.version)) fail('UNSUPPORTED_OR_MALFORMED_SERVER');
      return finish({ ok: true, status: 'SUCCESS', data: { version: state.version, authenticated: true, namespaceConfirmed: true } });
    }
    if (command === 'config-search') {
      const body = json(await request('/v1/cs/configs', { search: 'blur', dataId: options['data-id'] || '*', group, tenant: namespace, pageNo: page, pageSize: limit }));
      if (!object(body) || !integer(body.totalCount) || !Array.isArray(body.pageItems) || body.pageItems.length > limit) fail('MALFORMED_RESPONSE');
      const items = body.pageItems.map((x) => {
        if (!object(x) || typeof x.dataId !== 'string' || x.group !== group || normalNamespace(x.tenant) !== normalNamespace(namespace)) fail('RESPONSE_TARGET_MISMATCH');
        return { dataId: identifier(x.dataId, 'MALFORMED_RESPONSE'), group, namespaceId: namespace };
      });
      return finish({ ok: true, status: 'SUCCESS', data: { total: body.totalCount, page, limit, items, hasMore: page * limit < body.totalCount } });
    }
    const get = (dataId, selectedGroup) => request('/v1/cs/configs', { dataId, group: selectedGroup, tenant: namespace });
    if (command === 'config-get') return finish({ ok: true, status: 'SUCCESS', data: { dataId: options['data-id'], summary: configSummary(await get(options['data-id'], group)) } });
    if (command === 'config-diff') {
      const otherGroup = identifier(options['other-group'] || group);
      const a = await get(options['data-id'], group), b = await get(options['other-data-id'], otherGroup);
      const aa = a.split(/\r?\n/), bb = b.split(/\r?\n/);
      let differentLinePositions = 0;
      for (let i = 0; i < Math.max(aa.length, bb.length); i++) if (aa[i] !== bb[i]) differentLinePositions++;
      return finish({ ok: true, status: 'SUCCESS', data: { left: { dataId: options['data-id'], group, summary: configSummary(a) }, right: { dataId: options['other-data-id'], group: otherGroup, summary: configSummary(b) }, identical: a === b, differentLinePositions, valuesReturned: false } });
    }
    if (options.service) {
      const body = json(await request('/v1/ns/service', { serviceName: options.service, groupName: group, namespaceId: namespace }));
      if (!object(body) || body.name !== options.service || body.groupName !== group
          || normalNamespace(body.namespaceId) !== normalNamespace(namespace) || !Array.isArray(body.clusters)) fail('RESPONSE_TARGET_MISMATCH');
      return finish({ ok: true, status: 'SUCCESS', data: { service: body.name, clusterCount: body.clusters.length } });
    }
    const body = json(await request('/v1/ns/service/list', { groupName: group, namespaceId: namespace, pageNo: page, pageSize: limit }));
    if (!object(body) || !integer(body.count) || !Array.isArray(body.doms) || body.doms.length > limit || body.doms.some((s) => typeof s !== 'string' || !s || s.length > 160)) fail('MALFORMED_RESPONSE');
    return finish({ ok: true, status: 'SUCCESS', data: { total: body.count, page, limit, services: body.doms, hasMore: page * limit < body.count } });
  } catch (error) {
    const code = errorCode(error, 'READ_FAILED');
    return finish({ ok: false, status: 'FAILED', error: { code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) } });
  }
}

export async function main(argv) {
  let result;
  try { const { command, options } = parseArgs(argv); result = await execute(command, options); }
  catch (error) { result = { schema: SCHEMA, ok: false, status: 'FAILED', error: { code: error instanceof NacosReadError ? error.code : 'READ_FAILED' } }; }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) await main(process.argv.slice(2));
