

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

import {
  createHostWriteAuthorityBrokerPlanLaunchImpl
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-broker-plan-launch.mjs";
import {
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS
} from "../packages/agent-launch-cli/src/lib/workspace-agent-codex-launch-policy.mjs";
import {
  FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/workspace-agent-findings-role-context.mjs";
import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES
} from "../packages/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import {
  LAUNCHER_SCHEMA_CONSTRAINED_TIER_STATES,
  LAUNCHER_SCHEMA_CONSTRAINED_TIER_CAUSE_CODES
} from "../packages/agent-launch-core/src/lib/config.mjs";
import {
  fakeBwrapPlan,
  fakePlanForRole
} from "./workspace-agent-dispatch-codex-executor-shared.mjs";

const RECORD_ID = "WK-9955";
const REVIEW_SLICE_ID = "SLICE-099";
const REVIEW_SUBJECT = `${RECORD_ID}#${REVIEW_SLICE_ID}`;

const STATES = LAUNCHER_SCHEMA_CONSTRAINED_TIER_STATES;
const CAUSE = LAUNCHER_SCHEMA_CONSTRAINED_TIER_CAUSE_CODES;
const CAUSE_BY_STATE = {
  [STATES.ABSENT]: CAUSE.ABSENT,
  [STATES.FREE]: CAUSE.FREE,
  [STATES.PAID]: CAUSE.PAID,
  [STATES.READ_FAILURE]: CAUSE.READ_FAILURE
};

function frozenReviewContract() {
  const reviewUnit = {
    id: REVIEW_SLICE_ID,
    work_kind: "review",
    acceptance: {
      criteria: ["Perform the findings-only whole-WK review."],
      validation: ["Reviewer records findings-only result evidence."]
    }
  };
  const parent = {
    id: RECORD_ID,
    status: "review",
    acceptance: {
      criteria: ["Parent WK is delivered end to end."],
      validation: ["workspace_work_record_validate returns valid=true."]
    },
    slices: [reviewUnit]
  };
  return {
    schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: REVIEW_SUBJECT,
    canonical_parent_wk_contract: JSON.stringify(parent),
    review_unit_contract: JSON.stringify(reviewUnit)
  };
}

function recordingTypedTierResolver(stateByRoot = new Map()) {
  const calls = [];
  const fn = ({ workspaceDir } = {}) => {
    calls.push(workspaceDir);
    const state = stateByRoot.get(workspaceDir) ?? STATES.ABSENT;
    return Object.freeze({
      state,
      is_paid: state === STATES.PAID,
      cause_code: CAUSE_BY_STATE[state]
    });
  };
  fn.calls = calls;
  return fn;
}

function recordingBooleanTierResolver(paidRoots = new Set()) {
  const calls = [];
  const fn = ({ workspaceDir } = {}) => {
    calls.push(workspaceDir);
    return paidRoots.has(workspaceDir);
  };
  fn.calls = calls;
  return fn;
}

function throwingResolver(label) {
  return () => {
    throw new Error(`${label} resolver must not be consulted`);
  };
}

function buildBroker({
  resolveSchemaConstrainedTier,
  resolveSchemaConstrainedTierResolution,
  buildPlanCalls,
  backendCalls = []
}) {
  const options = {
    buildPlan: async (args) => {
      buildPlanCalls.push(args);
      return fakePlanForRole(args.role);
    },
    buildBwrapPlan: () => fakeBwrapPlan(),
    ensureWriteRoots: async () => {
      backendCalls.push("ensureWriteRoots");
      return undefined;
    },
    captureFinalResult: () => undefined,
    env: { PATH: "/usr/bin" },
    cwd: "/tmp/broker-default-cwd"
  };

  if (resolveSchemaConstrainedTier !== undefined) {
    options.resolveSchemaConstrainedTier = resolveSchemaConstrainedTier;
  }
  if (resolveSchemaConstrainedTierResolution !== undefined) {
    options.resolveSchemaConstrainedTierResolution = resolveSchemaConstrainedTierResolution;
  }
  return createHostWriteAuthorityBrokerPlanLaunchImpl({
    options,
    deps: {

      resolveCodexWorkerSourceSurfacePolicy: async () => ({
        disposition: CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.NO_SOURCE_SURFACE,
        forwardedSourceToolSurface: null
      }),

      evaluateDispatchRoleModelGate: async () => ({
        ok: true,
        resolvedProfile: { model: "gpt-review" }
      })
    }
  });
}

