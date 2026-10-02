

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import {
  HISTORICAL_DELIVERY_INDEX_RECOVERY,
  isSliceReviewMaterializationError,
  prepareSliceReviewSurface,
  projectAuthenticatedSliceReviewMaterializationFailure,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_MATERIALIZATION_ERROR_NAME,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
  SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES,
  SliceReviewMaterializationError
} from "../../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  CommittedSliceReviewAdmissionError,
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES
} from "../../packages/agent-launch-cli/src/lib/committed-slice-review-admission.mjs";
import {
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  readStructuredResult
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import {
  compareOidVocabulary, mintedRefusalLiterals, OID_SUFFIX, oidFamily
} from "../slice-review-materialization-source-witness.mjs";
const MONITOR_HANDLE = "wkmh_1008be45e16c97ffdeb7da08";
const SUBJECT = "WK-1790#SLICE-006";
const RUN_ID = "wkdb_dac88423ed75f8f6";
const MESSAGE_PREFIX = "agent-launch slice-review materialization: ";

const GENERIC_LIFECYCLE_FAILURE = Object.freeze({
  invoked: true, phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION, integrated: false,
  error_code: "agent_launch.slice_lifecycle.failed.v1",
  error_message: "post-worker slice lifecycle invocation failed",
  error_message_truncated: false
});

const SECRETS = Object.freeze([
  "/home/launcher/worktrees/slice/IN-0032/WK-1790/SLICE-006/secret-file.txt",
  "AGENT_LAUNCH_FORGE_TOKEN=wk1793-environment-canary",
  "fatal: refusing to merge unrelated histories wk1793-stderr-canary",
  "sk-live-wk1793-materialization-canary",
  "at hostileFrame (/opt/private/launcher/spawn-secret.mjs:42:7)"
]);
const TERMINAL_CHILD = Object.freeze({
  accepted: true, timed_out: false, run_id: RUN_ID, monitor_handle: MONITOR_HANDLE,
  role: "worker", subject: SUBJECT, status: "succeeded", terminal: true,
  started_at: "2026-07-28T00:00:00.000Z", updated_at: "2026-07-28T00:01:00.000Z"
});

function assertNoSecrets(label, ...rendered) {
  for (const secret of SECRETS) {
    for (const text of rendered) {
      assert.equal(text.includes(secret), false, `${label} disclosed ${JSON.stringify(secret)}`);
    }
  }
}

const authentic = (code, reason, detail = null) =>
  new SliceReviewMaterializationError(`${MESSAGE_PREFIX}${reason}`,
    { code, detail, cause: new Error(SECRETS[3]) });
const CODES = SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES;
const PREDICATES = SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES;

const REASON = Object.freeze(Object.fromEntries([
  [CODES.INVALID_ARGUMENT,
    "preparation requires the canonical main repo and exact base launcher tuple"],
  [CODES.BINDING_MISMATCH, "could not resolve and verify the exact launcher-bound slice identity"],
  [CODES.WORKTREE_MISMATCH, "retained slice worktree has in-progress Git operation state"],
  [CODES.OBJECT_MISMATCH,
    "reviewed slice commit does not have the exact launcher-bound base parent"],
  [CODES.INDEX_LOCKED, "ordinary linked-worktree index is locked; refusing without deleting the lock"],
  [CODES.INDEX_STATE_REFUSED,
    "no authenticated historical launcher delivery within the fixed traversal bound"],
  [CODES.PHYSICAL_TREE_REFUSED,
    "physical checkout does not exactly materialize the reviewed commit tree"],
  [CODES.PREPARE_FAILED, "git read-tree could not align the ordinary index with the reviewed commit"],
  [CODES.POSTCHECK_FAILED,
    "trusted slice/worktree/ref state changed during review-surface preparation"]
].filter(([code, reason]) => typeof code === "string" && PREDICATES.includes(reason))));
const EMPTY_DETAIL = Object.freeze({
  predicate: null, field: null, pseudoref: null, config_key: null,
  config_scope: null, suffix_depth: null, traversal_bound: null, git_exit_status: null
});
const expectedProjection = (code, reason, detail = {}) => ({
  schema_version: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
  kind: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
  code, message: SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
  detail: { ...EMPTY_DETAIL, predicate: reason, ...detail }
});

function monitorRoutes(makeValue, { child = TERMINAL_CHILD, lifecycle = null } = {}) {
  const counters = { lifecycle: 0, launched: 0 };
  const tools = createDispatchToolRegistry({
    backend: {
      startLaunch: async () => { counters.launched += 1; return { accepted: false }; },
      getRunStatus: async () => child, waitForRunStatus: async () => child,
      runPostWorkerSliceLifecycle: async (args) => {
        counters.lifecycle += 1;

        checkpoint = args.status[POST_WORKER_LIFECYCLE_CHECKPOINT];
        if (typeof lifecycle === "function") return await lifecycle(args);
        throw makeValue();
      }
    }
  });
  let checkpoint = null;

  const call = async (_tool, extra) => readStructuredResult(
    await tools.get("workspace_agent_run_status").handler({ subject: child.subject,
      include_final_result: true, ...extra }));
  return {
    counters,
    status: () => call("workspace_agent_run_status", {}),

    wait: () => call("workspace_agent_run_status", { timeout_ms: 1 }),
    recordedFailure: () => checkpoint?.retained_failure ?? null
  };
}
const bothRoutes = async (r) => [["status", await r.status()], ["wait", await r.wait()]];
const LATEST_GENERIC_FAILURE = Object.freeze({
  phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
  error_code: GENERIC_LIFECYCLE_FAILURE.error_code,
  error_message: GENERIC_LIFECYCLE_FAILURE.error_message, error_message_truncated: false
});

const RETIRED_FAILURE_KEYS = Object.freeze([
  "materialization_failure", "postcheck_mismatch_field", "source_refusal"
]);

function withoutEvidence(response) {
  const copy = JSON.parse(JSON.stringify(response));
  const strip = (entry) => {
    if (entry && typeof entry === "object") {
      delete entry.evidence;
      delete entry.evidence_summary;
    }
  };
  strip(copy.slice_lifecycle);
  strip(copy.lifecycle_resolution?.latest_failure);
  for (const entry of copy.lifecycle_resolution?.retained_failures ?? []) strip(entry);
  return copy;
}
const classificationJson = (response) => JSON.stringify(withoutEvidence(response).slice_lifecycle);

function assertGenericLifecycleFailure(label, response) {
  const classified = withoutEvidence(response);
  assert.deepEqual(classified.slice_lifecycle, { ...GENERIC_LIFECYCLE_FAILURE }, label);
  const evidence = response.slice_lifecycle.evidence;
  assert.equal(evidence.operation, "post_worker_slice_lifecycle_invocation", label);

  assert.ok(evidence.thrown === null || Array.isArray(evidence.thrown.cause_chain), label);
  assert.equal(Object.hasOwn(evidence.thrown ?? {}, "capture_failures"), false, label);
  if (evidence.retained_evidence !== undefined) {
    assert.equal(evidence.retained_evidence.owner, "post_worker_lifecycle_failure_record", label);
  }
  assert.equal(JSON.stringify(evidence).includes("\"stack\""), false, label);
  assert.deepEqual(response.lifecycle_resolution.latest_failure.evidence_summary,
    response.slice_lifecycle.evidence_summary, label);
  for (const key of RETIRED_FAILURE_KEYS) {
    assert.equal(Object.hasOwn(response.slice_lifecycle, key), false, `${label}: ${key}`);
  }
  assert.equal(response.terminal, false, label);
  assert.equal(response.child_terminal, true, label);
  assert.equal(response.next_action,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.ESCALATE_MISSING_RETRY_CAPABILITY, label);
  assert.deepEqual(classified.lifecycle_resolution.latest_failure, { ...LATEST_GENERIC_FAILURE }, label);
}

function productionLifecycleRoutes(makeThrow) {
  const harness = createResumableLifecycleHarness();
  const adapterCalls = [];
  harness.deps.hostSliceIntegrationAdapter = async (request) => {
    adapterCalls.push(request);
    throw makeThrow();
  };
  const routes = monitorRoutes(() => null, { child: harness.status, lifecycle: harness.invoke });
  return { harness, routes, adapterCalls };
}

function productionAssertions(label, response) {
  const {
    phase, integrated, error_code: code, error_message: message, failure_cause: cause
  } = response.slice_lifecycle;
  assert.deepEqual({ phase, integrated, code, message, cause }, {
    phase: GENERIC_LIFECYCLE_FAILURE.phase,
    integrated: false,
    code: "agent_launch.slice_lifecycle.committed_slice_integration_failed.v1",
    message: "post-worker committed slice integration failed",
    cause: {
      kind: "unexpected_exception", reason: null,
      diagnostic_code: null, diagnostic_kind: null, public_blocker_code: null
    }
  }, label);
  for (const key of RETIRED_FAILURE_KEYS) {
    assert.equal(Object.hasOwn(response.slice_lifecycle, key), false, `${label}: ${key}`);
  }
  assert.equal(response.terminal, false, label);
  assert.equal(response.next_action,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.ESCALATE_MISSING_RETRY_CAPABILITY, label);
}

test("WK-2510 production lifecycle refusals publish no review-derived diagnostic", async () => {
  const refusals = [
    ["materialization refusal", () => authentic(CODES.INDEX_STATE_REFUSED,
      REASON[CODES.INDEX_STATE_REFUSED], {
        bound: HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits,
        path: SECRETS[0],
        authority_limb: "exact_returned_policy"
      })],
    ["postcheck refusal", () => authentic(CODES.POSTCHECK_FAILED,
      REASON[CODES.POSTCHECK_FAILED], { field: "objectAlternates" })],
    ["committed admission refusal", () => new CommittedSliceReviewAdmissionError(
      "exact_slice_worktree_not_frozen", {
        code: COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED,
        detail: { reason: "exact_slice_worktree_not_frozen", path: SECRETS[0], stderr: SECRETS[2] }
      })]
  ];
  for (const [label, makeThrow] of refusals) {
    const { harness, routes, adapterCalls } = productionLifecycleRoutes(makeThrow);
    const responses = await Promise.all([routes.status(), routes.wait()]);
    for (const [route, response] of [["status", responses[0]], ["wait", responses[1]]]) {
      productionAssertions(`${label}/${route}`, response);
      const classified = withoutEvidence(response);
      assertNoSecrets(`${label}/${route}`, JSON.stringify(classified), inspect(classified, { depth: null }));
    }
    assert.equal(routes.counters.lifecycle, 1, `${label}: concurrent observers share one attempt`);

    assert.deepEqual(adapterCalls.map((request) => request.assigned_unit),
      [harness.status.subject], label);
    assert.equal(harness.counts().reviewSeamCalls, 0, label);
  }
});

test("WK-2510 every authenticated materialization refusal publishes only the generic envelope", async () => {
  for (const [code, reason] of Object.entries(REASON)) {
    const routes = monitorRoutes(() => authentic(code, reason));
    const published = (await bothRoutes(routes)).map(([route, response]) => {
      const at = `${code}/${route}`;
      assertGenericLifecycleFailure(at, response);
      assertNoSecrets(at, JSON.stringify(withoutEvidence(response)));
      return classificationJson(response);
    });
    assert.equal(published[0], published[1], "both routes publish the identical envelope");

    const recorded = routes.recordedFailure().evidence;
    assert.equal(recorded.operation, "post_worker_slice_lifecycle_invocation", code);
    assert.deepEqual(recorded.thrown.capture_failures, [], code);
    assert.equal(recorded.thrown.value.properties.code, code);
    assert.equal(routes.counters.launched, 0, "a failure must never launch a run");
  }
});

test("WK-1793 every diagnostic code is covered and every reason is a closed predicate", () => {
  assert.deepEqual(Object.keys(REASON).sort(), Object.values(CODES).sort());
  for (const reason of Object.values(REASON)) {
    assert.ok(SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES.includes(reason), reason);
  }
});
const MAX_DEPTH = HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits;

const BOUNDED_DETAIL_CASES = Object.freeze([
  ["postcheck bound field", CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED],
    { field: "baseTree" }, { field: "baseTree" }],
  ["sequencer pseudoref", CODES.WORKTREE_MISMATCH, REASON[CODES.WORKTREE_MISMATCH],
    { pseudoref: "MERGE_HEAD" }, { pseudoref: "MERGE_HEAD" }],
  ["historical suffix depth", CODES.INDEX_STATE_REFUSED, "historical delivery suffix is cyclic",
    { object: "a".repeat(40), depth: 3 }, { suffix_depth: 3 }],
  ["historical traversal bound", CODES.INDEX_STATE_REFUSED, REASON[CODES.INDEX_STATE_REFUSED],
    { bound: MAX_DEPTH }, { traversal_bound: MAX_DEPTH }],
  ["git invocation", CODES.PREPARE_FAILED, REASON[CODES.PREPARE_FAILED],
    { args: ["read-tree", SECRETS[0]], status: 128, stderr: SECRETS[2] }, { git_exit_status: 128 }],
  ["porcelain status", CODES.POSTCHECK_FAILED,
    "retained slice review worktree is not clean after preparation",
    { status: `?? ${SECRETS[0]}\n` }, {}],
  ["untracked path", CODES.PHYSICAL_TREE_REFUSED,
    "retained slice worktree contains unexpected untracked content", { path: SECRETS[0] }, {}],
  ["object mismatch oids", CODES.OBJECT_MISMATCH, "required slice object has the wrong Git type",
    { object: "b".repeat(40), expected: "commit", actual: "tree" }, {}],
  ["out-of-vocabulary field", CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED],
    { field: SECRETS[3] }, {}],
  ["out-of-range depth", CODES.INDEX_STATE_REFUSED, "historical delivery suffix is cyclic",
    { depth: MAX_DEPTH + 1 }, {}],
  ["unrecognized predicate", CODES.PREPARE_FAILED, `drifted reason ${SECRETS[3]}`,
    { status: 1 }, { predicate: null, git_exit_status: 1 }]
].filter(([, code]) => Object.values(CODES).includes(code)));

