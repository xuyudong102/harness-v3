#!/usr/bin/env node
/** Generic deterministic OpenAPI <-> Apifox capability. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApifoxProfile } from '../../../scripts/environment-profile.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SKILL_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const CONFIG_ROOT = path.join(SKILL_ROOT, 'references', 'projects');
const MANIFEST_SCHEMA = 'apifox-openapi-sync/v3';
const CONFIG_SCHEMA = 'apifox-openapi-project/v1';
const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'];
const SECRET_PATTERN = /(bearer\s+)[a-z0-9._~+/=-]{12,}|("?(?:token|access_?token|refresh_?token|id_?token|authorization|api_?key|password|secret|cookie)"?\s*[:=]\s*")([^"]+)/gi;

export class ToolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}

function redact(value) {
  return String(value || '')
    .replace(SECRET_PATTERN, (match, prefix, keyPrefix) => keyPrefix ? `${keyPrefix}[REDACTED_SECRET]` : `${prefix}[REDACTED_SECRET]`)
    .slice(0, 1200);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ToolError('MALFORMED_CONFIG', `${label} contains unknown field ${key}`);
  }
}

function canonicalize(value, key = '') {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    if (['required', 'enum', 'tags'].includes(key)) {
      return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return items;
  }
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((childKey) => [childKey, canonicalize(value[childKey], childKey)]));
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new ToolError('MALFORMED_CONFIG', `${label} must be a non-empty string`);
  return value.trim();
}

function assertUrl(value, label) {
  const text = requireString(value, label);
  let parsed;
  try { parsed = new URL(text); } catch { throw new ToolError('MALFORMED_CONFIG', `${label} must be an absolute URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ToolError('MALFORMED_CONFIG', `${label} must use http or https`);
  if (parsed.username || parsed.password) throw new ToolError('SECRET_IN_CONFIG', `${label} must not contain inline credentials`);
  return text;
}

function assertNoInlineSecret(entry, label) {
  for (const forbidden of ['value', 'token', 'password', 'secret', 'cookie', 'authorization']) {
    if (Object.hasOwn(entry, forbidden)) throw new ToolError('SECRET_IN_CONFIG', `${label} contains forbidden inline field ${forbidden}`);
  }
}

export function validateProjectConfig(config) {
  if (!isObject(config)) throw new ToolError('MALFORMED_CONFIG', 'project config must be an object');
  assertAllowedKeys(config, new Set(['schema', 'project', 'services', 'environments', 'contract', 'runtime']), 'project config');
  if (config.schema !== CONFIG_SCHEMA) throw new ToolError('MALFORMED_CONFIG', `config schema must be ${CONFIG_SCHEMA}`);
  if (!isObject(config.project)) throw new ToolError('MALFORMED_CONFIG', 'project is required');
  assertAllowedKeys(config.project, new Set(['label', 'name', 'apifoxProjectId', 'teamId', 'branch']), 'project');
  requireString(config.project.label, 'project.label');
  requireString(config.project.name, 'project.name');
  requireString(config.project.branch, 'project.branch');
  if (config.project.apifoxProjectId !== undefined && (typeof config.project.apifoxProjectId !== 'string' || !/^\d+$/.test(config.project.apifoxProjectId))) {
    throw new ToolError('MALFORMED_CONFIG', 'project.apifoxProjectId must be a numeric string');
  }
  if (config.project.teamId !== undefined && (typeof config.project.teamId !== 'string' || !/^\d+$/.test(config.project.teamId))) {
    throw new ToolError('MALFORMED_CONFIG', 'project.teamId must be a numeric string');
  }
  if (config.project.apifoxProjectId === undefined && config.project.teamId === undefined) {
    throw new ToolError('MALFORMED_CONFIG', 'project.teamId is required when project ID is not configured');
  }
  if (!Array.isArray(config.services) || config.services.length === 0) throw new ToolError('MALFORMED_CONFIG', 'services must be a non-empty array');
  if (!Array.isArray(config.environments)) throw new ToolError('MALFORMED_CONFIG', 'environments must be an array');
  if (!isObject(config.contract)) throw new ToolError('MALFORMED_CONFIG', 'contract is required');
  assertAllowedKeys(config.contract, new Set(['allowedPathPrefixes', 'forbiddenPathPrefixes']), 'contract');
  if (!Array.isArray(config.contract.allowedPathPrefixes) || config.contract.allowedPathPrefixes.length === 0) {
    throw new ToolError('MALFORMED_CONFIG', 'contract.allowedPathPrefixes must be non-empty');
  }
  if (!Array.isArray(config.contract.forbiddenPathPrefixes)) throw new ToolError('MALFORMED_CONFIG', 'contract.forbiddenPathPrefixes must be an array');
  for (const [index, prefix] of config.contract.allowedPathPrefixes.entries()) requireString(prefix, `contract.allowedPathPrefixes[${index}]`);
  for (const [index, prefix] of config.contract.forbiddenPathPrefixes.entries()) requireString(prefix, `contract.forbiddenPathPrefixes[${index}]`);
  if (!isObject(config.runtime)) throw new ToolError('MALFORMED_CONFIG', 'runtime is required');
  assertAllowedKeys(config.runtime, new Set(['manifestIdentity', 'environmentProfiles']), 'runtime');
  const manifestIdentity = requireString(config.runtime.manifestIdentity, 'runtime.manifestIdentity');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifestIdentity)) throw new ToolError('MALFORMED_CONFIG', 'runtime.manifestIdentity must be lowercase kebab-case');

  const environmentKeys = new Set();
  const environmentNames = new Set();
  for (const [index, environment] of config.environments.entries()) {
    if (!isObject(environment)) throw new ToolError('MALFORMED_CONFIG', `environments[${index}] must be an object`);
    assertAllowedKeys(environment, new Set(['key', 'name', 'baseUrl', 'headers']), `environments[${index}]`);
    const key = requireString(environment.key, `environments[${index}].key`);
    const name = requireString(environment.name, `environments[${index}].name`);
    if (environmentKeys.has(key)) throw new ToolError('DUPLICATE_ENVIRONMENT', `duplicate environment key: ${key}`);
    if (environmentNames.has(name)) throw new ToolError('DUPLICATE_ENVIRONMENT', `duplicate environment name: ${name}`);
    environmentKeys.add(key);
    environmentNames.add(name);
    if (environment.baseUrl !== undefined) assertUrl(environment.baseUrl, `environments[${index}].baseUrl`);
    else if (!config.runtime.environmentProfiles?.[environment.key]) throw new ToolError('MALFORMED_CONFIG', `baseUrl required for ${environment.key}`);
    if (!Array.isArray(environment.headers)) throw new ToolError('MALFORMED_CONFIG', `environments[${index}].headers must be an array`);
    const headerNames = new Set();
    for (const [headerIndex, header] of environment.headers.entries()) {
      if (!isObject(header)) throw new ToolError('MALFORMED_CONFIG', `environment header ${headerIndex} must be an object`);
      assertAllowedKeys(header, new Set(['name', 'valueFromVariable', 'description']), `environments[${index}].headers[${headerIndex}]`);
      assertNoInlineSecret(header, `environments[${index}].headers[${headerIndex}]`);
      const headerName = requireString(header.name, `environments[${index}].headers[${headerIndex}].name`).toLowerCase();
      requireString(header.valueFromVariable, `environments[${index}].headers[${headerIndex}].valueFromVariable`);
      if (header.description !== undefined) requireString(header.description, `environments[${index}].headers[${headerIndex}].description`);
      if (headerNames.has(headerName)) throw new ToolError('MALFORMED_CONFIG', `duplicate environment header: ${headerName}`);
      headerNames.add(headerName);
    }
  }

  const serviceNames = new Set();
  const aliases = new Set();
  const namespaces = new Set();
  for (const [index, service] of config.services.entries()) {
    if (!isObject(service)) throw new ToolError('MALFORMED_CONFIG', `services[${index}] must be an object`);
    assertAllowedKeys(service, new Set(['name', 'aliases', 'source', 'namespace', 'environment']), `services[${index}]`);
    const name = requireString(service.name, `services[${index}].name`);
    const namespace = requireString(service.namespace, `services[${index}].namespace`);
    if (serviceNames.has(name)) throw new ToolError('DUPLICATE_SERVICE', `duplicate service: ${name}`);
    if (namespaces.has(namespace)) throw new ToolError('NAMESPACE_COLLISION', `duplicate namespace: ${namespace}`);
    serviceNames.add(name);
    namespaces.add(namespace);
    if (!Array.isArray(service.aliases)) throw new ToolError('MALFORMED_CONFIG', `services[${index}].aliases must be an array`);
    for (const alias of [name, ...service.aliases]) {
      const normalized = requireString(alias, `alias for ${name}`);
      if (aliases.has(normalized)) throw new ToolError('DUPLICATE_ALIAS', `duplicate service alias: ${normalized}`);
      aliases.add(normalized);
    }
    if (!isObject(service.source)) throw new ToolError('MALFORMED_SOURCE', `source is required for ${name}`);
    assertAllowedKeys(service.source, new Set(['type', 'url', 'group', 'headers']), `source for ${name}`);
    if (!['direct', 'swagger-config', 'environment-profile'].includes(service.source.type)) throw new ToolError('MALFORMED_SOURCE', `unsupported source type for ${name}`);
    if (service.source.type === 'environment-profile') {
      if (!service.environment || !config.runtime.environmentProfiles?.[service.environment]) throw new ToolError('MALFORMED_SOURCE', `Environment Profile binding required for ${name}`);
      if (service.source.url !== undefined || service.source.group !== undefined) throw new ToolError('MALFORMED_SOURCE', `Environment Profile source must not duplicate URL/group for ${name}`);
    } else assertUrl(service.source.url, `source.url for ${name}`);
    if (service.source.type === 'swagger-config') requireString(service.source.group, `source.group for ${name}`);
    else if (service.source.group !== undefined) throw new ToolError('MALFORMED_SOURCE', `source.group is only valid for swagger-config source ${name}`);
    if (service.source.headers !== undefined) {
      if (!Array.isArray(service.source.headers)) throw new ToolError('MALFORMED_SOURCE', `source.headers for ${name} must be an array`);
      const sourceHeaderNames = new Set();
      for (const [headerIndex, header] of service.source.headers.entries()) {
        if (!isObject(header)) throw new ToolError('MALFORMED_SOURCE', `source header ${headerIndex} for ${name} must be an object`);
        assertAllowedKeys(header, new Set(['name', 'valueFromEnv']), `source.headers[${headerIndex}] for ${name}`);
        assertNoInlineSecret(header, `source.headers for ${name}`);
        const headerName = requireString(header.name, `source.headers[${headerIndex}].name for ${name}`).toLowerCase();
        requireString(header.valueFromEnv, `source.headers[${headerIndex}].valueFromEnv for ${name}`);
        if (sourceHeaderNames.has(headerName)) throw new ToolError('MALFORMED_SOURCE', `duplicate source header for ${name}: ${headerName}`);
        sourceHeaderNames.add(headerName);
      }
    }
    if (service.environment !== undefined) {
      const environmentKey = requireString(service.environment, `environment for ${name}`);
      if (!environmentKeys.has(environmentKey)) throw new ToolError('INVALID_ENVIRONMENT_REFERENCE', `${name} references unknown environment ${environmentKey}`);
    }
  }
  if (config.runtime.environmentProfiles !== undefined) {
    if (!isObject(config.runtime.environmentProfiles)) throw new ToolError('MALFORMED_CONFIG', 'runtime.environmentProfiles must be an object');
    for (const [key, binding] of Object.entries(config.runtime.environmentProfiles)) {
      if (!environmentKeys.has(key) || !isObject(binding)) throw new ToolError('INVALID_ENVIRONMENT_REFERENCE', 'Environment profile references an unknown environment');
      assertAllowedKeys(binding, new Set(['platform', 'environment', 'service']), 'environment profile binding');
      requireString(binding.platform, 'profile platform');
      if (!['DEV', 'SIT'].includes(binding.environment)) throw new ToolError('MALFORMED_CONFIG', 'Environment profile must use DEV or SIT');
      if (binding.service !== undefined) requireString(binding.service, 'profile service');
    }
  }
  return config;
}

export function loadProjectConfig({ projectName, configPath } = {}) {
  if (projectName && configPath) throw new ToolError('PROJECT_CONFIG_CONFLICT', '--project and --config cannot be used together');
  let file;
  if (configPath) file = path.resolve(configPath);
  else {
    if (!projectName || !/^[a-z0-9][a-z0-9-]*$/.test(projectName)) throw new ToolError('PROJECT_CONFIG_REQUIRED', '--project or --config is required');
    file = path.join(CONFIG_ROOT, `${projectName}.json`);
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new ToolError('MALFORMED_CONFIG', `cannot read project config: ${redact(error.message)}`); }
  validateProjectConfig(parsed);
  const config = resolveApifoxProfile(parsed);
  validateProjectConfig(config);
  return { config, file };
}

function deepClone(value) {
  return structuredClone(value);
}

function decodeJsonPointerSegment(segment) {
  if (/~(?:[^01]|$)/.test(segment)) throw new ToolError('BROKEN_LOCAL_REF', `invalid JSON Pointer escape in #/${segment}`);
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveLocalRef(document, reference) {
  if (reference === '#') return document;
  if (!reference.startsWith('#/')) return undefined;
  let current = document;
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = decodeJsonPointerSegment(rawSegment);
    if ((!isObject(current) && !Array.isArray(current)) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function validateReferences(document) {
  const visit = (value) => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        if (typeof child !== 'string') throw new ToolError('MALFORMED_OPENAPI', '$ref must be a string');
        if (!child.startsWith('#')) throw new ToolError('EXTERNAL_REF_UNSUPPORTED', `external reference is not supported: ${child}`);
        if (resolveLocalRef(document, child) === undefined) throw new ToolError('BROKEN_LOCAL_REF', `unresolved local reference: ${child}`);
      }
      visit(child);
    }
  };
  visit(document);
}

function pathAllowed(apiPath, contract) {
  return contract.allowedPathPrefixes.some((prefix) => apiPath.startsWith(prefix))
    && !contract.forbiddenPathPrefixes.some((prefix) => apiPath.startsWith(prefix));
}

function operationKey(method, apiPath) {
  return `${method.toUpperCase()} ${apiPath}`;
}

export function normalizeOpenApi(spec, service, contract) {
  if (!isObject(spec)) throw new ToolError('MALFORMED_OPENAPI', `${service.name}: OpenAPI document must be an object`);
  if (typeof spec.openapi !== 'string' || !/^3\.(?:0|1)\.\d+$/.test(spec.openapi)) throw new ToolError('MALFORMED_OPENAPI', `${service.name}: only OpenAPI 3.0.x and 3.1.x are supported`);
  if (!isObject(spec.info)) throw new ToolError('MALFORMED_OPENAPI', `${service.name}: info object is required`);
  if (typeof spec.info.title !== 'string' || spec.info.title.trim() === '') throw new ToolError('MALFORMED_OPENAPI', `${service.name}: info.title must be a non-empty string`);
  if (typeof spec.info.version !== 'string' || spec.info.version.trim() === '') throw new ToolError('MALFORMED_OPENAPI', `${service.name}: info.version must be a non-empty string`);
  if (!isObject(spec.paths) || Object.keys(spec.paths).length === 0) throw new ToolError('MALFORMED_OPENAPI', `${service.name}: OpenAPI paths are missing`);
  const copy = deepClone(spec);
  const namespace = requireString(service.namespace, `namespace for ${service.name}`);
  const operationIds = new Set();
  let operationCount = 0;
  for (const [apiPath, item] of Object.entries(copy.paths)) {
    if (!isObject(item)) throw new ToolError('MALFORMED_OPENAPI', `${service.name}: path item ${apiPath} must be an object`);
    if (!pathAllowed(apiPath, contract)) throw new ToolError('PATH_CONTRACT_VIOLATION', `${service.name}: forbidden or disallowed path ${apiPath}`);
    for (const method of METHODS) {
      const operation = item?.[method];
      if (operation === undefined) continue;
      if (!isObject(operation) || !isObject(operation.responses) || Object.keys(operation.responses).length === 0) {
        throw new ToolError('MALFORMED_OPENAPI', `${service.name}: ${method.toUpperCase()} ${apiPath} must be an operation with responses`);
      }
      if (Object.hasOwn(operation, 'operationId') && typeof operation.operationId !== 'string') {
        throw new ToolError('MALFORMED_OPENAPI', `${service.name}: ${method.toUpperCase()} ${apiPath} operationId must be a string`);
      }
      if (Object.hasOwn(operation, 'tags') && (!Array.isArray(operation.tags) || operation.tags.some((tag) => typeof tag !== 'string'))) {
        throw new ToolError('MALFORMED_OPENAPI', `${service.name}: ${method.toUpperCase()} ${apiPath} tags must be a string array`);
      }
      operationCount += 1;
      if (operation.operationId) {
        if (operationIds.has(operation.operationId)) throw new ToolError('NAMESPACE_COLLISION', `${service.name}: duplicate operationId ${operation.operationId}`);
        operationIds.add(operation.operationId);
      }
      // Apifox folders are tag-driven. Only scope tags to the service folder;
      // schema names, operationId and local references remain source-authentic.
      operation.tags = (Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags : ['ungrouped'])
        .map((tag) => String(tag).startsWith(`${namespace}/`) ? String(tag) : `${namespace}/${tag}`);
    }
  }
  if (operationCount === 0) throw new ToolError('MALFORMED_OPENAPI', `${service.name}: no operations found`);
  validateReferences(copy);
  return canonicalize(copy);
}

export function snapshotOpenApi(normalizedSpec) {
  const components = normalizedSpec.components || {};
  const operations = {};
  for (const [apiPath, item] of Object.entries(normalizedSpec.paths || {})) {
    for (const method of METHODS) {
      if (!isObject(item?.[method])) continue;
      operations[operationKey(method, apiPath)] = sha256(stableStringify({ operation: item[method], pathParameters: item.parameters || [], rootSecurity: normalizedSpec.security || null, components }));
    }
  }
  return {
    digest: sha256(stableStringify(normalizedSpec)),
    documentationDigest: sha256(stableStringify({ info: normalizedSpec.info || {}, paths: normalizedSpec.paths || {} })),
    operations,
    operationCount: Object.keys(operations).length,
    schemaNames: Object.keys(normalizedSpec.components?.schemas || {}).sort(),
    componentSchemaCount: Object.keys(normalizedSpec.components?.schemas || {}).length,
  };
}

function compactKeys(keys, limit = 30) {
  const sorted = [...keys].sort();
  return { count: sorted.length, items: sorted.slice(0, limit), truncated: sorted.length > limit };
}

export function diffSnapshots(previous, current) {
  const before = previous?.operations || {};
  const after = current.operations || {};
  const added = Object.keys(after).filter((key) => !(key in before));
  const removed = Object.keys(before).filter((key) => !(key in after));
  const modified = Object.keys(after).filter((key) => key in before && before[key] !== after[key]);
  return {
    change: previous?.digest === current.digest ? 'NO_CHANGE' : 'CHANGED',
    added: compactKeys(added), removed: compactKeys(removed), modified: compactKeys(modified),
    documentModified: Boolean(previous && previous.digest !== current.digest && added.length + removed.length + modified.length === 0),
    previousDigest: previous?.digest || null,
    currentDigest: current.digest,
  };
}

function overallStatus(services) {
  const statuses = services.map((item) => item.status);
  if (statuses.includes('NEEDS_HUMAN')) return 'NEEDS_HUMAN';
  if (statuses.includes('FAILED')) return 'FAILED';
  if (statuses.includes('NEEDS_CLEANUP')) return 'NEEDS_CLEANUP';
  return statuses.length > 0 && statuses.every((status) => status === 'NO_CHANGE') ? 'NO_CHANGE' : 'SUCCESS';
}

export function detectNamespaceCollisions(entries) {
  const schemas = new Map();
  for (const entry of entries) {
    for (const schemaName of Object.keys(entry.spec.components?.schemas || {})) {
      const owners = schemas.get(schemaName) || new Set();
      owners.add(entry.service.name);
      schemas.set(schemaName, owners);
    }
  }
  const collisions = [...schemas]
    .filter(([, owners]) => owners.size > 1)
    .map(([name, owners]) => ({ kind: 'schema', name, services: [...owners].sort() }));
  if (collisions.length > 0) {
    const compact = collisions.slice(0, 10);
    const summary = compact.map((item) => `${item.kind}:${item.name}[${item.services.join(',')}]`).join(', ');
    throw new ToolError('NAMESPACE_COLLISION', `cross-service identity collision: ${summary}`, { conflicts: compact, truncated: collisions.length > compact.length });
  }
  return { schemas: schemas.size };
}

export function detectRemoteSchemaCollisions(entries, remoteSchemas, manifest, { allowFullAdoption = false } = {}) {
  const remoteNames = new Set(remoteSchemas.map((schema) => schema?.name).filter((name) => typeof name === 'string' && name !== ''));
  const owners = new Map();
  for (const [serviceName, state] of Object.entries(manifest.services || {})) {
    for (const schemaName of Array.isArray(state.schemaNames) ? state.schemaNames : []) {
      const current = owners.get(schemaName) || new Set();
      current.add(serviceName);
      owners.set(schemaName, current);
    }
  }
  const conflicts = [];
  for (const entry of entries) {
    for (const schemaName of entry.snapshot.schemaNames) {
      if (!remoteNames.has(schemaName)) continue;
      const knownOwners = owners.get(schemaName) || new Set();
      const foreignOwners = [...knownOwners].filter((owner) => owner !== entry.service.name);
      if (foreignOwners.length > 0) {
        conflicts.push({ kind: 'schema', name: schemaName, service: entry.service.name, owners: foreignOwners.sort() });
      } else if (!knownOwners.has(entry.service.name) && !allowFullAdoption) {
        conflicts.push({ kind: 'schema', name: schemaName, service: entry.service.name, owners: ['unmanaged-remote'] });
      }
    }
  }
  if (conflicts.length > 0) {
    const compact = conflicts.slice(0, 10);
    const summary = compact.map((item) => `schema:${item.name}[${item.owners.join(',')}] -> ${item.service}`).join(', ');
    throw new ToolError('NAMESPACE_COLLISION', `remote project-global schema collision: ${summary}`, { conflicts: compact, truncated: conflicts.length > compact.length });
  }
  return { remoteSchemas: remoteNames.size, checkedServices: entries.length };
}

function manifestFileFor(config, runtimeRoot = path.join(os.homedir(), '.harness', 'runtime', 'apifox')) {
  return path.join(runtimeRoot, `${config.runtime.manifestIdentity}-sync-manifest.json`);
}

function configIdentity(config) {
  return sha256(stableStringify({
    manifestIdentity: config.runtime.manifestIdentity,
    label: config.project.label,
    name: config.project.name,
    teamId: config.project.teamId ? String(config.project.teamId) : null,
    branch: config.project.branch,
  }));
}

function newManifest(config, target = null) {
  return {
    schema: MANIFEST_SCHEMA,
    project: {
      identity: config.runtime.manifestIdentity,
      configIdentity: configIdentity(config),
      label: config.project.label,
      name: config.project.name,
      teamId: config.project.teamId ? String(config.project.teamId) : null,
      projectId: target?.projectId || (config.project.apifoxProjectId ? String(config.project.apifoxProjectId) : null),
      branch: config.project.branch,
    },
    services: {},
  };
}

function manifestLifecycle(file) {
  if (!fs.existsSync(file)) return 'missing';
  try {
    const schema = JSON.parse(fs.readFileSync(file, 'utf8')).schema;
    if (['apifox-openapi-sync/v1', 'apifox-openapi-sync/v2'].includes(schema)) return 'legacy';
    if (schema === MANIFEST_SCHEMA) return 'v3';
    return 'unsupported';
  } catch { return 'malformed'; }
}

export function loadManifest(file, config, { allowMissing = true, allowLegacyReset = false } = {}) {
  if (!fs.existsSync(file)) {
    if (!allowMissing) throw new ToolError('MANIFEST_MISSING', `manifest is missing: ${file}`);
    return newManifest(config);
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new ToolError('MALFORMED_MANIFEST', 'manifest is not valid JSON'); }
  if (['apifox-openapi-sync/v1', 'apifox-openapi-sync/v2'].includes(manifest.schema)) {
    if (allowLegacyReset) return newManifest(config);
    throw new ToolError('MANIFEST_MIGRATION_REQUIRED', 'legacy manifest cannot prove target and complete contract equality; run an authorized full sync to rebuild it');
  }
  if (manifest.schema !== MANIFEST_SCHEMA || !isObject(manifest.project) || !isObject(manifest.services)) throw new ToolError('MALFORMED_MANIFEST', `manifest must use ${MANIFEST_SCHEMA}`);
  if (manifest.project.identity !== config.runtime.manifestIdentity || manifest.project.branch !== config.project.branch || manifest.project.configIdentity !== configIdentity(config)) {
    throw new ToolError('MANIFEST_TARGET_MISMATCH', 'manifest project/config identity or branch does not match config');
  }
  if (config.project.apifoxProjectId && manifest.project.projectId && String(manifest.project.projectId) !== String(config.project.apifoxProjectId)) throw new ToolError('MANIFEST_TARGET_MISMATCH', 'manifest projectId does not match config');
  return manifest;
}

export function saveManifestAtomic(file, manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  // Only proven operation SHA-256 entries are neutralized in the scan copy;
  // keep the original credential detector and the persisted manifest unchanged.
  const scanManifest = JSON.parse(text);
  for (const service of Object.values(scanManifest.services || {})) {
    if (!isObject(service?.operations)) continue;
    service.operations = Object.fromEntries(Object.entries(service.operations).map(([key, value]) => {
      const operationDigest = /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|TRACE) \/\S*$/.test(key)
        && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
      return [operationDigest ? sha256(key) : key, value];
    }));
  }
  SECRET_PATTERN.lastIndex = 0;
  const containsSecret = SECRET_PATTERN.test(JSON.stringify(scanManifest));
  SECRET_PATTERN.lastIndex = 0;
  if (containsSecret) throw new ToolError('SECRET_IN_MANIFEST', 'refusing to store credential-like content');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function parseJsonOutput(stdout, label) {
  try { return JSON.parse(stdout); }
  catch { throw new ToolError('MALFORMED_APIFOX_RESPONSE', `${label} returned non-JSON output`); }
}

function numericSummary(value, output = {}, prefix = '') {
  if (!isObject(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'number' && /(count|total|created|updated|ignored|deleted)/i.test(key)) output[name] = child;
    else if (isObject(child)) numericSummary(child, output, name);
  }
  return output;
}

class ApifoxCliAdapter {
  constructor({ binary = process.env.APIFOX_BIN || 'apifox', timeoutMs = 120000, maxOutputBytes = 20 * 1024 * 1024 } = {}) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
  }
  run(args, label, timeoutMs = this.timeoutMs) {
    // Apifox CLI can truncate large JSON when its stdout is a Node pipe. A private
    // file preserves the complete official CLI response without exposing it in logs.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apifox-cli-output-'));
    const stdoutFile = path.join(dir, 'stdout.json');
    const stderrFile = path.join(dir, 'stderr.log');
    let stdoutFd;
    let stderrFd;
    try {
      stdoutFd = fs.openSync(stdoutFile, 'wx', 0o600);
      stderrFd = fs.openSync(stderrFile, 'wx', 0o600);
      const result = spawnSync(this.binary, args, { cwd: dir, timeout: timeoutMs, stdio: ['ignore', stdoutFd, stderrFd] });
      fs.closeSync(stdoutFd); stdoutFd = undefined;
      fs.closeSync(stderrFd); stderrFd = undefined;
      if (result.error) throw new ToolError('APIFOX_EXECUTION_FAILED', `${label} failed: ${redact(result.error.message)}`);
      if (result.status !== 0) throw new ToolError('APIFOX_COMMAND_FAILED', `${label} failed with exit ${result.status}`);
      const size = fs.statSync(stdoutFile).size;
      if (size > this.maxOutputBytes) throw new ToolError('APIFOX_OUTPUT_TOO_LARGE', `${label} output exceeded ${this.maxOutputBytes} bytes`);
      const payload = parseJsonOutput(fs.readFileSync(stdoutFile, 'utf8'), label);
      if (payload.success !== true) throw new ToolError('APIFOX_COMMAND_FAILED', `${label} did not report success`);
      return payload;
    } finally {
      if (stdoutFd !== undefined) fs.closeSync(stdoutFd);
      if (stderrFd !== undefined) fs.closeSync(stderrFd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  projectGet(projectId) { return this.run(['project', 'get', String(projectId)], 'project get').data; }
  projectList() { return this.run(['project', 'list'], 'project list').data || []; }
  projectCreate(project) { return this.run(['project', 'create', '--team', String(project.teamId), '--name', project.name, '--type', 'HTTP', '--skip-default-environment'], 'project create').data; }
  branchList(projectId) { return this.run(['branch', 'list', '--project', String(projectId), '--type', 'all'], 'branch list').data || []; }
  environmentList(projectId, branch) { return this.run(['environment', 'list', '--project', String(projectId), '--branch', branch], 'environment list').data || []; }
  environmentGet(projectId, branch, environmentId) { return this.run(['environment', 'get', String(environmentId), '--project', String(projectId), '--branch', branch], 'environment get').data; }
  environmentCreate(projectId, branch, environment) { return this.run(['environment', 'create', environment.name, '--project', String(projectId), '--branch', branch, '--base-url', environment.baseUrl], 'environment create').data; }
  environmentUpdate(projectId, branch, environmentId, value) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apifox-environment-'));
    const file = path.join(dir, 'environment.json');
    try {
      fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
      this.run(['cli-schema', 'validate', 'environment-update', '--file', file], 'environment schema validation');
      return this.run(['environment', 'update', String(environmentId), '--project', String(projectId), '--branch', branch, '--file', file], 'environment update').data;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  endpointList(projectId, branch) { return this.run(['endpoint', 'list', '--project', String(projectId), '--branch', branch], 'endpoint list').data || []; }
  folderList(projectId, branch) { return this.run(['folder', 'list', '--project', String(projectId), '--branch', branch, '--type', 'endpoint'], 'folder list').data || []; }
  schemaList(projectId, branch) {
    const data = this.run(['schema', 'list', '--project', String(projectId), '--branch', branch], 'schema list').data;
    if (!Array.isArray(data)) throw new ToolError('MALFORMED_APIFOX_RESPONSE', 'schema list returned invalid data');
    if (data.some((schema) => !isObject(schema) || typeof schema.name !== 'string' || schema.name === '')) {
      throw new ToolError('MALFORMED_APIFOX_RESPONSE', 'schema list contains an invalid schema identity');
    }
    return data;
  }
  importOpenApi(projectId, branch, spec) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apifox-openapi-'));
    const file = path.join(dir, 'openapi.json');
    try {
      fs.writeFileSync(file, JSON.stringify(spec), { mode: 0o600 });
      const payload = this.run(['import', '--project', String(projectId), '--branch', branch, '--format', 'openapi', '--file', file], 'OpenAPI import', 180000);
      return { success: true, counts: numericSummary(payload.data || {}), operation: payload.operation || 'import' };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

export function createReadOnlyApifoxAdapter(options = {}) {
  const adapter = new ApifoxCliAdapter(options);
  return Object.freeze({
    projectGet: adapter.projectGet.bind(adapter),
    projectList: adapter.projectList.bind(adapter),
    branchList: adapter.branchList.bind(adapter),
    environmentList: adapter.environmentList.bind(adapter),
    environmentGet: adapter.environmentGet.bind(adapter),
    endpointList: adapter.endpointList.bind(adapter),
    folderList: adapter.folderList.bind(adapter),
    schemaList: adapter.schemaList.bind(adapter),
  });
}

function discoverWorkspaceSettings(explicitPath, start = process.cwd()) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) throw new ToolError('WORKSPACE_TARGET_MISSING', `workspace settings do not exist: ${resolved}`);
    return resolved;
  }
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, '.apifox', 'settings.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readWorkspaceProjectId(file) {
  if (!file) return null;
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new ToolError('WORKSPACE_TARGET_MALFORMED', `workspace settings are malformed: ${file}`); }
  if (!isObject(value)) throw new ToolError('WORKSPACE_TARGET_MALFORMED', `workspace settings must be an object: ${file}`);
  const projectId = value.projectId;
  const validString = typeof projectId === 'string' && /^\d+$/.test(projectId);
  const validNumber = Number.isSafeInteger(projectId) && projectId > 0;
  if (!validString && !validNumber) throw new ToolError('WORKSPACE_TARGET_MALFORMED', `workspace settings projectId must be numeric: ${file}`);
  return String(projectId);
}

export async function ensureProject(config, adapter, { authorizedMutation = false, workspaceSettingsPath = null } = {}) {
  const workspaceProjectId = readWorkspaceProjectId(discoverWorkspaceSettings(workspaceSettingsPath));
  let project;
  let created = false;
  if (config.project.apifoxProjectId) project = await adapter.projectGet(String(config.project.apifoxProjectId));
  else {
    const matches = (await adapter.projectList()).filter((item) => item.name === config.project.name && (!config.project.teamId || String(item.teamId) === String(config.project.teamId)));
    if (matches.length > 1) throw new ToolError('PROJECT_AMBIGUOUS', `multiple projects match ${config.project.name}`);
    if (matches.length === 1) project = matches[0];
    else {
      if (!authorizedMutation) throw new ToolError('AUTHORIZATION_REQUIRED', `project ${config.project.name} does not exist; creation requires explicit authorization`);
      project = await adapter.projectCreate(config.project);
      created = true;
    }
  }
  if (!project?.id) throw new ToolError('MALFORMED_APIFOX_RESPONSE', 'resolved project has no ID');
  if (project.name !== config.project.name) throw new ToolError('PROJECT_TARGET_MISMATCH', `project name mismatch: expected ${config.project.name}`);
  if (config.project.teamId && String(project.teamId) !== String(config.project.teamId)) throw new ToolError('PROJECT_TARGET_MISMATCH', 'project team mismatch');
  if (workspaceProjectId && workspaceProjectId !== String(project.id)) throw new ToolError('PROJECT_TARGET_MISMATCH', 'workspace and project config projectId differ');
  const branches = (await adapter.branchList(String(project.id))).filter((item) => item.name === config.project.branch && item.isArchived !== true);
  if (branches.length === 0) throw new ToolError('BRANCH_TARGET_MISMATCH', `branch ${config.project.branch} is not available in target project`);
  if (branches.length > 1) throw new ToolError('BRANCH_AMBIGUOUS', `multiple active branches match ${config.project.branch}`);
  const branch = branches[0];
  return { projectId: String(project.id), projectName: project.name, teamId: String(project.teamId), branch: branch.name, created };
}

function headerReference(entry) {
  return { name: entry.name, value: `{{${entry.valueFromVariable}}}`, initialValue: `{{${entry.valueFromVariable}}}`, description: entry.description || 'Value supplied by secure Apifox/runtime variable', isSync: false, isBindInitial: false };
}

function environmentMismatch(environment, detail) {
  const currentBase = detail?.baseUrls?.default || detail?.baseUrl || '';
  const currentHeaders = detail?.parameters?.header || [];
  const expectedHeaders = environment.headers.map(headerReference);
  const missingHeaders = expectedHeaders.filter((expected) => !currentHeaders.some((current) => current.name?.toLowerCase() === expected.name.toLowerCase() && current.value === expected.value));
  return { currentBase, currentHeaders, expectedHeaders, missingHeaders, differs: currentBase !== environment.baseUrl || missingHeaders.length > 0 };
}

export async function ensureEnvironment(config, environmentKey, target, adapter, { authorizedMutation = false } = {}) {
  const environment = config.environments.find((item) => item.key === environmentKey);
  if (!environment) throw new ToolError('ENVIRONMENT_NOT_CONFIGURED', `environment ${environmentKey} is not configured`);
  const existing = (await adapter.environmentList(target.projectId, target.branch)).filter((item) => item.name === environment.name);
  if (existing.length > 1) throw new ToolError('ENVIRONMENT_AMBIGUOUS', `multiple environments match ${environment.name}`);
  let resolved = existing[0];
  let created = false;
  if (!resolved) {
    if (!authorizedMutation) throw new ToolError('AUTHORIZATION_REQUIRED', `environment ${environment.name} is missing; creation requires explicit authorization`);
    resolved = await adapter.environmentCreate(target.projectId, target.branch, environment);
    created = true;
  }
  if (!resolved?.id) throw new ToolError('MALFORMED_APIFOX_RESPONSE', 'resolved environment has no ID');
  let detail = await adapter.environmentGet(target.projectId, target.branch, resolved.id);
  let comparison = environmentMismatch(environment, detail);
  if (comparison.differs) {
    if (!authorizedMutation) throw new ToolError('ENVIRONMENT_TARGET_MISMATCH', `environment ${environment.name} differs from config and update is not authorized`);
    const next = { name: detail.name, baseUrls: { ...(detail.baseUrls || {}), default: environment.baseUrl }, parameters: { ...(detail.parameters || {}), cookie: detail.parameters?.cookie || [], query: detail.parameters?.query || [], body: detail.parameters?.body || [], header: [...comparison.currentHeaders.filter((current) => !comparison.expectedHeaders.some((expected) => expected.name.toLowerCase() === current.name?.toLowerCase())), ...comparison.expectedHeaders] } };
    await adapter.environmentUpdate(target.projectId, target.branch, resolved.id, next);
    detail = await adapter.environmentGet(target.projectId, target.branch, resolved.id);
    comparison = environmentMismatch(environment, detail);
    if (comparison.differs) throw new ToolError('ENVIRONMENT_CONVERGENCE_FAILED', `environment ${environment.name} did not converge after mutation`);
  }
  return { key: environment.key, id: String(resolved.id), name: environment.name, baseUrl: detail.baseUrls?.default || detail.baseUrl || '', created, reused: !created };
}

async function defaultFetchJson(url, headerRefs = []) {
  const headers = { Accept: 'application/json' };
  for (const entry of headerRefs) {
    const value = process.env[entry.valueFromEnv];
    if (!value) throw new ToolError('SOURCE_AUTH_UNAVAILABLE', `source credential environment variable is unavailable: ${entry.valueFromEnv}`);
    headers[entry.name] = value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new ToolError('OPENAPI_FETCH_FAILED', `OpenAPI request failed with HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('OPENAPI_FETCH_FAILED', `OpenAPI request failed: ${redact(error.message)}`);
  } finally { clearTimeout(timer); }
}

export async function fetchServiceOpenApi(service, fetchJson = defaultFetchJson) {
  const headers = service.source.headers || [];
  if (service.source.type === 'direct') return fetchJson(service.source.url, headers);
  const config = await fetchJson(service.source.url, headers);
  const match = (config.urls || []).filter((item) => item.name === service.source.group);
  if (match.length !== 1) throw new ToolError('OPENAPI_GROUP_AMBIGUOUS', `${service.name}: expected one Swagger group ${service.source.group}`);
  return fetchJson(new URL(match[0].url, service.source.url).toString(), headers);
}

function selectServices(config, selectors) {
  if (!selectors.length) return config.services;
  const selected = [];
  for (const selector of selectors) {
    const matches = config.services.filter((service) => service.name === selector || service.aliases.includes(selector));
    if (matches.length !== 1) throw new ToolError('SERVICE_SELECTION_FAILED', `service selector must resolve uniquely: ${selector}`);
    if (!selected.includes(matches[0])) selected.push(matches[0]);
  }
  return selected;
}

async function prepareServices(config, services, fetchJson) {
  const entries = [];
  const failures = [];
  for (const service of services) {
    try {
      const raw = await fetchServiceOpenApi(service, fetchJson);
      const spec = normalizeOpenApi(raw, service, config.contract);
      entries.push({ service, spec, snapshot: snapshotOpenApi(spec) });
    } catch (error) { failures.push({ service: service.name, code: error.code || 'OPENAPI_PREPARE_FAILED', message: redact(error.message) }); }
  }
  if (entries.length > 0) detectNamespaceCollisions(entries);
  return { entries, failures };
}

function folderPath(folder) {
  if (Array.isArray(folder.path)) return folder.path.join('/');
  return String(folder.path || folder.name || '');
}

function namespaceFolderIds(folders, namespace) {
  const ids = new Set();
  for (const folder of folders) {
    const segments = folderPath(folder).split('/').filter(Boolean);
    if (folder.name === namespace || segments.includes(namespace)) ids.add(String(folder.id));
  }
  return ids;
}

export async function validateImportedService(config, entry, target, adapter) {
  const [folders, endpoints] = await Promise.all([adapter.folderList(target.projectId, target.branch), adapter.endpointList(target.projectId, target.branch)]);
  const folderIds = namespaceFolderIds(folders, entry.service.namespace);
  const scoped = endpoints.filter((endpoint) => folderIds.has(String(endpoint.folderId)));
  const actual = new Map();
  let duplicateCount = 0;
  for (const endpoint of scoped) {
    const key = operationKey(String(endpoint.method || '').toLowerCase(), endpoint.path);
    if (actual.has(key)) duplicateCount += 1;
    actual.set(key, endpoint);
  }
  const expectedKeys = new Set(Object.keys(entry.snapshot.operations));
  const actualKeys = new Set(actual.keys());
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const extra = [...actualKeys].filter((key) => !expectedKeys.has(key));
  const forbidden = scoped.filter((endpoint) => !pathAllowed(endpoint.path, config.contract));
  let environment = null;
  if (entry.service.environment) {
    const expectedEnvironment = config.environments.find((item) => item.key === entry.service.environment);
    const matches = (await adapter.environmentList(target.projectId, target.branch)).filter((item) => item.name === expectedEnvironment.name);
    if (matches.length !== 1) environment = { status: 'FAIL', reason: 'environment-not-unique' };
    else {
      const detail = await adapter.environmentGet(target.projectId, target.branch, matches[0].id);
      const comparison = environmentMismatch(expectedEnvironment, detail);
      environment = { status: comparison.differs ? 'FAIL' : 'PASS', name: expectedEnvironment.name, baseUrlMatched: comparison.currentBase === expectedEnvironment.baseUrl, headerReferencesMatched: comparison.missingHeaders.length === 0 };
    }
  }
  const status = extra.length > 0 ? 'NEEDS_CLEANUP' : folderIds.size > 0 && missing.length === 0 && forbidden.length === 0 && duplicateCount === 0 && (!environment || environment.status === 'PASS') ? 'PASS' : 'FAIL';
  return { status, target: { projectId: target.projectId, branch: target.branch }, namespace: entry.service.namespace, namespacePresent: folderIds.size > 0, expectedOperationCount: expectedKeys.size, actualOperationCount: actualKeys.size, missing: compactKeys(missing), extra: compactKeys(extra), forbiddenPathCount: forbidden.length, duplicateCount, environment };
}

function validationEvidence(validation) {
  return { status: validation.status, projectId: validation.target.projectId, branch: validation.target.branch, namespace: validation.namespace, expectedOperationCount: validation.expectedOperationCount, actualOperationCount: validation.actualOperationCount, forbiddenPathCount: validation.forbiddenPathCount, duplicateCount: validation.duplicateCount, environment: validation.environment, validatedAt: new Date().toISOString() };
}

export async function executeDiff({ config, services, fetchJson = defaultFetchJson, runtimeRoot } = {}) {
  const file = manifestFileFor(config, runtimeRoot);
  const manifest = loadManifest(file, config);
  const prepared = await prepareServices(config, services, fetchJson);
  const results = prepared.entries.map((entry) => {
    const diff = diffSnapshots(manifest.services[entry.service.name], entry.snapshot);
    return { service: entry.service.name, status: diff.change === 'NO_CHANGE' ? 'NO_CHANGE' : 'SUCCESS', diff };
  });
  const combined = [...results, ...prepared.failures.map((failure) => ({ ...failure, status: 'FAILED' }))];
  const status = overallStatus(combined);
  return { ok: !['FAILED', 'NEEDS_CLEANUP', 'NEEDS_HUMAN'].includes(status), status, command: 'diff', manifest: file, services: combined };
}

export async function executeValidate({ config, services, adapter, fetchJson = defaultFetchJson, workspaceSettingsPath } = {}) {
  const target = await ensureProject(config, adapter, { workspaceSettingsPath });
  const prepared = await prepareServices(config, services, fetchJson);
  const results = [];
  for (const entry of prepared.entries) {
    try {
      const validation = await validateImportedService(config, entry, target, adapter);
      results.push({ service: entry.service.name, status: validation.status === 'PASS' ? 'SUCCESS' : validation.status === 'NEEDS_CLEANUP' ? 'NEEDS_CLEANUP' : 'FAILED', validation });
    } catch (error) { results.push({ service: entry.service.name, status: 'FAILED', code: error.code || 'VALIDATION_FAILED', message: redact(error.message) }); }
  }
  const combined = [...results, ...prepared.failures.map((failure) => ({ ...failure, status: 'FAILED' }))];
  const status = overallStatus(combined);
  return { ok: status === 'SUCCESS', status, command: 'validate', target, services: combined };
}

export async function executeSync({ config, services, adapter, fetchJson = defaultFetchJson, runtimeRoot, full = false, authorizedMutation = false, workspaceSettingsPath } = {}) {
  if (!authorizedMutation) throw new ToolError('AUTHORIZATION_REQUIRED', 'sync requires --authorized-mutation');
  const target = await ensureProject(config, adapter, { workspaceSettingsPath });
  const file = manifestFileFor(config, runtimeRoot);
  const lifecycle = manifestLifecycle(file);
  const manifest = loadManifest(file, config, { allowLegacyReset: full });
  if (manifest.project.projectId && manifest.project.projectId !== target.projectId) throw new ToolError('MANIFEST_TARGET_MISMATCH', 'manifest projectId does not match resolved target');
  manifest.project.projectId = target.projectId;
  const prepared = await prepareServices(config, services, fetchJson);
  const diffs = new Map(prepared.entries.map((entry) => [entry.service.name, diffSnapshots(manifest.services[entry.service.name], entry.snapshot)]));
  const changedEntries = prepared.entries.filter((entry) => full || diffs.get(entry.service.name).change !== 'NO_CHANGE');
  if (changedEntries.length > 0) {
    if (typeof adapter.schemaList !== 'function') throw new ToolError('SCHEMA_INVENTORY_UNAVAILABLE', 'Apifox adapter does not provide remote schema inventory');
    const remoteSchemas = await adapter.schemaList(target.projectId, target.branch);
    const selectedNames = new Set(services.map((service) => service.name));
    const completeSelection = prepared.failures.length === 0
      && prepared.entries.length === config.services.length
      && config.services.every((service) => selectedNames.has(service.name));
    const allowFullAdoption = full && completeSelection && ['missing', 'legacy'].includes(lifecycle);
    detectRemoteSchemaCollisions(changedEntries, remoteSchemas, manifest, { allowFullAdoption });
  }
  const results = [];
  for (const entry of prepared.entries) {
    const diff = diffs.get(entry.service.name);
    if (!full && diff.change === 'NO_CHANGE') { results.push({ service: entry.service.name, status: 'NO_CHANGE', diff }); continue; }
    try {
      const importResult = await adapter.importOpenApi(target.projectId, target.branch, entry.spec);
      const validation = await validateImportedService(config, entry, target, adapter);
      if (validation.status !== 'PASS') { results.push({ service: entry.service.name, status: validation.status === 'NEEDS_CLEANUP' ? 'NEEDS_CLEANUP' : 'FAILED', diff, import: importResult, validation }); continue; }
      manifest.services[entry.service.name] = { digest: entry.snapshot.digest, documentationDigest: entry.snapshot.documentationDigest, operations: entry.snapshot.operations, operationCount: entry.snapshot.operationCount, schemaNames: entry.snapshot.schemaNames, componentSchemaCount: entry.snapshot.componentSchemaCount, syncedAt: new Date().toISOString(), validation: validationEvidence(validation) };
      saveManifestAtomic(file, manifest);
      results.push({ service: entry.service.name, status: 'SUCCESS', diff, import: importResult, validation });
    } catch (error) { results.push({ service: entry.service.name, status: 'FAILED', code: error.code || 'SYNC_FAILED', message: redact(error.message), diff }); }
  }
  const combined = [...results, ...prepared.failures.map((failure) => ({ ...failure, status: 'FAILED' }))];
  const status = overallStatus(combined);
  return { ok: ['SUCCESS', 'NO_CHANGE'].includes(status), status, command: 'sync', target, manifest: file, services: combined };
}

function parseArguments(argv) {
  if (argv.length === 0) throw new ToolError('USAGE', 'command is required');
  const command = argv[0];
  const allowedCommands = new Set(['config-check', 'diff', 'sync', 'ensure-project', 'ensure-environment', 'validate']);
  if (!allowedCommands.has(command)) throw new ToolError('USAGE', `unknown command: ${command}`);
  const options = { selectors: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { options.selectors.push(token); continue; }
    const [rawName, inline] = token.slice(2).split(/=(.*)/s);
    if (['full', 'authorized-mutation'].includes(rawName)) { if (inline !== undefined) throw new ToolError('USAGE', `--${rawName} does not accept a value`); options[rawName] = true; continue; }
    if (!['project', 'config', 'environment', 'workspace-settings', 'runtime-root'].includes(rawName)) throw new ToolError('USAGE', `unknown option: --${rawName}`);
    const value = inline !== undefined ? inline : argv[++index];
    if (!value || value.startsWith('--')) throw new ToolError('USAGE', `--${rawName} requires a value`);
    options[rawName] = value;
  }
  return { command, options };
}

function exitCode(result) { return result.ok ? 0 : 2; }

function errorStatus(error) {
  return ['AUTHORIZATION_REQUIRED', 'PROJECT_AMBIGUOUS', 'BRANCH_AMBIGUOUS', 'ENVIRONMENT_AMBIGUOUS'].includes(error.code) ? 'NEEDS_HUMAN' : 'FAILED';
}

export async function runCommand(argv, dependencies = {}) {
  const { command, options } = parseArguments(argv);
  if (options['workspace-settings']) readWorkspaceProjectId(discoverWorkspaceSettings(options['workspace-settings']));
  const { config, file } = loadProjectConfig({ projectName: options.project, configPath: options.config });
  const services = selectServices(config, options.selectors);
  const adapter = dependencies.adapter || new ApifoxCliAdapter();
  const fetchJson = dependencies.fetchJson || defaultFetchJson;
  const common = { config, services, adapter, fetchJson, runtimeRoot: options['runtime-root'], workspaceSettingsPath: options['workspace-settings'] };
  if (command === 'config-check') return { exitCode: 0, result: { ok: true, status: 'SUCCESS', command, config: file, project: config.project.label, services: config.services.length, environments: config.environments.length } };
  if (command === 'diff') { const result = await executeDiff(common); return { exitCode: exitCode(result), result }; }
  if (command === 'validate') { const result = await executeValidate(common); return { exitCode: exitCode(result), result }; }
  if (command === 'sync') { const result = await executeSync({ ...common, full: Boolean(options.full), authorizedMutation: Boolean(options['authorized-mutation']) }); return { exitCode: exitCode(result), result }; }
  if (command === 'ensure-project') { const target = await ensureProject(config, adapter, { authorizedMutation: Boolean(options['authorized-mutation']), workspaceSettingsPath: options['workspace-settings'] }); return { exitCode: 0, result: { ok: true, status: 'SUCCESS', command, target } }; }
  if (command === 'ensure-environment') {
    if (!options.environment) throw new ToolError('USAGE', 'ensure-environment requires --environment');
    const target = await ensureProject(config, adapter, { authorizedMutation: Boolean(options['authorized-mutation']), workspaceSettingsPath: options['workspace-settings'] });
    const environment = await ensureEnvironment(config, options.environment, target, adapter, { authorizedMutation: Boolean(options['authorized-mutation']) });
    return { exitCode: 0, result: { ok: true, status: 'SUCCESS', command, target, environment } };
  }
  throw new ToolError('USAGE', `unsupported command: ${command}`);
}

async function cliMain() {
  try {
    const output = await runCommand(process.argv.slice(2));
    console.log(JSON.stringify(output.result));
    process.exitCode = output.exitCode;
  } catch (error) {
    const result = { ok: false, status: errorStatus(error), code: error.code || 'UNEXPECTED_ERROR', message: redact(error.message) };
    if (error.code === 'NAMESPACE_COLLISION' && Array.isArray(error.details?.conflicts)) result.conflicts = error.details.conflicts;
    console.log(JSON.stringify(result));
    process.exitCode = error.code === 'USAGE' ? 64 : 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) await cliMain();
