import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES
} from "../../../agent-launch-cli/src/lib/terminal-review-materialization.mjs";

import {
  createDispatchRunLifecycle,
  MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE
} from "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle.mjs";
import {
  createWorkspaceAgentDispatchBackend
} from "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  buildFamilyExecutorRegistryEntry,
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
} from "../../../agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";
import {
  SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES,
  SLICE_TIP_RECONCILE_STATES,
  SLICE_TIP_RECOVERY_ROUTES
} from "../../../agent-launch-cli/src/lib/worktree-substrate-exact-unit.mjs";
import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WorktreeSubstrateError,
  worktreeIdentityStoreDir
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS,
  managedRunProcessIdentityStoreDir,
  managedRunSubjectReservationFilePath,
  publishPendingManagedRunProcessIdentity,
  retireManagedRunProcessIdentity
} from "../../../agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  createDispatchToolRegistry,
  parseStructuredTextResponse
} from "./dispatch-tools-test-helpers.mjs";

function createRecoveryRefusalTools({ recoverIntegratedWorkerRun }) {
  const unknownHandle = {
    accepted: false,
    refusal: { code: "monitor_handle_unknown", reason: "unknown_run_or_handle", detail: null }
  };
  return createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => unknownHandle,
      waitForRunStatus: async () => unknownHandle,
      recoverIntegratedWorkerRun
    }
  });
}

test("WK-1623#SLICE-007 a recovery that fails the materialize verify reports the cause, not monitor_handle_unknown", async () => {

  const tools = createRecoveryRefusalTools({
    recoverIntegratedWorkerRun: async () => Object.freeze({
      recovery_failure: Object.freeze({
        code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
        message: "terminal review materialization: materialized review checkout failed part write_tree_is_frozen_tree",
        detail: { part: "write_tree_is_frozen_tree" }
      })
    })
  });

  for (const tool of ["workspace_agent_run_status", "workspace_agent_run_wait"]) {
    const refused = parseStructuredTextResponse(await tools.get(tool).handler({
      monitor_handle: "wkmh_worker_latched",
      subject: "WK-1537#SLICE-001"
    }));
    assert.equal(refused.accepted, false, tool);
    assert.equal(refused.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED, tool);
    assert.equal(refused.blocker.reason, "post_worker_lifecycle_recovery_failed", tool);
    assert.equal(
      refused.blocker.detail.recovery_failure.code,
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      tool
    );
    assert.match(refused.blocker.detail.recovery_failure.message, /write_tree_is_frozen_tree/u);

    assert.equal(refused.blocker.detail.backend_refusal.code, "monitor_handle_unknown", tool);
  }
});

test("WK-1623#SLICE-007 a recovery with nothing to recover still reports the original backend refusal", async () => {

  const tools = createRecoveryRefusalTools({ recoverIntegratedWorkerRun: async () => null });
  const refused = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker_absent",
    subject: "WK-1537#SLICE-001"
  }));
  assert.equal(refused.accepted, false);
  assert.equal(refused.blocker.code, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.equal(refused.blocker.reason, "unknown_run_or_handle");
});

const RECONCILE_RECORD_ID = "WK-1469";
const RECONCILE_SLICE_ID = "SLICE-002";
const RECONCILE_SUBJECT = `${RECONCILE_RECORD_ID}#${RECONCILE_SLICE_ID}`;
const RECONCILE_INITIATIVE = "IN-0017";
const RECONCILE_WK_BRANCH = `wk/${RECONCILE_INITIATIVE}/${RECONCILE_RECORD_ID}`;
const RECONCILE_SLICE_BRANCH =
  `slice/${RECONCILE_INITIATIVE}/${RECONCILE_RECORD_ID}/${RECONCILE_SLICE_ID}`;

