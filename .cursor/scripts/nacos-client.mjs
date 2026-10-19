/** Shared bounded Nacos transport. Read sessions cannot publish. No shell or persistence. */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironmentProfile, localPath } from './environment-profile.mjs';
import { redactRuntime } from './kubernetes-read.mjs';

export const LIMITS = Object.freeze({ timeoutMs: 8000, responseBytes: 1024 * 1024, outputBytes: 16384, results: 50, requests: 4 });
export class NacosError extends Error {
  constructor(code, httpStatus) { super(code); this.code = code; this.httpStatus = httpStatus; }
}
export const fail = (code, status) => { throw new NacosError(code, status); };
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function identifier(v, code = 'INVALID_ARGUMENT') {
  if (typeof v !== 'string' || !v.trim() || v.length > 160 || /[\x00-\x1f\x7f]/.test(v)) fail(code);
  return v;
}
function credentials(file) {
  const resolved = localPath(identifier(file, 'NACOS_PROFILE_INCOMPLETE'));
  if (!path.isAbsolute(resolved)) fail('NACOS_PROFILE_INCOMPLETE');
  let text;
  try {
    if (fs.statSync(resolved).size > 65536) fail('AUTH_FILE_MALFORMED');
    text = fs.readFileSync(resolved, 'utf8');
  } catch { fail('AUTH_FILE_UNAVAILABLE'); }
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?(NACOS_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !['NACOS_BASE_URL', 'NACOS_USERNAME', 'NACOS_PASSWORD'].includes(m[1])) continue;
    if (Object.hasOwn(result, m[1])) fail('AUTH_FILE_MALFORMED');
    let value = m[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.at(-1) !== value[0]) fail('AUTH_FILE_MALFORMED');
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '').trim();
    if (!value || /[\r\n\x00]/.test(value)) fail('AUTH_FILE_MALFORMED');
    result[m[1]] = value;
  }
  if (!result.NACOS_BASE_URL || !result.NACOS_USERNAME || !result.NACOS_PASSWORD) fail('AUTH_FILE_MALFORMED');
  return result;
}
function baseUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('NACOS_PROFILE_INCOMPLETE'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('TARGET_MISMATCH');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}
export function sanitize(value, secrets = []) {
  if (typeof value === 'string') {
    // Longest first: a rounded numeric/string prefix must not expose a secret's suffix.
    for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) value = value.split(secret).join('[REDACTED]');
    return redactRuntime(value);
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, secrets));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, secrets)]));
  return value;
}
export const json = (text) => { try { return JSON.parse(text); } catch { fail('MALFORMED_RESPONSE'); } };
export const errorCode = (e, fallback) => e instanceof NacosError ? e.code
  : ['INVALID_TARGET', 'PROFILE_TARGET_MISMATCH', 'INVALID_PROFILE', 'SECRET_IN_PROFILE', 'NEEDS_HUMAN'].includes(e.code) ? e.code : fallback;

export async function openNacosSession(options, { fetchImpl = globalThis.fetch, profileRoot, limits = LIMITS,
  metrics = { apiRequests: 0, responseBytes: 0 }, secrets = [], writeAuthorized = false, onTarget } = {}) {
  const { profile } = loadEnvironmentProfile(options.platform, options.environment, { root: profileRoot });
  const n = profile.nacos;
  if (!object(n) || typeof n.namespaceId !== 'string' || !n.group || !n.serverAddress || !n.consoleUrl || !n.authFile) fail('NACOS_PROFILE_INCOMPLETE');
  const namespace = n.namespaceId;
  if (options['namespace-id'] !== undefined && options['namespace-id'] !== namespace) fail('TARGET_MISMATCH');
  const group = identifier(options.group || n.group, 'NACOS_PROFILE_INCOMPLETE');
  if (writeAuthorized && group !== n.group) fail('TARGET_MISMATCH');
  const base = baseUrl(n.consoleUrl);
  if (base.host !== n.serverAddress) fail('TARGET_MISMATCH');
  const auth = credentials(n.authFile);
  secrets.push(auth.NACOS_USERNAME, auth.NACOS_PASSWORD);
  if (baseUrl(auth.NACOS_BASE_URL).href !== base.href) fail('AUTH_TARGET_MISMATCH');
  const target = { platform: profile.platform, environment: profile.environment, server: n.serverAddress, namespaceId: namespace, group };
  onTarget?.(target);
  const reads = new Set(['/v1/console/server/state', '/v1/console/namespaces', '/v1/cs/configs', '/v1/ns/service/list', '/v1/ns/service']);
  let token;
  async function request(route, params = {}, login = false, publish = false, casMd5) {
    if (publish ? !writeAuthorized || login || route !== '/v1/cs/configs' || params.tenant !== namespace || params.group !== group
      : login ? route !== '/v1/auth/login' : !reads.has(route)) fail('READ_ONLY_VIOLATION');
    if (++metrics.apiRequests > (writeAuthorized ? 7 : LIMITS.requests)) fail('REQUEST_LIMIT');
    const url = new URL(base.href.replace(/\/$/, '') + route);
    if (!login && !publish) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    if (token && !login) url.searchParams.set('accessToken', token);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    let response, content;
    try {
      response = await fetchImpl(url, { method: login || publish ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        ...(login || publish ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(publish && casMd5 ? { casMd5 } : {}) },
          body: new URLSearchParams(login ? { username: auth.NACOS_USERNAME, password: auth.NACOS_PASSWORD } : params) } : {}) });
      if (Number(response.headers.get('content-length')) > limits.responseBytes) fail('RESPONSE_LIMIT');
      const parts = []; let size = 0;
      for await (const chunk of response.body || []) {
        size += chunk.byteLength; metrics.responseBytes += chunk.byteLength;
        if (size > limits.responseBytes) fail('RESPONSE_LIMIT');
        parts.push(Buffer.from(chunk));
      }
      content = Buffer.concat(parts).toString('utf8');
    } catch (e) {
      if (e instanceof NacosError) throw e;
      fail(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_FAILURE');
    } finally { clearTimeout(timer); controller.abort(); }
    if (response.status === 401 || response.status === 403) fail('AUTHENTICATION_OR_PERMISSION_FAILED', response.status);
    if (response.status === 404) fail(route === '/v1/cs/configs' && params.search === undefined ? 'CONFIG_NOT_FOUND' : 'RESOURCE_NOT_FOUND', 404);
    if (response.status >= 500) fail('NACOS_SERVER_ERROR', response.status);
    if (response.status < 200 || response.status >= 300) fail('NACOS_HTTP_ERROR', response.status);
    return content;
  }
  const loggedIn = json(await request('/v1/auth/login', {}, true));
  if (!object(loggedIn) || typeof loggedIn.accessToken !== 'string' || !loggedIn.accessToken || loggedIn.accessToken.length > 8192) fail('AUTHENTICATION_FAILED');
  token = loggedIn.accessToken; secrets.push(token);
  const namespaces = json(await request('/v1/console/namespaces'));
  const normal = (v) => v === 'public' ? '' : v;
  if (!object(namespaces) || !Array.isArray(namespaces.data) || namespaces.code !== 200 || namespaces.data.some((x) => !object(x) || typeof x.namespace !== 'string')) fail('MALFORMED_RESPONSE');
  if (!namespaces.data.some((x) => normal(x.namespace) === normal(namespace))) fail('NAMESPACE_NOT_FOUND');
  return { target, request, sanitize: (v) => sanitize(v, secrets),
    publish: (params, casMd5) => request('/v1/cs/configs', params, false, true, casMd5) };
}
