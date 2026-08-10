#!/usr/bin/env node

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(rootDir, 'worker/wrangler.local.toml');
const targetPath = resolve(rootDir, 'worker/wrangler.deploy.toml');
const secretKeys = new Set(['GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'API_TOKEN']);

if (process.argv.includes('--clean')) {
  if (existsSync(targetPath)) rmSync(targetPath);
  console.log('Removed temporary worker/wrangler.deploy.toml.');
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error('worker/wrangler.local.toml is missing.');
  process.exit(1);
}

const source = readFileSync(sourcePath, 'utf8');
let section = '';
const output = [];

for (const line of source.split(/\r?\n/)) {
  const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
  if (sectionMatch) section = sectionMatch[1].trim();

  const assignmentMatch = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
  if (section === 'vars' && assignmentMatch && secretKeys.has(assignmentMatch[1])) {
    continue;
  }
  output.push(line);
}

const sanitized = output.join('\n');
for (const key of secretKeys) {
  const assignment = new RegExp(`^\\s*${key}\\s*=`, 'm');
  if (assignment.test(sanitized)) {
    console.error(`Failed to remove secret-class variable ${key}.`);
    process.exit(1);
  }
}

writeFileSync(targetPath, sanitized, { encoding: 'utf8', mode: 0o600 });
chmodSync(targetPath, 0o600);
console.log('Wrote temporary worker/wrangler.deploy.toml with secret-class variables omitted.');