function git(repo, ...args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function reconcileFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "wk1694-seam-"));
  const repo = path.join(root, "repo");
  const worktreeRoot = path.join(root, "worktrees");
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  mkdirSync(path.join(repo, "packages", "demo"), { recursive: true });
  writeFileSync(path.join(repo, "packages", "demo", "source.mjs"), "export const value = 1;\n");
  writeFileSync(path.join(repo, "packages", "demo", "other.mjs"), "export const other = 2;\n");
  writeFileSync(
    path.join(repo, "wiki", "work-records", `${RECONCILE_RECORD_ID}.json`),
    `${JSON.stringify({
      id: RECONCILE_RECORD_ID,
      initiative: RECONCILE_INITIATIVE,
      read_scope: ["packages/demo/source.mjs"],
      write_scope: ["packages/demo/source.mjs"],
      slices: [{
        id: RECONCILE_SLICE_ID,
        work_kind: "implementation",
        status: "todo",
        depends_on: [],
        read_scope: ["packages/demo/source.mjs"],
        write_scope: ["packages/demo/source.mjs"]
      }, {
        id: "SLICE-003",
        work_kind: "implementation",
        status: "todo",
        depends_on: [],
        read_scope: ["packages/demo/other.mjs"],
        write_scope: ["packages/demo/other.mjs"]
      }]
    }, null, 2)}\n`
  );
  spawnSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  return { repo: realpathSync(repo), worktreeRoot };
}

function deliveringExecutor(state, { deliver }) {
  return async (input) => {
    state.calls += 1;
    state.lastWorkspaceDir = input.workspace_dir;
    if (deliver) {

      writeFileSync(
        path.join(input.workspace_dir, "packages", "demo", "source.mjs"),
        `export const value = ${state.calls + 1};\n`
      );
      git(input.workspace_dir, "add", "packages/demo/source.mjs");
      git(input.workspace_dir, "commit", "-q", "-m", `closed-input delivery ${state.calls}`);
      state.deliveredSha = git(input.workspace_dir, "rev-parse", "HEAD");
    }

    return { accepted: true, status: "succeeded" };
  };
}

function reconcileBackend(fx, state, {
  deliver = false,
  provisioningDeps = null,
  worktreeRoot = null,

  idPrefix = "wk1694"
} = {}) {
  let runSequence = 0;
  let monitorSequence = 0;
  return createWorkspaceAgentDispatchBackend({
    proveAssignedSourceReadable: async () => ({ ok: true, detail: { fixture: true } }),
    runIdFactory: () => `wkdb_${idPrefix}_${runSequence++}`,
    monitorHandleFactory: () => `wkmh_${idPrefix}_${monitorSequence++}`,
    worktreeProvisioning: {
      mainRepo: fx.repo,
      worktreeRoot: worktreeRoot ?? fx.worktreeRoot,
      confinementAvailable: true,
      ...(provisioningDeps ? { deps: provisioningDeps } : {})
    },
    requireManagedProvisioning: true,
    launchExecutors: {
      codex: buildFamilyExecutorRegistryEntry({
        executor: deliveringExecutor(state, { deliver }),
        sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
        nativeReadCapability: LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
      })
    }
  });
}

function startWorker(backend, sessionSuffix, subject = RECONCILE_SUBJECT) {
  return backend.startLaunch({
    caller_session_id: `session-wk1694-${sessionSuffix}`,
    role: "worker",
    app: "codex",
    subject,
    readiness: { dispatchable: true, initiative: RECONCILE_INITIATIVE }
  });
}

test("WK-1694#SLICE-001 the public backend seam allocates absent and contained slice tips", async () => {

  {
    const fx = reconcileFixture();
    const state = { calls: 0 };
    const backend = reconcileBackend(fx, state);
    const first = await startWorker(backend, "absent");
    assert.equal(first.accepted, true, JSON.stringify(first));
    assert.equal(state.calls, 1);
    assert.equal(
      git(fx.repo, "rev-parse", RECONCILE_SLICE_BRANCH),
      git(fx.repo, "rev-parse", RECONCILE_WK_BRANCH)
    );

    const second = await startWorker(backend, "absent");
    assert.equal(second.accepted, true, JSON.stringify(second));
    assert.equal(state.calls, 2);
  }

  {
    const fx = reconcileFixture();
    const state = { calls: 0 };
    const backend = reconcileBackend(fx, state, { deliver: true });
    assert.equal((await startWorker(backend, "integrated")).accepted, true);
    assert.equal(state.calls, 1);
    git(fx.repo, "update-ref", `refs/heads/${RECONCILE_WK_BRANCH}`, state.deliveredSha);
    const relaunch = await startWorker(backend, "integrated");
    assert.equal(relaunch.accepted, true, JSON.stringify(relaunch));
    assert.equal(state.calls, 2, "an integrated slice tip still reaches the executor");
  }
});