for (const [label, code, reason, detail, expected] of BOUNDED_DETAIL_CASES) {
  test(`WK-1793 bounded primitive detail: ${label}`, async () => {
    const predicate = SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES.includes(reason) ? reason : null;
    const projected = projectAuthenticatedSliceReviewMaterializationFailure(
      authentic(code, reason, detail));
    assert.deepEqual(projected, expectedProjection(code, predicate, expected), label);
    assert.deepEqual(Object.keys(projected), [...SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS], label);
    assert.deepEqual(Object.keys(projected.detail),
      [...SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS], label);
    assertNoSecrets(label, JSON.stringify(projected), inspect(projected, { depth: null }));

    for (const [route, response] of await bothRoutes(monitorRoutes(() => authentic(code, reason, detail)))) {
      assertGenericLifecycleFailure(`${label}/${route}`, response);
      assertNoSecrets(`${label}/${route}`, JSON.stringify(withoutEvidence(response)));
    }
  });
}

function hostileProxy() {
  const raise = () => { throw new Error(`proxy trap fired: ${SECRETS[3]}`); };
  return new Proxy({},
    { get: raise, has: raise, getPrototypeOf: raise, ownKeys: raise, getOwnPropertyDescriptor: raise });
}

function malformedDetail(detail) {
  const error = authentic(CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED]);
  error.detail = detail;
  return error;
}
const POSTCHECK_MESSAGE = `${MESSAGE_PREFIX}${REASON[CODES.POSTCHECK_FAILED]}`;
const GENERIC_THROWS = Object.freeze([

  ["forged name only", () => Object.assign(new Error(POSTCHECK_MESSAGE),
    { name: SLICE_REVIEW_MATERIALIZATION_ERROR_NAME })],
  ["forged code only", () => Object.assign(new Error(SECRETS[3]), { code: CODES.INDEX_STATE_REFUSED })],

  ["forged complete lookalike", () => Object.assign(
    new Error(`${MESSAGE_PREFIX}${REASON[CODES.INDEX_STATE_REFUSED]}`), {
      name: SLICE_REVIEW_MATERIALIZATION_ERROR_NAME, code: CODES.INDEX_STATE_REFUSED,
      detail: { field: "baseTree", depth: 1, status: 128 }
    })],

  ["prototype-forged instance", () => Object.setPrototypeOf({
    name: SLICE_REVIEW_MATERIALIZATION_ERROR_NAME,
    message: `${MESSAGE_PREFIX}${REASON[CODES.PREPARE_FAILED]}`,
    code: CODES.PREPARE_FAILED, detail: { field: "baseSha" }
  }, SliceReviewMaterializationError.prototype)],
  ["plain object lookalike", () => ({
    name: SLICE_REVIEW_MATERIALIZATION_ERROR_NAME, message: POSTCHECK_MESSAGE,
    code: CODES.POSTCHECK_FAILED, detail: { field: "reviewedTree" },
    materialization_failure: { code: SECRETS[3], detail: { predicate: SECRETS[0] } }
  })],

  ["proxy-wrapped authentic refusal", () =>
    new Proxy(authentic(CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED]), {})],

  ["authentic instance with an out-of-taxonomy code", () =>
    authentic(`agent_launch.slice_review_materialization.${SECRETS[3]}.v1`,
      REASON[CODES.POSTCHECK_FAILED])],
  ["authentic instance without the refusal prefix", () =>
    new SliceReviewMaterializationError(SECRETS[3], { code: CODES.POSTCHECK_FAILED })],
  ["malformed detail: array", () => malformedDetail([{ field: "baseTree" }])],
  ["malformed detail: null-prototype bag", () =>
    malformedDetail(Object.assign(Object.create(null), { field: "baseTree" }))],
  ["malformed detail: string", () => malformedDetail(SECRETS[0])],
  ["malformed detail: class instance", () => malformedDetail(new Error(SECRETS[2]))],
  ["an ordinary Error", () => new Error(`post-worker refused ${SECRETS[2]}`)],
  ["a secret-bearing Error", () => Object.assign(new Error(SECRETS[0]), {
    code: `ENOENT ${SECRETS[0]}`, stack: SECRETS[4], cause: new Error(SECRETS[3]),
    detail: { predicate: SECRETS[0], git_exit_status: 1 }
  })],
  ["a bare string", () => `${SECRETS[3]} ${SECRETS[0]}`], ["a number", () => 42],
  ["null", () => null], ["undefined", () => undefined],
  ["a hostile proxy", () => hostileProxy()],
  ["a hostile non-Error throwable", () => ({
    get code() { throw new Error(SECRETS[3]); }, get message() { throw new Error(SECRETS[0]); },
    get detail() { throw new Error(SECRETS[2]); }
  })]
]);

