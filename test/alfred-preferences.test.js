import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {resolveAlfredPreferences} from '../src/alfred-preferences.js';
import {createSandbox} from '../test-support/helpers.js';

test('resolveAlfredPreferences prefers an explicit Alfred environment path', async () => {
  const resolved = await resolveAlfredPreferences({
    environment: {alfred_preferences: '~/Synced Alfred/Alfred.alfredpreferences'},
    homeDirectory: '/Users/example',
  });
  assert.equal(resolved, '/Users/example/Synced Alfred/Alfred.alfredpreferences');
});

test('resolveAlfredPreferences reads the active preferences path', async t => {
  const homeDirectory = await createSandbox(t);
  const alfredRoot = path.join(homeDirectory, 'Library', 'Application Support', 'Alfred');
  await fs.mkdir(alfredRoot, {recursive: true});
  await fs.writeFile(
    path.join(alfredRoot, 'prefs.json'),
    JSON.stringify({current: '~/Dropbox/Alfred/Alfred.alfredpreferences'}),
  );

  assert.equal(
    await resolveAlfredPreferences({environment: {}, homeDirectory}),
    path.join(homeDirectory, 'Dropbox', 'Alfred', 'Alfred.alfredpreferences'),
  );
});
