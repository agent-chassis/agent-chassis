import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

test("the extracted integration route is separate, closed-input, and CCE-owned", () => {
  const route = source(
    "packages/wiki-mcp/src/lib/dispatch-tools/committed-slice-integration-route.mjs"
  );
  const admission = source(
    "packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-request-admission.mjs"
  );
  assert.match(route, /requestCommittedSliceIntegration/u);
  assert.match(admission, /export const CALLER_CCE_POLICY_AUTHORITY_FIELDS/u);
  assert.match(route, /caller_supplied_integration_authority/u);
  assert.match(route, /disposition: z\.enum\(\["accept", "reject", "defer"\]\)/u);
  assert.match(route, /CCE alone owns any configured organization-policy decision/u);
});

test("the boundary primitive consumes policy authorization, never review evidence", () => {
  const integration = source("packages/agent-launch-cli/src/lib/slice-integration.mjs");
  assert.match(integration, /assertSliceIntegrationBoundaryAuthorization/u);
  assert.match(integration, /SLICE_INTEGRATION_POLICY_POSTURES\.CCE_POLICY/u);
  assert.match(integration, /SLICE_INTEGRATION_POLICY_POSTURES\.FREE_SUBSTRATE/u);
  assert.doesNotMatch(integration, /assertSliceReviewAcceptance|slice-review-veto-gate/u);
});

test("receipt-schema ownership is isolated from every active integration consumer", () => {
  const launcherReceiptSchema = source(
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-schema.mjs"
  );
  const workRecordSchema = source("packages/wiki-core/src/lib/work-record-schema.mjs");
  assert.match(launcherReceiptSchema, /proof_state/u, "legacy receipts remain readable");
  assert.match(workRecordSchema, /projectSliceReviewReceiptContracts/u,
    "receipt contract projection remains owned by the shared schema module");
  for (const relativePath of ACTIVE_INTEGRATION_FILES) {
    assert.doesNotMatch(source(relativePath), /\bproof_state\b/u,
      `${relativePath} must not consume legacy proof state`);
  }
});

test("slice-review acceptance delegates readiness ownership to the shared owner", () => {
  const acceptance = source("packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs");
  assert.match(acceptance, /normalizeReadinessEnvelope\(/u);
  assert.doesNotMatch(acceptance, /schema_version:\s*["']dispatch-readiness\.v1["']/u);
  assert.doesNotMatch(acceptance, /graph_state:\s*\{/u);
  assert.doesNotMatch(acceptance, /blast_radius:\s*\{/u);
  assert.doesNotMatch(acceptance, /buildEvidenceOnlyMaterializationDispatchReadiness/u);
});