test("WK-1694#SLICE-001 an orphaned slice tip refuses on the public route with zero executor invocations", async () => {
  const fx = reconcileFixture();
  const state = { calls: 0 };
  const backend = reconcileBackend(fx, state, { deliver: true });

  const first = await startWorker(backend, "orphaned");
  assert.equal(first.accepted, true, JSON.stringify(first));
  assert.equal(state.calls, 1);

  const deliveredSha = state.deliveredSha;
  assert.equal(git(fx.repo, "rev-parse", RECONCILE_SLICE_BRANCH), deliveredSha);
  const wkTipBefore = git(fx.repo, "rev-parse", RECONCILE_WK_BRANCH);
  assert.notEqual(wkTipBefore, deliveredSha);
  const storeDir = worktreeIdentityStoreDir(fx.repo);
  const bindingsBefore = readdirSync(storeDir).sort();
  const worktreesBefore = git(fx.repo, "worktree", "list", "--porcelain");
  const sliceWorktreeHeadBefore = git(state.lastWorkspaceDir, "rev-parse", "HEAD");

  const refused = await startWorker(backend, "orphaned");

  assert.equal(refused.accepted, false, JSON.stringify(refused));

  assert.equal(
    refused.refusal.reason,
    RUNTIME_BLOCKER_CODES.MANAGED_SLICE_TIP_RECONCILE_REQUIRED
  );
  assert.equal(refused.refusal.reason, "managed_slice_tip_reconcile_required");
  assert.notEqual(refused.refusal.reason, RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE);
  assert.equal(refused.refusal.detail.actor_recovery, "coordinator");
  assert.equal(refused.refusal.detail.next_action, "workspace_agent_dispatch");
  assert.deepEqual(refused.refusal.detail.next_action_args, {
    role: "reviewer",
    subject: RECONCILE_SUBJECT
  });
  assert.equal(
    refused.refusal.detail.next_action_call,
    `workspace_agent_dispatch(role=reviewer, subject=${RECONCILE_SUBJECT})`
  );
  assert.equal(
    refused.refusal.detail.recovery_route,
    SLICE_TIP_RECOVERY_ROUTES.EXACT_SLICE_REVIEW_RECOVERY,
    "committed work routes to exact-slice review recovery, never to another worker"
  );

  assert.equal(refused.refusal.detail.reconcile_state, SLICE_TIP_RECONCILE_STATES.ORPHANED);
  assert.equal(refused.refusal.detail.slice_tip, deliveredSha);
  assert.equal(refused.refusal.detail.wk_base_ref, RECONCILE_WK_BRANCH);

  assert.match(refused.refusal.detail.wk_base_sha, /^[0-9a-f]{40}$/);
  assert.notEqual(refused.refusal.detail.wk_base_sha, deliveredSha);

  assert.equal(
    refused.refusal.detail.source_code,
    SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED
  );
  assert.equal(refused.refusal.detail.detail.reconcile_state, SLICE_TIP_RECONCILE_STATES.ORPHANED);
  assert.equal(refused.refusal.detail.detail.slice_tip, deliveredSha);
  assert.equal(
    refused.refusal.detail.detail.recovery_route,
    SLICE_TIP_RECOVERY_ROUTES.EXACT_SLICE_REVIEW_RECOVERY
  );
  assert.equal(state.calls, 1, "a reconcile refusal must invoke the executor zero additional times");

  assert.equal(git(fx.repo, "rev-parse", RECONCILE_SLICE_BRANCH), deliveredSha);
  assert.equal(git(fx.repo, "rev-parse", RECONCILE_WK_BRANCH), wkTipBefore);
  assert.equal(git(state.lastWorkspaceDir, "rev-parse", "HEAD"), sliceWorktreeHeadBefore);
  assert.deepEqual(readdirSync(storeDir).sort(), bindingsBefore);
  assert.equal(git(fx.repo, "worktree", "list", "--porcelain"), worktreesBefore);
  assert.equal(existsSync(path.join(fx.repo, "packages", "demo", "source.mjs")), true);

});

