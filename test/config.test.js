import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {readProjectConfig} from '../src/config.js';
import {createSandbox, writeWorkflow} from '../test-support/helpers.js';

test('readProjectConfig resolves the workflow source and validates its bundle ID', async t => {
  const packageRoot = await createSandbox(t);
  const sourceRoot = path.join(packageRoot, 'workflow');
  await writeWorkflow(sourceRoot, 'com.example.workflow.dev');
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    alfredWorkflowSwitch: {
      developmentBundleId: 'com.example.workflow.dev',
      releaseBundleId: 'com.example.workflow',
      workflowPath: 'workflow',
    },
    name: 'alfred-example',
  }));

  const config = await readProjectConfig({projectRoot: packageRoot});
  assert.equal(config.packageName, 'alfred-example');
  assert.equal(config.releaseBundleId, 'com.example.workflow');
  assert.equal(config.sourceRoot, await fs.realpath(sourceRoot));
});

test('readProjectConfig rejects a development bundle ID mismatch', async t => {
  const packageRoot = await createSandbox(t);
  await writeWorkflow(packageRoot, 'com.example.actual');
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    alfredWorkflowSwitch: {
      developmentBundleId: 'com.example.expected',
      releaseBundleId: 'com.example.release',
    },
  }));

  await assert.rejects(
    readProjectConfig({projectRoot: packageRoot}),
    /Development bundle ID mismatch/u,
  );
});
