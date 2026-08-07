

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";

import { z } from "zod";

import {
  FULL_INDEX_CONFIG_KEYS,
  FULL_INDEX_CONFIG_SCOPES,
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
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET,
  SliceReviewMaterializationError
} from "../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  LIFECYCLE_FAILURE_HISTORY_LIMIT,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  POST_WORKER_LIFECYCLE_PHASES
} from "../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import { registerRunMonitorRoutes } from
  "../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";
import {
  createDispatchToolRegistry, parseStructuredTextResponse
} from "../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import { jsonContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  compareOidVocabulary, functionSource, lexModule, mintedRefusalLiterals, oidFamily
} from "./slice-review-materialization-source-witness.mjs";
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

const REASON = Object.freeze({
  [CODES.INVALID_ARGUMENT]:
    "preparation requires the canonical main repo and exact base launcher tuple",
  [CODES.BINDING_MISMATCH]: "could not resolve and verify the exact launcher-bound slice identity",
  [CODES.WORKTREE_MISMATCH]: "retained slice worktree has in-progress Git operation state",
  [CODES.OBJECT_MISMATCH]:
    "reviewed slice commit does not have the exact launcher-bound base parent",
  [CODES.INDEX_LOCKED]: "ordinary linked-worktree index is locked; refusing without deleting the lock",
  [CODES.INDEX_STATE_REFUSED]:
    "no authenticated historical launcher delivery within the fixed traversal bound",
  [CODES.PHYSICAL_TREE_REFUSED]:
    "physical checkout does not exactly materialize the reviewed commit tree",
  [CODES.SPARSE_OR_HIDDEN_INDEX]: "retained slice worktree has sparse checkout enabled",
  [CODES.PREPARE_FAILED]: "git read-tree could not align the ordinary index with the reviewed commit",
  [CODES.POSTCHECK_FAILED]:
    "trusted slice/worktree/ref state changed during review-surface preparation"
});
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

function monitorRoutes(makeValue, resolved = false) {
  const counters = { lifecycle: 0, launched: 0 };
  const tools = createDispatchToolRegistry({
    backend: {
      startLaunch: async () => { counters.launched += 1; return { accepted: false }; },
      getRunStatus: async () => TERMINAL_CHILD, waitForRunStatus: async () => TERMINAL_CHILD,
      runPostWorkerSliceLifecycle: async () => {
        counters.lifecycle += 1;
        const value = makeValue();
        if (resolved) return value;
        throw value;
      }
    }
  });
  const call = async (tool, extra) => parseStructuredTextResponse(
    await tools.get(tool).handler({ monitor_handle: MONITOR_HANDLE, subject: SUBJECT, ...extra }));
  return {
    counters,
    status: () => call("workspace_agent_run_status", {}),

    wait: () => call("workspace_agent_run_wait", { timeout_ms: 1, poll_interval_ms: 500 })
  };
}
const bothRoutes = async (r) => [["status", await r.status()], ["wait", await r.wait()]];
const LATEST_GENERIC_FAILURE = Object.freeze({
  phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
  error_code: GENERIC_LIFECYCLE_FAILURE.error_code,
  error_message: GENERIC_LIFECYCLE_FAILURE.error_message, error_message_truncated: false
});

function assertOuterContractUnchanged(label, response) {
  const { materialization_failure: _p, postcheck_mismatch_field: _f, ...core } =
    response.slice_lifecycle;
  assert.deepEqual(core, { ...GENERIC_LIFECYCLE_FAILURE }, label);
  assert.equal(response.terminal, false, label);
  assert.equal(response.child_terminal, true, label);
  assert.equal(response.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY, label);
  assert.deepEqual(response.lifecycle_resolution.latest_failure, { ...LATEST_GENERIC_FAILURE }, label);
}

