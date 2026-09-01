#!/usr/bin/env node

import {runCli} from '../src/cli.js';
import {logger} from '../src/logger.js';

try {
  await runCli();
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