for (const [label, makeThrow] of GENERIC_THROWS) {
  test(`WK-1793 ${label} stays byte-stable generic`, async () => {
    const routes = monitorRoutes(makeThrow);
    const first = await routes.status();
    const replay = await routes.status();
    const wait = await routes.wait();
    for (const [route, response] of [["status", first], ["replay", replay], ["wait", wait]]) {
      const at = `${label}/${route}`;
      assertGenericLifecycleFailure(at, response);
      assertNoSecrets(at, JSON.stringify(withoutEvidence(response)));
    }

    assert.equal(classificationJson(first), classificationJson(replay), label);
    assert.equal(classificationJson(first), classificationJson(wait), label);
    assert.equal(routes.counters.launched, 0, label);
  });
}

test("WK-1793 the primitive itself refuses every non-authentic value", () => {
  for (const [label, makeThrow] of GENERIC_THROWS) {
    const value = makeThrow();
    assert.equal(isSliceReviewMaterializationError(value) &&
      projectAuthenticatedSliceReviewMaterializationFailure(value) !== null, false,
    `${label} authenticated at the primitive`);
  }
  for (const value of [null, undefined, "", 0, false, Symbol("x"), 10n, () => {}, []]) {
    assert.equal(projectAuthenticatedSliceReviewMaterializationFailure(value), null);
  }
});

