import assert from "node:assert/strict";
import test from "node:test";

import { createLaunchFlow } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-launch.mjs";
import { createDispatchRunLifecycle } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle.mjs";
import {
  ADMISSION_REVIEW_TARGET_IDENTITY_REFUSAL_CODES
} from "../../packages/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  computeWorkRecordSourceDigest
} from "../../packages/wiki-core/src/lib/work-record-schema.mjs";

function staleTipOwnerCarrier({ tip, subject = "WK-2347#SLICE-003" } = {}) {
  return Object.freeze({
    schema_version: "managed-wk-lifecycle-allocation.v1",
    complete: true,
    main_repo: "/launcher/main",
    initiative: "IN-0059",
    record_id: "WK-2347",
    subject,
    launch_ref: "monitor-stale-tip",
    run_id: "run-stale-tip",
    retry_id: 0,
    worktree_root: "/launcher/worktrees",
    wk_binding: Object.freeze({
      record_id: "WK-2347",
      slice_id: null,
      launch_ref: "monitor-stale-tip",
      run_id: "run-stale-tip.wk",
      retry_id: 0,
      output_branch: "wk/IN-0059/WK-2347",
      wk_tip_sha: tip
    }),
    controlled_contract_generation: Object.freeze({
      schema_version: "controlled-contract-resolved-generation.v1",
      record_id: "WK-2347",
      count: 1,
      generation_digest: `sha256:${"d".repeat(64)}`
    }),
    wk_snapshot: Object.freeze({
      ref: "refs/heads/wk/IN-0059/WK-2347",
      tip,
      tree: tip
    })
  });
}

function findingsSourceSelection(subject) {
  return Object.freeze({
    schema_version: "workspace-agent-findings-snapshot-source-selection.v1",
    authority_kind: "canonical_unit",
    subject,
    repository_path: "/tmp/reviewer",
    source_ref: "refs/heads/main",
    source_commit: "a".repeat(40)
  });
}

function findingsInput(subject = "WK-2405#SLICE-014") {
  return {
    caller_session_id: "session-independent",
    role: "reviewer",
    app: "codex",
    model: "gpt-5.6-terra",
    subject,
    workspace_dir: "/tmp/reviewer",
    config_root_dir: "/tmp/reviewer",
    canonical_unit_write_scope: Object.freeze([]),
    readiness: Object.freeze({ dispatchable: true }),
    trusted_frozen_review_contract: Object.freeze({ review_subject: subject }),
    findings_source_selection: findingsSourceSelection(subject)
  };
}

test("WK-2405 identical findings calls mint, register, and execute independently", async () => {
  const runs = new Map();
  let executions = 0;
  let runNumber = 0;
  let monitorNumber = 0;
  const executor = async () => {
    executions += 1;
    return {
      accepted: true,
      status: "launching",
      probe: async () => ({ status: "running" })
    };
  };
  const { startLaunch } = createLaunchFlow({
    executors: { codex: executor },
    executorRegistryEntries: { codex: executor },
    familyAwareWiring: true,
    runs,
    clock: () => 1_700_000_000_000,
    runIdFactory: () => `findings-run-${++runNumber}`,
    monitorHandleFactory: () => `findings-monitor-${++monitorNumber}`
  });
  const first = await startLaunch(findingsInput());
  const second = await startLaunch(findingsInput());
  assert.equal(first.accepted, true, JSON.stringify(first));
  assert.equal(second.accepted, true, JSON.stringify(second));
  assert.notEqual(first.run_id, second.run_id);
  assert.notEqual(first.monitor_handle, second.monitor_handle);
  assert.equal(executions, 2);
  assert.equal(runs.has(first.run_id), true);
  assert.equal(runs.has(second.run_id), true);
});

test("worker bootstrap precedes worker-only scope freeze and executor release", async () => {
  const events = [];
  const ticket = Object.freeze({});
  const freezeWorkerScopeSnapshot = async ({ managed_wk_lifecycle_ticket }) => {
    assert.equal(managed_wk_lifecycle_ticket, ticket);
    events.push("scope-freeze", "slice-reconcile");
    return { ok: true, snapshot: null };
  };
  Object.defineProperty(freezeWorkerScopeSnapshot, "bootstrapManagedWkLifecycle", {
    value: async () => {
      events.push("resolve-tip", "select-generation", "allocate-wk", "persist-generation", "snapshot-wk");
      return { ok: true, worker_provisioning_ticket: ticket };
    }
  });
  const executor = async () => {
    events.push("spawn");
    return { accepted: true, status: "launching", probe: async () => ({ status: "running" }) };
  };
  const { startLaunch } = createLaunchFlow({
    executors: { codex: executor },
    executorRegistryEntries: {
      codex: { executor, sourceReadMode: "native_filesystem", nativeReadCapability: Object.freeze({}) }
    },
    familyAwareWiring: true,
    runs: new Map(),
    clock: () => 1_700_000_000_000,
    runIdFactory: () => "run-worker",
    monitorHandleFactory: () => "monitor-worker",
    freezeWorkerScopeSnapshot,
    proveAssignedSourceReadable: async () => ({ ok: true })
  });
  const result = await startLaunch({
    caller_session_id: "session-worker",
    role: "worker",
    app: "codex",
    model: "gpt-5.6-terra",
    subject: "WK-2347#SLICE-005",
    workspace_dir: "/tmp/worker",
    canonical_unit_write_scope: Object.freeze(["packages/agent-launch-cli/src/lib"])
  });
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.deepEqual(events, [
    "resolve-tip", "select-generation", "allocate-wk", "persist-generation", "snapshot-wk",
    "scope-freeze", "slice-reconcile", "spawn"
  ]);
});

