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
  assert.throws(() => parseCliArguments([]), /Usage/u);
});

test('parseCliArguments supports --help and --version', () => {
  assert.deepEqual(parseCliArguments(['--help']), {command: 'help'});
  assert.deepEqual(parseCliArguments(['-h']), {command: 'help'});
  assert.deepEqual(parseCliArguments(['--version']), {command: 'version'});
  assert.deepEqual(parseCliArguments(['-v']), {command: 'version'});
});