test("WK-1694#SLICE-001 genuinely unavailable provisioning still reports managed_worktree_provisioning_unavailable", async () => {
  const fx = reconcileFixture();
  const state = { calls: 0 };

  const link = path.join(path.dirname(fx.worktreeRoot), "linked-worktrees");
  mkdirSync(fx.worktreeRoot, { recursive: true });
  symlinkSync(fx.worktreeRoot, link);
  const backend = reconcileBackend(fx, state, { worktreeRoot: link });

  const refused = await startWorker(backend, "root-refused");
  assert.equal(refused.accepted, false, JSON.stringify(refused));
  assert.equal(
    refused.refusal.reason,
    RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE
  );
  assert.equal(state.calls, 0);

  for (const field of ["reconcile_state", "slice_tip", "recovery_route", "actor_recovery", "next_action"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(refused.refusal.detail, field),
      false,
      `a provisioning-capability refusal must not carry ${field}`
    );
  }
});

test("WK-1694#SLICE-001 an unresolvable canonical WK base is NOT routed to review recovery", async () => {

  const fx = reconcileFixture();
  const state = { calls: 0 };
  const backend = reconcileBackend(fx, state);
  assert.equal((await startWorker(backend, "unresolved")).accepted, true);
  assert.equal(state.calls, 1);

  const unresolvedBackend = reconcileBackend(fx, state, {
    idPrefix: "wk1694unresolved",
    provisioningDeps: {
      resolveWkBranchTipBase: () => {
        throw new WorktreeSubstrateError("canonical WK base is unresolvable", {
          code: WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED
        });
      }
    }
  });
  const refused = await unresolvedBackend.startLaunch({
    caller_session_id: "session-wk1694-unresolved",
    role: "worker",
    app: "codex",
    subject: RECONCILE_SUBJECT,
    readiness: { dispatchable: true, initiative: RECONCILE_INITIATIVE }
  });

  assert.equal(refused.accepted, false, JSON.stringify(refused));
  assert.equal(
    refused.refusal.detail.detail?.reconcile_state,
    SLICE_TIP_RECONCILE_STATES.WK_BASE_UNRESOLVED,
    JSON.stringify(refused.refusal)
  );
  assert.equal(
    refused.refusal.reason,
    RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE
  );
  assert.notEqual(
    refused.refusal.reason,
    RUNTIME_BLOCKER_CODES.MANAGED_SLICE_TIP_RECONCILE_REQUIRED
  );
  assert.equal(refused.refusal.detail.actor_recovery, undefined);
  assert.equal(state.calls, 1, "the executor is never reached");
});

test("WK-1694#SLICE-001 unrelated and malformed substrate failures are not mislabeled as reconciliation-required", async () => {
  const cases = [

    ["unrelated_code", new WorktreeSubstrateError("worktree add failed", {
      code: WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      detail: { reconcile_state: SLICE_TIP_RECONCILE_STATES.ORPHANED }
    })],

    ["missing_detail", new WorktreeSubstrateError("reconcile", {
      code: SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED
    })],

    ["scalar_detail", new WorktreeSubstrateError("reconcile", {
      code: SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED,
      detail: "orphaned"
    })],
    ["unknown_state", new WorktreeSubstrateError("reconcile", {
      code: SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED,
      detail: { reconcile_state: "something_else" }
    })]
  ];
  for (const [label, error] of cases) {
    const fx = reconcileFixture();
    const state = { calls: 0 };
    const backend = reconcileBackend(fx, state, {
      provisioningDeps: {
        allocateFullSliceExactUnitWorktree: () => { throw error; }
      }
    });
    const refused = await startWorker(backend, `mislabel-${label}`);
    assert.equal(refused.accepted, false, `${label}: ${JSON.stringify(refused)}`);
    assert.equal(
      refused.refusal.reason,
      RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE,
      label
    );
    assert.equal(refused.refusal.detail.source_code, error.code, label);
    assert.equal(refused.refusal.detail.actor_recovery, undefined, label);
    assert.equal(state.calls, 0, label);
  }
});

