

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspect } from "node:util";

import {
  defaultTerminalCandidateRunGit,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  TerminalWkCandidateError
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  LIFECYCLE_FAILURE_HISTORY_LIMIT,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  recordLifecycleFailure
} from "../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import { runPostWorkerSliceLifecycle } from
  "../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs";
import {
  buildDispatchToolExceptionDetail,
  SLICE_REVIEW_POSTCHECK_FAILED_CODE
} from "../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import {
  createDispatchToolRegistry,
  parseStructuredTextResponse
} from "../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  CLOSED_CANDIDATE_FAILURE_KEYS,
  CLOSED_CANDIDATE_FAILURE_KINDS,
  CLOSED_LIFECYCLE_FAILURE_CODES,
  CLOSED_LIFECYCLE_FAILURE_KEYS,
  CLOSED_LIFECYCLE_FAILURE_MESSAGES,
  CLOSED_LIFECYCLE_FAILURE_NAME,
  CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
  closeTerminalCandidatePreparationFailure,
  isClosedLifecycleFailure,
  projectClosedLifecycleFailure
} from "../packages/wiki-mcp/src/lib/dispatch-lifecycle-failure-projection.mjs";

const PREPARATION_FAILED_CODE =
  CLOSED_LIFECYCLE_FAILURE_CODES.TERMINAL_CANDIDATE_PREPARATION_FAILED;
const PREPARATION_FAILED_MESSAGE =
  CLOSED_LIFECYCLE_FAILURE_MESSAGES[PREPARATION_FAILED_CODE];

const SECRETS = Object.freeze([
  "sk-live-wk1759-slice004-candidate-canary",
  "Bearer ghp_wk1759-slice004-authorization-canary",
  "/home/launcher/.config/agent-launch/credentials.toml",
  "AGENT_LAUNCH_FORGE_TOKEN=wk1759-environment-canary",
  "at hostileFrame (/opt/private/launcher/spawn-secret.mjs:42:7)"
]);

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

function collectStrings(value, seen = new Set(), out = []) {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, seen, out);
    return out;
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || typeof descriptor.get === "function") continue;
    out.push(key);
    collectStrings(descriptor.value, seen, out);
  }
  return out;
}

function collectObjects(value, seen = new Set(), out = []) {
  if (typeof value !== "object" || value === null) return out;
  if (seen.has(value)) return out;
  seen.add(value);
  out.push(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectObjects(entry, seen, out);
    return out;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || typeof descriptor.get === "function") continue;
    collectObjects(descriptor.value, seen, out);
  }
  return out;
}

function assertNoSecrets(label, ...surfaces) {
  const haystack = surfaces.flatMap((surface) =>
    typeof surface === "string" ? [surface] : collectStrings(surface)
  );
  for (const secret of SECRETS) {
    for (const text of haystack) {
      assert.equal(
        text.includes(secret),
        false,
        `${label} disclosed the injected secret ${JSON.stringify(secret)}`
      );
    }
  }
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1759-slice004-"));
  const repo = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.invalid");
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const B = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "wk/IN-0030/WK-1634");
  git(repo, "checkout", "-q", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "wk.txt"), "complete WK change\n");
  git(repo, "add", "wk.txt");
  git(repo, "commit", "-q", "-m", "wk");
  const W = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "main");
  writeFileSync(path.join(repo, "landing.txt"), "landing only\n");
  git(repo, "add", "landing.txt");
  git(repo, "commit", "-q", "-m", "landing");
  const L = git(repo, "rev-parse", "HEAD");
  return { root, repo, worktrees, B, W, L };
}

const WK_REF = "refs/heads/wk/IN-0030/WK-1634";
const SLICE_REF = "refs/heads/slice/IN-0030/WK-1634/SLICE-007";

function integrationFor(state, entry) {
  const common = {
    wk_ref: WK_REF,
    wk_sha: state.W,
    slice_ref: SLICE_REF,
    slice_sha: state.W,
    integrated: true
  };
  if (entry === "recovered") {

    return Object.freeze({ ...common, recovered: true, review_target: null });
  }
  return Object.freeze({
    ...common,
    review_target: Object.freeze({
      schema_version: "slice-integration.v1",
      unit_address: "IN-0030/WK-1634",
      ref: WK_REF,
      sha: state.W,
      diff_base_sha: state.B,
      diff_head_sha: state.W,
      diff_range: `${state.B}..${state.W}`,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true
    })
  });
}

