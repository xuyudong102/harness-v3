/** Host-neutral deterministic helpers for Harness resource checks and adapters. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const isVisibleEntryName = (name) => !name.startsWith('.');

export function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => isVisibleEntryName(entry.name)).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
