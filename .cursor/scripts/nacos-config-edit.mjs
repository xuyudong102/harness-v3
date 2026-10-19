/** Conservative lossless field editor, NOT a general YAML parser. Unsupported syntax fails closed. */
import { fail, object } from './nacos-client.mjs';
const keyPattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/;
const ambiguousKey = /^(?:true|false|null|yes|no|on|off|y|n)$/i;
const id = (parts) => JSON.stringify(parts);
const scalar = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 8192 && !/[\x00-\x1f\x7f\u0085\u2028\u2029]/.test(v)
  || typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v));

function yamlValue(raw) {
  // Inline comments are kept byte-for-byte. Quotes with '#' are scanned, never split blindly.
  let quote = '', end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote === '"' && c === '\\') { i++; continue; }
    if (quote === "'" && c === "'" && raw[i + 1] === "'") { i++; continue; }
    if (quote) { if (c === quote) quote = ''; }
    else if (i === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) { end = i; break; }
  }
  if (quote) fail('UNSUPPORTED_CONFIG_STRUCTURE');
  const trimmed = raw.slice(0, end).trimEnd(), suffix = raw.slice(trimmed.length);
  let value;
  if (!trimmed) return { branch: true, suffix };
  if (trimmed.startsWith('"')) {
    try { value = JSON.parse(trimmed); } catch { fail('UNSUPPORTED_CONFIG_STRUCTURE'); }
  } else if (/^'(?:[^']|'')*'$/.test(trimmed)) value = trimmed.slice(1, -1).replaceAll("''", "'");
  else if (trimmed === 'null' || trimmed === '~') value = null;
  else if (/^(true|false)$/.test(trimmed)) value = trimmed === 'true';
  else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) value = Number(trimmed);
  else {
    // Refuse ambiguous YAML 1.1/1.2 scalars, aliases/tags/flow/blocks/dates and punctuation.
    if (!/^[A-Za-z_][A-Za-z0-9_./@-]*$/.test(trimmed) || /^(?:yes|no|on|off|y|n|true|false|null)$/i.test(trimmed)) fail('UNSUPPORTED_CONFIG_STRUCTURE');
    value = trimmed;
  }
  if (!scalar(value)) fail('UNSUPPORTED_CONFIG_STRUCTURE');
  return { value, suffix, branch: false, rawScalar: trimmed };
}

export function parseConfig(content, type) {
  if (!['yaml', 'properties'].includes(type) || typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024 || /\r(?!\n)|\t|\x00|[\u0085\u2028\u2029]/.test(content)) fail('UNSUPPORTED_CONFIG_STRUCTURE');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  if (eol === '\r\n' && /(?<!\r)\n/.test(content)) fail('UNSUPPORTED_CONFIG_STRUCTURE');
  const lines = content.split(eol), nodes = new Map(), stack = [], siblings = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:#.*)?$/.test(line) || type === 'properties' && /^\s*!/.test(line)) continue;
    if (type === 'properties') {
      const m = line.match(/^( *)([A-Za-z_][A-Za-z0-9_.-]{0,95})(\s*[=:]\s*)([^\r\n\\]*)$/);
      if (!m) fail('UNSUPPORTED_CONFIG_STRUCTURE');
      const parts = [m[2]], k = id(parts);
      if (nodes.has(k)) fail('DUPLICATE_CONFIG_FIELD');
      nodes.set(k, { parts, line: i, prefix: m[1] + m[2] + m[3], value: m[4], branch: false, suffix: '', indent: 0 });
      continue;
    }
    const m = line.match(/^( *)([A-Za-z_][A-Za-z0-9_.-]{0,95}):( +)?(.*)$/);
    if (!m || (!m[3] && m[4]) || ambiguousKey.test(m[2])) fail('UNSUPPORTED_CONFIG_STRUCTURE');
    const indent = m[1].length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    if (stack.length && !stack.at(-1).branch || !stack.length && indent !== 0) fail('UNSUPPORTED_CONFIG_STRUCTURE');
    const parts = [...(stack.at(-1)?.parts || []), m[2]], parent = id(parts.slice(0, -1));
    if (siblings.has(parent) && siblings.get(parent) !== indent) fail('UNSUPPORTED_CONFIG_STRUCTURE');
    siblings.set(parent, indent);
    const k = id(parts);
    if (nodes.has(k) || parts.length > 16) fail('DUPLICATE_CONFIG_FIELD');
    const node = { parts, line: i, indent, prefix: m[1] + m[2] + ':' + (m[3] || ' '), ...yamlValue(m[4]) };
    nodes.set(k, node); stack.push(node);
  }
  for (const n of nodes.values()) if (n.branch && ![...nodes.values()].some((c) => c.parts.length === n.parts.length + 1 && id(c.parts.slice(0, -1)) === id(n.parts))) fail('UNSUPPORTED_CONFIG_STRUCTURE');
  return { lines, nodes, eol, siblings };
}

