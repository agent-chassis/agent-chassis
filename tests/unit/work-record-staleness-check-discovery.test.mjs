import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  TOOL_DISCOVERY_CONTROLLED_TASK_IDS,
  ToolDiscoveryFragmentError,
  assembleToolDiscoveryDescriptor,
  loadToolDiscoveryDescriptor,
  loadToolDiscoveryEnvelope
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

const TOOL_NAME = "workspace_record_staleness_check";
const FRAGMENT_FILE = "work-record-core-mcp-tools.json";
const DATA_DIR = path.resolve("packages/wiki-core/data/tool-discovery");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(DATA_DIR, relativePath), "utf8"));
}

test("the tool-discovery envelope resolves the staleness route by name", async () => {
  const envelope = await loadToolDiscoveryEnvelope();
  const entry = envelope.results.find((result) => result.tool_name === TOOL_NAME);

  assert.ok(entry, `${TOOL_NAME} must be resolvable on the tool-discovery envelope`);
  assert.equal(entry.kind, "mcp_tool");
  assert.equal(entry.entrypoint, TOOL_NAME);
  assert.equal(entry.recommended_route, "mcp");
  assert.equal(entry.runtime_posture, "supported");
});

test("the staleness route appears under the read-canonical task id with a read-only, non-privileged descriptor", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const tool = descriptor.tools.find((entry) => entry.tool_name === TOOL_NAME);

  assert.ok(tool, `${TOOL_NAME} must be present in the assembled descriptor corpus`);
  assert.deepEqual(tool.task_ids, ["read-canonical"]);
  assert.ok(
    TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes("read-canonical"),
    "read-canonical must remain a controlled task id; the route introduces no new task family"
  );
  assert.deepEqual(tool.side_effects, ["read_only"]);
  assert.deepEqual(tool.audience, ["agent", "operator"]);

  assert.ok(
    tool.use_when.some((entry) => /source_digest/.test(entry)),
    "use_when must name the held source_digest values that key the check"
  );
  assert.ok(
    tool.do_not_use_when.some((entry) => /expected_source_digest/.test(entry)),
    "do_not_use_when must send write-precondition callers to the CAS precondition"
  );
  assert.ok(
    tool.do_not_use_when.some((entry) => /content/.test(entry)),
    "do_not_use_when must exclude content fetching"
  );

  const fragment = await readJson(FRAGMENT_FILE);
  assert.ok(
    fragment.tools.some((entry) => entry.tool_name === TOOL_NAME),
    `${TOOL_NAME} must be owned by ${FRAGMENT_FILE}`
  );
});

test("the staleness route carries the same broad advisory content-read role access as its read-canonical siblings", async () => {
  const policy = await readJson("session-role-tool-access.json");
  const grants = policy.access[TOOL_NAME];

  assert.ok(grants, `${TOOL_NAME} must declare a session-role-tool-access entry`);

  assert.deepEqual(grants, ["orchestrator", "reviewer", "redteam", "operator"]);
  assert.deepEqual(grants, policy.access.workspace_get_record);
  assert.deepEqual(grants, policy.access.workspace_work_record_validate);
});

test("all three duplicated counts agree, so the assembled corpus loads without a count-mismatch error", async () => {
  const manifest = await readJson("manifest.json");
  const fragment = await readJson(FRAGMENT_FILE);
  const manifestEntry = manifest.fragments.find((entry) => entry.file === FRAGMENT_FILE);

  assert.ok(manifestEntry, `${FRAGMENT_FILE} must be listed in the fragment manifest`);
  assert.equal(fragment.tool_count, fragment.tools.length);
  assert.equal(manifestEntry.tool_count, fragment.tools.length);
  assert.equal(
    manifest.expected_tool_count,
    manifest.fragments.reduce((total, entry) => total + entry.tool_count, 0)
  );

  const descriptor = await loadToolDiscoveryDescriptor();
  assert.equal(descriptor.tools.length, manifest.expected_tool_count);
  assert.equal(
    new Set(descriptor.tools.map((tool) => tool.tool_name)).size,
    descriptor.tools.length,
    "assembled tool names must stay unique"
  );
});

test("guard: dropping the new descriptor without moving its counts refuses the whole corpus", async () => {
  const manifest = await readJson("manifest.json");
  const fragmentsByFile = new Map();
  for (const entry of manifest.fragments) {
    fragmentsByFile.set(entry.file, await readJson(entry.file));
  }

  const fragment = fragmentsByFile.get(FRAGMENT_FILE);
  const thinned = {
    ...fragment,
    tools: fragment.tools.filter((tool) => tool.tool_name !== TOOL_NAME)
  };
  assert.equal(thinned.tools.length, fragment.tools.length - 1);

  assert.throws(
    () =>
      assembleToolDiscoveryDescriptor(
        manifest,
        new Map(fragmentsByFile).set(FRAGMENT_FILE, thinned)
      ),
    (error) =>
      error instanceof ToolDiscoveryFragmentError &&
      error.code === "fragment_self_count_mismatch"
  );

  assert.throws(
    () =>
      assembleToolDiscoveryDescriptor(
        manifest,
        new Map(fragmentsByFile).set(FRAGMENT_FILE, {
          ...thinned,
          tool_count: thinned.tools.length
        })
      ),
    (error) =>
      error instanceof ToolDiscoveryFragmentError && error.code === "fragment_count_mismatch"
  );

  assert.throws(
    () =>
      assembleToolDiscoveryDescriptor(
        {
          ...manifest,
          fragments: manifest.fragments.map((entry) =>
            entry.file === FRAGMENT_FILE
              ? { ...entry, tool_count: thinned.tools.length }
              : entry
          )
        },
        fragmentsByFile
      ),
    (error) =>
      error instanceof ToolDiscoveryFragmentError && error.code === "manifest_count_mismatch"
  );
});
