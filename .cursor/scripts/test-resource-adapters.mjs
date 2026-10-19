#!/usr/bin/env node
/** Isolated forward checks: real link/sync commands, stale cleanup and ownership protection. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, walk } from './harness-resource-utils.mjs';
import {
  marker,
  ownerId,
  legacyOwnership,
  legacyWrapper,
  legacyIndex,
  legacyAgentsConfig,
  defaultPaths,
  ownership,
  discover,
  wrapper,
  index,
  agentsConfig,
  validateIndexTargets,
} from './sync-codex.mjs';
const workerFlag = '--harness-temp-worker';

async function runController() {
  fs.mkdirSync(os.tmpdir(), {recursive:true});
  const tempBase = path.join(fs.realpathSync(os.tmpdir()), 'zfnjjs-harness');
  fs.mkdirSync(tempBase, {recursive:true});
  const temp = fs.mkdtempSync(path.join(tempBase, 'resource-adapters.'));
  const keepTemp = process.env.HARNESS_KEEP_TEMP === '1';
  let tempHandled = false, child, pendingSignal;
  const cleanupTemp = () => {
    if (tempHandled) return;
    tempHandled = true;
    if (path.dirname(temp) !== tempBase || !path.basename(temp).startsWith('resource-adapters.')) {
      throw new Error('Refusing unsafe Harness temp cleanup: ' + temp);
    }
    if (keepTemp) {
      console.error('HARNESS_TEMP_RETAINED path=' + temp);
      return;
    }
    fs.rmSync(temp, {recursive:true,force:true,maxRetries:3,retryDelay:50});
  };
  process.once('exit', cleanupTemp);
  const handlers = new Map();
  for (const signal of ['SIGHUP','SIGINT','SIGTERM']) {
    const handler = () => {
      pendingSignal = signal;
      if (child) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  let result;
  try {
    child = spawn(process.execPath,[fileURLToPath(import.meta.url),workerFlag,temp],{stdio:'inherit',env:process.env});
    result = await new Promise((resolve,reject) => {
      child.once('error',reject);
      child.once('exit',(code,signal)=>resolve({code,signal}));
    });
  } finally {
    cleanupTemp();
    for (const [signal,handler] of handlers) process.removeListener(signal,handler);
  }
  if (pendingSignal) {
    process.kill(process.pid,pendingSignal);
  } else if (result.signal) {
    process.kill(process.pid,result.signal);
  } else if (result.code !== 0) {
    process.exitCode = result.code ?? 1;
  }
}

function runWorker(temp) {
  fs.mkdirSync(os.tmpdir(), {recursive:true});
  const tempBase = path.join(fs.realpathSync(os.tmpdir()), 'zfnjjs-harness');
  temp = fs.realpathSync(temp);
  if (path.dirname(temp) !== tempBase || !path.basename(temp).startsWith('resource-adapters.')) {
    throw new Error('Refusing unowned Harness temp workspace: ' + temp);
  }
  const keepTemp = process.env.HARNESS_KEEP_TEMP === '1';
// Link scripts may normalize executable bits. Exercise an isolated source copy, never the real Harness.
const linkSource=path.join(temp,'link-source');
fs.cpSync(root,linkSource,{recursive:true,verbatimSymlinks:true,filter:(src)=>{
  const rel=path.relative(root,src);
  return rel!=='.git' && !rel.startsWith('.git'+path.sep) && rel!=='.agent-work' && !rel.startsWith('.agent-work'+path.sep);
}});
const sync = path.join(root,'.cursor/scripts/sync-codex.mjs');
const output=path.join(temp,'codex'), skills=path.join(temp,'skills');
const run = () => execFileSync(process.execPath,[sync,'--output',output,'--skills-dir',skills],{encoding:'utf8'});
const target = (name) => path.join(output,'generated/skills',name);
const write = (file,text) => { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,text); };

// Resource discovery ignores OS metadata, hidden entries and non-Skill files without weakening stale cleanup.
const discoverySync=fs.realpathSync(path.join(linkSource,'.cursor/scripts/sync-codex.mjs'));
const discoveryOutput=path.join(temp,'discovery-codex'), discoverySkills=path.join(temp,'discovery-skills');
const runDiscovery=()=>execFileSync(process.execPath,[discoverySync,'--output',discoveryOutput,'--skills-dir',discoverySkills],{encoding:'utf8'});
write(path.join(linkSource,'.cursor/skills/.DS_Store'),'macOS metadata');
write(path.join(linkSource,'.cursor/skills/.hidden-metadata'),'hidden metadata');
write(path.join(linkSource,'.cursor/skills/notes.txt'),'ordinary file');
fs.mkdirSync(path.join(linkSource,'.cursor/skills/ordinary-directory'));
write(path.join(linkSource,'.cursor/agents/.hidden-agent.md'),'hidden agent');
write(path.join(linkSource,'.cursor/agents/notes.txt'),'ordinary agent file');
write(path.join(linkSource,'.cursor/rules/.hidden-rule.mdc'),'hidden rule');
write(path.join(linkSource,'.cursor/rules/.hidden-group/nested.mdc'),'hidden rule directory');
write(path.join(linkSource,'.cursor/workflows/.hidden-workflow.yaml'),'hidden workflow');
runDiscovery();
const discoveryIndex=fs.readFileSync(path.join(discoveryOutput,'config/generated-harness-index.md'),'utf8');
assert(discoveryIndex.includes('skills/done-verify/SKILL.md'),'legal Skill was not discovered');
for(const ignored of ['.DS_Store','.hidden-metadata','notes.txt','ordinary-directory','.hidden-agent.md','.hidden-rule.mdc','.hidden-workflow.yaml']) {
  assert(!discoveryIndex.includes(ignored),'non-Skill entry was discovered: '+ignored);
}
assert.equal(walk(path.join(linkSource,'.cursor')).filter((file)=>path.relative(path.join(linkSource,'.cursor'),file).split(path.sep).some((name)=>name.startsWith('.'))).length,0,'shared resource walk discovered a hidden entry');
const hiddenGenerated=path.join(discoveryOutput,'generated/skills/.hidden-metadata');
write(hiddenGenerated,'preserve me');
fs.rmSync(path.join(linkSource,'.cursor/skills/brainstorming'),{recursive:true});
runDiscovery();
assert(!fs.existsSync(path.join(discoveryOutput,'generated/skills/brainstorming')),'stale managed Skill was not removed');
assert.equal(fs.readFileSync(hiddenGenerated,'utf8'),'preserve me','stale cleanup changed unrelated hidden metadata');
fs.cpSync(path.join(root,'.cursor/skills/brainstorming'),path.join(linkSource,'.cursor/skills/brainstorming'),{recursive:true});

const managed = 'obsolete-fixture';
const staleBody = (name) => wrapper({name,source:path.join(root,'.cursor/skills',name,'SKILL.md'),description:'retired fixture'});
write(path.join(target(managed),'SKILL.md'),staleBody(managed));
fs.mkdirSync(skills,{recursive:true}); fs.symlinkSync(target(managed),path.join(skills,managed),'dir');
write(path.join(skills,'user-maintained/SKILL.md'),'user-owned');
write(path.join(output,'config/user-config.md'),'user-config');
run();
assert(!fs.existsSync(target(managed)) && !fs.lstatSync(path.join(skills,managed),{throwIfNoEntry:false}));
const first=fs.readFileSync(path.join(output,'config/generated-harness-index.md'),'utf8');
run(); assert.equal(fs.readFileSync(path.join(output,'config/generated-harness-index.md'),'utf8'),first);
assert.equal(fs.readFileSync(path.join(skills,'user-maintained/SKILL.md'),'utf8'),'user-owned');
assert.equal(fs.readFileSync(path.join(output,'config/user-config.md'),'utf8'),'user-config');
for(const item of discover()) {
  const file=path.join(target(item.name),'SKILL.md');
  assert(fs.readFileSync(file,'utf8').includes(item.source) && fs.existsSync(item.source));
}
// A public capability name alone is never ownership. Abort before any update.
const conflict=path.join(skills,discover()[0].name);
fs.unlinkSync(conflict); fs.mkdirSync(conflict); write(path.join(conflict,'SKILL.md'),'manual-user-skill');
const blocked=spawnSync(process.execPath,[sync,'--output',output,'--skills-dir',skills],{encoding:'utf8'});
assert.notEqual(blocked.status,0);
assert(blocked.stderr.includes('Refusing user Skill'));
assert.equal(fs.readFileSync(path.join(conflict,'SKILL.md'),'utf8'),'manual-user-skill');
assert.equal(fs.readFileSync(path.join(output,'config/generated-harness-index.md'),'utf8'),first);
fs.unlinkSync(path.join(conflict,'SKILL.md')); fs.rmdirSync(conflict); fs.symlinkSync(target(discover()[0].name),conflict,'dir');
const unowned=discover()[1].name;
fs.unlinkSync(path.join(skills,unowned));
fs.rmSync(target(unowned),{recursive:true});
write(path.join(target(unowned),'SKILL.md'),'manual generated-directory occupant');
assert.notEqual(spawnSync(process.execPath,[sync,'--output',output,'--skills-dir',skills],{encoding:'utf8'}).status,0);
assert.equal(fs.readFileSync(path.join(target(unowned),'SKILL.md'),'utf8'),'manual generated-directory occupant');
fs.unlinkSync(path.join(target(unowned),'SKILL.md')); fs.rmdirSync(target(unowned));
run();
// Observe the entire isolated tree, including symlink targets located outside the managed root.
const snapshot = (dir) => {
  const result=[];
  const visit=(file) => {
    const stat=fs.lstatSync(file);
    result.push([path.relative(dir,file),stat.mode,stat.isSymbolicLink()?fs.readlinkSync(file):stat.isFile()?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):'directory']);
    if(stat.isDirectory()) for(const name of fs.readdirSync(file).sort()) visit(path.join(file,name));
  };
  visit(dir); return result;
};
const adversarial=[];
function abortCase(label, setup) {
  const base=path.join(temp,label), out=path.join(base,'codex'), catalog=path.join(base,'skills');
  fs.mkdirSync(base); execFileSync(process.execPath,[sync,'--output',out,'--skills-dir',catalog]);
  setup({base,out,catalog,generated:path.join(out,'generated/skills')});
  const before=snapshot(base);
  const result=spawnSync(process.execPath,[sync,'--output',out,'--skills-dir',catalog],{encoding:'utf8'});
  assert.notEqual(result.status,0,label+' must abort');
  assert.deepEqual(snapshot(base),before,label+' mutated a file/link');
  adversarial.push({case:label,status:'PASS',exit:result.status,noMutation:true});
}
abortCase('stale-directory-symlink',({base,generated})=>{
  const victim=path.join(base,'other-project'); write(path.join(victim,'SKILL.md'),marker+'\nforeign source: /other/project/SKILL.md');
  fs.symlinkSync(victim,path.join(generated,'zzz-stale'),'dir');
});
abortCase('other-output-tree',({base,generated})=>{
  const victim=path.join(base,'other-codex/generated/skills/zzz-stale'); write(path.join(victim,'SKILL.md'),staleBody('zzz-stale'));
  fs.symlinkSync(victim,path.join(generated,'zzz-stale'),'dir');
});
abortCase('manual-capability-directory',({generated})=>write(path.join(generated,discover()[0].name,'SKILL.md'),'user maintained'));
abortCase('generic-marker-foreign-source',({generated})=>write(path.join(generated,discover()[0].name,'SKILL.md'),wrapper(discover()[0]).replace('\n'+ownership,'').replace(root,'/other/project')));
abortCase('foreign-owner-identity',({generated})=>write(path.join(generated,discover()[0].name,'SKILL.md'),wrapper(discover()[0]).replace('owner: '+ownerId,'owner: other-project')));
abortCase('full-preflight',({base,generated})=>{
  write(path.join(generated,'aaa-legal/SKILL.md'),staleBody('aaa-legal'));
  const early=path.join(generated,discover()[0].name,'SKILL.md');
  write(early,wrapper({...discover()[0],description:'old managed metadata'}));
  const victim=path.join(base,'late-victim'); write(path.join(victim,'SKILL.md'),staleBody('zzz-unsafe'));
  fs.symlinkSync(victim,path.join(generated,'zzz-unsafe'),'dir');
});
abortCase('same-prefix-boundary',({out,generated})=>{
  const victim=path.join(out,'generated/skills-foreign'); write(path.join(victim,'SKILL.md'),staleBody('zzz-unsafe'));
  fs.symlinkSync(victim,path.join(generated,'zzz-unsafe'),'dir');
});
abortCase('generated-parent-symlink',({base,out,generated})=>{
  const victim=path.join(base,'foreign-tree'); fs.renameSync(generated,victim); fs.symlinkSync(victim,generated,'dir');
});
abortCase('skill-leaf-symlink',({base,generated})=>{
  const victim=path.join(base,'victim.md'); write(victim,wrapper(discover()[0]));
  const file=path.join(generated,discover()[0].name,'SKILL.md'); fs.unlinkSync(file); fs.symlinkSync(victim,file);
});
abortCase('config-leaf-symlink',({base,out})=>{
  const file=path.join(out,'config/generated-harness-index.md'), victim=path.join(base,'victim-index.md');
  fs.renameSync(file,victim); fs.symlinkSync(victim,file);
});
const update=discover()[0], updateFile=path.join(target(update.name),'SKILL.md');
write(updateFile,wrapper({...update,description:'previous managed description'}));
run(); assert.equal(fs.readFileSync(updateFile,'utf8'),wrapper(update));
assert(!discover().some((item)=>item.name.startsWith('zfnjjs-')),'public capability names retain the legacy prefix');
assert(wrapper(update).includes('Harness owner: '+ownerId+'; adapter-storage: zfnjjs;'),'stable Adapter ownership metadata missing');
assert(!index().includes('skills/zfnjjs-'),'generated index retains legacy capability names');
assert(index().includes('## How to use this index'),'generated index lacks discovery guidance');
assert(index().includes('rules/rules-loader.mdc'),'generated index lacks Rule discovery entry');
assert(index().includes('rules/projects/<matching-project>/'),'generated index lacks project-scope discovery boundary');
assert(agentsConfig().includes('$CODEX_HOME/harness/zfnjjs/config/generated-harness-index.md'),'generated Adapter lacks index bootstrap');
assert(agentsConfig().includes('rules/rules-loader.mdc'),'generated Adapter lacks Rule discovery entry');
assert(agentsConfig().includes('rules/projects/<matching-project>/'),'generated Adapter lacks project-scope discovery boundary');
assert(!legacyIndex().includes('## How to use this index'),'legacy index migration contract changed');
assert(!legacyAgentsConfig().includes('$CODEX_HOME/harness/zfnjjs/config/generated-harness-index.md'),'legacy Adapter migration contract changed');

// Default installation is CODEX_HOME-scoped and independent of the Harness clone location.
const isolatedCodexHome=path.join(temp,'default-codex-home');
assert.equal(defaultPaths({CODEX_HOME:isolatedCodexHome}).output,path.join(isolatedCodexHome,'harness/zfnjjs'));
assert.equal(defaultPaths({CODEX_HOME:isolatedCodexHome}).skillsDir,path.join(isolatedCodexHome,'skills'));

// Exact legacy artifacts migrate once: prefixed links/wrappers and current-generator configs only.
const legacyOutput=path.join(temp,'legacy-codex'), legacySkills=path.join(temp,'legacy-skills');
const migratedOutput=path.join(temp,'migrated-codex');
fs.mkdirSync(legacySkills,{recursive:true});
for(const item of discover()) {
  const name='zfnjjs-'+item.name, dir=path.join(legacyOutput,'generated/skills',name);
  write(path.join(dir,'SKILL.md'),legacyWrapper(item));
  fs.symlinkSync(dir,path.join(legacySkills,name),'dir');
}
write(path.join(legacyOutput,'config/generated-harness-index.md'),legacyIndex());
write(path.join(legacyOutput,'config/AGENTS.generated.md'),legacyAgentsConfig());
write(path.join(legacyOutput,'config/user-config.md'),'preserve legacy user config');
const migrationResult=execFileSync(process.execPath,[sync,'--output',migratedOutput,'--skills-dir',legacySkills],{encoding:'utf8'}).trim().split('\n').at(-1);
const migrationJson=JSON.parse(migrationResult);
assert.equal(migrationJson.migration.legacyLinksRemoved.length,discover().length);
assert.equal(migrationJson.migration.legacyWrappersRemoved.length,discover().length);
assert.equal(migrationJson.migration.legacyConfigsRemoved.length,2);
assert.equal(fs.readFileSync(path.join(legacyOutput,'config/user-config.md'),'utf8'),'preserve legacy user config');
assert(!fs.readdirSync(legacySkills).some((name)=>name.startsWith('zfnjjs-')));
for(const item of discover()) {
  const link=path.join(legacySkills,item.name), expected=path.join(migratedOutput,'generated/skills',item.name);
  assert(fs.lstatSync(link).isSymbolicLink());
  assert.equal(path.resolve(path.dirname(link),fs.readlinkSync(link)),expected);
  assert.equal(fs.readFileSync(path.join(expected,'SKILL.md'),'utf8'),wrapper(item));
}

// One proven legacy install plus an unproven prefixed directory fails before any cleanup.
const blockedLegacyOutput=path.join(temp,'blocked-legacy-codex'), blockedLegacySkills=path.join(temp,'blocked-legacy-skills');
const legacyItem=discover()[0], legacyName='zfnjjs-'+legacyItem.name;
write(path.join(blockedLegacyOutput,'generated/skills',legacyName,'SKILL.md'),legacyWrapper(legacyItem));
fs.mkdirSync(blockedLegacySkills,{recursive:true});
fs.symlinkSync(path.join(blockedLegacyOutput,'generated/skills',legacyName),path.join(blockedLegacySkills,legacyName),'dir');
write(path.join(blockedLegacyOutput,'generated/skills/zfnjjs-foreign/SKILL.md'),'user maintained');
const blockedLegacyBefore=snapshot(temp);
const blockedLegacy=spawnSync(process.execPath,[sync,'--output',path.join(temp,'blocked-new-output'),'--skills-dir',blockedLegacySkills],{encoding:'utf8'});
assert.notEqual(blockedLegacy.status,0);
assert(blockedLegacy.stderr.includes('Refusing unproven legacy wrapper'));
assert.deepEqual(snapshot(temp),blockedLegacyBefore,'legacy migration mutated before full preflight');
// Explicit target resolution is independent of generated-text equality.
assert.throws(()=>validateIndexTargets(index()+'\n- repo-local: `mcp/missing-fixture.json`\n'),/missing repo-local index target/);
assert.equal(validateIndexTargets(index()).brokenIndexTargets,0);
assert.equal(validateIndexTargets(index()).mcpMode,'MCP_EXTERNAL_CONFIGURATION');
assert.equal(validateIndexTargets(index()).runtimeConfigurationValidated,false);
assert(!index().includes('mcp/mcp-template.json'));
assert(!fs.readFileSync(path.join(root,'README.md'),'utf8').includes('.cursor/mcp/mcp-template.json'));
// A local source copy with its own Git object database allows the REAL guard to run after lifecycle changes.
execFileSync('git',['clone','--shared','--no-checkout',root,path.join(temp,'lifecycle-source')],{stdio:'pipe'});
const lifecycle=path.join(temp,'lifecycle-source');
fs.cpSync(linkSource,lifecycle,{recursive:true,verbatimSymlinks:true});
const lifecycleOutput=path.join(temp,'lifecycle-codex'), lifecycleSkills=path.join(temp,'lifecycle-skills');
const lifecycleRebuild=()=>execFileSync(process.execPath,[fs.realpathSync(path.join(lifecycle,'.cursor/scripts/sync-codex.mjs')),'--output',lifecycleOutput,'--skills-dir',lifecycleSkills],{encoding:'utf8'});
const guard=()=>spawnSync(process.execPath,[path.join(lifecycle,'.cursor/scripts/check-resource-consolidation.mjs'),'--codex-output',lifecycleOutput],{encoding:'utf8'});
lifecycleRebuild();
const initialGuard=guard(); assert.equal(initialGuard.status,0,initialGuard.stderr);
const project=path.join(temp,'cursor-project');
fs.mkdirSync(project); write(path.join(project,'docs/README.md'),'project-owned-doc');
execFileSync('bash',[path.join(linkSource,'link-cursor-config.sh'),project],{encoding:'utf8'});
assert(fs.existsSync(path.join(project,'.cursor/skills/done-verify/SKILL.md')));
assert(fs.existsSync(path.join(project,'.cursor/agents/integrated-reviewer.md')));
assert(fs.existsSync(path.join(project,'.cursor/workflows/feature-delivery.yaml')));
assert(fs.existsSync(path.join(project,'.cursor/rules/projects/broker/broker-facts.mdc')));
assert(fs.existsSync(path.join(project,'.cursor/rules/projects/yunshang/yunshang-facts.mdc')));
assert.equal(fs.readFileSync(path.join(project,'docs/README.md'),'utf8'),'project-owned-doc');
const before=fs.readFileSync(path.join(project,'.cursor/AGENTS.md'),'utf8');
execFileSync('bash',[path.join(linkSource,'link-cursor-config.sh'),project],{encoding:'utf8'});
assert.equal(fs.readFileSync(path.join(project,'.cursor/AGENTS.md'),'utf8'),before);
// Fresh B2C installation must work independently of this user's existing AGENTS/links.
const b2cRoot = path.join(temp, 'fresh-project/repos/b2c/backend');
fs.mkdirSync(b2cRoot, {recursive:true});
const installB2c = () => execFileSync('bash', [path.join(linkSource,'link-cursor-config.sh'),b2cRoot], {encoding:'utf8'});
installB2c();
const b2cAgents = fs.readFileSync(path.join(b2cRoot,'AGENTS.md'),'utf8');
assert(b2cAgents.includes('b2cmall') && !b2cAgents.includes('AGENTS.generated.md'));
assert(fs.lstatSync(path.join(b2cRoot,'.cursor/skills')).isSymbolicLink());
assert(fs.existsSync(path.join(b2cRoot,'.cursor/skills/nacos-read/SKILL.md')));
assert(fs.existsSync(path.join(b2cRoot,'.cursor/skills/nacos-config-write/SKILL.md')));
assert(fs.readFileSync(path.join(output,'generated/skills/nacos-config-write/SKILL.md'),'utf8').includes(path.join(root,'.cursor/skills/nacos-config-write/SKILL.md')));
assert(!fs.lstatSync(path.join(b2cRoot,'.cursor/.DS_Store'),{throwIfNoEntry:false}));
const b2cBefore = snapshot(b2cRoot); installB2c(); assert.deepEqual(snapshot(b2cRoot),b2cBefore);
write(path.join(b2cRoot,'AGENTS.md'),'project-owned B2C instructions');
installB2c(); assert.equal(fs.readFileSync(path.join(b2cRoot,'AGENTS.md'),'utf8'),'project-owned B2C instructions');
const rootHook = spawnSync(process.execPath,[path.join(b2cRoot,'.cursor/hooks/handle-before-submit.mjs')],
  {cwd:b2cRoot,input:JSON.stringify({prompt:'修改 B2C API 返回字段'}),encoding:'utf8'});
const b2cDiscovery = JSON.parse(rootHook.stdout).additional_context || '';
assert.equal(rootHook.status,0);
assert(b2cDiscovery.includes('b2cmall-context.mdc') && !b2cDiscovery.includes('broker-facts.mdc') && !b2cDiscovery.includes('yunshang-facts.mdc'));
execFileSync(process.execPath,[path.join(root,'.cursor/scripts/check-resource-consolidation.mjs'),'--codex-output',output],{encoding:'utf8'});
console.log(JSON.stringify({tempLifecycle:keepTemp?'RETAINED':'CLEANED',...(keepTemp?{temp}:{}),adversarial,staleCleanup:'PASS',managedUpdate:'PASS',repeatSync:'PASS',unmanagedSkillProtection:'PASS',unmanagedGeneratedProtection:'PASS',wrapperTargets:'PASS',indexTargets:'PASS',mcpMode:'MCP_EXTERNAL_CONFIGURATION',missingIndexTarget:'FAIL as expected',cursorLink:'PASS',cursorRepeatLink:'PASS',b2cFirstInstall:'PASS',b2cProjectAgentsPreserved:'PASS',b2cRootRouting:'PASS'}));
}

const workerIndex = process.argv.indexOf(workerFlag);
if (workerIndex < 0) await runController();
else runWorker(path.resolve(process.argv[workerIndex + 1]));
