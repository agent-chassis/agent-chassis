import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as boundaryModule from "../../packages/wiki-mcp/src/lib/tool-usage-audit-mcp-tools.mjs";
import * as compositionHelpers from "../../packages/wiki-mcp/src/lib/server-composition-helpers.mjs";

test("the live tool-usage audit route, event ring, and production origin context are retired", async () => {

  assert.deepEqual(Object.keys(boundaryModule).sort(), ["createToolUsageAuditBoundaryRecorder"]);
  assert.deepEqual(
    Object.keys(boundaryModule.createToolUsageAuditBoundaryRecorder()).sort(),
    ["observeToolCall", "wrapHandler"]
  );

  await assert.rejects(
    import(new URL("../../packages/wiki-mcp/src/lib/tool-usage-audit/live-recorder.mjs", import.meta.url).href),
    { code: "ERR_MODULE_NOT_FOUND" }
  );

  for (const retired of [
    "createProductionToolUsageAuditOrigin",
    "createProductionToolUsageAuditSelectedContext"
  ]) {
    assert.equal(retired in compositionHelpers, false, `${retired} is retired`);
  }

  const serverSource = await readFile(
    new URL("../../packages/wiki-mcp/src/server.mjs", import.meta.url),
    "utf8"
  );
  for (const retired of [
    "registerToolUsageAuditTools",
    "createProductionToolUsageAudit",
    "tool_usage_audit_recorder_error"
  ]) {
    assert.equal(serverSource.includes(retired), false, `server.mjs no longer references ${retired}`);
  }
});