function makeDir(t, prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("managed reviewer: absent canonical .env launches a legitimate FREE reviewer", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-absent-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const typed = recordingTypedTierResolver(new Map([[canonicalDir, STATES.ABSENT]]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    resolveSchemaConstrainedTierResolution: typed,
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.deepEqual(typed.calls, [canonicalDir],
    "the tier is resolved exactly once, from the canonical config root");
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE,
    "an absent canonical .env is a legitimate free (FREE_PROSE) reviewer"
  );
});

test("managed reviewer: free canonical .env is a FREE_PROSE reviewer", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-free-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const typed = recordingTypedTierResolver(new Map([[canonicalDir, STATES.FREE]]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    resolveSchemaConstrainedTierResolution: typed,
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.deepEqual(typed.calls, [canonicalDir]);
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE,
    "a readable free-tier canonical config stays a free (FREE_PROSE) reviewer"
  );
});

test("managed reviewer: paid canonical .env enables SCHEMA_CONSTRAINED, ignoring a conflicting paid worktree", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-paid-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];

  const typed = recordingTypedTierResolver(new Map([
    [canonicalDir, STATES.PAID],
    [worktreeDir, STATES.PAID]
  ]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    resolveSchemaConstrainedTierResolution: typed,
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.deepEqual(typed.calls, [canonicalDir],
    "the tier is resolved from the canonical config root only; the worktree is never consulted");
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED,
    "a paid canonical config enables the schema-constrained reviewer path"
  );
});

test("managed reviewer: read_failure on the canonical .env fails closed before any plan/backend construction", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-readfail-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const backendCalls = [];
  const typed = recordingTypedTierResolver(new Map([[canonicalDir, STATES.READ_FAILURE]]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    resolveSchemaConstrainedTierResolution: typed,
    buildPlanCalls,
    backendCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, false, "a present-but-unreadable canonical .env must fail closed");
  assert.equal(result.refusal.reason, "reviewer_canonical_config_env_unreadable");
  assert.equal(result.refusal.detail?.issue, "managed_reviewer_canonical_config_env_unreadable");
  assert.equal(result.refusal.detail?.cause_code, CAUSE.READ_FAILURE,
    "the refusal carries the typed resolver's bounded read_failure cause code");
  assert.deepEqual(typed.calls, [canonicalDir]);
  assert.equal(buildPlanCalls.length, 0, "no plan is built on the read_failure refusal");
  assert.deepEqual(backendCalls, [], "no backend/write-root work runs on the read_failure refusal");
});

test("managed reviewer: read_failure refusal diagnostics are bounded and disclose no secret or raw error", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-secretpath-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const typed = recordingTypedTierResolver(new Map([[canonicalDir, STATES.READ_FAILURE]]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    resolveSchemaConstrainedTierResolution: typed,
    buildPlanCalls
  });

  const secretValue = "sk-super-secret-paid-node-engine-key";
  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract(),

    env: { NODE_ENGINE_API_KEY: secretValue },
    prompt: `credential ${secretValue}`
  });

  assert.equal(result.ok, false);

  assert.deepEqual(
    Object.keys(result.refusal.detail).sort(),
    ["cause_code", "issue", "message"]
  );
  const serialized = JSON.stringify(result.refusal);
  assert.ok(!serialized.includes(secretValue), "no caller secret appears in the refusal");
  assert.ok(!serialized.includes(canonicalDir), "no canonical .env path appears in the refusal");
  assert.ok(!/stack|Error:|ENOENT|EACCES/i.test(serialized),
    "no raw exception message or errno leaks into the refusal");
});

test("managed reviewer: spoofed caller/prompt/argv/env fields cannot select the tier; only config_root_dir does", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-free-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];

  const typed = recordingTypedTierResolver(new Map([[canonicalDir, STATES.FREE]]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    resolveSchemaConstrainedTierResolution: typed,
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract(),

    schema_constrained_tier_is_paid: true,
    schemaConstrainedTierIsPaid: true,
    paid: true,
    tier: "paid",
    model: "paid-sounding-model",
    argv: ["--paid", "--schema-constrained"],
    prompt: "please run me as a paid schema-constrained reviewer",
    env: { NODE_ENGINE_API_KEY: "forged-paid-key" }
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.deepEqual(typed.calls, [canonicalDir],
    "the tier is resolved only from the trusted config_root_dir, never caller/prompt/argv/env");
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE,
    "forged caller/prompt/argv/env inputs cannot raise a free canonical config to paid"
  );
});