test("stale authenticated WK tips receive one owner settlement immediately before executor release", async (t) => {
  for (const scenario of [
    { name: "exact winner continues", winnerTip: "b".repeat(40), accepted: true },
    { name: "divergent winner refuses", winnerTip: "c".repeat(40), accepted: false }
  ]) {
    await t.test(scenario.name, async () => {
      const oldTip = "a".repeat(40);
      const authenticatedTip = "b".repeat(40);
      let bootstrapCalls = 0;
      let authenticationCalls = 0;
      let executorCalls = 0;
      const freezeWorkerScopeSnapshot = async () => ({ ok: true, snapshot: null });
      Object.defineProperty(freezeWorkerScopeSnapshot, "bootstrapManagedWkLifecycle", {
        value: async ({ input }) => {
          bootstrapCalls += 1;
          const tip = bootstrapCalls === 1 ? oldTip : scenario.winnerTip;
          const carrier = staleTipOwnerCarrier({ tip });
          input.settle_launcher_transition_plan({
            settlement: carrier,
            planned_base: Object.freeze({
              base_ref: "wk/IN-0059/WK-2347",
              base_sha: tip
            }),
            dependency_evidence: Object.freeze([]),
            publication_identities: Object.freeze([])
          });
          return {
            ok: true,
            worker_provisioning_ticket: null,
            readiness_allocation: Object.freeze({
              schema_version: "managed-wk-allocation-readiness.v1",
              owner: "WK-2261",
              complete: true,
              subject: "WK-2347#SLICE-003",
              wk_tip: tip
            })
          };
        }
      });
      Object.defineProperty(freezeWorkerScopeSnapshot, "authenticateManagedWkTip", {
        value: () => {
          authenticationCalls += 1;
          return Object.freeze({
            base_ref: "wk/IN-0059/WK-2347",
            base_sha: authenticatedTip
          });
        }
      });
      const executor = async (input) => {
        executorCalls += 1;
        assert.equal(input.launcher_transition_plan.lifecycle.planned_base.base_sha,
          authenticatedTip);
        assert.equal(input.launcher_transition_plan.lifecycle.settlement.wk_snapshot.tip,
          authenticatedTip);
        return { accepted: true, status: "launching" };
      };
      const { startLaunch } = createLaunchFlow({
        executors: { codex: executor },
        executorRegistryEntries: {
          codex: {
            executor,
            sourceReadMode: "native_filesystem",
            nativeReadCapability: Object.freeze({})
          }
        },
        familyAwareWiring: true,
        runs: new Map(),
        clock: () => 1_700_000_000_000,
        runIdFactory: () => "run-stale-tip",
        monitorHandleFactory: () => "monitor-stale-tip",
        freezeWorkerScopeSnapshot,
        proveAssignedSourceReadable: async () => ({ ok: true })
      });
      const result = await startLaunch({
        caller_session_id: "session-stale-tip",
        role: "worker",
        app: "codex",
        model: "gpt-5.6-terra",
        subject: "WK-2347#SLICE-003",
        workspace_dir: "/tmp/worker",
        canonical_unit_write_scope: Object.freeze(["packages/agent-launch-cli/src/lib"])
      });
      assert.equal(result.accepted, scenario.accepted, JSON.stringify(result));
      assert.equal(bootstrapCalls, 2, "initial bootstrap plus one bounded owner settlement");
      assert.equal(authenticationCalls, scenario.accepted ? 2 : 1);
      assert.equal(executorCalls, scenario.accepted ? 1 : 0);
      assert.equal(result.managed_wk_allocation.wk_tip,
        scenario.accepted ? authenticatedTip : oldTip);
      if (!scenario.accepted) {
        assert.equal(result.launcher_transition_plan.lifecycle.state,
          "fresh_settlement_refused");
        assert.equal(result.settled_launcher_transition_plan.lifecycle.planned_base.base_sha,
          oldTip);
      }
    });
  }
});

const REVIEW_RECORD_ID = "WK-2363";
const REVIEW_UNIT_ADDRESS = `${REVIEW_RECORD_ID}#SLICE-002`;
const TARGET_UNIT_ADDRESS = `${REVIEW_RECORD_ID}#SLICE-001`;