function createGatedLifecycle({
  priorAttempt,
  publish,
  executor,

  managedWorkerIdentityRequired = false,
  managedRunIdentityRootPresent = false,
  bindOuter = undefined
}) {
  const executorCalls = [];
  const registryEntry = {
    executor,

    sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
    nativeReadCapability: "native_filesystem_read"
  };
  const lifecycle = createDispatchRunLifecycle({
    executors: {
      claude: async (input) => {
        executorCalls.push(input);
        return executor(input);
      }
    },
    executorRegistryEntries: { claude: registryEntry },
    familyAwareWiring: true,
    runs: new Map(),
    clock: () => 0,
    sleep: async () => {},
    monotonicNow: () => 0,
    runIdFactory: () => "run-gated",
    monitorHandleFactory: () => "wkmh_gated",
    proveAssignedSourceReadable: async () => ({ ok: true }),
    managedWorkerIdentityRequired,
    managedRunIdentityRootPresent,
    checkPriorManagedAttempt: priorAttempt,
    publishPendingManagedRunIdentity: publish,
    bindManagedRunOuterIdentity: bindOuter
  });
  return { lifecycle, executorCalls };
}

const GATED_LAUNCH = Object.freeze({
  caller_session_id: "session-123",
  role: "worker",
  subject: "WK-1694#SLICE-002",
  app: "claude",
  workspace_dir: "/home/user/agent-chassis"
});

test("WK-1694#SLICE-004 a managed worker refuses when identity enforcement is not composable", async () => {

  const complete = {
    managedWorkerIdentityRequired: true,
    managedRunIdentityRootPresent: true,
    priorAttempt: async () => ({ may_launch: true, verdict: "absent" }),
    publish: async () => ({ bind: async () => {}, discard: async () => {} }),
    bindOuter: async (pending, args) => pending.bind(args)
  };

  {
    const { lifecycle, executorCalls } = createGatedLifecycle({
      ...complete,
      executor: () => ({ accepted: true, status: "launching", pid: 4242 })
    });
    const accepted = await lifecycle.startLaunch({ ...GATED_LAUNCH });
    assert.equal(accepted.accepted, true);
    assert.equal(executorCalls.length, 1);
  }

  const missingCases = [
    ["managed_run_identity_root", { managedRunIdentityRootPresent: false }],
    ["prior_attempt_resolver", { priorAttempt: null }],
    ["pending_identity_publisher", { publish: null }],
    ["outer_identity_binder", { bindOuter: null }]
  ];
  for (const [expected, override] of missingCases) {
    const { lifecycle, executorCalls } = createGatedLifecycle({
      ...complete,
      ...override,
      executor: () => assert.fail(`${expected}: the executor must never be reached`)
    });
    const refused = await lifecycle.startLaunch({ ...GATED_LAUNCH });
    assert.equal(refused.accepted, false, expected);
    assert.equal(refused.refusal.reason, MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE, expected);
    assert.deepEqual(refused.refusal.detail.missing_dependencies, [expected], expected);
    assert.equal(refused.refusal.detail.role, "worker", expected);
    assert.equal(executorCalls.length, 0, expected);
  }

  {
    const { lifecycle, executorCalls } = createGatedLifecycle({
      managedWorkerIdentityRequired: true,
      managedRunIdentityRootPresent: false,
      priorAttempt: null,
      publish: null,
      bindOuter: null,
      executor: () => assert.fail("the executor must never be reached")
    });
    const refused = await lifecycle.startLaunch({ ...GATED_LAUNCH });
    assert.deepEqual(refused.refusal.detail.missing_dependencies, [
      "managed_run_identity_root",
      "prior_attempt_resolver",
      "pending_identity_publisher",
      "outer_identity_binder"
    ]);
    assert.equal(executorCalls.length, 0);
  }

  for (const role of ["reviewer", "redteam"]) {
    const { lifecycle, executorCalls } = createGatedLifecycle({
      managedWorkerIdentityRequired: true,
      managedRunIdentityRootPresent: false,
      priorAttempt: null,
      publish: null,
      bindOuter: null,
      executor: () => ({ accepted: true, status: "launching", pid: 7 })
    });
    const accepted = await lifecycle.startLaunch({ ...GATED_LAUNCH, role });
    assert.equal(accepted.accepted, true, role);
    assert.equal(executorCalls.length, 1, role);
  }
  {

    const { lifecycle, executorCalls } = createGatedLifecycle({
      priorAttempt: null,
      publish: null,
      executor: () => ({ accepted: true, status: "launching", pid: 7 })
    });
    const accepted = await lifecycle.startLaunch({ ...GATED_LAUNCH });
    assert.equal(accepted.accepted, true);
    assert.equal(executorCalls.length, 1);
  }
});

