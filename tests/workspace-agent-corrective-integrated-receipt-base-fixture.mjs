

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  createManagedStdioMcpCompositionAuthority
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";
import {
  clearSubjectReservation,
  correctiveReceipt,
  fixture,
  git,
  INITIATIVE,
  OLD_TUPLE,
  readReservationRecord,
  SLICE_REF,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";

export const WK_REF = `refs/heads/wk/${INITIATIVE}/WK-1712`;
export const RECORD_RELATIVE_PATH = path.join("wiki", "work-records", "WK-1712.json");

function changesRequestedReviewerResult() {
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

function coordinator(fx, createBackend = createTestDispatchBackend) {
  let idSequence = 0;
  const backend = createBackend({
    runIdFactory: () => `wkdb_frozen_base_${idSequence++}`,
    monitorHandleFactory: () => `wkmh_frozen_base_${idSequence++}`,
    launchExecutor: async (input) => {
      fx.launches.push(input);
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
    workerLaunches: () => fx.launches.filter((entry) => entry.role === "worker")
  };
}

async function advisoryChangesRequestedReviews(fx, warm) {
  const prepared = await warm.backend.prepareCanonicalCommittedSliceReviewAdmission({
    subject: SUBJECT,
    workspace_dir: fx.repo
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  for (let index = 0; index < 2; index += 1) {
    const review = await warm.backend.startLaunch({
      caller_session_id: `frozen-base-review-${index}`,
      role: "reviewer",
      app: "codex",
      subject: SUBJECT,
      workspace_dir: fx.repo,
      readiness: { dispatchable: true }
    });
    assert.equal(review.accepted, true, JSON.stringify(review));
  }
  assert.equal(fx.receipts.length, 2, "the review round left one two-receipt group");
}

function integrateReviewedDeliveryByFastForward(fx) {
  git(fx.wkWorktree, "merge", "--ff-only", SLICE_REF);
}

function reopenIntegratedTargetForCorrection(fx) {
  const recordPath = path.join(fx.repo, RECORD_RELATIVE_PATH);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "active";
  record.slices.find((slice) => slice.id === "SLICE-001").status = "todo";
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

export async function settledIntegratedScenario(t, createBackend) {
  const fx = await fixture(t);
  const warm = coordinator(fx, createBackend);
  await advisoryChangesRequestedReviews(fx, warm);
  const receipt = correctiveReceipt(fx);
  integrateReviewedDeliveryByFastForward(fx);
  reopenIntegratedTargetForCorrection(fx);
  clearSubjectReservation(fx);

  const liveWkTip = git(fx.repo, "rev-parse", WK_REF);
  assert.equal(liveWkTip, receipt.reviewed_sha,
    "THE DECISIVE PRECONDITION: the live canonical WK ref tip is exactly the reviewed tip");
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), receipt.reviewed_sha,
    "the exact slice ref still resolves directly to the reviewed SHA");
  assert.notEqual(receipt.diff_base_sha, receipt.reviewed_sha,
    "the frozen pre-integration base is a real earlier commit, so the range is non-empty");
  return { fx, warm, receipt, liveWkTip };
}

export function captureSurface(fx) {
  return {
    refs: git(fx.repo, "for-each-ref", "--format=%(refname) %(objectname)"),
    head: git(fx.worktree, "rev-parse", "HEAD"),
    record: readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"),
    receipts: JSON.stringify(fx.receipts),
    identity: readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }),
    reservation: readReservationRecord(fx.repo),
    workerLaunches: fx.launches.filter((entry) => entry.role === "worker").length
  };
}

export function assertSurfaceByteIdentical(fx, before) {
  assert.equal(git(fx.repo, "for-each-ref", "--format=%(refname) %(objectname)"), before.refs,
    "no ref is created, moved, or deleted");
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), before.head,
    "the delivered worktree is untouched");
  assert.equal(readFileSync(path.join(fx.repo, RECORD_RELATIVE_PATH), "utf8"), before.record,
    "the reopened canonical contract is not rewritten");
  assert.equal(JSON.stringify(fx.receipts), before.receipts,
    "no receipt is rewritten, replaced, or synthesized");
  assert.deepEqual(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }),
    before.identity, "the prior attempt is neither retired nor replaced");
  assert.deepEqual(readReservationRecord(fx.repo), before.reservation,
    "no successor reservation is minted and none is retired");
  assert.equal(fx.launches.filter((entry) => entry.role === "worker").length,
    before.workerLaunches, "no corrective worker is provisioned or spawned");
}

export function reissueCorrectiveDispatch(fx, warm, caller) {
  return warm.backend.startLaunch({
    caller_session_id: caller,
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: fx.repo,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });
}