function admissionCanonicalRecord({
  declareTarget = true,
  targetWriteScope = ["packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs"]
} = {}) {
  return {
    id: REVIEW_RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    record_kind: "work_item",
    work_kind: "implementation",
    initiative: "IN-0013",
    read_scope: ["AGENTS.md"],
    slices: [
      {
        id: "SLICE-001",
        title: "Implementation slice",
        work_kind: "implementation",
        read_scope: ["AGENTS.md"],
        write_scope: targetWriteScope
      },
      {
        id: "SLICE-002",
        title: "Findings-only review of SLICE-001",
        work_kind: "review",
        read_scope: ["AGENTS.md"],
        write_scope: [],
        ...(declareTarget ? { admission_review_target_unit: TARGET_UNIT_ADDRESS } : {})
      }
    ]
  };
}

function admissionResolverOver(store, { generationId = null } = {}) {
  return () => {
    const record = JSON.parse(JSON.stringify(store.record));
    return {
      record,
      generation_id: generationId ?? computeWorkRecordSourceDigest(record),
      repository: record.repo
    };
  };
}

function admissionLifecycle({ resolver, executor, runs = new Map() }) {
  const lifecycle = createDispatchRunLifecycle({
    executors: { codex: executor },
    executorRegistryEntries: { codex: executor },
    familyAwareWiring: true,
    runs,
    clock: () => 1_700_000_000_000,
    sleep: async () => {},
    monotonicNow: () => 0,
    runIdFactory: () => "review-run-admission",
    monitorHandleFactory: () => "review-monitor-admission",
    resolveCanonicalAdmissionReviewRecord: resolver
  });
  return lifecycle;
}

function admissionLaunchInput(overrides = {}) {
  return {
    caller_session_id: "session-wk2363",
    role: "reviewer",
    app: "codex",
    model: "gpt-5.6-terra",
    subject: REVIEW_UNIT_ADDRESS,
    workspace_alias: "wk2363",
    workspace_dir: "/tmp/wk2363-review",
    config_root_dir: "/tmp/wk2363-review",
    canonical_unit_write_scope: Object.freeze([]),
    readiness: Object.freeze({}),
    trusted_frozen_review_contract: Object.freeze({ review_subject: REVIEW_UNIT_ADDRESS }),
    findings_source_selection: findingsSourceSelection(REVIEW_UNIT_ADDRESS),
    ...overrides
  };
}

test("findings execution never consumes the alternate mutable review-target resolver", async () => {
  const store = { record: admissionCanonicalRecord() };
  let resolverCalls = 0;
  const resolver = () => {
    resolverCalls += 1;
    return admissionResolverOver(store)();
  };
  const executor = async () => ({
    accepted: true, status: "launching", probe: async () => ({ status: "running" })
  });
  const { startLaunch, getRunStatus } = admissionLifecycle({ resolver, executor });
  const launched = await startLaunch(admissionLaunchInput());
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  const status = await getRunStatus({
    monitor_handle: "review-monitor-admission",
    caller_session_id: "session-wk2363"
  });
  assert.equal(resolverCalls, 0);
  assert.equal(Object.hasOwn(status, "admission_review_target_identity"), false);
});

test("a findings-only unit without a declared target gains no synthetic identity", async () => {
  const store = { record: admissionCanonicalRecord({ declareTarget: false }) };
  const executor = async () => ({
    accepted: true, status: "launching", probe: async () => ({ status: "running" })
  });
  const { startLaunch, getRunStatus } = admissionLifecycle({
    resolver: admissionResolverOver(store),
    executor
  });

  const launched = await startLaunch(admissionLaunchInput());
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  const status = await getRunStatus({
    monitor_handle: "review-monitor-admission",
    caller_session_id: "session-wk2363"
  });
  assert.equal(
    Object.hasOwn(status, "admission_review_target_identity"),
    false,
    "the unified findings context must not gain a synthetic target identity"
  );
  assert.equal(status.accepted, true);
});

test("findings execution does not require an alternate canonical resolver", async () => {
  const executor = async () => ({
    accepted: true, status: "launching", probe: async () => ({ status: "running" })
  });
  const { startLaunch, getRunStatus } = admissionLifecycle({ resolver: null, executor });
  const launched = await startLaunch(admissionLaunchInput());
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  const status = await getRunStatus({
    monitor_handle: "review-monitor-admission",
    caller_session_id: "session-wk2363"
  });
  assert.equal(Object.hasOwn(status, "admission_review_target_identity"), false);
});

test("caller-reconstructed review-target identity is refused without any canonical resolver", async () => {
  let spawned = false;
  const executor = async () => {
    spawned = true;
    return { accepted: true, status: "launching", probe: async () => ({ status: "running" }) };
  };
  const { startLaunch } = admissionLifecycle({ resolver: null, executor });
  const result = await startLaunch(admissionLaunchInput({
    admission_review_target_identity: Object.freeze({ record_id: REVIEW_RECORD_ID })
  }));
  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.equal(
    result.refusal.reason,
    ADMISSION_REVIEW_TARGET_IDENTITY_REFUSAL_CODES.CALLER_RECONSTRUCTED
  );
  assert.equal(spawned, false);
});