test("WK-1793 a real prepareSliceReviewSurface refusal authenticates and drops its cause", async () => {

  const invalid = await prepareSliceReviewSurface({}).then(() => null, (error) => error);
  assert.equal(isSliceReviewMaterializationError(invalid), true);
  assert.deepEqual(projectAuthenticatedSliceReviewMaterializationFailure(invalid),
    expectedProjection(CODES.INVALID_ARGUMENT, REASON[CODES.INVALID_ARGUMENT]));

  const bindingFailure = await prepareSliceReviewSurface({
    mainRepo: "/nonexistent-wk1793", assignedUnit: SUBJECT,
    launchRef: MONITOR_HANDLE, runId: RUN_ID, retryId: 0,
    deps: {
      resolveWorktreeBinding: () => { throw new Error(SECRETS[0]); },
      digestWorktreeIdentity: () => `sha256:${"a".repeat(64)}`,
      runGit: () => ({ ok: false, status: 128, stderr: SECRETS[2] })
    }
  }).then(() => null, (error) => error);
  assert.equal(isSliceReviewMaterializationError(bindingFailure), true);
  assert.equal(bindingFailure.cause instanceof Error, true, "the raw cause is retained internally");
  const projected = projectAuthenticatedSliceReviewMaterializationFailure(bindingFailure);
  assert.deepEqual(projected,
    expectedProjection(CODES.BINDING_MISMATCH, REASON[CODES.BINDING_MISMATCH]));
  assertNoSecrets("real binding refusal", JSON.stringify(projected),
    inspect(projected, { depth: null }));

  const response = await monitorRoutes(() => bindingFailure).status();
  assertGenericLifecycleFailure("real binding refusal/status", response);
  assertNoSecrets("real binding refusal/status", JSON.stringify(withoutEvidence(response)));

  const bindingRoutes = monitorRoutes(() => bindingFailure);
  const published = (await bindingRoutes.status()).slice_lifecycle.evidence.thrown.cause_chain;
  assert.deepEqual(published.map(({ name, message }) => [name, message]).slice(0, 2), [
    ["SliceReviewMaterializationError", bindingFailure.message],
    ["Error", SECRETS[0]]
  ]);
  const thrown = bindingRoutes.recordedFailure().evidence.thrown.value;
  assert.equal(thrown.name, "SliceReviewMaterializationError");
  assert.equal(thrown.cause.message, SECRETS[0]);
  assert.equal(typeof thrown.stack, "string");
});

