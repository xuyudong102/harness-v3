#!/usr/bin/env node
/** Single authorized publish + read-back, not a planner/retry loop. No deletion. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fail, object, identifier, json, errorCode, openNacosSession, LIMITS } from './nacos-client.mjs';
import { editConfig, parseConfig } from './nacos-config-edit.mjs';

const SCRIPT = fileURLToPath(import.meta.url), SCHEMA = 'harness-nacos-config-write/v1';
const commands = { 'config-create': 'CREATE', 'config-update': 'UPDATE', 'config-append': 'APPEND' };
export const fingerprint = (s) => createHash('sha256').update(s).digest('hex');
const md5 = (s) => createHash('md5').update(s).digest('hex');
const sensitiveField = (parts) => /password|passwd|secret|token|authorization|credentials?|api.?key|access.?key|private.?key|cookie/i.test(parts.join('.'));
function rememberValue(parts, value, secrets, rawScalar) {
  if (typeof value === 'string' && value || sensitiveField(parts) && value !== null && value !== undefined) secrets.push(String(value));
  if (sensitiveField(parts) && typeof value === 'number' && rawScalar) secrets.push(rawScalar);
}
export function parseArgs(argv) {
  const [command, ...args] = argv, options = {};
  if (!Object.hasOwn(commands, command)) fail('INVALID_COMMAND');
  const allowed = ['platform', 'environment', 'namespace-id', 'group', 'data-id', 'type', 'reason', 'authorize', 'acknowledge-non-atomic',
    command === 'config-create' ? 'content-file' : 'changes-file'];
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m || !allowed.includes(m[1]) || Object.hasOwn(options, m[1])) fail('INVALID_ARGUMENT');
    if (['authorize', 'acknowledge-non-atomic'].includes(m[1])) {
      if (m[2] !== undefined) fail('INVALID_ARGUMENT'); options[m[1]] = true; continue;
    }
    const v = m[2] ?? args[++i];
    if (typeof v !== 'string' || v.startsWith('--')) fail('INVALID_ARGUMENT');
    options[m[1]] = v;
  }
  return { command, options };
}
function validate(command, o) {
  if (!Object.hasOwn(commands, command) || !object(o)) fail('INVALID_COMMAND');
  const parsed = parseArgs([command, ...Object.entries(o).flatMap(([k, v]) => ['authorize', 'acknowledge-non-atomic'].includes(k)
    ? v === true ? ['--' + k] : ['--' + k + '=' + String(v)] : ['--' + k + '=' + String(v)])]);
  o = parsed.options;
  if (o.authorize !== true) fail('MUTATION_AUTHORIZATION_REQUIRED');
  if (o['acknowledge-non-atomic'] !== true) fail('NON_ATOMIC_RISK_ACKNOWLEDGEMENT_REQUIRED');
  if (!o.platform || !['DEV', 'SIT'].includes(o.environment)) fail('INVALID_TARGET');
  if (typeof o['namespace-id'] !== 'string' || o['namespace-id'].length > 160 || /[\x00-\x1f\x7f]/.test(o['namespace-id'])) fail('EXPLICIT_NAMESPACE_REQUIRED');
  for (const key of ['group', 'data-id', 'reason']) identifier(o[key]);
  if (!['yaml', 'properties'].includes(o.type)) fail('UNSUPPORTED_CONTENT_TYPE');
  return o;
}
function privateSource(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) fail('INVALID_CONTENT_SOURCE');
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMITS.responseBytes || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) fail('UNSAFE_CONTENT_SOURCE');
    const bytes = fs.readFileSync(fd), text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) fail('INVALID_CONTENT_ENCODING');
    return text;
  } catch (e) { if (e.code && !e.code.startsWith('E')) throw e; fail('CONTENT_SOURCE_UNAVAILABLE'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function backupDirectory(root) {
  root = path.resolve(root);
  // No symlink traversal or in-repository backup storage, even for caller overrides.
  let at = path.parse(root).root;
  for (const component of root.slice(at.length).split(path.sep)) {
    at = path.join(at, component);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail('UNSAFE_BACKUP_PATH');
    if (fs.existsSync(path.join(at, '.git'))) fail('BACKUP_IN_REPOSITORY');
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(root);
  if (stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) fail('UNSAFE_BACKUP_PATH');
  const directory = path.join(root, randomUUID()); fs.mkdirSync(directory, { mode: 0o700 });
  return directory;
}
function saveRecord(directory, record) {
  const temporary = path.join(directory, 'record-' + randomUUID() + '.tmp'), file = path.join(directory, 'record.json');
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function metadata(raw, target, dataId, type) {
  const x = json(raw);
  if (x === null) return null;
  if (!object(x) || x.dataId !== dataId || x.group !== target.group || x.tenant !== target.namespaceId
      || typeof x.content !== 'string' || x.type !== type || typeof x.md5 !== 'string' || !/^[a-f0-9]{32}$/i.test(x.md5)
      || md5(x.content) !== x.md5.toLowerCase()) fail('MALFORMED_CONFIG_DETAIL');
  if (x.encryptedDataKey) fail('ENCRYPTED_CONFIG_UNSUPPORTED');
  const extra = {};
  for (const k of ['appName', 'configTags', 'desc', 'use', 'effect', 'schema']) {
    if (x[k] != null) { if (typeof x[k] !== 'string' || x[k].length > 65536) fail('MALFORMED_CONFIG_DETAIL'); extra[k === 'configTags' ? 'config_tags' : k] = x[k]; }
  }
  return { content: x.content, md5: x.md5.toLowerCase(), extra };
}

/** Combine every result, including prior writes when the larger task fails. Never infer success. */
export function changeDisclosure(results, taskResult = 'UNSPECIFIED') {
  return { heading: 'Nacos 配置变更记录', taskResult,
    entries: results.flatMap((r) => r.changeRecord ? [r.changeRecord] : []) };
}

