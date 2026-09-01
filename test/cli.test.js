import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCliArguments} from '../src/cli.js';

test('parseCliArguments supports project selection and JSON output', () => {
  assert.deepEqual(parseCliArguments([
    'doctor',
    '--project',
    '/tmp/example',
    '--json',
  ]), {
    command: 'doctor',
    json: true,
    projectRoot: '/tmp/example',
  });
});

test('parseCliArguments rejects unknown commands and options', () => {
  assert.throws(() => parseCliArguments(['remove']), /Usage/u);
  assert.throws(() => parseCliArguments(['status', '--force']), /Unknown option/u);
});
