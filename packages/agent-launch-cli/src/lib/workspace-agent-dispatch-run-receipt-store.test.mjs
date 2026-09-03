import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storeSourceUrl = new URL(
  "./workspace-agent-dispatch-run-receipt-store.mjs",
  import.meta.url
);

test("WK-2327 SLICE-006 receipt storage delegates exact result-mode validation and equality", async () => {
  const source = await readFile(storeSourceUrl, "utf8");
  assert.match(source, /validateWorkspaceAgentResultModeEnvelope/u);
  assert.match(source, /workspaceAgentResultModeEnvelopesEqual/u);
  assert.match(source, /result_mode: exactResultModeEnvelope\(finalResult, receipt\)/u);
});

test("WK-2327 SLICE-006 receipt storage has no local result-mode vocabulary or fallback", async () => {
  const source = await readFile(storeSourceUrl, "utf8");
  assert.doesNotMatch(source, /\bRESULT_MODES\b/u);
  assert.doesNotMatch(source, /\bboundedResultMode\b/u);
  assert.doesNotMatch(source, /supplied\?\.mode\s*\?\?/u);
  assert.doesNotMatch(source, /receipt\.result_mode\s*\?\?/u);
  assert.doesNotMatch(source, /schema_version:\s*["']workspace-agent-result-mode\.v1["']/u);
});