export async function execute(command, options, dependencies = {}) {
  const metrics = { apiRequests: 0, responseBytes: 0 }, secrets = [];
  let session, record, directory;
  const finish = (ok, status, code) => {
    let changeRecord = record;
    if (changeRecord && Buffer.byteLength(JSON.stringify(changeRecord)) > 10000) changeRecord = {
      platform: changeRecord.platform, environment: changeRecord.environment, dataId: changeRecord.dataId,
      publishAttempted: changeRecord.publishAttempted, publication: changeRecord.publication,
      evidence: changeRecord.evidence, fieldsWithheld: 'OUTPUT_LIMIT_NO_PUBLICATION' };
    return { schema: SCHEMA, ok, status, ...(code ? { error: { code } } : {}),
      ...(changeRecord ? { changeRecord, disclosure: changeDisclosure([{ changeRecord }]) } : {}), metrics };
  };
  try {
    options = validate(command, options);
    const operation = commands[command];
    const source = privateSource(options[operation === 'CREATE' ? 'content-file' : 'changes-file']);
    let input;
    if (operation !== 'CREATE') {
      try { input = JSON.parse(source); } catch { fail('INVALID_CHANGES'); }
      // Withhold exact numeric credential lexemes too; JSON Number conversion may round decimals.
      for (const m of source.matchAll(/"value"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g)) secrets.push(m[1]);
    }
    // Secrets from explicit new field values are withheld even when repeated in a reason/identifier.
    for (const c of input?.changes || []) rememberValue(Array.isArray(c?.path) ? c.path : [], c?.value, secrets);
    session = await openNacosSession(options, { ...dependencies, metrics, secrets, writeAuthorized: true });
    const state = json(await session.request('/v1/console/server/state'));
    if (!object(state) || state.version !== '2.3.1') fail('UNVERIFIED_SERVER_WRITE');
    const target = session.target, dataId = options['data-id'];
    const params = { dataId, group: target.group, tenant: target.namespaceId };
    const get = async () => {
      try { return metadata(await session.request('/v1/cs/configs', { ...params, show: 'all' }), target, dataId, options.type); }
      catch (e) { if (e.code === 'CONFIG_NOT_FOUND') return null; throw e; }
    };
    const before = await get();
    if (operation === 'CREATE' && before) fail('CONFIG_ALREADY_EXISTS');
    if (operation !== 'CREATE' && !before) fail('CONFIG_NOT_FOUND');
    const edited = operation === 'CREATE' ? (() => {
      const doc = parseConfig(source, options.type);
      if (!doc.nodes.size) fail('EMPTY_CONFIG');
      return { content: source, addedFields: [...doc.nodes.values()].filter((n) => !n.branch).map((n) => n.parts), changedFields: [], deletedFields: [] };
    })() : editConfig(before.content, options.type, operation, input);
    for (const n of parseConfig(edited.content, options.type).nodes.values()) rememberValue(n.parts, n.value, secrets, n.rawScalar);
    if (before) for (const n of parseConfig(before.content, options.type).nodes.values()) rememberValue(n.parts, n.value, secrets, n.rawScalar);
    if (Buffer.byteLength(edited.content) > LIMITS.responseBytes) fail('CONTENT_LIMIT');
    if (operation === 'CREATE' && edited.addedFields.length > 64) fail('FIELD_LIMIT');
    const noChange = before?.content === edited.content;
    directory = backupDirectory(dependencies.backupRoot || path.join(os.homedir(), '.harness/config-changes'));
    if (before) fs.writeFileSync(path.join(directory, 'before.config'), before.content, { flag: 'wx', mode: 0o600 });
    // Only untrusted fields are redacted. Generated paths, hashes and protocol enums are not config values.
    record = { ...session.sanitize(target), dataId: session.sanitize(dataId), operation, type: options.type,
      reason: session.sanitize(options.reason), timestamp: new Date().toISOString(),
      addedFields: session.sanitize(edited.addedFields), changedFields: session.sanitize(edited.changedFields), deletedFields: [],
      beforeFingerprint: before ? fingerprint(before.content) : null, expectedFingerprint: fingerprint(edited.content),
      contentSource: operation === 'CREATE' ? 'private-content-file' : 'private-field-changes-file',
      publishAttempted: false, publication: 'NOT_ATTEMPTED', readBack: 'NOT_EXECUTED',
      applicationLoaded: 'UNVERIFIED', refreshOrRestart: 'NEEDS_ASSESSMENT_NO_AUTOMATIC_RESTART',
      concurrency: 'NON_ATOMIC_EXPLICITLY_ACKNOWLEDGED; RECHECK_TO_PUBLISH_RACE_CAN_OVERWRITE_CONCURRENT_CHANGES',
      backup: before ? path.join(directory, 'before.config') : null, evidence: path.join(directory, 'record.json') };
    if (Buffer.byteLength(JSON.stringify(record)) > 10000) fail('OUTPUT_LIMIT');
    saveRecord(directory, record);
    if (noChange) return finish(true, 'NO_CHANGE');
    const current = await get();
    if ((current?.content ?? null) !== (before?.content ?? null)
      || JSON.stringify(current?.extra) !== JSON.stringify(before?.extra)) fail('FINGERPRINT_DRIFT');
    // Pre-write durable receipt survives a process/task failure; publication is initially UNKNOWN.
    record.publishAttempted = true; record.publication = 'UNKNOWN'; saveRecord(directory, record);
    let publishError, acknowledged = false;
    try {
      const answer = await session.publish({ ...params, ...(before?.extra || {}), content: edited.content, type: options.type });
      acknowledged = answer.trim() === 'true';
      if (!acknowledged) publishError = 'PUBLISH_NOT_ACKNOWLEDGED';
    } catch (e) { publishError = errorCode(e, 'PUBLISH_FAILED'); }
    // Exactly one read-back, including ambiguous/timeout/error responses. NEVER retry the write.
    let after;
    try {
      after = await get();
      record.readBack = after?.content === edited.content ? 'MATCH' : 'MISMATCH';
      record.observedFingerprint = after ? fingerprint(after.content) : null;
    } catch (e) { record.readBack = 'UNAVAILABLE'; record.readBackError = errorCode(e, 'READ_FAILED'); }
    if (record.readBack === 'MATCH') {
      record.publication = acknowledged ? 'ACKNOWLEDGED_AND_VERIFIED' : 'OBSERVED_EXPECTED_CONTENT_ACK_UNAVAILABLE';
      record.publishError = publishError || null; saveRecord(directory, record);
      return finish(acknowledged, acknowledged ? 'SUCCESS' : 'NEEDS_HUMAN', publishError);
    }
    record.publication = acknowledged ? 'ACKNOWLEDGED_NOT_VERIFIED' : 'UNKNOWN';
    record.publishError = publishError || null; saveRecord(directory, record);
    return finish(false, record.readBack === 'UNAVAILABLE' ? 'NEEDS_HUMAN' : 'FAILED', publishError || 'POST_WRITE_MISMATCH');
  } catch (e) {
    if (record && directory) { record.error = errorCode(e, 'WRITE_FAILED'); try { saveRecord(directory, record); } catch { /* keep original UNKNOWN receipt; stdout still discloses */ } }
    return finish(false, record?.publishAttempted ? 'NEEDS_HUMAN' : 'FAILED', errorCode(e, 'WRITE_FAILED'));
  }
}
export async function main(argv) {
  let result;
  try { const { command, options } = parseArgs(argv); result = await execute(command, options); }
  catch (e) { result = { schema: SCHEMA, ok: false, status: 'FAILED', error: { code: errorCode(e, 'WRITE_FAILED') } }; }
  process.stdout.write(JSON.stringify(result) + '\n'); if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) await main(process.argv.slice(2));
