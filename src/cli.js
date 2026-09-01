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
  logger.info(`Preferences: ${paint.path(result.preferencesRoot)}`);
  logger.info(`Source: ${paint.path(result.sourcePath)}`);
  logger.info(`Workflow slot: ${paint.path(result.slotPath ?? 'not found')}`);
  logger.info(`Release backup: ${paint.path(result.backupPath)}`);
  if (result.reason) {
    logger.warn(`Reason: ${result.reason}`);
  }
}

export async function runCli({
  argv = process.argv.slice(2),
  environment = process.env,
  homeDirectory = os.homedir(),
  logger = defaultLogger,
  output = console.log,
} = {}) {
  const cli = parseCliArguments(argv);
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
