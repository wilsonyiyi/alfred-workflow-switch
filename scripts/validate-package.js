#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const requiredFiles = [
  packageJson.bin['alfred-workflow-switch'],
  packageJson.exports['.'],
  'LICENSE',
  'README.md',
];

await Promise.all(requiredFiles.map(file => fs.access(path.join(packageRoot, file))));
console.log('[Alfred Switch] Package structure is valid.');
