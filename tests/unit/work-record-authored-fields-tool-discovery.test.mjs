import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit.mjs";
const discoveryDir = "packages/wiki-core/data/tool-discovery";
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
test("general editor descriptor, manifest, and role policy agree exactly", async () => {
  const [fragment, manifest, policy] = await Promise.all([
    readJson(`${discoveryDir}/work-record-edit-mcp-tools.json`),
    readJson(`${discoveryDir}/manifest.json`),
    readJson(`${discoveryDir}/session-role-tool-access.json`)
  ]);
  const rows = fragment.tools.filter(({ tool_name }) => tool_name === "workspace_work_record_edit");
  assert.equal(rows.length, 1);
  assert.equal(fragment.tool_count, fragment.tools.length);
  assert.equal(
    manifest.fragments.find(({ file }) => file === "work-record-edit-mcp-tools.json").tool_count,
    fragment.tool_count
  );
  assert.equal(
    manifest.expected_tool_count,
    manifest.fragments.reduce((sum, entry) => sum + entry.tool_count, 0)
  );
  assert.deepEqual(policy.access.workspace_work_record_edit, ["orchestrator", "operator"]);
  for (const denied of ["reviewer", "worker", "redteam"]) {
    assert.equal(policy.access.workspace_work_record_edit.includes(denied), false);
  }
  assert.equal(Object.hasOwn(rows[0], "fields"), false, "descriptor must not copy the registry inventory");
  assert.match(JSON.stringify(rows[0].authoritative_for), /WORK_RECORD_EDIT_FIELD_REGISTRY/);
  assert.match(rows[0].do_not_use_when.join(" "), /read-only context/i);
});
test("durable registry projection covers every registry entry without a parallel discovery table", async () => {
  const docs = await readFile("docs/mcp-operation-reference.md", "utf8");
  const toolRegistry = await readFile("docs/mcp-tool-registry-reference.md", "utf8");
  const discovery = await readFile("docs/tool-discovery.md", "utf8");
  for (const entry of WORK_RECORD_EDIT_FIELD_REGISTRY) {
    assert.ok(docs.includes(`\`${entry.field}\``), `missing docs projection for ${entry.id}`);
    assert.ok(docs.includes(`\`${entry.owner}\``), `missing owner projection for ${entry.id}`);
    for (const action of entry.actions) assert.ok(docs.includes(action), `${entry.id}:${action}`);
  }
  assert.match(toolRegistry, /reviewer, worker, and redteam sessions are denied/i);
  assert.match(discovery, /orchestrator and operator/);
  assert.match(discovery, /no CLI parity/);
});