for (const [code, reason] of Object.entries(REASON)) {
  test(`WK-1793 registered run_status/run_wait project the authenticated refusal ${code}`, async () => {
    const routes = monitorRoutes(() => authentic(code, reason));
    const published = (await bothRoutes(routes)).map(([route, response]) => {
      const at = `${code}/${route}`;
      assertOuterContractUnchanged(at, response);
      const projection = response.slice_lifecycle.materialization_failure;
      assert.deepEqual(projection, expectedProjection(code, reason), at);
      assert.deepEqual(Object.keys(projection), [...SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS], at);
      assert.deepEqual(Object.keys(projection.detail),
        [...SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS], at);
      assertNoSecrets(at, JSON.stringify(response));
      return JSON.stringify(projection);
    });
    assert.equal(published[0], published[1], "both routes publish the identical projection");
    assert.equal(routes.counters.launched, 0, "a diagnostic must never launch a run");
  });
}

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
  ["full-index config", CODES.SPARSE_OR_HIDDEN_INDEX, REASON[CODES.SPARSE_OR_HIDDEN_INDEX],
    { key: "index.sparse", scope: "--worktree" },
    { config_key: "index.sparse", config_scope: "--worktree" }],
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
  ["index entry", CODES.SPARSE_OR_HIDDEN_INDEX, "ordinary index contains a sparse-directory entry",
    { entry: `040000 ${SECRETS[0]}` }, {}],
  ["object mismatch oids", CODES.OBJECT_MISMATCH, "required slice object has the wrong Git type",
    { object: "b".repeat(40), expected: "commit", actual: "tree" }, {}],
  ["out-of-vocabulary field", CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED],
    { field: SECRETS[3] }, {}],
  ["out-of-range depth", CODES.INDEX_STATE_REFUSED, "historical delivery suffix is cyclic",
    { depth: MAX_DEPTH + 1 }, {}],
  ["unrecognized predicate", CODES.PREPARE_FAILED, `drifted reason ${SECRETS[3]}`,
    { status: 1 }, { predicate: null, git_exit_status: 1 }]
]);

for (const [label, code, reason, detail, expected] of BOUNDED_DETAIL_CASES) {
  test(`WK-1793 bounded detail: ${label}`, async () => {
    const routes = monitorRoutes(() => authentic(code, reason, detail));
    const predicate = SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES.includes(reason) ? reason : null;
    for (const [route, response] of await bothRoutes(routes)) {
      const at = `${label}/${route}`;
      assertOuterContractUnchanged(at, response);
      assert.deepEqual(response.slice_lifecycle.materialization_failure,
        expectedProjection(code, predicate, expected), at);
      assertNoSecrets(at, JSON.stringify(response));
    }
  });
}

test("WK-1793 the existing postcheck discriminator and the new projection coexist", async () => {
  const routes = monitorRoutes(() =>
    authentic(CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED], { field: "objectAlternates" }));
  const { slice_lifecycle: lifecycle } = await routes.status();

  assert.equal(lifecycle.postcheck_mismatch_field, "objectAlternates");
  assert.equal(lifecycle.materialization_failure.detail.field, "objectAlternates");
  assert.equal(lifecycle.materialization_failure.detail.predicate, REASON[CODES.POSTCHECK_FAILED]);
  assert.equal(SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields.includes("objectAlternates"), true);
});

const REGATE = expectedProjection(CODES.POSTCHECK_FAILED, REASON[CODES.POSTCHECK_FAILED],
  { field: "baseTree", git_exit_status: 128 });
const resolvedLifecycle = (projection) => Object.freeze({
  ...GENERIC_LIFECYCLE_FAILURE,
  ...(projection === null ? {} : { materialization_failure: projection })
});
const REGATE_CASES = Object.freeze([

  ["widened", { ...REGATE, stack: SECRETS[4], cause_message: SECRETS[3],
    detail: { ...REGATE.detail, leaked_path: SECRETS[0], stderr: SECRETS[2] } }, REGATE],
  ["narrow", REGATE, REGATE],

  ["malformed kind", { ...REGATE, kind: SECRETS[3] }, null],
  ["malformed code", { ...REGATE, code: SECRETS[3] }, null],
  ["malformed schema_version", { ...REGATE, schema_version: SECRETS[3] }, null],
  ["malformed detail", { ...REGATE, detail: SECRETS[0] }, null]
]);

