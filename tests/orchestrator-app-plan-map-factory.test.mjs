import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSharedOrchestratorAppPlanLaunchMap,
} from '../packages/agent-launch-cli/src/lib/orchestrator-dispatch-sidecar.mjs';

test('app.plan factory returns a plain object with stable keys and direct handlers', () => {
  const codexHandler = () => 'codex';
  const claudeHandler = () => 'claude';
  const agyHandler = () => 'agy';

  const map = createSharedOrchestratorAppPlanLaunchMap({
    agy: agyHandler,
    claude: claudeHandler,
    codex: codexHandler,
  });

  assert.equal(Object.getPrototypeOf(map), null);
  assert.equal(map instanceof Map, false);
  assert.deepEqual(Object.keys(map).sort(), ['agy', 'claude', 'codex']);
  assert.equal(map.codex, codexHandler);
  assert.equal(map.claude, claudeHandler);
  assert.equal(map.agy, agyHandler);
});

test('app.plan factory preserves broker-path bracket lookup for each family', () => {
  const handlers = {
    agy: () => 'agy',
    claude: () => 'claude',
    codex: () => 'codex',
  };

  const map = createSharedOrchestratorAppPlanLaunchMap(handlers);

  for (const app of ['codex', 'claude', 'agy']) {
    assert.equal(map[app], handlers[app]);
    assert.equal(map[app](), app);
  }
});

test('app.plan factory fails closed on malformed handlers', () => {
  assert.throws(
    () => createSharedOrchestratorAppPlanLaunchMap({
      agy: () => 'agy',
      claude: 'not-a-function',
      codex: () => 'codex',
    }),
    TypeError,
  );
});