test("WK-1793 concurrent observers share one attempt and one retained generic failure", async () => {
  const reason = REASON[CODES.INDEX_STATE_REFUSED];
  const routes = monitorRoutes(() => authentic(CODES.INDEX_STATE_REFUSED, reason, { bound: MAX_DEPTH }));
  const observers = await Promise.all([routes.status(), routes.status(), routes.status()]);
  assert.equal(routes.counters.lifecycle, 1, "concurrent observers drove one attempt");
  for (const [index, response] of observers.entries()) {
    assertGenericLifecycleFailure(`observer ${index}`, response);
    assert.equal(response.lifecycle_resolution.failure_attempts, 1);
    assert.equal(response.lifecycle_resolution.retained_failures.length, 1);
  }

  assert.equal(new Set(observers.map((r) => JSON.stringify(r.slice_lifecycle))).size, 1);
});

test("WK-1793 repeated polling stays nonterminal and returns the one retained failure", async () => {
  const routes = monitorRoutes(() =>
    authentic(CODES.PREPARE_FAILED, REASON[CODES.PREPARE_FAILED], { status: 1 }));
  for (let poll = 1; poll <= 5; poll += 1) {
    const response = await routes.status();
    assertGenericLifecycleFailure(`poll ${poll}`, response);

    assert.equal(response.lifecycle_resolution.failure_attempts, 1);
    assert.equal(response.lifecycle_resolution.retained_failures.length, 1);

    for (const entry of response.lifecycle_resolution.retained_failures) {
      assert.deepEqual(Object.keys(entry).sort(),
        ["error_code", "error_message", "error_message_truncated", "evidence_summary", "phase"]);
    }
  }
  assert.equal(routes.counters.lifecycle, 1, "one attempt; later polls withhold");
  assert.equal(routes.counters.launched, 0);
});
const MATERIALIZATION_PATH = fileURLToPath(new URL(
  "../../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs", import.meta.url));

