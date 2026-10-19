#!/usr/bin/env node
/** Read-only Git state evidence. No restoration, semantic verdict or persisted state. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function inspectGit(repo) {
  const git = (...args) => {
    const run = spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], {
      encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (run.status !== 0) throw new Error(run.stderr.trim() || `git failed: ${args[0]}`);
    return run.stdout;
  };
  const root = fs.realpathSync(git('rev-parse', '--show-toplevel').trim());
  repo = root;
  const gitPath = (name) => path.resolve(root, git('rev-parse', '--git-path', name).trim());
  const digest = (file) => {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat || stat.isDirectory()) return null;
    const data = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
    return crypto.createHash('sha256').update(data).digest('hex');
  };
  const maybe = (...args) => { try { return git(...args).trim(); } catch { return null; } };
  const records = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0');
  const changes = [];
  for (let i = 0; i < records.length; i++) {
    if (!records[i]) continue;
    const status = records[i].slice(0, 2), file = records[i].slice(3);
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) throw new Error('Status path escaped repository');
    const entry = { status, path: file, sha256: digest(absolute) };
    if (/[RC]/.test(status)) entry.originalPath = records[++i];
    changes.push(entry);
  }
  return {
    repo: root, branch: maybe('symbolic-ref', '--short', '-q', 'HEAD'),
    HEAD: maybe('rev-parse', '--verify', 'HEAD'), upstream: maybe('rev-parse', '--abbrev-ref', '@{u}'),
    changes, indexSha256: digest(gitPath('index')),
    unmerged: git('ls-files', '-u').trim().split('\n').filter(Boolean),
    operations: Object.fromEntries(['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD',
      'rebase-merge', 'rebase-apply', 'sequencer'].map(name => [name, fs.existsSync(gitPath(name))])),
    stash: git('stash', 'list', '--format=%gd:%H').trim().split('\n').filter(Boolean),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: inspect-git.mjs <repo>');
  console.log(JSON.stringify(inspectGit(path.resolve(process.argv[2])), null, 2));
}
