import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  assertWorkflowSlotPath,
  findWorkflowSlotsByBundleId,
} from '../src/workflow-discovery.js';
import {createSandbox, writeWorkflow} from '../test-support/helpers.js';

test('findWorkflowSlotsByBundleId returns every matching Alfred slot', async t => {
  const preferencesRoot = await createSandbox(t);
  const workflowsRoot = path.join(preferencesRoot, 'workflows');
  await writeWorkflow(path.join(workflowsRoot, 'user.workflow.b'), 'com.example.target');
  await writeWorkflow(path.join(workflowsRoot, 'user.workflow.a'), 'com.example.target');
  await writeWorkflow(path.join(workflowsRoot, 'user.workflow.other'), 'com.example.other');

  assert.deepEqual(await findWorkflowSlotsByBundleId({
    bundleId: 'com.example.target',
    preferencesRoot,
  }), [
    path.join(workflowsRoot, 'user.workflow.a'),
    path.join(workflowsRoot, 'user.workflow.b'),
  ]);
});

test('assertWorkflowSlotPath rejects paths outside the workflows directory', () => {
  assert.throws(
    () => assertWorkflowSlotPath('/tmp/workflow', '/tmp/preferences'),
    /outside the Alfred workflows directory/u,
  );
});
