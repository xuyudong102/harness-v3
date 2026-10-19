#!/usr/bin/env node
/**
 * 校验 rules-loader.mdc 场景表 与 rules-engine.mjs 路由配置是否同步。
 *
 * 检查项：
 *   1. SCENE_DETECTORS 与 SCENE_TO_ROW 的 key 集合一致
 *   2. SCENE_TO_ROW 的 value 均存在于场景表「任务场景」列
 *   3. 场景表每一行至少被一个 SCENE_TO_ROW 引用（tenant/mq 可共用一行）
 *   4. 场景表引用的规则文件均存在
 * 场景表是发现索引，不强制覆盖每个 Rule。
 *
 * 运行：
 *   node .cursor/scripts/check-rule-routing-sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  SCENE_DETECTORS,
  SCENE_TO_ROW,
  getProjectRoot,
  parseScenarioTable,
  resolveRules,
} from '../hooks/lib/rules-engine.mjs';
const PROJECT_ROOT = getProjectRoot();
const RULES_ROOT = path.join(PROJECT_ROOT, '.cursor', 'rules');
const RULES_LOADER = path.join(RULES_ROOT, 'rules-loader.mdc');

const errors = [];

function fail(code, detail) {
  errors.push(`${code}: ${detail}`);
}

function main() {
  const loaderContent = fs.readFileSync(RULES_LOADER, 'utf8');
  const scenarioTable = parseScenarioTable(loaderContent);
  const tableScenes = new Set(scenarioTable.keys());
  const tableRules = new Set();
  for (const rules of scenarioTable.values()) {
    rules.forEach((rule) => tableRules.add(rule));
  }

  const detectorKeys = new Set(Object.keys(SCENE_DETECTORS));
  const rowKeys = new Set(Object.keys(SCENE_TO_ROW));

  for (const key of detectorKeys) {
    if (!rowKeys.has(key)) {
      fail('DETECTOR_WITHOUT_ROW', `SCENE_DETECTORS.${key} 缺少对应 SCENE_TO_ROW 条目`);
    }
  }
  for (const key of rowKeys) {
    if (!detectorKeys.has(key)) {
      fail('ROW_WITHOUT_DETECTOR', `SCENE_TO_ROW.${key} 缺少对应 SCENE_DETECTORS 条目`);
    }
  }

  const rowTargets = new Set(Object.values(SCENE_TO_ROW));
  for (const target of rowTargets) {
    if (!tableScenes.has(target)) {
      fail('ROW_TARGET_MISSING', `SCENE_TO_ROW 指向的场景不在 rules-loader 表内: ${target}`);
    }
  }

  for (const scene of tableScenes) {
    const covered = [...rowTargets].includes(scene);
    if (!covered) {
      fail('TABLE_ROW_UNCOVERED', `场景表行未被任何 SCENE_TO_ROW 引用: ${scene}`);
    }
  }

  for (const ruleName of tableRules) {
    const direct = path.join(RULES_ROOT, `${ruleName}.mdc`);
    const projectExists = fs
      .existsSync(path.join(RULES_ROOT, 'projects'))
      ? walkProjectRuleExists(ruleName)
      : false;
    if (!fs.existsSync(direct) && !projectExists) {
      fail('TABLE_RULE_MISSING', `场景表引用不存在的规则文件: ${ruleName}.mdc`);
    }
  }

  const projectCases = [
    ['/workspace/projects/mall/repos/b2c/backend', ['b2cmall']],
    ['/workspace/projects/mall/repos/b2c/backend/zfn-financial', ['b2cmall']],
    ['C:\\workspace\\projects\\mall\\repos\\b2c\\backend', ['b2cmall']],
    ['/workspace/projects/mall/repos/b2b/backend/broker', ['broker']],
    ['/workspace/projects/mall/repos/b2b/backend/yunshang', ['yunshang']],
    ['/workspace/projects/mall/repos/b2c/backend-backup', []],
    ['/workspace/projects/mall/repos/b2c/frontend', []],
  ];
  for (const [filePath, expected] of projectCases) {
    const actual = [...new Set(resolveRules({ prompt: '检查 API', paths: [filePath] }).rules
      .filter((rule) => rule.project).map((rule) => rule.project))].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail('PROJECT_SCOPE_MISMATCH', `${filePath}: expected=${expected.join(',')} actual=${actual.join(',')}`);
    }
  }

  // Exercise the real Hook from a linked root with no attached/open files.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-root-routing-'));
  try {
    const workspace = path.join(tempRoot, 'repos/b2c/backend');
    fs.mkdirSync(workspace, { recursive: true });
    fs.symlinkSync(path.join(PROJECT_ROOT, '.cursor'), path.join(workspace, '.cursor'), 'dir');
    const hook = spawnSync(process.execPath, [path.join(workspace, '.cursor/hooks/handle-before-submit.mjs')], {
      cwd: workspace, input: JSON.stringify({ prompt: '修改 B2C API 返回字段' }), encoding: 'utf8', timeout: 5000,
    });
    let context = '';
    try { context = JSON.parse(hook.stdout).additional_context || ''; } catch { /* fail below */ }
    if (hook.status !== 0 || !context.includes('b2cmall-context.mdc')
        || context.includes('broker-facts.mdc') || context.includes('yunshang-facts.mdc')) {
      fail('ROOT_ONLY_DISCOVERY', 'linked B2C root must discover only B2C project facts without file context');
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (errors.length > 0) {
    console.error('Rule routing sync validation failed:');
    errors.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
  }

  console.log(
    `Rule routing sync passed (${detectorKeys.size} scenes, ${tableScenes.size} table rows, ${tableRules.size} routed rules)`,
  );
  console.log(`Project root routing / isolation passed (${projectCases.length} cases)`);
  console.log('Linked root-only Hook discovery passed (no attached/open files)');
}

function walkProjectRuleExists(ruleName) {
  const projectsDir = path.join(RULES_ROOT, 'projects');
  if (!fs.existsSync(projectsDir)) {
    return false;
  }
  for (const projectDir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (projectDir.name.startsWith('.') || !projectDir.isDirectory()) {
      continue;
    }
    const candidate = path.join(projectsDir, projectDir.name, `${ruleName}.mdc`);
    if (fs.existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

main();