async function runPreparationFailure(state, { entry, throwValue, synchronous = false }) {
  const integration = integrationFor(state, entry);
  const checkpoint = {
    phase: POST_WORKER_LIFECYCLE_PHASES.INTEGRATED,
    integration,
    slice_review: null,
    finalized: null,
    in_flight: null,
    failure_attempts: 0,
    failure_history: []
  };
  const status = {
    run_id: `worker-${entry}`,
    monitor_handle: `worker-${entry}-handle`,
    role: "worker",
    subject: "WK-1634#SLICE-007",
    status: "succeeded",
    terminal: true,
    [POST_WORKER_LIFECYCLE_CHECKPOINT]: checkpoint
  };
  const counters = { prepare: 0, validate: 0, bindReview: 0, commitAuthority: 0, retire: 0 };
  const deps = {
    runGit: defaultTerminalCandidateRunGit,
    resolveManagedRunBinding: () => ({
      record_id: "WK-1634",
      slice_id: "SLICE-007",
      slice_binding: {
        unit_address: "IN-0030/WK-1634/SLICE-007",
        output_branch: "slice/IN-0030/WK-1634/SLICE-007",
        worktree_path: state.repo,
        base_sha: state.B,
        retry_id: 0
      },
      wk_binding: {
        unit_address: "IN-0030/WK-1634",
        output_branch: "wk/IN-0030/WK-1634",
        worktree_path: state.repo,
        base_ref: "main",
        base_sha: state.B
      },
      validation_worktree_path: state.repo
    }),
    resolveCanonicalReviewUnit: () => ({
      record_id: "WK-1634",
      initiative: "IN-0030",
      subject: "WK-1634#SLICE-008",
      parent_status: "done"
    }),
    prepareTerminalCandidate: synchronous
      ? () => { counters.prepare += 1; throw throwValue; }
      : async () => { counters.prepare += 1; throw throwValue; },

    validateTerminalCandidate: async () => { counters.validate += 1; return []; },
    bindFrozenReviewContext: async () => {
      counters.bindReview += 1;
      throw new Error("review context was bound after a failed candidate preparation");
    },
    markCommitAuthorityExercised: () => { counters.commitAuthority += 1; },
    retireManagedWorkerIdentity: async () => { counters.retire += 1; return { retired: true }; },
    hostSliceIntegrationAdapter: () => {
      throw new Error("slice integration was re-delegated after a failed candidate preparation");
    }
  };
  const before = {
    wk: git(state.repo, "rev-parse", WK_REF),
    main: git(state.repo, "rev-parse", "refs/heads/main")
  };
  let raised = null;
  let resolved;
  try {
    resolved = await runPostWorkerSliceLifecycle({
      workspace: { repo: "agent-chassis", dir: state.repo },
      status,
      deps
    });
  } catch (error) {
    raised = error;
  }
  return {
    raised,
    resolved,
    checkpoint,
    counters,
    integration,
    before,
    after: {
      wk: git(state.repo, "rev-parse", WK_REF),
      main: git(state.repo, "rev-parse", "refs/heads/main")
    }
  };
}

function renderMonitorEnvelope(checkpoint, error) {
  const detail = buildDispatchToolExceptionDetail("post_worker_slice_lifecycle", error);
  const failure = {
    invoked: true,
    phase: checkpoint.phase,
    integrated: checkpoint.phase !== POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    error_code: error?.code ?? "agent_launch.slice_lifecycle.failed.v1",
    error_message: detail.error_message,
    error_message_truncated: detail.error_message_truncated
  };
  if (detail.postcheck_mismatch_field !== undefined) {
    failure.postcheck_mismatch_field = detail.postcheck_mismatch_field;
  }
  if (checkpoint.integration) failure.integration = checkpoint.integration;
  return Object.freeze(failure);
}