for (const [label, injected, expected] of REGATE_CASES) {
  test(`WK-1793 publication re-gate reconstructs: ${label}`, async () => {
    const observed = await bothRoutes(monitorRoutes(() => resolvedLifecycle(injected), true));

    const baseline = await bothRoutes(monitorRoutes(() => resolvedLifecycle(null), true));
    for (const [index, [route, response]] of observed.entries()) {
      const at = `${label}/${route}`;
      const base = baseline[index][1];
      const { materialization_failure: published, ...core } = response.slice_lifecycle;
      const { materialization_failure: _absent, ...baseCore } = base.slice_lifecycle;

      assert.deepEqual(core, baseCore, at);
      assert.equal(core.error_code, GENERIC_LIFECYCLE_FAILURE.error_code, at);
      assert.equal(core.error_message, GENERIC_LIFECYCLE_FAILURE.error_message, at);
      assert.equal(core.error_message_truncated, false, at);
      assert.equal(response.terminal, base.terminal, at);
      assert.equal(response.child_terminal, base.child_terminal, at);
      assert.deepEqual(response.next_action ?? null, base.next_action ?? null, at);
      assert.deepEqual(response.lifecycle_resolution ?? null, base.lifecycle_resolution ?? null, at);
      if (expected === null) {
        assert.equal(Object.hasOwn(response.slice_lifecycle, "materialization_failure"), false,
          `${at}: a malformed projection was published`);
      } else {
        assert.deepEqual(published, expected, at);
        assert.deepEqual(Object.keys(published), [...SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS], at);
        assert.deepEqual(Object.keys(published.detail),
          [...SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS], at);

        assert.equal(published.detail.field, "baseTree", at);
        assert.equal(published.detail.git_exit_status, 128, at);
        assert.equal(published.detail.predicate, REASON[CODES.POSTCHECK_FAILED], at);
      }
      assertNoSecrets(at, JSON.stringify(response), inspect(response, { depth: null }));
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
      assertOuterContractUnchanged(at, response);
      assert.equal(Object.hasOwn(response.slice_lifecycle, "materialization_failure"), false,
        `${at}: an unauthenticated failure gained a projection`);
      assertNoSecrets(at, JSON.stringify(response));
    }

    assert.equal(JSON.stringify(first.slice_lifecycle), JSON.stringify(replay.slice_lifecycle), label);
    assert.equal(JSON.stringify(first.slice_lifecycle), JSON.stringify(wait.slice_lifecycle), label);
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
  assertOuterContractUnchanged("real binding refusal/status", response);
  assert.deepEqual(response.slice_lifecycle.materialization_failure, projected);
  assertNoSecrets("real binding refusal/status", JSON.stringify(response));
});

test("WK-1793 concurrent observers share one attempt and one retained projection", async () => {
  const reason = REASON[CODES.INDEX_STATE_REFUSED];
  const routes = monitorRoutes(() => authentic(CODES.INDEX_STATE_REFUSED, reason, { bound: MAX_DEPTH }));
  const observers = await Promise.all([routes.status(), routes.status(), routes.status()]);
  assert.equal(routes.counters.lifecycle, 1, "concurrent observers drove one attempt");
  const expected = expectedProjection(CODES.INDEX_STATE_REFUSED, reason, { traversal_bound: MAX_DEPTH });
  for (const [index, response] of observers.entries()) {
    assertOuterContractUnchanged(`observer ${index}`, response);
    assert.deepEqual(response.slice_lifecycle.materialization_failure, expected);
    assert.equal(response.lifecycle_resolution.failure_attempts, 1);
    assert.equal(response.lifecycle_resolution.retained_failures.length, 1);
  }

  assert.equal(new Set(observers.map((r) =>
    JSON.stringify(r.slice_lifecycle.materialization_failure))).size, 1);
});

test("WK-1793 repeated polling stays nonterminal and keeps the retry action", async () => {
  const routes = monitorRoutes(() =>
    authentic(CODES.PREPARE_FAILED, REASON[CODES.PREPARE_FAILED], { status: 1 }));
  const expected = expectedProjection(CODES.PREPARE_FAILED, REASON[CODES.PREPARE_FAILED],
    { git_exit_status: 1 });
  for (let poll = 1; poll <= 5; poll += 1) {
    const response = await routes.status();
    assertOuterContractUnchanged(`poll ${poll}`, response);
    assert.deepEqual(response.slice_lifecycle.materialization_failure, expected);
    assert.equal(response.lifecycle_resolution.failure_attempts, poll);
    assert.equal(response.lifecycle_resolution.retained_failures.length,
      Math.min(poll, LIFECYCLE_FAILURE_HISTORY_LIMIT));

    for (const entry of response.lifecycle_resolution.retained_failures) {
      assert.deepEqual(Object.keys(entry).sort(),
        ["error_code", "error_message", "error_message_truncated", "phase"]);
    }
  }
  assert.equal(routes.counters.lifecycle, 5, "one attempt per poll, unchanged");
  assert.equal(routes.counters.launched, 0);
});

const ROUTES_PATH = fileURLToPath(new URL(
  "../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs", import.meta.url));

const DISCLOSURE_PATH = fileURLToPath(new URL(
  "../packages/wiki-mcp/src/lib/dispatch-lifecycle-failure-disclosure.mjs", import.meta.url));
const MATERIALIZATION_PATH = fileURLToPath(new URL(
  "../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs", import.meta.url));

function rewriteSpecifiers(source, basePath) {
  const require = createRequire(basePath);
  return source.replace(/(\bfrom\s*)"([^"]+)"/gu, (match, prefix, specifier) =>
    (specifier.startsWith("node:") || specifier.startsWith("file:") ? match
      : `${prefix}"${pathToFileURL(require.resolve(specifier)).href}"`));
}

