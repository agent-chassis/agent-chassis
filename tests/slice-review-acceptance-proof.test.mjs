import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const ACTIVE_INTEGRATION_FILES = Object.freeze([
  "packages/agent-launch-cli/src/lib/slice-integration.mjs",
  "packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs",
  "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs",
  "packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs",
  "packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs",
  "packages/wiki-mcp/src/lib/dispatch-tools/register.mjs"
]);

test("active integration code has no review-derived admission, veto, or Proof-A authority", () => {
  const activeSource = ACTIVE_INTEGRATION_FILES.map(source).join("\n");
  const forbidden = [
    ["findings count veto", /findingReceipts\.length\s*>\s*0/u],
    ["clean count admission", /cleanReceipts\.length\s*>\s*0/u],
    ["review-derived integration_allowed", /\bintegration_allowed\b/u],
    ["review-derived vetoed", /\bvetoed\b/u],
    ["append-only veto semantics", /append_only_veto/u],
    ["hard-coded paid CCE enforcement", /ENFORCED_CCE|enforced_cce/u],
    ["Proof-A minting", /mintSliceReviewAcceptanceProof|proof_a_mint/u],
    ["Proof-A lookup", /resolveSliceReviewAcceptanceProof|proof_a_lookup/u],
    ["consumed-review admission", /consumed_review|consumed-context admission/u],
    ["first/latest verdict authority", /first_verdict|latest_receipt_admission/u]
  ];
  for (const [label, pattern] of forbidden) {
    assert.doesNotMatch(activeSource, pattern, label);
  }
});

test("the registered integration route is separate, closed-input, and CCE-owned", () => {
  const registered = source("packages/wiki-mcp/src/lib/dispatch-tools/register.mjs");
  assert.match(registered, /workspace_integrate_committed_slice/u);
  assert.match(registered, /requestCommittedSliceIntegration/u);
  assert.match(registered, /CALLER_CCE_POLICY_AUTHORITY_FIELDS/u);
  assert.match(registered, /caller_supplied_integration_authority/u);
  assert.match(registered, /disposition: z\.enum\(\["accept", "reject", "defer"\]\)/u);
  assert.match(registered, /CCE alone owns any configured organization-policy decision/u);
});

test("the boundary primitive consumes policy authorization, never review evidence", () => {
  const integration = source("packages/agent-launch-cli/src/lib/slice-integration.mjs");
  assert.match(integration, /assertSliceIntegrationBoundaryAuthorization/u);
  assert.match(integration, /SLICE_INTEGRATION_POLICY_POSTURES\.CCE_POLICY/u);
  assert.match(integration, /SLICE_INTEGRATION_POLICY_POSTURES\.FREE_SUBSTRATE/u);
  assert.doesNotMatch(integration, /assertSliceReviewAcceptance|slice-review-veto-gate/u);
});

test("legacy receipt proof_state is isolated from every active integration consumer", () => {
  const receipt = source("packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs");
  assert.match(receipt, /proof_state/u, "legacy receipts remain readable");
  for (const relativePath of ACTIVE_INTEGRATION_FILES) {
    assert.doesNotMatch(source(relativePath), /\bproof_state\b/u,
      `${relativePath} must not consume legacy proof state`);
  }
});