function assertClosedCarrier(label, run, state, { throwValue }) {
  const carrier = run.raised;
  assert.notEqual(carrier, null, `${label}: the lifecycle resolved instead of refusing`);
  assert.equal(run.resolved, undefined, `${label}: a failed preparation produced a result`);

  assert.equal(isClosedLifecycleFailure(carrier), true, `${label}: carrier is unbranded`);

  assert.deepEqual(Object.keys(carrier), [...CLOSED_LIFECYCLE_FAILURE_KEYS]);
  assert.deepEqual(
    Object.getOwnPropertyNames(carrier).sort(),
    ["candidate_failure", "code", "message", "name", "schema_version", "stack"]
  );
  assert.deepEqual(Object.getOwnPropertySymbols(carrier), []);
  assert.equal(Object.isFrozen(carrier), true);
  assert.equal(carrier.schema_version, CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION);
  assert.equal(carrier.code, PREPARATION_FAILED_CODE);
  assert.equal(carrier.name, CLOSED_LIFECYCLE_FAILURE_NAME);
  assert.equal(carrier.message, PREPARATION_FAILED_MESSAGE);
  assert.equal(carrier.stack, `${CLOSED_LIFECYCLE_FAILURE_NAME}: ${PREPARATION_FAILED_MESSAGE}`);

  assert.equal(Object.hasOwn(carrier, "cause"), false);
  assert.equal(carrier.cause, undefined);
  assert.equal(Object.hasOwn(carrier, "detail"), false);
  assert.deepEqual(
    Object.keys(carrier.candidate_failure).sort(),
    [...CLOSED_CANDIDATE_FAILURE_KEYS].sort()
  );
  if (typeof throwValue === "object" && throwValue !== null) {
    for (const held of collectObjects(carrier)) {
      assert.notEqual(held, throwValue, `${label}: the raw throwable survived on the carrier`);
    }
  }

  const envelope = renderMonitorEnvelope(run.checkpoint, carrier);
  assert.equal(envelope.error_code, PREPARATION_FAILED_CODE);
  assert.equal(envelope.error_message, PREPARATION_FAILED_MESSAGE);
  assert.equal(envelope.error_message_truncated, false);
  assert.equal(Object.hasOwn(envelope, "postcheck_mismatch_field"), false);
  const recorded = recordLifecycleFailure(run.checkpoint, envelope);
  assert.deepEqual(run.checkpoint.failure_history.at(-1), {
    phase: POST_WORKER_LIFECYCLE_PHASES.INTEGRATED,
    error_code: PREPARATION_FAILED_CODE,
    error_message: PREPARATION_FAILED_MESSAGE,
    error_message_truncated: false
  });
  assertNoSecrets(
    `${label} carrier/checkpoint/envelope`,
    carrier,
    projectClosedLifecycleFailure(carrier),
    envelope,
    recorded,
    run.checkpoint.failure_history,
    JSON.stringify(carrier),
    JSON.stringify(projectClosedLifecycleFailure(carrier)),
    JSON.stringify(envelope),
    JSON.stringify(run.checkpoint.failure_history),

    inspect(carrier, { depth: null }),
    inspect(projectClosedLifecycleFailure(carrier), { depth: null })
  );

  assert.equal(run.counters.prepare, 1, `${label}: preparation ran more than once`);
  assert.equal(run.counters.validate, 0, `${label}: validation ran after a failed preparation`);
  assert.equal(run.counters.bindReview, 0, `${label}: a reviewer context was bound`);
  assert.equal(run.counters.commitAuthority, 0, `${label}: commit authority was exercised`);
  assert.equal(run.counters.retire, 0, `${label}: a settled identity was retired`);

  assert.equal(run.after.wk, state.W);
  assert.equal(run.after.wk, run.before.wk);
  assert.equal(run.after.main, state.L);
  assert.equal(run.after.main, run.before.main);
  assert.equal(git(state.repo, "rev-parse", `${WK_REF}^`), state.B);
  assert.equal(
    git(state.repo, "for-each-ref", "--format=%(refname)", "refs/agent-launch/"),
    "",
    `${label}: a candidate ref was published by a failed preparation`
  );
  assert.equal(existsSync(path.join(state.worktrees, ".terminal-candidates")), false);
  assert.equal(existsSync(path.join(state.worktrees, ".terminal-validation")), false);
  assert.equal(run.checkpoint.phase, POST_WORKER_LIFECYCLE_PHASES.INTEGRATED);
  assert.equal(run.checkpoint.finalized, null);
  assert.equal(run.checkpoint.slice_review, null);
  assert.equal(run.checkpoint.integration.wk_sha, state.W);
  assert.equal(run.checkpoint.integration.slice_sha, state.W);
  assert.equal(run.checkpoint.integration.wk_ref, WK_REF);

  return projectClosedLifecycleFailure(carrier);
}

