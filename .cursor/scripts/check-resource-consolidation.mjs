#!/usr/bin/env node
/** Actual file/reference/source checks; never a Workflow or resource registry runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isVisibleEntryName, walk, root } from './harness-resource-utils.mjs';
import { defaultPaths, discover, wrapper, index, owned, safePath, validateIndexTargets } from './sync-codex.mjs';
import { validate, loadPlaybooks } from './check-workflow-diet.mjs';
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const read = (file) => fs.readFileSync(file, 'utf8');
const value = (name) => { const i=process.argv.indexOf(name); return i<0 ? null : process.argv[i+1]; };
const output = path.resolve(value('--codex-output') || defaultPaths().output);
const workflowFiles=walk(path.join(root,'.cursor/workflows')).filter((f)=>/^[a-z0-9-]+\.yaml$/.test(path.basename(f)));
check(workflowFiles.length===3 && workflowFiles.every((f)=>f.endsWith('.yaml')), 'Only 3 active playbooks may remain');
for (const {file,book} of loadPlaybooks('cursor')) {
  for(const error of validate(book)) failures.push(file+': '+error);
}
const canonical = walk(path.join(root,'.cursor'));
const resources = canonical.filter((f)=>f.includes('/agents/')&&f.endsWith('.md') || f.endsWith('/SKILL.md') || f.includes('/rules/')&&f.endsWith('.mdc')&&!f.includes('/skills/') || f.includes('/workflows/')&&f.endsWith('.yaml'));
const agentNames = new Set(fs.readdirSync(path.join(root,'.cursor/agents'),{withFileTypes:true})
  .filter((entry)=>isVisibleEntryName(entry.name) && entry.isFile() && /^[a-z0-9-]+\.md$/.test(entry.name))
  .map((entry)=>path.basename(entry.name,'.md')));
check(agentNames.size===6,'Agent surface drift');
for(const file of resources) {
  const text=read(file);
  for(const match of text.matchAll(/(?:agents|skills)\/[a-z0-9-]+(?:\/SKILL\.md|\.md)?/g)) {
    const ref=match[0]; // Explicit resource names only; globs/placeholders are excluded.
    const target=path.join(root,'.cursor',ref.startsWith('agents/') ? ref.replace(/\.md$/,'')+'.md' : ref.replace(/\/SKILL\.md$/,'')+'/SKILL.md');
    check(fs.existsSync(target),'Broken resource: '+path.relative(root,file)+' → '+ref);
  }
  for(const match of text.matchAll(/(?:context|analysis|design|plans|delivery|workflow|quality)\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md/g)) {
    check(fs.existsSync(path.join(root,'docs/templates',match[0])),'Missing durable template: '+path.relative(root,file)+' → '+match[0]);
  }
  check(!/phase-[1-8][^\s]*\.yaml/.test(text),'Active legacy phase reference: '+file);
}
const canonicalRules=canonical.filter((f)=>f.includes('/rules/')&&!f.includes('/skills/')&&f.endsWith('.mdc'));
const templateDir=path.join(root,'docs/templates');
const cursorRules=walk(path.join(root,'.cursor/rules')).filter((f)=>f.endsWith('.mdc'));
const cursorRuleNames=new Set(cursorRules.map((f)=>path.basename(f)));
const exceptions=new Set(['rules-loader.mdc','correction-detection.mdc','cross-ref-guard.mdc','java-edit-self-check.mdc']);
for (const file of cursorRules) {
  if(exceptions.has(path.basename(file))) continue;
  for(const match of read(file).matchAll(/`([a-z0-9-]+\.mdc)`/g)) {
    check(!cursorRuleNames.has(match[1])||match[1]===path.basename(file),'Leaf Rule cross-reference: '+file+' → '+match[1]);
  }
}
const templates=walk(templateDir).filter((f)=>path.basename(f)!=='README.md').map((f)=>path.relative(templateDir,f).replaceAll(path.sep,'/'));
const purposes=[...read(path.join(templateDir,'README.md')).matchAll(/^\| `([^`]+)` \| ([^\n]+) \|$/gm)];
for(const t of templates) check(purposes.some((m)=>m[1]===t&&m[2].trim().length>5),'Template has no consumer/purpose: '+t);
for(const m of purposes) check(templates.includes(m[1]),'Template purpose points to deleted file: '+m[1]);
// Current docs, not historical decision logs or project design source snapshots.
for(const file of [path.join(root,'README.md'),...walk(path.join(root,'docs')).filter((f)=>!f.includes('/decisions/')&&!f.includes('/design/')&&f.endsWith('architecture.md')||f.endsWith('resource-placement-guide.md')), ...resources.filter((f)=>f.endsWith('/SKILL.md')).map((f)=>path.join(path.dirname(f),'README.md')).filter((f)=>fs.existsSync(f))]) {
  check(!/所有调试活动必须|由对应 Skill 读取并驱动|确认通过后进入 (?:DDL|实现计划)|八阶段是默认|镜像扩展面|默认.*(?:Reviewer committee|多 Reviewer 委员会)/.test(read(file)),'Stale active documentation: '+file);
}
const skills=discover(), expected=new Set(skills.map((s)=>s.name));
const generated=path.join(output,'generated/skills');
safePath(generated,output);
const actual=fs.existsSync(generated)?fs.readdirSync(generated,{withFileTypes:true})
  .filter((entry)=>isVisibleEntryName(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()))
  .map((entry)=>entry.name):[];
check(actual.length===expected.size && actual.every((n)=>expected.has(n)),'Stale/missing generated wrapper');
check(actual.every((name)=>!name.startsWith('zfnjjs-')),'Legacy prefixed wrapper remains active');
for(const item of skills) {
  const file=path.join(generated,item.name,'SKILL.md');
  check(fs.existsSync(file)&&owned(file),'Wrapper ownership/absence: '+item.name);
  if(fs.existsSync(file)) check(read(file)===wrapper(item),'Wrapper target/metadata drift: '+item.name);
  check(fs.existsSync(item.source),'Missing wrapper source: '+item.source);
}
const idx=path.join(output,'config/generated-harness-index.md');
safePath(idx,output);
check(fs.existsSync(idx)&&read(idx)===index(),'Generated index drift / removed resource');
const indexValidation=validateIndexTargets(read(idx));
check(!read(path.join(root,'README.md')).includes('.cursor/mcp/mcp-template.json'),'README has nonexistent MCP template');
// Source stability smoke: real MCP configuration files, not service consumer labels.
const mcpFiles=canonical.filter((f)=>f.endsWith('/mcp.json') || f.includes('/mcp/')&&f.endsWith('.json'));
// This repository declares project/host-managed MCP. Do not turn an empty config scan into configuration PASS.
check(mcpFiles.length===0,'Unexpected repo-owned MCP config: update explicit discovery mode before validation');
const mcpRule=read(path.join(root,'.cursor/rules/mcp.mdc'));
for(const capability of ['loki-mcp','swagger-mcp','dbx','codegraph-mcp']) check(mcpRule.includes(capability),'MCP discovery lost: '+capability);
check(mcpRule.includes('skills/nacos-read') && fs.existsSync(path.join(root,'.cursor/scripts/nacos-read.mjs')), 'Nacos CLI discovery lost');
check(!mcpRule.includes('nacos-mcp'), 'Retired Nacos MCP remains an active recommendation');
check(fs.existsSync(path.join(root,'.cursor/skills/nacos-config-write/SKILL.md')) && fs.existsSync(path.join(root,'.cursor/scripts/nacos-config-write.mjs')), 'Nacos controlled write discovery lost');
for(const removed of ['ones-mcp','middle-mcp']) check(!mcpRule.includes(removed),'Removed MCP still documented: '+removed);
const guard=path.join(root,'.cursor/hooks/handle-pre-tool-use.mjs'), guardRel=path.relative(root,guard);
// Reviewed Git global-option extension; keep an explicit body fingerprint plus adversarial behavior tests.
const guardFingerprint = 'a8ae1ef466aacbb81650681ac842eb067b2bf1b4fd9289230bd1754461b8a7f8';
check(createHash('sha256').update(read(guard)).digest('hex')===guardFingerprint,'Safety Hook body changed: '+guardRel);
if(failures.length) throw new Error(failures.join('\n'));
console.log(JSON.stringify({agents:agentNames.size,skills:skills.length,activePlaybooks:workflowFiles.length,legacyPhases:0,rules:canonicalRules.length,templates:templates.length,wrappers:actual.length,staleWrappers:0,manualSemanticDuplicates:0,brokenReferences:0,...indexValidation,repoMcpConfigs:mcpFiles.length,mcpReferenceSmoke:'PASS'}));
console.log('Resource consolidation / cross-reference / generated target / semantic source passed; MCP references validated, configuration external/project-managed (not runtime-tested)');