function loadMutatedRoutes(mutate) {
  const { source, applied } = mutate(readFileSync(DISCLOSURE_PATH, "utf8"));
  assert.equal(applied, 1, "the mutation must apply exactly once");
  const dir = mkdtempSync(path.join(os.tmpdir(), "wk1793-mutant-"));
  const disclosureFile = path.join(dir, "dispatch-lifecycle-failure-disclosure.mutant.mjs");
  writeFileSync(disclosureFile, rewriteSpecifiers(source, DISCLOSURE_PATH));
  const routesSource = readFileSync(ROUTES_PATH, "utf8")
    .replace("./dispatch-lifecycle-failure-disclosure.mjs", pathToFileURL(disclosureFile).href);
  const file = path.join(dir, "dispatch-run-monitor-routes.mutant.mjs");
  writeFileSync(file, rewriteSpecifiers(routesSource, ROUTES_PATH));
  return { url: pathToFileURL(file).href, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const GENERIC_ONLY_CATCH = (source) => {
  const target = "const materializationFailure = publishableMaterializationFailure(error);";
  return {
    source: source.replace(target, "const materializationFailure = null;"),
    applied: source.split(target).length - 1
  };
};
const WORKSPACE = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };

async function driveRegisteredRoutes(registerRoutes, makeThrow) {
  const tools = new Map();
  registerRoutes({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    workspaceRepos: [WORKSPACE], z, jsonContent, resolveWorkspaceRepo: () => WORKSPACE,
    dispatchBackend: {
      getRunStatus: async () => TERMINAL_CHILD, waitForRunStatus: async () => TERMINAL_CHILD,
      runPostWorkerSliceLifecycle: async () => { throw makeThrow(); }
    }, dispatchSessionIdentity: "session-wk1793"
  });
  return parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: MONITOR_HANDLE, subject: SUBJECT
  }));
}