test("WK-1793 the predicate allowlist matches the module's own refusal literals", () => {
  const source = readFileSync(MATERIALIZATION_PATH, "utf8");
  const minted = mintedRefusalLiterals(source);
  const allowed = new Set(PREDICATES);
  assert.deepEqual([...minted].filter((reason) => !allowed.has(reason)), [],
    "a minted refusal reason is missing from the closed predicate allowlist");
  assert.deepEqual([...allowed].filter((reason) =>
    !reason.endsWith(OID_SUFFIX) && !minted.has(reason)), [],
    "a closed predicate has no executable refusal producer");

  assert.equal(compareOidVocabulary(source, PREDICATES), null);
  assert.equal(oidFamily(PREDICATES).length, 12);
});

test("WK-1793 the OID drift witness catches a new and a renamed executable call site", () => {
  const source = readFileSync(MATERIALIZATION_PATH, "utf8");
  assert.equal(compareOidVocabulary(source, PREDICATES), null, "the unmodified source must pass");

  const added = source.replace("function parseWorktreeRegistrations(raw) {",
    'function wk1793DriftProbe(value) { return assertOid(value, "unallowlisted probe label"); }\n\n' +
    "function parseWorktreeRegistrations(raw) {");
  assert.notEqual(added, source, "the added-call-site mutation must apply");
  assert.match(compareOidVocabulary(added, PREDICATES) ?? "",
    /unallowlisted executable assertOid label: unallowlisted probe label/u);

  const renamed = source.replace('"post-preparation HEAD tree"', '"post-preparation HEAD tree v2"');
  assert.notEqual(renamed, source, "the rename mutation must apply");
  assert.match(compareOidVocabulary(renamed, PREDICATES) ?? "",
    /unallowlisted executable assertOid label: post-preparation HEAD tree v2/u);
});

test("WK-1793 the refusal witness fails closed when its extraction anchors disappear", () => {
  const source = readFileSync(MATERIALIZATION_PATH, "utf8");
  const removed = source.replaceAll("refuseIndexState(", "refuseIndexStateRemoved(");
  assert.throws(() => mintedRefusalLiterals(removed), /no refuseIndexState extraction anchor/u);

  const unparsed = source.replace(
    'refuseIndexState("the launcher-owned WK fork ref is symbolic", { ref });',
    'refuseIndexState(String("the launcher-owned WK fork ref is symbolic"), { ref });'
  );
  assert.notEqual(unparsed, source, "the unparsed refusal mutation must apply");
  assert.throws(() => mintedRefusalLiterals(unparsed),
    /not a fixed literal expression/u);
});
