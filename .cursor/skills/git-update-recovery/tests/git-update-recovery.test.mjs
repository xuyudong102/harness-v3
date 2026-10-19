import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectGit } from '../scripts/inspect-git.mjs';
import { resolveRules } from '../../../hooks/lib/rules-engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const skill = fs.readFileSync(path.join(root, '.cursor/skills/git-update-recovery/SKILL.md'), 'utf8');
const done = fs.readFileSync(path.join(root, '.cursor/skills/done-verify/SKILL.md'), 'utf8');
const fixtures = process.env.HARNESS_TEST_TMP || path.join(os.tmpdir(), 'harness-git-recovery-tests');
fs.mkdirSync(fixtures, { recursive: true });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fixtures, 'case-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  return dir;
}
function git(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function guard(command) {
  const result = spawnSync(process.execPath, [path.join(root, '.cursor/hooks/handle-pre-tool-use.mjs')], {
    input: JSON.stringify({ tool_name: 'Shell', tool_input: { command } }), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).permission;
}
function mergeFixture(t, ours, base, theirs) {
  const dir = fixture(t);
  for (const [file, content] of Object.entries({ ours, base, theirs })) fs.writeFileSync(path.join(dir, file), content);
  return spawnSync('git', ['merge-file', '-p', path.join(dir, 'ours'), path.join(dir, 'base'), path.join(dir, 'theirs')], { encoding: 'utf8' });
}

test('clean update is allowed and its Git rule is discovered on demand', t => {
  assert.deepEqual(inspectGit(fixture(t)).changes, []);
  assert.equal(guard('git pull --ff-only'), 'allow');
  assert.ok(resolveRules({ prompt: 'IDEA Update Project 后 Shelf 恢复冲突', paths: [] }).rules.some(r => r.name === 'git-branch'));
});
test('dirty snapshot includes index, working files and untracked; inspection writes nothing', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'tracked'), 'stage');
  git(dir, 'add', 'tracked');
  fs.writeFileSync(path.join(dir, 'tracked'), 'working');
  fs.writeFileSync(path.join(dir, 'new'), 'untracked');
  const index = fs.readFileSync(path.join(dir, '.git/index'));
  const before = inspectGit(dir);
  assert.equal(before.changes.find(c => c.path === 'tracked').status, 'AM');
  assert.equal(before.changes.find(c => c.path === 'new').status, '??');
  assert.ok(before.changes.every(c => c.sha256));
  assert.deepEqual(inspectGit(dir), before);
  assert.deepEqual(fs.readFileSync(path.join(dir, '.git/index')), index);
  assert.match(skill, /先验证备份内容再更新/);
});
test('different regions can merge while preserving both changes', t => {
  const result = mergeFixture(t, 'local\nb\nc\nd\ne\n', 'a\nb\nc\nd\ne\n', 'a\nb\nc\nd\nremote\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'local\nb\nc\nd\nremote\n');
});
test('same region exposes conflict; semantic decision remains an Agent responsibility', t => {
  const result = mergeFixture(t, 'local\n', 'base\n', 'remote\n');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /<<<<<<<[\s\S]*local[\s\S]*remote[\s\S]*>>>>>>>/);
  assert.match(skill, /分别列出本地与远程有效意图/);
  assert.match(skill, /不机械选择 Yours\/Theirs\/Both/);
});
test('remaining Shelf must be checked against source, not automatically cleared', t => {
  const dir = fixture(t), file = path.join(dir, 'shelved.patch');
  fs.writeFileSync(file, 'Index: remaining.java\n');
  inspectGit(dir);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Index: remaining.java\n');
  assert.match(skill, /本地修改恢复冲突；Git 更新成功与补丁恢复成功分别报告/);
  assert.match(skill, /文件数量不能单独证明恢复结果/);
});
test('unclear discard escalates; destructive commands with Git global options are blocked', () => {
  assert.match(skill, /丢弃价值不明的成果[\s\S]*请求明确确认/);
  assert.equal(guard('git -C repo reset --hard HEAD'), 'deny');
});
test('unmerged index is distinct from merge operation and cannot prove completion', t => {
  const dir = fixture(t);
  const blob = spawnSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { input: 'value', encoding: 'utf8' }).stdout.trim();
  const write = spawnSync('git', ['-C', dir, 'update-index', '--index-info'], {
    input: [1, 2, 3].map(stage => `100644 ${blob} ${stage}\tconflict\n`).join(''), encoding: 'utf8',
  });
  assert.equal(write.status, 0, write.stderr);
  assert.equal(inspectGit(dir).unmerged.length, 3);
  assert.equal(inspectGit(dir).operations.MERGE_HEAD, false);
  fs.writeFileSync(path.join(dir, '.git/MERGE_HEAD'), blob);
  assert.equal(inspectGit(dir).operations.MERGE_HEAD, true);
  assert.match(skill, /未解决冲突[\s\S]*不能宣称全部完成/);
});
test('failed verification is disclosed even when the index has no conflict', () => {
  assert.match(done, /失败验证必须披露/);
  assert.match(done, /required mechanical evidence `FAIL`[\s\S]*CHANGES_REQUIRED/);
});
test('ordinary read-only Git stays allowed without loading the Git recovery rule', () => {
  assert.equal(guard('git --no-optional-locks -C repo status --short'), 'allow');
  assert.ok(!resolveRules({ prompt: '只读查看 git status 与 git diff', paths: [] }).rules.some(r => r.name === 'git-branch'));
});
test('inspection from subdirectory supports real Git operation paths', t => {
  const dir = fixture(t), child = path.join(dir, 'child');
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(dir, '.git/CHERRY_PICK_HEAD'), '0123456789012345678901234567890123456789\n');
  const state = inspectGit(child);
  assert.equal(state.repo, fs.realpathSync(dir));
  assert.equal(state.operations.CHERRY_PICK_HEAD, true);
});
