import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PREFERENCES_RELATIVE_PATH = path.join(
  'Library',
  'Application Support',
  'Alfred',
  'Alfred.alfredpreferences',
);
const PREFS_JSON_RELATIVE_PATH = path.join(
  'Library',
  'Application Support',
  'Alfred',
  'prefs.json',
);

function expandHome(value, homeDirectory) {
  if (value === '~') {
    return homeDirectory;
  }

  if (value.startsWith('~/')) {
    return path.join(homeDirectory, value.slice(2));
  }

  return value;
}

export async function resolveAlfredPreferences({
  environment = process.env,
  fileSystem = fs,
  homeDirectory,
}) {
  const configuredPath = environment.alfred_preferences || environment.ALFRED_PREFERENCES;
  if (configuredPath) {
    return path.resolve(expandHome(configuredPath, homeDirectory));
  }

  const prefsJsonPath = path.join(homeDirectory, PREFS_JSON_RELATIVE_PATH);
  try {
    const preferences = JSON.parse(await fileSystem.readFile(prefsJsonPath, 'utf8'));
    if (typeof preferences.current === 'string' && preferences.current.trim()) {
      return path.resolve(expandHome(preferences.current.trim(), homeDirectory));
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw new Error(`Unable to read Alfred preferences at ${prefsJsonPath}`, {cause: error});
    }
  }

  return path.join(homeDirectory, DEFAULT_PREFERENCES_RELATIVE_PATH);
}