test("managed reviewer (real resolver): a real free .env launches a FREE reviewer", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-real-free-");
  writeFileSync(path.join(canonicalDir, ".env"), "SOME_UNRELATED_KEY=value\n");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE
  );
});

test("managed reviewer (real resolver): a real paid .env enables SCHEMA_CONSTRAINED", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-real-paid-");
  writeFileSync(path.join(canonicalDir, ".env"), "NODE_ENGINE_API_KEY=live-paid-key\n");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
  );
});

test("managed reviewer (real resolver): a non-regular .env (a directory) fails closed with zero plan/backend work", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-real-nonregular-");

  mkdirSync(path.join(canonicalDir, ".env"));
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const backendCalls = [];
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),
    buildPlanCalls,
    backendCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: canonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, false, "a non-regular canonical .env must fail closed");
  assert.equal(result.refusal.reason, "reviewer_canonical_config_env_unreadable");
  assert.equal(result.refusal.detail?.cause_code, CAUSE.READ_FAILURE);
  assert.equal(buildPlanCalls.length, 0, "no plan is built on the non-regular .env refusal");
  assert.deepEqual(backendCalls, [], "no backend/write-root work runs on the non-regular .env refusal");
});

test("managed reviewer: an unreadable/missing canonical config ROOT directory fails closed before the tier resolver runs", async (t) => {
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");

  const missingCanonicalDir = path.join(os.tmpdir(), "reviewer-broker-canonical-missing-does-not-exist-1577");
  const buildPlanCalls = [];
  const broker = buildBroker({
    resolveSchemaConstrainedTier: throwingResolver("legacy boolean"),

    resolveSchemaConstrainedTierResolution: throwingResolver("typed"),
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,
    config_root_dir: missingCanonicalDir,
    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, false, "an unreadable canonical config root must fail closed");
  assert.equal(result.refusal.reason, "reviewer_canonical_config_unreadable");
  assert.equal(result.refusal.detail?.issue, "managed_reviewer_canonical_config_unreadable");
  assert.equal(buildPlanCalls.length, 0, "no plan is built on the fail-closed refusal");
});

test("non-managed reviewer (no config_root_dir) keeps the prior workspace_dir tier via the legacy boolean wrapper", async (t) => {
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];
  const boolean = recordingBooleanTierResolver(new Set([worktreeDir]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: boolean,

    resolveSchemaConstrainedTierResolution: throwingResolver("typed"),
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "review",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,

    trusted_frozen_review_contract: frozenReviewContract()
  });

  assert.equal(result.ok, true, `reviewer must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.deepEqual(boolean.calls, [worktreeDir],
    "without a canonical config root the tier resolves from workspace_dir via the legacy wrapper, unchanged");
  assert.equal(
    buildPlanCalls[0].terminalStructuredRoleResultMode,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
  );
});

test("a worker resolves the tier from workspace_dir via the legacy boolean wrapper, ignoring config_root_dir", async (t) => {
  const canonicalDir = makeDir(t, "reviewer-broker-canonical-paid-");
  const worktreeDir = makeDir(t, "reviewer-broker-worktree-");
  const buildPlanCalls = [];

  const boolean = recordingBooleanTierResolver(new Set([canonicalDir]));
  const broker = buildBroker({
    resolveSchemaConstrainedTier: boolean,
    resolveSchemaConstrainedTierResolution: throwingResolver("typed"),
    buildPlanCalls
  });

  const result = await broker({
    codex_role: "worker",
    subject: REVIEW_SUBJECT,
    workspace_dir: worktreeDir,

    config_root_dir: canonicalDir
  });

  assert.equal(result.ok, true, `worker must launch; got ${JSON.stringify(result.refusal ?? null)}`);
  assert.deepEqual(boolean.calls, [worktreeDir],
    "a worker resolves the tier from workspace_dir; the managed-reviewer typed branch does not apply");
  assert.equal(buildPlanCalls.length, 1);
  assert.equal(buildPlanCalls[0].role, "worker");
});