function secretBearingError() {
  const error = new Error(`spawn failed: ${SECRETS[0]} ${SECRETS[1]} ${SECRETS[2]}`);
  error.name = SECRETS[3];
  error.code = `ENOENT ${SECRETS[2]}`;
  error.stack = SECRETS[4];
  error.cause = new Error(SECRETS[0]);
  error.authorization = SECRETS[1];
  error.env = { AGENT_LAUNCH_FORGE_TOKEN: SECRETS[3] };
  return error;
}

function typedCandidateError() {
  return new TerminalWkCandidateError(
    `plumbing refused ${SECRETS[0]} ${SECRETS[2]}`,
    {
      code: TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
      detail: {
        args: ["commit-tree", "-p", "0".repeat(40)],
        status: 128,
        stderr: "fatal: not a valid object name",
        stdout: SECRETS[0],
        env: { AGENT_LAUNCH_FORGE_TOKEN: SECRETS[3] },
        authorization: SECRETS[1],
        credentials_path: SECRETS[2]
      },
      cause: new Error(SECRETS[4])
    }
  );
}

function forgedTypedCandidateError() {
  const forged = { code: `terminal_candidate_recovery_${SECRETS[3]}`, message: SECRETS[0] };
  forged.detail = { args: [SECRETS[2]], status: 1, stderr: SECRETS[1] };
  Object.setPrototypeOf(forged, TerminalWkCandidateError.prototype);
  return forged;
}

function hostileProxy() {
  const raise = () => { throw new Error(`proxy trap fired: ${SECRETS[0]}`); };
  return new Proxy({}, {
    get: raise,
    has: raise,
    getPrototypeOf: raise,
    ownKeys: raise,
    getOwnPropertyDescriptor: raise
  });
}

function hostileThrowable() {
  return {
    get code() { throw new Error(`code getter fired: ${SECRETS[1]}`); },
    get message() { throw new Error(`message getter fired: ${SECRETS[0]}`); },
    toString() { throw new Error(`toString fired: ${SECRETS[2]}`); },
    [Symbol.toPrimitive]() { throw new Error(`toPrimitive fired: ${SECRETS[3]}`); }
  };
}

const UNKNOWN_CAUSE_INJECTIONS = Object.freeze([
  ["secret-bearing Error", () => secretBearingError()],
  ["bare secret string", () => `${SECRETS[0]} ${SECRETS[2]}`],
  ["forged lookalike object", () => ({
    code: TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    name: "TerminalWkCandidateError",
    message: SECRETS[0],
    kind: "typed_candidate_error",
    detail: { git_args: [SECRETS[2]], git_status: 1, git_stderr: SECRETS[1] },
    terminal_candidate_failure: { kind: "typed_candidate_error", code: SECRETS[3] },
    schema_version: CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
    candidate_failure: { kind: "typed_candidate_error", code: SECRETS[3] }
  })],
  ["null", () => null],
  ["undefined", () => undefined],
  ["prototype-forged typed candidate error", () => forgedTypedCandidateError()],
  ["hostile proxy", () => hostileProxy()],
  ["hostile non-Error throwable", () => hostileThrowable()]
]);