export function editConfig(content, type, operation, input) {
  if (!['UPDATE', 'APPEND'].includes(operation) || !object(input) || Object.keys(input).some((k) => k !== 'changes')
    || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 32) fail('INVALID_CHANGES');
  const changes = input.changes;
  const seen = new Set();
  for (const c of changes) {
    if (!object(c) || Object.keys(c).sort().join(',') !== 'path,value' || !Array.isArray(c.path) || !c.path.length || c.path.length > 16
      || c.path.some((p) => typeof p !== 'string' || !keyPattern.test(p)) || !scalar(c.value) || seen.has(id(c.path))) fail('INVALID_CHANGES');
    seen.add(id(c.path));
    if (type === 'yaml' && c.path.some((p) => ambiguousKey.test(p))) fail('UNSUPPORTED_CONFIG_STRUCTURE');
    if (type === 'properties' && (c.path.length !== 1 || typeof c.value !== 'string' || /\\|^\s|\s$/.test(c.value))) fail('UNSUPPORTED_CONFIG_STRUCTURE');
  }
  // Overlapping parent/child changes would introduce ordering semantics; refuse them.
  for (const c of changes) for (let n = 1; n < c.path.length; n++) if (seen.has(id(c.path.slice(0, n)))) fail('INVALID_CHANGES');
  let next = content;
  const changedFields = [], addedFields = [];
  for (const c of changes) {
    const doc = parseConfig(next, type), node = doc.nodes.get(id(c.path));
    if (operation === 'UPDATE' && (!node || node.branch)) fail('FIELD_NOT_FOUND');
    if (operation === 'APPEND' && node) fail('FIELD_ALREADY_EXISTS');
    if (node) {
      if (Object.is(node.value, c.value)) continue;
      doc.lines[node.line] = node.prefix + (type === 'yaml' ? JSON.stringify(c.value) : c.value) + node.suffix;
      changedFields.push(c.path);
    } else {
      let depth = c.path.length - 1, parent;
      while (depth > 0 && !(parent = doc.nodes.get(id(c.path.slice(0, depth))))) depth--;
      if (parent && !parent.branch) fail('FIELD_PARENT_NOT_MAPPING');
      let insert = doc.lines.length;
      if (doc.lines.at(-1) === '') insert--;
      if (parent) {
        insert = parent.line + 1;
        while (insert < doc.lines.length) {
          const at = [...doc.nodes.values()].find((x) => x.line === insert);
          if (at && at.indent <= parent.indent) break;
          insert++;
        }
        if (insert === doc.lines.length && doc.lines.at(-1) === '') insert--;
      }
      let indent = parent ? doc.siblings.get(id(parent.parts)) ?? parent.indent + 2 : 0;
      const generated = [];
      for (let j = depth; j < c.path.length; j++) {
        generated.push(' '.repeat(indent) + c.path[j] + (type === 'yaml' ? ':' : '=')
          + (j === c.path.length - 1 ? (type === 'yaml' ? ' ' + JSON.stringify(c.value) : c.value) : ''));
        indent += 2;
      }
      doc.lines.splice(insert, 0, ...generated); addedFields.push(c.path);
    }
    next = doc.lines.join(doc.eol);
  }
  // Independently reparse and compare all unchanged leaves. No deletion or coercion permitted.
  const before = parseConfig(content, type), after = parseConfig(next, type);
  for (const [k, n] of before.nodes) {
    const a = after.nodes.get(k);
    if (!a || n.branch !== a.branch || !seen.has(k) && !Object.is(n.value, a.value)) fail('UNRELATED_FIELD_CHANGED');
  }
  for (const c of changes) if (!Object.is(after.nodes.get(id(c.path))?.value, c.value)) fail('EDIT_VALIDATION_FAILED');
  return { content: next, addedFields, changedFields, deletedFields: [] };
}