test("WK-1694#SLICE-002 the dispatch surface consults durable identity BEFORE any executor invocation", async () => {

  const refusing = [
    "live", "partial", "unreadable", "ambiguous", "mismatched", "unresolved", "proven_dead"
  ];
  for (const verdict of refusing) {
    const publications = [];
    const { lifecycle, executorCalls } = createGatedLifecycle({
      priorAttempt: async () => ({ may_launch: false, verdict, reason: `${verdict} prior attempt` }),
      publish: async () => { publications.push(verdict); return { bind: async () => {}, discard: async () => {} }; },
      executor: () => ({ accepted: true, status: "launching", pid: 4242 })
    });
    const refused = await lifecycle.startLaunch({ ...GATED_LAUNCH });
    assert.equal(refused.accepted, false, verdict);
    assert.equal(refused.refusal.reason, `managed_run_prior_attempt_${verdict}`, verdict);
    assert.equal(refused.refusal.detail.verdict, verdict, verdict);

    assert.equal(refused.refusal.detail.recovery_route, "workspace_agent_dispatch", verdict);
    assert.equal(executorCalls.length, 0, verdict);
    assert.deepEqual(publications, [], verdict);
  }
});

test("WK-1694#SLICE-002 pending publication precedes spawn and outer binding precedes the accepted response", async () => {
  const order = [];
  const { lifecycle } = createGatedLifecycle({
    priorAttempt: async () => ({ may_launch: true, verdict: "absent" }),
    publish: async (tuple) => {
      order.push("publish-pending");
      assert.equal(tuple.subject, GATED_LAUNCH.subject);
      assert.equal(tuple.run_id, "run-gated");
      assert.equal(tuple.monitor_handle, "wkmh_gated");
      return {
        bind: async ({ pid }) => { order.push(`bind-outer:${pid}`); },
        discard: async () => { order.push("discard"); }
      };
    },
    executor: () => { order.push("spawn"); return { accepted: true, status: "launching", pid: 4242 }; }
  });

  const accepted = await lifecycle.startLaunch({ ...GATED_LAUNCH });
  order.push("accepted-returned");

  assert.equal(accepted.accepted, true);

  assert.deepEqual(order, ["publish-pending", "spawn", "bind-outer:4242", "accepted-returned"]);
});

test("WK-1694#SLICE-002 a failed outer binding refuses the launch instead of accepting it", async () => {
  const { lifecycle } = createGatedLifecycle({
    priorAttempt: async () => ({ may_launch: true, verdict: "absent" }),
    publish: async () => ({
      bind: async () => {
        const error = new Error("outer sandbox identity unreadable");
        error.code = "agent_launch.managed_run_process_identity.publication_incomplete.v1";
        throw error;
      },
      discard: async () => assert.fail("a post-spawn binding failure must NOT discard the record")
    }),
    executor: () => ({ accepted: true, status: "launching", pid: 4242 })
  });

  const refused = await lifecycle.startLaunch({ ...GATED_LAUNCH });
  assert.equal(refused.accepted, false);
  assert.equal(refused.refusal.reason, "managed_run_identity_binding_failed");
  assert.equal(
    refused.refusal.detail.code,
    "agent_launch.managed_run_process_identity.publication_incomplete.v1"
  );
});