const EXPECTED_UNKNOWN_PROJECTION = Object.freeze({
  kind: CLOSED_CANDIDATE_FAILURE_KINDS.UNKNOWN,
  code: null,
  message: TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

for (const entry of ["first_construction", "recovered"]) {
  test(`WK-1759#SLICE-004 ${entry}: every non-typed preparation throw becomes the fixed unknown projection`, async (t) => {
    const state = fixture(t);
    for (const [label, make] of UNKNOWN_CAUSE_INJECTIONS) {
      const throwValue = make();
      const run = await runPreparationFailure(state, { entry, throwValue });
      const projection = assertClosedCarrier(`${entry}/${label}`, run, state, { throwValue });
      assert.deepEqual(projection, {
        schema_version: CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
        code: PREPARATION_FAILED_CODE,
        message: PREPARATION_FAILED_MESSAGE,
        candidate_failure: EXPECTED_UNKNOWN_PROJECTION
      }, `${entry}/${label}: unknown causes must retain only the fixed unknown projection`);
    }
  });

  test(`WK-1759#SLICE-004 ${entry}: a typed candidate failure keeps its stable code and only the approved bounded Git detail`, async (t) => {
    const state = fixture(t);
    const throwValue = typedCandidateError();
    const run = await runPreparationFailure(state, { entry, throwValue });
    const projection = assertClosedCarrier(`${entry}/typed`, run, state, { throwValue });
    assert.equal(projection.candidate_failure.kind, CLOSED_CANDIDATE_FAILURE_KINDS.TYPED);
    assert.equal(
      projection.candidate_failure.code,
      TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
      "the exact stable typed candidate code must survive"
    );
    assert.deepEqual(Object.keys(projection.candidate_failure.detail).sort(), [
      "git_args", "git_status", "git_stderr"
    ]);
    assert.deepEqual(
      projection.candidate_failure.detail.git_args,
      ["commit-tree", "-p", "0".repeat(40)]
    );
    assert.equal(projection.candidate_failure.detail.git_status, 128);
    assert.equal(projection.candidate_failure.detail.git_stderr, "fatal: not a valid object name");

    assertNoSecrets(`${entry}/typed detail`, projection, JSON.stringify(projection));
  });

  test(`WK-1759#SLICE-004 ${entry}: a synchronous preparation throw is caught by the same boundary`, async (t) => {
    const state = fixture(t);
    const throwValue = secretBearingError();
    const run = await runPreparationFailure(state, { entry, throwValue, synchronous: true });
    const projection = assertClosedCarrier(`${entry}/sync`, run, state, { throwValue });
    assert.deepEqual(projection.candidate_failure, EXPECTED_UNKNOWN_PROJECTION);
  });
}

test("WK-1759#SLICE-004 first construction and recovery produce byte-identical closed failures", async (t) => {
  const state = fixture(t);
  const injections = [
    ["typed", () => typedCandidateError()],
    ...UNKNOWN_CAUSE_INJECTIONS
  ];
  for (const [label, make] of injections) {
    const first = await runPreparationFailure(state, {
      entry: "first_construction",
      throwValue: make()
    });
    const recovered = await runPreparationFailure(state, {
      entry: "recovered",
      throwValue: make()
    });
    assert.deepEqual(
      projectClosedLifecycleFailure(first.raised),
      projectClosedLifecycleFailure(recovered.raised),
      `${label}: the two preparation entries must project identically`
    );
    assert.equal(first.raised.code, recovered.raised.code);
    assert.equal(first.raised.message, recovered.raised.message);
    assert.equal(first.raised.stack, recovered.raised.stack);
  }
});

test("WK-1759#SLICE-004 the recovered entry genuinely reconstructs its target before preparation", async (t) => {

  const state = fixture(t);
  const run = await runPreparationFailure(state, {
    entry: "recovered",
    throwValue: secretBearingError()
  });
  assert.equal(run.integration.review_target, null);
  assert.equal(run.integration.recovered, true);
  assert.equal(run.counters.prepare, 1, "the recovered entry must reach candidate preparation");
  assert.equal(isClosedLifecycleFailure(run.raised), true);

  assert.equal(run.checkpoint.integration.review_target.sha, state.W);
  assert.equal(run.checkpoint.integration.review_target.diff_base_sha, state.B);
  assert.equal(run.checkpoint.integration.review_target.ref, WK_REF);
});

test("WK-1759#SLICE-004 forged and lookalike carriers are rejected", () => {
  const real = closeTerminalCandidatePreparationFailure(new Error(SECRETS[0]));
  assert.equal(isClosedLifecycleFailure(real), true);

  const plainLookalike = {
    schema_version: real.schema_version,
    code: real.code,
    candidate_failure: real.candidate_failure
  };

  const errorLookalike = Object.assign(new Error(PREPARATION_FAILED_MESSAGE), {
    name: CLOSED_LIFECYCLE_FAILURE_NAME,
    schema_version: real.schema_version,
    code: real.code,
    candidate_failure: real.candidate_failure
  });

  const protoLookalike = Object.create(Object.getPrototypeOf(real));

  const proxied = new Proxy(real, {});

  for (const [label, value] of [
    ["plain lookalike", plainLookalike],
    ["error lookalike", errorLookalike],
    ["prototype lookalike", protoLookalike],
    ["proxied real carrier", proxied],
    ["null", null],
    ["undefined", undefined],
    ["string", PREPARATION_FAILED_CODE],
    ["number", 1],
    ["symbol", Symbol("carrier")]
  ]) {
    assert.equal(isClosedLifecycleFailure(value), false, `${label} was accepted as a carrier`);
    assert.equal(projectClosedLifecycleFailure(value), null, `${label} was projected`);
  }

  const CarrierClass = Object.getPrototypeOf(real).constructor;
  assert.throws(
    () => new CarrierClass(Symbol("forged-token"), real.code, real.candidate_failure),
    /constructible only by trusted lifecycle code/u
  );
  assert.throws(
    () => new CarrierClass(undefined, real.code, real.candidate_failure),
    /constructible only by trusted lifecycle code/u
  );
  assert.equal(isClosedLifecycleFailure(real), true);
});

test("WK-1759#SLICE-004 the producer never reads a hostile throwable", () => {

  const carrier = closeTerminalCandidatePreparationFailure(hostileProxy());
  assert.equal(isClosedLifecycleFailure(carrier), true);
  assert.deepEqual(carrier.candidate_failure, EXPECTED_UNKNOWN_PROJECTION);
  assertNoSecrets("hostile proxy producer", carrier, inspect(carrier, { depth: null }));

  for (const value of [null, undefined, "", 0, false, Symbol("x"), 10n, () => {}, []]) {
    const projected = closeTerminalCandidatePreparationFailure(value);
    assert.equal(isClosedLifecycleFailure(projected), true);
    assert.deepEqual(projected.candidate_failure, EXPECTED_UNKNOWN_PROJECTION);
  }
});

const MONITOR_HANDLE = "wkmh_wk1759_slice005";
const ROUTE_SUBJECT = "WK-1634#SLICE-007";

const GENERIC_LIFECYCLE_FAILURE = Object.freeze({
  invoked: true,
  phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
  integrated: false,
  error_code: "agent_launch.slice_lifecycle.failed.v1",
  error_message: "post-worker slice lifecycle invocation failed",
  error_message_truncated: false
});

const TERMINAL_CHILD = Object.freeze({
  accepted: true,
  timed_out: false,
  run_id: "run-wk1759-slice005",
  monitor_handle: MONITOR_HANDLE,
  role: "worker",
  subject: ROUTE_SUBJECT,
  status: "succeeded",
  terminal: true,
  started_at: "2026-07-24T00:00:00.000Z",
  updated_at: "2026-07-24T00:01:00.000Z"
});

function monitorRoutes(makeThrow) {
  const counters = { lifecycle: 0, launched: 0 };
  const tools = createDispatchToolRegistry({
    backend: {

      startLaunch: async () => { counters.launched += 1; return { accepted: false }; },
      getRunStatus: async () => TERMINAL_CHILD,
      waitForRunStatus: async () => TERMINAL_CHILD,
      runPostWorkerSliceLifecycle: async () => { counters.lifecycle += 1; throw makeThrow(); }
    }
  });
  const call = async (tool, extra) => parseStructuredTextResponse(
    await tools.get(tool).handler({
      monitor_handle: MONITOR_HANDLE, subject: ROUTE_SUBJECT, ...extra
    })
  );
  return {
    counters,
    status: () => call("workspace_agent_run_status", {}),

    wait: () => call("workspace_agent_run_wait", { timeout_ms: 1, poll_interval_ms: 500 })
  };
}

function expectedLatestFailure(failure) {
  return {
    phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    error_code: failure.error_code,
    error_message: failure.error_message,
    error_message_truncated: false
  };
}

async function assertClosedMonitorRefusal(label, makeThrow) {
  const routes = monitorRoutes(makeThrow);
  const first = await routes.status();
  const replay = await routes.status();
  const wait = await routes.wait();

  for (const [route, response] of [["status", first], ["status replay", replay], ["wait", wait]]) {
    const at = `${label}/${route}`;
    assert.deepEqual(response.slice_lifecycle, GENERIC_LIFECYCLE_FAILURE, at);
    assert.deepEqual(
      response.lifecycle_resolution.latest_failure,
      expectedLatestFailure(GENERIC_LIFECYCLE_FAILURE),
      at
    );

    assert.equal(response.terminal, false, at);
    assert.equal(response.child_terminal, true, at);
    assertNoSecrets(at, JSON.stringify(response), response);
  }

  assert.equal(JSON.stringify(first.slice_lifecycle), JSON.stringify(replay.slice_lifecycle));
  assert.equal(JSON.stringify(first.slice_lifecycle), JSON.stringify(wait.slice_lifecycle));

  const attempts = routes.counters.lifecycle;
  const retained = Math.min(attempts, LIFECYCLE_FAILURE_HISTORY_LIMIT);
  assert.ok(attempts >= 3, `${label}: ${attempts} lifecycle attempts`);
  assert.equal(wait.lifecycle_resolution.failure_attempts, retained, label);
  assert.equal(wait.lifecycle_resolution.retained_failures.length, retained, label);
  for (const entry of wait.lifecycle_resolution.retained_failures) {
    assert.deepEqual(entry, expectedLatestFailure(GENERIC_LIFECYCLE_FAILURE), label);
  }
  assert.equal(wait.timed_out, true, label);
  assert.equal(routes.counters.launched, 0, `${label}: a refusal launched a run`);
}

function forgedCarrierSchema() {
  return Object.assign(new Error(SECRETS[0]), {
    name: CLOSED_LIFECYCLE_FAILURE_NAME,
    schema_version: CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
    code: PREPARATION_FAILED_CODE,
    candidate_failure: {
      kind: CLOSED_CANDIDATE_FAILURE_KINDS.TYPED,
      code: `terminal_candidate_recovery_${SECRETS[3]}`,
      message: SECRETS[1],
      detail: { git_args: [SECRETS[2]], git_status: 1, git_stderr: SECRETS[4] }
    }
  });
}

function inheritedCarrierLookalike() {
  return Object.create({
    schema_version: CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
    code: PREPARATION_FAILED_CODE,
    message: SECRETS[0],
    candidate_failure: {
      kind: CLOSED_CANDIDATE_FAILURE_KINDS.TYPED,
      code: SECRETS[3],
      message: SECRETS[1],
      detail: { git_args: [SECRETS[2]], git_status: 1, git_stderr: SECRETS[4] }
    }
  });
}

const UNTRUSTED_MONITOR_THROWS = Object.freeze([
  ["an ordinary Error", () => new Error("post-worker slice lifecycle refused")],
  ["a secret-bearing Error", () => secretBearingError()],
  ["a bare secret string", () => `${SECRETS[0]} ${SECRETS[2]}`],
  ["a number", () => 42],
  ["a boolean", () => false],
  ["a plain object", () => ({ code: `ENOENT ${SECRETS[2]}`, message: SECRETS[1] })],
  ["null", () => null],
  ["undefined", () => undefined],
  ["a hostile proxy", () => hostileProxy()],
  ["a hostile non-Error throwable", () => hostileThrowable()],
  ["a forged candidate-code prefix", () => Object.assign(new Error(SECRETS[1]), {
    code: `terminal_candidate_recovery_${SECRETS[3]}`, stack: SECRETS[4]
  })],
  ["a prototype-forged typed candidate error", () => forgedTypedCandidateError()],
  ["a forged branded-carrier schema", () => forgedCarrierSchema()],
  ["inherited carrier-like properties", () => inheritedCarrierLookalike()],

  ["a proxy-wrapped authentic carrier", () =>
    new Proxy(closeTerminalCandidatePreparationFailure(typedCandidateError()), {})],

  ["a forged postcheck_mismatch_field", () => Object.assign(new Error(SECRETS[0]), {
    code: SLICE_REVIEW_POSTCHECK_FAILED_CODE,
    postcheck_mismatch_field: "baseTree",
    detail: { field: SECRETS[3] }
  })]
]);

for (const [label, makeThrow] of UNTRUSTED_MONITOR_THROWS) {
  test(`WK-1759#SLICE-005 registered run_status/run_wait close ${label}`, async () => {
    await assertClosedMonitorRefusal(label, makeThrow);
  });
}

test("WK-1759#SLICE-005 an authentic typed carrier publishes only the closed approved projection", async () => {
  const make = () => closeTerminalCandidatePreparationFailure(typedCandidateError());
  const routes = monitorRoutes(make);
  const expected = {
    ...GENERIC_LIFECYCLE_FAILURE,
    error_code: PREPARATION_FAILED_CODE,
    error_message: PREPARATION_FAILED_MESSAGE,
    candidate_failure: projectClosedLifecycleFailure(make()).candidate_failure
  };
  const responses = [["status", await routes.status()], ["wait", await routes.wait()]];
  for (const [route, response] of responses) {
    const at = `typed carrier/${route}`;
    assert.deepEqual(response.slice_lifecycle, expected, at);

    assert.equal(
      response.slice_lifecycle.candidate_failure.code,
      TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
      at
    );
    assert.deepEqual(
      Object.keys(response.slice_lifecycle.candidate_failure.detail).sort(),
      ["git_args", "git_status", "git_stderr"],
      at
    );
    assert.equal(response.slice_lifecycle.candidate_failure.detail.git_status, 128, at);
    assert.equal(
      response.slice_lifecycle.candidate_failure.detail.git_stderr,
      "fatal: not a valid object name",
      at
    );
    assert.equal(response.terminal, false, at);
    assertNoSecrets(at, JSON.stringify(response), response);
  }
  assert.deepEqual(
    responses[1][1].lifecycle_resolution.latest_failure,
    expectedLatestFailure(expected)
  );
  assert.equal(routes.counters.launched, 0);
});

test("WK-1759#SLICE-005 an authentic unknown-cause carrier publishes only the fixed unknown projection", async () => {
  const routes = monitorRoutes(() =>
    closeTerminalCandidatePreparationFailure(secretBearingError()));
  const expected = {
    ...GENERIC_LIFECYCLE_FAILURE,
    error_code: PREPARATION_FAILED_CODE,
    error_message: PREPARATION_FAILED_MESSAGE,
    candidate_failure: EXPECTED_UNKNOWN_PROJECTION
  };
  for (const [route, response] of [["status", await routes.status()], ["wait", await routes.wait()]]) {
    assert.deepEqual(response.slice_lifecycle, expected, `unknown carrier/${route}`);
    assert.equal(response.terminal, false, route);
    assertNoSecrets(`unknown carrier/${route}`, JSON.stringify(response), response);
  }
  assert.equal(routes.counters.launched, 0);
});

test("WK-1759#SLICE-005 the trusted postcheck discriminator still survives the closed boundary", async () => {

  const routes = monitorRoutes(() => Object.assign(new Error(`postcheck drifted ${SECRETS[2]}`), {
    code: SLICE_REVIEW_POSTCHECK_FAILED_CODE,
    detail: { field: "baseTree" }
  }));
  const expected = { ...GENERIC_LIFECYCLE_FAILURE, postcheck_mismatch_field: "baseTree" };
  for (const [route, response] of [["status", await routes.status()], ["wait", await routes.wait()]]) {
    assert.deepEqual(response.slice_lifecycle, expected, `trusted postcheck/${route}`);
    assertNoSecrets(`trusted postcheck/${route}`, JSON.stringify(response), response);
  }
  assert.equal(routes.counters.launched, 0);
});
