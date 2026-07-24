import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultRegistry,
  resolveAgentConfig
} from "../packages/agent-launch-core/src/lib/registry.mjs";

test("WK-1678 default launcher registry contains only client launch configuration", () => {
  const registry = createDefaultRegistry();
  assert.equal(registry.schema_version, 1);
  assert.deepEqual(Object.keys(registry).sort(), ["agents", "schema_version"]);
  assert.deepEqual(Object.keys(registry.agents).sort(), ["claude", "codex"]);
});

test("resolveAgentConfig retains read-only client launch profiles", () => {
  const registry = { data: createDefaultRegistry() };
  assert.equal(resolveAgentConfig(registry, "claude", "code_review").read_only.supported, true);
  assert.equal(resolveAgentConfig(registry, "codex", "redteam").read_only.supported, true);
});