test("WK-1694#SLICE-002 a refused or failed spawn cleans up the pending record it published", async () => {
  for (const [label, executor] of [
    ["executor_refused", () => ({ accepted: false, refusal: { reason: "family_refused" } })],
    ["executor_threw", () => { throw new Error("spawn blew up"); }],
    ["executor_no_result", () => null]
  ]) {
    let discards = 0;
    const { lifecycle } = createGatedLifecycle({
      priorAttempt: async () => ({ may_launch: true, verdict: "absent" }),
      publish: async () => ({
        bind: async () => assert.fail(`${label} must never bind an outer identity`),
        discard: async () => { discards += 1; }
      }),
      executor
    });
    const refused = await lifecycle.startLaunch({ ...GATED_LAUNCH });
    assert.equal(refused.accepted, false, label);

    assert.equal(discards, 1, label);
  }
});

test("WK-1694#SLICE-002 a failed publication refuses the launch and never reaches the executor", async () => {
  const { lifecycle, executorCalls } = createGatedLifecycle({
    priorAttempt: async () => ({ may_launch: true, verdict: "absent" }),
    publish: async () => {
      const error = new Error("identity store unwritable");
      error.code = "agent_launch.managed_run_process_identity.store_write_failed.v1";
      throw error;
    },
    executor: () => ({ accepted: true, status: "launching", pid: 4242 })
  });
  const refused = await lifecycle.startLaunch({ ...GATED_LAUNCH });
  assert.equal(refused.accepted, false);
  assert.equal(refused.refusal.reason, "managed_run_identity_publication_failed");
  assert.equal(executorCalls.length, 0);
});

