import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  loadToolDiscoveryDescriptor,
  validateToolDiscoveryDescriptor
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

const TOOL_NAME = "workspace_tool_usage_audit";
const DISCOVERY_DIR = new URL("../../packages/wiki-core/data/tool-discovery/", import.meta.url);

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, DISCOVERY_DIR), "utf8"));
}

test("workspace_tool_usage_audit is retired from discovery, the fragment manifest, and role grants", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const validation = validateToolDiscoveryDescriptor(descriptor);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));
  assert.equal(
    descriptor.tools.some((tool) => tool.tool_name === TOOL_NAME),
    false,
    "the retired route has no assembled descriptor row"
  );

  const manifest = await readJson("manifest.json");
  assert.equal(
    manifest.fragments.some((fragment) => fragment.file === "tool-usage-audit-tools.json"),
    false,
    "the retired fragment is not assembled"
  );

  const access = await readJson("session-role-tool-access.json");
  assert.equal(JSON.stringify(access).includes(TOOL_NAME), false, "no role is granted the retired route");
});
