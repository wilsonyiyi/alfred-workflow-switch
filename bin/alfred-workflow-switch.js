#!/usr/bin/env node

import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runCli} from '../src/cli.js';
import {logger} from '../src/logger.js';

const packageJson = JSON.parse(
  await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
);

try {
  await runCli({packageJson});
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
