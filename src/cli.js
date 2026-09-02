import os from 'node:os';
import {resolveAlfredPreferences} from './alfred-preferences.js';
import {readProjectConfig} from './config.js';
import {logger as defaultLogger, paint} from './logger.js';
import {
  inspectWorkflow,
  switchToDevelopment,
  switchToProduction,
} from './workflow-switcher.js';

const COMMANDS = new Set(['dev', 'doctor', 'prod', 'status']);

function usage() {
  return 'Usage: alfred-workflow-switch <dev|prod|status|doctor> [--project <path>] [--json]';
}

export function parseCliArguments(argv) {
  if (argv.length === 0) {
    throw new Error(usage());
  }

  const firstArg = argv[0];
  if (firstArg === '--help' || firstArg === '-h') {
    return {command: 'help'};
  }

  if (firstArg === '--version' || firstArg === '-v') {
    return {command: 'version'};
  }

  const [command, ...tokens] = argv;
  if (!COMMANDS.has(command)) {
    throw new Error(usage());
  }

  const result = {command, json: false, projectRoot: process.cwd()};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--json') {
      result.json = true;
      continue;
    }

    if (token === '--project') {
      const projectRoot = tokens[index + 1];
      if (!projectRoot) {
        throw new Error(`${usage()}\nMissing value for --project.`);
      }

      result.projectRoot = projectRoot;
      index += 1;
      continue;
    }

    throw new Error(`${usage()}\nUnknown option: ${token}`);
  }

  return result;
}

function printableResult(result) {
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined && value !== null),
  );
}

function printDoctor(result, logger) {
  logger.info(`Mode: ${paint.mode(result.mode)}`);
  logger.info(`Release bundle ID: ${paint.value(result.releaseBundleId)}`);
  logger.info(`Development bundle ID: ${paint.value(result.developmentBundleId)}`);

  if (result.developmentBundleId === result.releaseBundleId) {
    logger.warn(
      'Development and release bundle IDs are identical. The dev symlink may appear as a release candidate when state is missing.',
    );
  }

  logger.info(`Preferences: ${paint.path(result.preferencesRoot)}`);
  logger.info(`Source: ${paint.path(result.sourcePath)}`);
  logger.info(`Workflow slot: ${paint.path(result.slotPath ?? 'not found')}`);
  logger.info(`Release backup: ${paint.path(result.backupPath)}`);

  if (result.lockInfo?.exists) {
    const {owner, isStale, ageMs} = result.lockInfo;
    const staleNote = isStale ? ' (stale)' : '';
    logger.info(
      `Operation lock: exists${staleNote} (age: ${Math.round(ageMs)}ms, pid: ${owner?.pid ?? 'unknown'}, command: ${owner?.command ?? 'unknown'})`,
    );
  } else {
    logger.info('Operation lock: none');
  }

  if (result.reason) {
    logger.warn(`Reason: ${result.reason}`);
  }

  if (result.mode === 'conflict') {
    logger.warn('Recovery: both slot and backup exist. To recover:');
    logger.warn(`  1. Inspect both: ${paint.path(result.slotPath)} and ${paint.path(result.backupPath)}`);
    logger.warn('  2. Keep the desired workflow and remove the other');
    logger.warn('  3. Run dev or prod to re-establish the switch');
  }

  if (result.mode === 'development-interrupted') {
    logger.info('Recovery: run "dev" to restore the development link or "prod" to restore the release');
  }
}

export async function runCli({
  argv = process.argv.slice(2),
  environment = process.env,
  homeDirectory = os.homedir(),
  logger = defaultLogger,
  output = console.log,
  packageJson,
} = {}) {
  const cli = parseCliArguments(argv);

  if (cli.command === 'help') {
    output(usage());
    return;
  }

  if (cli.command === 'version') {
    if (!packageJson) {
      throw new Error('Package metadata is required for --version');
    }

    output(packageJson.version);
    return;
  }

  const config = await readProjectConfig({projectRoot: cli.projectRoot});
  const preferencesRoot = await resolveAlfredPreferences({environment, homeDirectory});
  const options = {...config, preferencesRoot};

  let result;
  if (cli.command === 'dev') {
    result = await switchToDevelopment(options);
  } else if (cli.command === 'prod') {
    result = await switchToProduction(options);
  } else {
    result = await inspectWorkflow(options);
  }

  if (cli.json) {
    output(JSON.stringify(printableResult(result), null, 2));
    return result;
  }

  if (cli.command === 'doctor') {
    printDoctor(result, logger);
  } else if (cli.command === 'status') {
    logger.info(`Mode: ${paint.mode(result.mode)}`);
  } else if (cli.command === 'dev') {
    const message = result.changed ? 'Using local source' : 'Already using local source';
    logger[result.changed ? 'success' : 'info'](`${message}: ${paint.path(result.sourcePath)}`);
  } else {
    const message = result.changed ? 'Release restored' : 'Already using the release';
    logger[result.changed ? 'success' : 'info'](`${message}: ${paint.path(result.slotPath)}`);
  }

  return result;
}