test("WK-1793 a mutant restoring the generic-only catch is killed by the missing projection", async (t) => {
  const mutant = loadMutatedRoutes(GENERIC_ONLY_CATCH);
  t.after(mutant.cleanup);
  const { registerRunMonitorRoutes: registerMutatedRoutes } = await import(mutant.url);
  const makeThrow = () => authentic(CODES.INDEX_STATE_REFUSED, REASON[CODES.INDEX_STATE_REFUSED]);
  const live = await driveRegisteredRoutes(registerRunMonitorRoutes, makeThrow);
  const mutated = await driveRegisteredRoutes(registerMutatedRoutes, makeThrow);

  assert.equal(typeof registerMutatedRoutes, "function");
  assertOuterContractUnchanged("mutant", mutated);
  assert.deepEqual({ ...mutated.slice_lifecycle }, { ...GENERIC_LIFECYCLE_FAILURE },
    "the mutant must still publish the well-formed generic envelope");

  assert.equal(Object.hasOwn(mutated.slice_lifecycle, "materialization_failure"), false,
    "the mutant kept the generic-only catch");
  assert.deepEqual(live.slice_lifecycle.materialization_failure,
    expectedProjection(CODES.INDEX_STATE_REFUSED, REASON[CODES.INDEX_STATE_REFUSED]),
    "the live seam publishes the authenticated projection the mutant drops");
});

const PREDICATES = SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES;

test("WK-1793 the predicate allowlist matches the module's own refusal literals", () => {
  const source = readFileSync(MATERIALIZATION_PATH, "utf8");

  const body = source.slice(0, source.indexOf("THE CLOSED PREDICATE ALLOWLIST"));
  assert.ok(body.length > 0, "the allowlist marker must exist");
  const minted = mintedRefusalLiterals(body);
  assert.ok(minted.size >= 70, `only ${minted.size} refusal literals were extracted`);
  const allowed = new Set(PREDICATES);
  assert.deepEqual([...minted].filter((reason) => !allowed.has(reason)), [],
    "a minted refusal reason is missing from the closed predicate allowlist");

  assert.equal(compareOidVocabulary(source, PREDICATES), null);
  assert.equal(oidFamily(PREDICATES).length, 10);

  assert.deepEqual([...FULL_INDEX_CONFIG_KEYS],
    ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]);
  assert.deepEqual([...FULL_INDEX_CONFIG_SCOPES], ["--local", "--worktree"]);
  const { code, literals } = lexModule(source);
  const shape = functionSource(code, "assertFullIndexShape");
  assert.ok(shape, "assertFullIndexShape must exist");
  assert.match(shape, /for\s*\(\s*const key of FULL_INDEX_CONFIG_KEYS\s*\)/u);
  assert.match(shape, /for\s*\(\s*const scope of FULL_INDEX_CONFIG_SCOPES\s*\)/u);
  for (const token of shape.matchAll(/@(\d+)/gu)) {
    assert.equal(FULL_INDEX_CONFIG_KEYS.includes(literals[Number(token[1])]), false,
      "assertFullIndexShape must not restate a closed config key");
  }
});

test("WK-1793 the public projection admits exactly the exported config vocabulary", () => {
  const project = (detail) => projectAuthenticatedSliceReviewMaterializationFailure(
    authentic(CODES.SPARSE_OR_HIDDEN_INDEX, REASON[CODES.SPARSE_OR_HIDDEN_INDEX], detail)).detail;
  for (const key of FULL_INDEX_CONFIG_KEYS) {
    for (const scope of FULL_INDEX_CONFIG_SCOPES) {
      const detail = project({ key, scope });
      assert.equal(detail.config_key, key);
      assert.equal(detail.config_scope, scope);
    }
  }
  const outside = project({ key: "core.bare", scope: "--system" });
  assert.equal(outside.config_key, null);
  assert.equal(outside.config_scope, null);
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
