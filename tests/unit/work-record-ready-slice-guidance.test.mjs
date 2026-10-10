import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getRuntimeBlockerEntry
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  describeToolDiscoveryTools,
  loadToolDiscoveryDescriptor
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

const RETIRED = /workspace_work_record_ready_slice|workspace_work_record_summary|workspace_read_page/u;

test("authoring and confirmation use the current save and read routes", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  assert.deepEqual(describeToolDiscoveryTools(descriptor,
    { tool_name: "workspace_work_record_ready_slice" }, { verbose: true }), []);
  const [save] = describeToolDiscoveryTools(descriptor, { tool_name: "save_record" }, { verbose: true });
  const [read] = describeToolDiscoveryTools(descriptor, { tool_name: "workspace_read_wiki" }, { verbose: true });
  assert.deepEqual(save.side_effects, ["workspace_write"]);
  assert.match(save.notes, /at the returned revision/u);
  assert.deepEqual(read.side_effects, ["read_only"]);
  for (const tool of [save, read]) assert.ok(tool.docs_refs.includes("docs/mcp-operation-reference.md"));

  const documentation = await readFile(new URL("../../docs/mcp-operation-reference.md", import.meta.url), "utf8");
  assert.match(documentation, /`save_record` \| `unit`, current combined `revision`, closed `changes`/u);
  assert.match(documentation, /revision refuses rather than rebasing/u);
});

test("the reviewer write-scope reason and its admission helper name no retired authoring route", async () => {
  const reason = getRuntimeBlockerEntry("role_policy_violation").reasons.find(
    ({ reason: name }) => name === "reviewer_write_scope_nonempty");
  assert.equal(Object.hasOwn(reason, "remediation"), false);
  assert.deepEqual(reason.required_write_scope, []);
  assert.match(reason.summary, /effective mutation scope/u);
  assert.doesNotMatch(JSON.stringify(reason), RETIRED);
  const helper = await readFile(new URL(
    "../../packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(helper, RETIRED);
  assert.match(helper, /Empty authenticated effective mutation authority selects findings/u);
});