function concurrentBackend(fx, state, gate) {
  let runSequence = 0;
  let monitorSequence = 0;
  let gated = false;
  return createWorkspaceAgentDispatchBackend({

    proveAssignedSourceReadable: async () => {
      if (!gated) {
        gated = true;
        state.entered.resolve();
        await gate;
      }
      return { ok: true, detail: { fixture: true } };
    },
    runIdFactory: () => `wkdb_wk1694_conc_${runSequence++}`,
    monitorHandleFactory: () => `wkmh_wk1694_conc_${monitorSequence++}`,
    worktreeProvisioning: {
      mainRepo: fx.repo,
      worktreeRoot: fx.worktreeRoot,
      confinementAvailable: true
    },
    requireManagedProvisioning: true,
    launchExecutors: {
      codex: buildFamilyExecutorRegistryEntry({
        executor: async (input) => {
          state.calls += 1;
          state.lastWorkspaceDir = input.workspace_dir;
          return { accepted: true, status: "succeeded" };
        },
        sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
        nativeReadCapability: LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
      })
    }
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("WK-1694#SLICE-002 two concurrent same-subject dispatches reach the executor exactly ONCE", async () => {
  const fx = reconcileFixture();
  const release = deferred();
  const entered = deferred();
  const state = { calls: 0, entered };
  const backend = concurrentBackend(fx, state, release.promise);

  const winner = startWorker(backend, "concurrent-a");

  await entered.promise;
  const loser = await startWorker(backend, "concurrent-b");

  assert.equal(loser.accepted, false, JSON.stringify(loser));
  assert.equal(loser.refusal.reason, "managed_run_prior_attempt_reserved");
  assert.equal(loser.refusal.detail.subject, RECONCILE_SUBJECT);
  assert.match(loser.refusal.detail.reservation_holder.reservation_id, /^[0-9a-f-]{36}$/);
  assert.equal(state.calls, 0, "the loser never reached a spawn");

  release.resolve();
  assert.equal((await winner).accepted, true);
  assert.equal(state.calls, 1, "exactly one executor invocation");

  const records = readdirSync(managedRunProcessIdentityStoreDir(fx.repo))
    .filter((entry) => entry.startsWith("identity-"));
  assert.ok(records.length <= 1, `at most one durable attempt record, saw ${records.length}`);
  assert.equal(existsSync(managedRunSubjectReservationFilePath(fx.repo, RECONCILE_SUBJECT)), false);

  const later = await startWorker(backend, "concurrent-c");
  assert.equal(later.accepted, true, JSON.stringify(later));
  assert.equal(state.calls, 2);
});

test("two independent slices of one WK launch concurrently without a global or per-WK singleton", async () => {
  const fx = reconcileFixture();
  const release = deferred();
  const entered = deferred();
  const state = { calls: 0, entered };
  const backend = concurrentBackend(fx, state, release.promise);

  const first = startWorker(backend, "independent-a");
  await entered.promise;
  const other = await startWorker(
    backend,
    "independent-b",
    `${RECONCILE_RECORD_ID}#SLICE-003`
  );
  assert.equal(other.accepted, true, JSON.stringify(other));
  assert.equal(state.calls, 1, "the independent slice launches while the first remains gated");
  release.resolve();
  assert.equal((await first).accepted, true);
  assert.equal(state.calls, 2);
  assert.notEqual(state.lastWorkspaceDir, null);
});

function identityLivenessDeps({ procs = {}, bootId = "cccccccc-dddd-eeee-ffff-000000000000" } = {}) {
  return {
    procAvailable: () => true,
    readBootId: () => bootId,
    readUptime: () => 1000,
    readProcStat: (pid) => {
      const starttime = procs[pid];
      if (starttime === undefined) return null;
      const tail = Array.from({ length: 30 }, (_, i) => String(i + 3));
      tail[0] = "S";
      tail[19] = String(starttime);
      return `${pid} (bwrap (managed) worker) ${tail.join(" ")}`;
    },
    sendSignal: () => assert.fail("the identity store must never signal a process")
  };
}

test("WK-1694#SLICE-002 a settled attempt is retired and the unit becomes dispatchable again", async () => {

  const fx = reconcileFixture();
  const state = { calls: 0 };
  const bootId = "cccccccc-dddd-eeee-ffff-000000000000";
  const priorTuple = {
    assigned_unit: RECONCILE_SUBJECT,
    launch_ref: "wkmh_prior_attempt",
    run_id: "run-prior-attempt",
    retry_id: 0
  };
  const sandboxPid = 515151;
  const publishDeps = identityLivenessDeps({
    procs: { [process.pid]: "555", [sandboxPid]: "777" },
    bootId
  });
  const pending = publishPendingManagedRunProcessIdentity({
    mainRepo: fx.repo, tuple: priorTuple, role: "worker", deps: publishDeps
  });
  bindManagedRunSandboxProcessIdentity(pending, {
    pid: sandboxPid,
    killShape: deriveOuterSandboxKillShape({ pid: sandboxPid }),
    deps: publishDeps
  });

  const deadDeps = identityLivenessDeps({ procs: { [process.pid]: "999" }, bootId });
  let runSequence = 0;
  let monitorSequence = 0;
  const backend = createWorkspaceAgentDispatchBackend({
    proveAssignedSourceReadable: async () => ({ ok: true, detail: { fixture: true } }),
    runIdFactory: () => `wkdb_wk1694_retire_${runSequence++}`,
    monitorHandleFactory: () => `wkmh_wk1694_retire_${monitorSequence++}`,
    worktreeProvisioning: {
      mainRepo: fx.repo, worktreeRoot: fx.worktreeRoot, confinementAvailable: true
    },
    requireManagedProvisioning: true,
    managedRunProcessIdentityDeps: deadDeps,
    launchExecutors: {
      codex: buildFamilyExecutorRegistryEntry({
        executor: async () => { state.calls += 1; return { accepted: true, status: "succeeded" }; },
        sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
        nativeReadCapability: LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
      })
    }
  });

  const blocked = await startWorker(backend, "retire-blocked");
  assert.equal(blocked.accepted, false, JSON.stringify(blocked));
  assert.equal(blocked.refusal.reason, "managed_run_prior_attempt_proven_dead");
  assert.equal(state.calls, 0, "a proven-dead prior attempt never spawns a replacement worker");

  const retired = retireManagedRunProcessIdentity({
    mainRepo: fx.repo,
    tuple: priorTuple,
    reason: MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.FINALIZED_INTEGRATION,
    evidence: { slice_ref: RECONCILE_SLICE_BRANCH, integrated_sha: "d".repeat(40) },
    deps: deadDeps
  });
  assert.equal(retired.retired, true);

  const allowed = await startWorker(backend, "retire-allowed");
  assert.equal(allowed.accepted, true, JSON.stringify(allowed));
  assert.equal(state.calls, 1, "the unit is dispatchable again, not permanently locked");
});
