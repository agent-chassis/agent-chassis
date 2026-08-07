

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";

import {
  classifyCanonicalIntegratedSliceContract,
  CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS,
  trustedReviewReceiptGroupKey
} from "../packages/agent-launch-cli/src/lib/backend-integrated-scope-authority.mjs";
import {
  resolveFrozenSliceReviewReceiptContract
} from "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import {
  createBackendManagedIdentity,
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  createManagedStdioMcpCompositionAuthority
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";
import { defaultRunGit } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import { bindingFilePath } from "../packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import {
  bindingIdentity
} from "../packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch-binding.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";
import {
  assertTypedCorrectiveFailure,
  clearSubjectReservation,
  fixture,
  git,
  INITIATIVE,
  OLD_TUPLE,
  readReservationRecord,
  SLICE_REF,
  structured,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";

const WK_REF = `refs/heads/wk/${INITIATIVE}/WK-1712`;
const RECORD_RELATIVE_PATH = path.join("wiki", "work-records", "WK-1712.json");

function changesRequestedReviewerResult(findingId) {
  const payload = {
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: SUBJECT,
    reported_outcome: "changes_requested",
    summary: "Advisory correction.",
    findings: [{
      id: findingId,
      title: "Advisory correction",
      severity: "high",
      blocking: true,
      affected_paths: [{ path: "src/canary.txt", line: 1 }]
    }],
    finding_counts: { total: 1, blocking: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },

    reviewed_controls: [
      { control_id: "max_write_file_loc", result: "pass" },
      { control_id: "write_scope_total_loc", result: "pass" }
    ]
  };
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: "findings",
    findings: { summary: "advisory finding recorded" },
    no_findings: null,
    missing_result: null,
    full_response: {
      format: "markdown",
      text: `Review.\n\n\`\`\`agent-role-result.v1\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      source: null
    },
    writeback: { kind: "wk_updated", detail: null }
  };
}

function coordinator(fx, seq, { findingId = "F-001", createBackend = createTestDispatchBackend } = {}) {
  const backend = createBackend({
    runIdFactory: () => `wkdb_plural_${seq.next++}`,
    monitorHandleFactory: () => `wkmh_plural_${seq.next++}`,
    launchExecutor: async (input) => {
      fx.launches.push(input);
      if (input.role === "reviewer") {
        return {
          accepted: true,
          status: "succeeded",
          final_result: changesRequestedReviewerResult(findingId)
        };
      }
      return {
        accepted: true,
        status: "launching",
        pid: 5252,
        enforcement: { enforced: false },
        probe: async () => ({ status: "running" })
      };
    },
    worktreeProvisioning: {
      mainRepo: fx.repo, worktreeRoot: fx.worktreeRoot, confinementAvailable: true
    },
    requireManagedProvisioning: true,
    postWorkerSliceLifecycle: async () => null,
    managedRunProcessIdentityDeps: fx.managedRunProcessIdentityDeps,
    exactSliceReviewReceiptStore: fx.exactSliceReviewReceiptStore,
    managedStdioMcpCompositionAuthority: createManagedStdioMcpCompositionAuthority()
  });
  return { backend, workerLaunches: () => fx.launches.filter((entry) => entry.role === "worker") };
}

async function reviewCycle(fx, seq, { tag, findingId, expectedReceipts }) {
  const cycle = coordinator(fx, seq, { findingId });
  const prepared = await cycle.backend.prepareCanonicalCommittedSliceReviewAdmission({
    subject: SUBJECT,
    workspace_dir: fx.repo
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  for (let index = 0; index < 2; index += 1) {
    const review = await cycle.backend.startLaunch({
      caller_session_id: `${tag}-review-${index}`,
      role: "reviewer",
      app: "codex",
      subject: SUBJECT,
      workspace_dir: fx.repo,
      readiness: { dispatchable: true }
    });
    assert.equal(review.accepted, true, JSON.stringify(review));
  }
  assert.equal(fx.receipts.length, expectedReceipts, `${tag} left one two-receipt group`);
}

function reopenIntegratedTargetForCorrection(fx) {
  const recordPath = path.join(fx.repo, RECORD_RELATIVE_PATH);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "active";
  record.slices.find((slice) => slice.id === "SLICE-001").status = "todo";
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

async function deliverSecondSliceCommit(fx) {
  const first = git(fx.repo, "rev-parse", SLICE_REF);
  const launchRef = "wkmh_second_delivery";
  const runId = bindingIdentity("wkdb_second_delivery", "slice");
  const original = JSON.parse(readFileSync(bindingFilePath(
    fx.repo, OLD_TUPLE.launch_ref, bindingIdentity(OLD_TUPLE.run_id, "slice"), 0), "utf8"));
  writeFileSync(bindingFilePath(fx.repo, launchRef, runId, 0), `${JSON.stringify(
    { ...original, launch_ref: launchRef, run_id: runId, base_sha: first }, null, 2)}\n`);
  writeFileSync(path.join(fx.worktree, "src", "canary.txt"), "second delivered bytes\n");
  const commit = structured(await fx.registerCommit({
    WIKI_MCP_ASSIGNED_UNIT: SUBJECT,
    WIKI_MCP_COMMIT_LAUNCH_REF: launchRef,
    WIKI_MCP_COMMIT_RUN_ID: runId,
    WIKI_MCP_COMMIT_RETRY_ID: "0"
  })({}));
  assert.equal(commit.committed, true, JSON.stringify(commit));
  assert.equal(git(fx.repo, "rev-list", "--parents", "-n", "1", SLICE_REF).split(" ")[1], first,
    "the second delivery is a server-minted child of the first");
  return first;
}

async function sameExactTargetPluralReviewScenario(t, createBackend) {
  const fx = await fixture(t);
  const seq = { next: 0 };
  await reviewCycle(fx, seq, { tag: "cycle-a", findingId: "F-001", expectedReceipts: 2 });
  writeFileSync(path.join(fx.wkWorktree, "README.md"), "wk lifecycle note\n");
  git(fx.wkWorktree, "add", "README.md");
  git(fx.wkWorktree, "commit", "-m", "wk lifecycle movement");
  await reviewCycle(fx, seq, { tag: "cycle-b", findingId: "F-002", expectedReceipts: 4 });

  git(fx.wkWorktree, "merge", "--no-ff", "-m", "integrate WK-1712#SLICE-001", SLICE_REF);
  reopenIntegratedTargetForCorrection(fx);
  clearSubjectReservation(fx);
  return { fx, seq, warm: coordinator(fx, seq, { createBackend }) };
}

async function divergentExactTargetScenario(t) {
  const fx = await fixture(t);
  const seq = { next: 0 };
  const first = await deliverSecondSliceCommit(fx);
  await reviewCycle(fx, seq, { tag: "cycle-a", findingId: "F-001", expectedReceipts: 2 });
  git(fx.wkWorktree, "merge", "--ff-only", first);
  await reviewCycle(fx, seq, { tag: "cycle-b", findingId: "F-002", expectedReceipts: 4 });

  git(fx.wkWorktree, "merge", "--ff-only", SLICE_REF);
  reopenIntegratedTargetForCorrection(fx);
  clearSubjectReservation(fx);
  return { fx, seq, warm: coordinator(fx, seq) };
}

function candidateGroups(fx) {
  const byKey = new Map();
  for (const receipt of fx.receipts) {
    const key = trustedReviewReceiptGroupKey(receipt);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(receipt);
  }
  return [...byKey.entries()].map(([key, receipts]) => ({ key, receipts, witness: receipts[0] }));
}

function continuationOver(fx, receipts) {
  return createBackendManagedIdentity({
    worktreeProvisioningConfig: { mainRepo: fx.repo, worktreeRoot: fx.worktreeRoot },
    reviewContextRunGit: defaultRunGit,
    correctiveContinuationProofs: new Map(),
    managedRunIdentityRoot: fx.repo,
    managedRunIdentityDeps: fx.managedRunProcessIdentityDeps,
    exactSliceReviewReceiptStore: {
      loadAll: async () => receipts, loadLatest: async () => null,
      load: async () => null, persist: async (receipt) => receipt
    }
  }).resolveMechanicallyAuthenticatedCorrectiveContinuation(SUBJECT);
}

async function soloProofs(fx, groups) {
  const proofs = [];
  for (const group of groups) {
    const resolved = await continuationOver(fx, group.receipts);
    assert.notEqual(resolved, null, "the group authenticates on its own");
    proofs.push(resolved.proof);
  }
  return proofs;
}

function assertSharedExactTarget(solo) {
  for (const field of ["subject", "unit_address", "slice_ref", "delivered_tip_sha", "frozen_base_sha"]) {
    assert.equal(solo[0][field], solo[1][field], `the DEC-0164 exact target agrees on ${field}`);
  }
  assert.notEqual(solo[0].committed_target_digest, solo[1].committed_target_digest,
    "the complete authenticated identities genuinely differ");
}

function captureSurface(fx) {
  return {
    refs: git(fx.repo, "for-each-ref", "--format=%(refname) %(objectname)"),
    refNames: git(fx.repo, "for-each-ref", "--format=%(refname)"),
    wk: git(fx.repo, "rev-parse", WK_REF),
    slice: git(fx.repo, "rev-parse", SLICE_REF),
    head: git(fx.worktree, "rev-parse", "HEAD"),
    record: readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"),
    receipts: JSON.stringify(fx.receipts),
    identity: readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }),
    reservation: readReservationRecord(fx.repo)
  };
}

function assertHistoryPreserved(fx, before) {
  assert.equal(JSON.stringify(fx.receipts), before.receipts,
    "no historical receipt is deleted, rewritten, reordered, or synthesized");
  assert.equal(readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"), before.record,
    "the reopened canonical contract is not rewritten");
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), before.head,
    "the delivered worktree is untouched");
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), before.slice,
    "the exact slice ref still resolves to the reviewed tip");
  assert.equal(git(fx.repo, "for-each-ref", "--format=%(refname)"), before.refNames,
    "no replacement ref is created and none is deleted");
}

function assertNothingMutated(fx, before) {
  assertHistoryPreserved(fx, before);
  assert.equal(git(fx.repo, "for-each-ref", "--format=%(refname) %(objectname)"), before.refs,
    "no ref is created, moved, or deleted");
  assert.deepEqual(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }),
    before.identity, "the prior attempt is neither retired nor replaced");
  assert.deepEqual(readReservationRecord(fx.repo), before.reservation,
    "no successor reservation is minted");
}

function reissueCorrectiveDispatch(fx, warm, caller) {
  return warm.backend.startLaunch({
    caller_session_id: caller,
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: fx.repo,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });
}

test("WK-1723 two review cycles of one DEC-0164 target converge into one successor carrying both", async (t) => {
  const { fx, warm } = await sameExactTargetPluralReviewScenario(t);
  const groups = candidateGroups(fx);

  assert.equal(groups.length, 2, "the store holds exactly two candidate groups");
  assert.notEqual(groups[0].key, groups[1].key, "the two group keys are distinct");
  assert.equal(groups[0].receipts.length, 2);
  assert.equal(groups[1].receipts.length, 2);
  assert.notEqual(groups[0].witness.review_run_id, groups[1].witness.review_run_id);

  assert.notEqual(groups[0].witness.worktree_identity.wk_sha,
    groups[1].witness.worktree_identity.wk_sha, "the frozen historical wk_sha differs");
  assert.notEqual(
    JSON.stringify(groups[0].witness.worktree_identity),
    JSON.stringify(groups[1].witness.worktree_identity),
    "the complete frozen committed-target identity differs across the two cycles"
  );
  assert.notEqual(groups[0].witness.committed_target_digest,
    groups[1].witness.committed_target_digest);

  for (const group of groups) {
    assert.equal(resolveFrozenSliceReviewReceiptContract(group.witness).subject, SUBJECT);
    assert.equal(
      classifyCanonicalIntegratedSliceContract(fx.repo, SUBJECT, group.witness).classification,
      CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.HISTORICAL_FROZEN_CONTRACT_UNCHANGED);
  }
  const solo = await soloProofs(fx, groups);
  assertSharedExactTarget(solo);
  assert.equal(solo[0].delivered_tip_sha, git(fx.repo, "rev-parse", SLICE_REF));

  const before = captureSurface(fx);
  const historicalIdentity = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.notEqual(historicalIdentity, null);

  const accepted = await reissueCorrectiveDispatch(fx, warm, "same-exact-target-plurality");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(warm.workerLaunches().length, 1, "exactly one corrective successor is launched");

  const context = warm.workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.notEqual(context, null);
  assert.equal(context.authority, "launcher_exact_review_receipt");
  assert.equal(context.reviewed_sha, solo[0].delivered_tip_sha);
  assert.equal(context.diff_base_sha, solo[0].frozen_base_sha);
  assert.deepEqual([...context.review_run_ids].sort(),
    fx.receipts.map((receipt) => receipt.review_run_id).sort(),
    "every reviewer run id of both cycles is preserved");
  assert.deepEqual([...context.review_monitor_handles].sort(),
    fx.receipts.map((receipt) => receipt.review_monitor_handle).sort(),
    "every reviewer monitor handle of both cycles is preserved");
  assert.deepEqual([...context.trusted_evidence_digests].sort(),
    fx.receipts.map((receipt) => receipt.trusted_evidence_digest).sort(),
    "every trusted evidence digest of both cycles is preserved");
  assert.equal(new Set(context.review_run_ids).size, 4, "no review is selected or discarded");

  assert.equal(context.findings.length, 4);
  assert.deepEqual([...context.findings.map((finding) => finding.id)].sort(),
    ["F-001", "F-001", "F-002", "F-002"],
    "repeated finding ids are valid plurality and are never collapsed");

  assert.notEqual(accepted.run_id, OLD_TUPLE.run_id);
  assert.notEqual(accepted.monitor_handle, OLD_TUPLE.launch_ref);
  const retired = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.notEqual(retired, null, "the superseded attempt is retired, never deleted");
  assert.deepEqual(retired.tuple, historicalIdentity.tuple);
  assert.equal(retired.state, "retired");
  assert.equal(readReservationRecord(fx.repo).tuple?.run_id, accepted.run_id,
    "the subject reservation names only the fresh successor");

  assertHistoryPreserved(fx, before);
  assert.equal(fx.receipts.length, 4, "no receipt is deleted to converge");
  const wkTip = git(fx.repo, "rev-parse", WK_REF);
  if (wkTip !== before.wk) {
    assert.equal(git(fx.repo, "rev-list", "--parents", "-n", "1", wkTip), `${wkTip} ${before.wk}`,
      "the WK ref only advances on top of the integrated tip");
  }
});

test("WK-1723 reversed receipt-store enumeration selects the same carrier and the same context", async (t) => {
  const { fx, warm } = await sameExactTargetPluralReviewScenario(t);

  const forward = await continuationOver(fx, [...fx.receipts]);
  const reversed = await continuationOver(fx, [...fx.receipts].reverse());
  assert.deepEqual(reversed.proof, forward.proof,
    "the same proof carrier is selected under reversed enumeration, byte for byte");
  assert.deepEqual(reversed.review_evidence, forward.review_evidence,
    "the converged receipts and the DEC-0164 witness are byte-identical");
  assert.equal(reversed.review_evidence.receipts.length, 4, "every receipt is carried");

  fx.receipts.reverse();
  const accepted = await reissueCorrectiveDispatch(fx, warm, "reversed-store");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(warm.workerLaunches().length, 1);
  const context = warm.workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.deepEqual(context.review_run_ids, [...context.review_run_ids].sort(),
    "aggregation order is canonical, not store-enumeration order");
  assert.equal(context.findings.length, 4);
  assert.equal(new Set(context.review_run_ids).size, 4);
});

test("WK-1723 two matched groups with different authenticated landing parents still refuse", async (t) => {
  const { fx, warm } = await divergentExactTargetScenario(t);
  const groups = candidateGroups(fx);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].witness.reviewed_sha, groups[1].witness.reviewed_sha,
    "both cycles reviewed the identical slice tip");
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), groups[0].witness.reviewed_sha);
  assert.notEqual(groups[0].witness.diff_base_sha, groups[1].witness.diff_base_sha,
    "the authenticated landing parents genuinely differ");

  const solo = await soloProofs(fx, groups);
  assert.equal(solo[0].delivered_tip_sha, solo[1].delivered_tip_sha);
  assert.notEqual(solo[0].frozen_base_sha, solo[1].frozen_base_sha);

  const before = captureSurface(fx);
  const refused = await reissueCorrectiveDispatch(fx, warm, "divergent-exact-target");
  assert.equal(refused.accepted, false, JSON.stringify(refused));
  assertTypedCorrectiveFailure(refused.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY);
  assert.equal(warm.workerLaunches().length, 0, "no worker is launched");
  assertNothingMutated(fx, before);
});

const MUTANT_TAG = "?wk1723-mutant=complete-identity-applicability";
const MANAGED_IDENTITY_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs",
  import.meta.url).href;
const DISPATCH_BACKEND_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs", import.meta.url).href;
const SHARED_BACKEND_MODULE_URL = new URL(
  "./workspace-agent-dispatch-backend-shared.mjs", import.meta.url).href;
const EXACT_TARGET_KEY_ANCHOR =
  "    return digestTrustedExactReviewEvidence({\n" +
  "      schema_version: DEC_0164_EXACT_REVIEW_TARGET_SCHEMA_VERSION,\n";
const COMPLETE_IDENTITY_KEY =
  "    return digestTrustedExactReviewEvidence(identity); // MUTANT: complete identity\n" +
  "    return digestTrustedExactReviewEvidence({\n" +
  "      schema_version: DEC_0164_EXACT_REVIEW_TARGET_SCHEMA_VERSION,\n";
const MANAGED_IDENTITY_SPECIFIER_ANCHOR = '"./workspace-agent-dispatch-backend-managed-identity.mjs"';
const DISPATCH_BACKEND_SPECIFIER_ANCHOR =
  '"../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs"';

function mutateOnce(source, anchor, replacement, label) {
  assert.equal(source.split(anchor).length, 2, `mutation anchor is not unique: ${label}`);
  const mutated = source.replace(anchor, replacement);
  assert.notEqual(mutated, source, label);
  return mutated;
}

test("WK-1723 MUTATION: making complete admission identity the applicability boundary is killed", async (t) => {
  const productionBytes = readFileSync(new URL(MANAGED_IDENTITY_MODULE_URL), null);
  const sources = new Map([
    [`${MANAGED_IDENTITY_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      productionBytes.toString("utf8"),
      EXACT_TARGET_KEY_ANCHOR,
      COMPLETE_IDENTITY_KEY,
      "exact-target key"
    )],
    [`${DISPATCH_BACKEND_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(DISPATCH_BACKEND_MODULE_URL), "utf8"),
      MANAGED_IDENTITY_SPECIFIER_ANCHOR,
      JSON.stringify(`${MANAGED_IDENTITY_MODULE_URL}${MUTANT_TAG}`),
      "managed identity specifier"
    )],
    [`${SHARED_BACKEND_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(SHARED_BACKEND_MODULE_URL), "utf8"),
      DISPATCH_BACKEND_SPECIFIER_ANCHOR,
      JSON.stringify(`${DISPATCH_BACKEND_MODULE_URL}${MUTANT_TAG}`),
      "dispatch backend specifier"
    )]
  ]);
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const source = sources.get(url);
      return source === undefined
        ? nextLoad(url, context)
        : { format: "module", shortCircuit: true, source };
    }
  });
  t.after(() => hooks.deregister());

  const mutant = await import(`${SHARED_BACKEND_MODULE_URL}${MUTANT_TAG}`);
  assert.equal(typeof mutant.createTestDispatchBackend, "function");

  const { fx, warm } = await sameExactTargetPluralReviewScenario(t, mutant.createTestDispatchBackend);
  const groups = candidateGroups(fx);
  assert.equal(groups.length, 2);

  assertSharedExactTarget(await soloProofs(fx, groups));
  const before = captureSurface(fx);

  const killed = await reissueCorrectiveDispatch(fx, warm, "mutant-complete-identity");
  assert.equal(killed.accepted, false, JSON.stringify(killed));
  assertTypedCorrectiveFailure(killed.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY);
  assert.match(killed.refusal.detail.message,
    /more than one durable corrective review receipt group authenticates as the current reviewed delivery/u,
    "the kill is the contradiction branch's own refusal, not an unrelated failure");
  assert.equal(warm.workerLaunches().length, 0, "the mutant creates no worker and no monitor");
  assertNothingMutated(fx, before);

  const production = await sameExactTargetPluralReviewScenario(t);
  const accepted = await reissueCorrectiveDispatch(production.fx, production.warm,
    "production-plural-witness");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(production.warm.workerLaunches().length, 1);
  const context = production.warm.workerLaunches().at(-1)
    .readiness.trusted_corrective_findings_context;
  assert.equal(context.findings.length, 4);
  assert.deepEqual([...context.findings.map((finding) => finding.id)].sort(),
    ["F-001", "F-001", "F-002", "F-002"]);

  assert.deepEqual(readFileSync(new URL(MANAGED_IDENTITY_MODULE_URL), null), productionBytes,
    "the production module must be byte-identical throughout");
});
