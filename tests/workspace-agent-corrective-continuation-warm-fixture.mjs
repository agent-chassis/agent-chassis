

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  createManagedStdioMcpCompositionAuthority
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";
import {
  createBackendIntegration
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { defaultRunGit } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";
import {
  clearSubjectReservation,
  fixture,
  git,
  INITIATIVE,
  integrateCommittedSlice,
  SLICE_REF,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";
import {
  commitRemediationRound,
  killLiveAttempt,
  MULTI_ROUND_BASE,
  MULTI_ROUND_DELIVERIES
} from "./workspace-agent-corrective-continuation-remediation-fixture.mjs";

export function changesRequestedReviewerResult() {
  const payload = {
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: SUBJECT,
    reported_outcome: "changes_requested",
    summary: "Advisory correction.",
    findings: [{
      id: "F-001",
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

export function warmCoordinator(fx, createBackend = createTestDispatchBackend) {
  const launches = [];
  let idSequence = 0;
  const backend = createBackend({
    runIdFactory: () => `wkdb_warm_${idSequence++}`,
    monitorHandleFactory: () => `wkmh_warm_${idSequence++}`,
    launchExecutor: async (input) => {
      launches.push(input);
      if (input.role === "reviewer") {
        return { accepted: true, status: "succeeded", final_result: changesRequestedReviewerResult() };
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
  return {
    backend,
    launches,
    workerLaunches: () => launches.filter((entry) => entry.role === "worker")
  };
}

export function warmCorrectiveFindingsProducer(fx, backend) {
  const frozen = backend.__snapshotFrozenSliceReviewContexts();
  assert.equal(frozen.length, 1, "the warm coordinator holds exactly one frozen slice review context");
  return createBackendIntegration({
    worktreeProvisioningConfig: { mainRepo: fx.repo, worktreeRoot: fx.worktreeRoot },
    reviewContextRunGit: defaultRunGit,
    frozenSliceReviewContexts: new Map(frozen.map((context) => [context.review_subject, context])),
    exactSliceReviewReceiptStore: fx.exactSliceReviewReceiptStore,
    canonicalCommittedSliceIntegrations: new Map(),
    canonicalCommittedSliceIntegrationAttempts: new Map(),
    committedSliceIntegrationTargetKey: () => "unused"
  }).resolveCorrectiveFindingsContext;
}

export async function warmAdvisoryReviews(fx, warm, { tag = "warm", round = 1 } = {}) {
  const prepared = await warm.backend.prepareCanonicalCommittedSliceReviewAdmission({
    subject: SUBJECT,
    workspace_dir: fx.repo
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  for (let index = 0; index < 2; index += 1) {
    const review = await warm.backend.startLaunch({
      caller_session_id: `${tag}-review-${index}`,
      role: "reviewer",
      app: "codex",
      subject: SUBJECT,
      workspace_dir: fx.repo,
      readiness: { dispatchable: true }
    });
    assert.equal(review.accepted, true, JSON.stringify(review));
  }
  assert.equal(fx.receipts.length, 2 * round,
    `review round ${round} left one two-receipt group`);
}

export const RECORD_RELATIVE_PATH = path.join("wiki", "work-records", "WK-1712.json");

export function readCanonicalRecord(fx) {
  return JSON.parse(readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"));
}

export function writeCanonicalRecord(fx, record) {
  writeFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), `${JSON.stringify(record, null, 2)}\n`);
}

export function reopenIntegratedTargetForCorrection(fx, { sliceStatus = "todo", parentStatus = "active" } = {}) {
  const record = readCanonicalRecord(fx);
  record.status = parentStatus;
  record.slices.find((slice) => slice.id === "SLICE-001").status = sliceStatus;
  writeCanonicalRecord(fx, record);
}

export function captureCorrectiveSurface(fx) {
  return {
    refs: git(fx.repo, "for-each-ref", "--format=%(refname) %(objectname)"),
    refNames: git(fx.repo, "for-each-ref", "--format=%(refname)"),
    wk: git(fx.repo, "rev-parse", `refs/heads/wk/${INITIATIVE}/WK-1712`),
    head: git(fx.worktree, "rev-parse", "HEAD"),
    record: readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"),
    receipts: JSON.stringify(fx.receipts)
  };
}

export function assertDeliverySurfacePreserved(fx, before) {
  assert.equal(git(fx.repo, "for-each-ref", "--format=%(refname)"), before.refNames,
    "no replacement ref is created and none is deleted");
  for (const ref of [
    SLICE_REF, "refs/heads/main", `refs/agent-launch/wk-forks/${INITIATIVE}/WK-1712`
  ]) {
    assert.equal(
      `${ref} ${git(fx.repo, "rev-parse", ref)}`,
      before.refs.split("\n").find((line) => line.startsWith(`${ref} `)),
      `${ref} is not rewritten`
    );
  }
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), before.head, "the delivery worktree is untouched");
  assert.equal(readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"), before.record,
    "no replacement WK or slice is authored, and the reopened contract is not rewritten");
  assert.equal(JSON.stringify(fx.receipts), before.receipts,
    "the historical review receipts are byte-unchanged and none is synthesized");
}

export function assertCorrectiveSurfaceUnchanged(fx, before) {
  assertDeliverySurfacePreserved(fx, before);
  assert.equal(git(fx.repo, "for-each-ref", "--format=%(refname) %(objectname)"), before.refs,
    "no ref is created, moved, or deleted");
}

export async function warmCorrectiveScenario(t, createBackend) {
  const fx = await fixture(t);
  const warm = warmCoordinator(fx, createBackend);
  await warmAdvisoryReviews(fx, warm);
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);
  integrateCommittedSlice(fx);
  reopenIntegratedTargetForCorrection(fx);
  clearSubjectReservation(fx);
  return { fx, warm, deliveredTip };
}

export function reissueWarmWorkerDispatch(fx, warm, caller) {
  return warm.backend.startLaunch({
    caller_session_id: caller,
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: fx.repo,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });
}

export const EXPECTED_CORRECTIVE_STATUS_RECOVERY = Object.freeze({
  recovery_kind: "agent_launch.managed_run.corrective_status_reconciliation.v1",
  observed: { parent_status: "todo", slice_status: "todo" },
  expected: { parent_status: "active", slice_status: "todo" },
  unit: "WK-1712",
  slice_unit: SUBJECT,
  responsible_actor: "coordinator",
  next_action: "reissue_subject_dispatch_after_canonical_status_reconciliation"
});

export function assertRefusedBeforeSpawn(refused, label) {
  assert.equal(refused?.accepted ?? false, false, `${label}: ${JSON.stringify(refused)}`);
  assert.equal(refused.refusal.reason, "managed_run_identity_check_threw",
    `${label}: ${JSON.stringify(refused.refusal)}`);
  return refused.refusal.detail;
}

export async function warmTwoRoundCorrectiveScenario(t) {
  const fx = await fixture(t, {
    canaryBase: MULTI_ROUND_BASE,
    deliveredBytes: MULTI_ROUND_DELIVERIES[0]
  });
  const warm = warmCoordinator(fx);

  await warmAdvisoryReviews(fx, warm);
  integrateCommittedSlice(fx, MULTI_ROUND_DELIVERIES[0]);
  reopenIntegratedTargetForCorrection(fx);
  clearSubjectReservation(fx);

  const round1 = await reissueWarmWorkerDispatch(fx, warm, "wk1793-m1-round-1");
  assert.equal(round1.accepted, true, JSON.stringify(round1));
  await commitRemediationRound(fx, warm.workerLaunches().at(-1), MULTI_ROUND_DELIVERIES[1]);
  await warmAdvisoryReviews(fx, warm, { tag: "warm-r2", round: 2 });
  integrateCommittedSlice(fx, MULTI_ROUND_DELIVERIES[1]);
  clearSubjectReservation(fx);
  killLiveAttempt(fx, 2);

  assert.equal(new Set(fx.receipts.map((receipt) => receipt.reviewed_sha)).size, 2,
    "two rounds are two candidate groups, not one");
  return { fx, warm };
}
