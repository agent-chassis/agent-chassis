import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBackendTerminalReview } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-terminal-review.mjs";
import {
  defaultTerminalCandidateRunGit,
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryReason,
  projectTerminalWkCandidateFailure
} from "../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";

const SCHEMA_VERSION = "agent_launch.terminal_candidate_failure_projection.v1";
const TYPED_MESSAGE = "terminal WK candidate: typed construction or recovery failure";
const UNKNOWN_MESSAGE = "terminal WK candidate: unknown construction or recovery failure";
const PROJECTION_KEYS = ["schema_version", "kind", "code", "message", "detail"];
const GIT_OPERATIONS = [
  "rev-parse",
  "rev-list",
  "cat-file",
  "commit-tree",
  "for-each-ref",
  "update-ref",
  "merge-base"
];
const UNKNOWN = Object.freeze({
  schema_version: SCHEMA_VERSION,
  kind: "unknown_cause",
  code: null,
  message: UNKNOWN_MESSAGE,
  detail: null
});
const UNTRUSTED_RUNNER_CODE = "terminal_candidate_recovery_construction_failed";
const UNTRUSTED_RUNNER_MESSAGE = "terminal candidate recovery construction failed";
const REVIEW_ADDRESS = Object.freeze({
  subject: "WK-1783#SLICE-004",
  record_id: "WK-1783",
  slice_id: "SLICE-004",
  initiative: "IN-0030"
});
const BACKEND_SOURCE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-terminal-review.mjs",
  import.meta.url
);
const RUNTIME_SOURCE_URL = new URL(
  "../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs",
  import.meta.url
);

function typedProjection(code, detail = null) {
  return {
    schema_version: SCHEMA_VERSION,
    kind: "typed_candidate_error",
    code,
    message: TYPED_MESSAGE,
    detail
  };
}

function carrier(projection, secret = "") {
  const error = new Error(`raw exception ${secret}`);
  error.name = `SecretCandidateFailure${secret}`;
  error.code = `agent_launch.terminal_wk_candidate.${secret}.v999`;
  error.cause = { credentials: `Bearer ${secret}`, path: `/private/${secret}` };
  error.terminal_candidate_failure = projection;
  return error;
}

function internalDetailForProjection(projection) {
  if (projection?.detail === null || projection?.detail === undefined) return null;
  if (projection.code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID) {
    return { args: ["merge-base"], status: projection.detail.git_status };
  }
  if (projection.detail.git_operation === "for-each-ref") {
    return {
      ref: "refs/agent-launch/terminal-current-v2/WK-1783",
      status: projection.detail.git_status
    };
  }
  return {
    args: [projection.detail.git_operation],
    status: projection.detail.git_status
  };
}

function sourceErrorForProjection(projection, secret = "private nested secret") {
  return projection.kind === "typed_candidate_error"
    ? new TerminalWkCandidateError("private runtime source", {
        code: projection.code,
        detail: internalDetailForProjection(projection),
        cause: new Error(secret)
      })
    : new Error(secret);
}

async function rejectedCoordinatorCarrier(runGit, {
  module = { createTerminalCandidateCoordinator },
  mainRepo = "/runtime-authentication-does-not-use-this-path",
  worktreeRoot = "/tmp"
} = {}) {
  const coordinator = module.createTerminalCandidateCoordinator({
    mainRepo,
    worktreeRoot,
    runGit
  });
  try {
    await coordinator.recoverTerminalCandidate("WK-1783");
  } catch (error) {
    return error;
  }
  assert.fail("terminal candidate runner fixture must throw");
}

async function injectedCarrier(thrown, options = {}) {
  return rejectedCoordinatorCarrier(() => { throw thrown; }, options);
}

function assertUntrustedRunnerTransport(error, forbidden = []) {
  assert.equal(error.code, UNTRUSTED_RUNNER_CODE);
  assert.equal(error.message, UNTRUSTED_RUNNER_MESSAGE);
  assert.equal(Object.hasOwn(error, "terminal_candidate_failure"), false);
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(error), UNKNOWN);
  assert.equal(projectTerminalCandidateRecoveryReason(error),
    "terminal_candidate_recovery_failed");
  const serialized = JSON.stringify({
    code: error.code,
    message: error.message,
    projection: projectAuthenticatedTerminalCandidateFailure(error)
  });
  for (const value of forbidden) assert.equal(serialized.includes(value), false);
}

async function productionMissingRepositoryCarrier(t, { explicitRunner = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1783-production-auth-"));
  const marker = explicitRunner
    ? "WK1783_EXPLICIT_PRODUCTION_RUNNER_SECRET"
    : "WK1783_DEFAULT_PRODUCTION_RUNNER_SECRET";
  const mainRepo = path.join(root, marker, "missing-repository");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const args = { mainRepo, worktreeRoot: root };
  if (explicitRunner) args.runGit = defaultTerminalCandidateRunGit;
  const coordinator = createTerminalCandidateCoordinator(args);
  try {
    await coordinator.recoverTerminalCandidate("WK-1783");
  } catch (error) {
    return { error, mainRepo, marker };
  }
  assert.fail("missing production repository must reject");
}

function backendContext(recoverTerminalCandidate) {
  return {
    frozenSliceReviewContexts: new Map(),
    frozenReviewContexts: new Map(),
    worktreeProvisioningConfig: { mainRepo: "/unused-before-recovery-success" },
    reviewContextRunGit() {
      assert.fail("Git verification must not run after recovery failure");
    },
    recoverTerminalCandidate,
    terminalCandidateRecoveryInFlight: new Map(),
    currentTerminalReviewTargetByWk: new Map(),
    frozenReviewContextsByTarget: new Map(),
    wholeReviewRunContexts: new Map(),
    runs: new Map(),
    wholeReviewTargetKey() {
      assert.fail("review target resolution must not run after recovery failure");
    },
    terminalReviewAttemptContracts: new Map(),
    terminalReviewAttemptContractBySubject: new Map(),
    structuredReceiptOutcome() {
      assert.fail("review result projection must not run after recovery failure");
    }
  };
}

async function refuseThrown(thrown, module = { createBackendTerminalReview }) {
  let recoveryCalls = 0;
  const ctx = backendContext(async () => {
    recoveryCalls += 1;
    throw thrown;
  });
  const backend = module.createBackendTerminalReview(ctx);
  const result = await backend.recoverTerminalReviewContext(REVIEW_ADDRESS);
  assert.equal(recoveryCalls, 1);
  assert.equal(ctx.runs.size, 0);
  assert.equal(ctx.wholeReviewRunContexts.size, 0);
  assert.equal(ctx.frozenReviewContexts.size, 0);
  return result;
}

function publicProjection(result) {
  return result.refusal.refusal.detail.recovery_detail;
}

function assertPreSpawnRefusal(result, expected) {
  assert.equal(result.ok, false);
  assert.equal(result.refusal.accepted, false);
  assert.equal(result.refusal.refusal.code, "validation_failure");
  assert.equal(result.refusal.refusal.reason, "managed_lifecycle_required");
  assert.equal(result.refusal.refusal.detail.reason, "terminal_candidate_recovery_failed");
  assert.equal(result.refusal.refusal.detail.recovery_code, expected.code);
  assert.equal(result.refusal.refusal.detail.message, expected.message);
  assert.deepEqual(publicProjection(result), expected);
  assert.deepEqual(Object.keys(publicProjection(result)), PROJECTION_KEYS);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("run_id"), false);
  assert.equal(serialized.includes("monitor_handle"), false);
}

async function assertUnknown(thrown, forbidden = []) {
  const result = await refuseThrown(thrown);
  assertPreSpawnRefusal(result, UNKNOWN);
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    assert.equal(serialized.includes(value), false, `public refusal reflected ${value}`);
  }
}

test("WK-1783 pure projection validates all eight typed codes without granting provenance", () => {
  assert.equal(Object.values(TERMINAL_WK_CANDIDATE_CODES).length, 8);
  for (const code of Object.values(TERMINAL_WK_CANDIDATE_CODES)) {
    const expected = typedProjection(code);
    const projected = projectTerminalWkCandidateFailure(sourceErrorForProjection(expected));
    assert.deepEqual(projected, expected);
    assert.deepEqual(Object.keys(projected), PROJECTION_KEYS);
  }
});

test("WK-1783 pure projection preserves only bounded structural Git detail", () => {
  for (const git_operation of GIT_OPERATIONS) {
    for (const git_status of [null, 0, 255]) {
      const detail = { git_operation, git_status };
      const expected = typedProjection(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, detail);
      assert.deepEqual(projectTerminalWkCandidateFailure(sourceErrorForProjection(expected)), expected);
    }
  }

  for (const git_status of [null, 0, 255]) {
    const detail = { git_operation: "merge-base", git_status };
    const expected = typedProjection(TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID, detail);
    assert.deepEqual(projectTerminalWkCandidateFailure(sourceErrorForProjection(expected)), expected);
  }
});

test("WK-1783 exact production runner authenticates a real Git failure for the backend", async (t) => {
  for (const explicitRunner of [false, true]) {
    const { error, mainRepo, marker } = await productionMissingRepositoryCarrier(t, {
      explicitRunner
    });
    const expected = typedProjection(
      TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
      { git_operation: "for-each-ref", git_status: 128 }
    );
    assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(error), expected);
    assertPreSpawnRefusal(await refuseThrown(error), expected);
    const serialized = JSON.stringify(await refuseThrown(error));
    for (const forbidden of [mainRepo, marker, "fatal:", "stderr", "stdout", "cause", "stack"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
});

test("WK-1783 injected callbacks cannot authenticate any of the eight typed codes", async () => {
  for (const code of Object.values(TERMINAL_WK_CANDIDATE_CODES)) {
    const secret = `injected-${code}-secret`;
    const expected = typedProjection(code);
    const error = await injectedCarrier(sourceErrorForProjection(expected, secret));
    assertUntrustedRunnerTransport(error, [secret, code]);
    assertPreSpawnRefusal(await refuseThrown(error), UNKNOWN);
  }
});

test("WK-1783 injected values and forged carriers stay unknown and secret-safe", async () => {
  const exact = typedProjection(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
  const getter = new Error("getter-carrier-secret");
  Object.defineProperty(getter, "terminal_candidate_failure", {
    get() { throw new Error("getter-projection-secret"); }
  });
  getter.stack = "getter-stack-secret";
  getter.cause = { path: "/private/getter-cause-secret" };
  const proxy = new Proxy(new Error("proxy-carrier-secret"), {
    getOwnPropertyDescriptor() { throw new Error("proxy-trap-secret"); }
  });
  const values = [
    carrier({ ...exact }, "exact-five-field-secret"),
    new Error("ordinary-error-secret"),
    "non-error-secret",
    { path: "/private/object-secret", stack: "object-stack-secret" },
    proxy,
    getter
  ];
  for (const value of values) {
    const error = await injectedCarrier(value);
    assertUntrustedRunnerTransport(error, ["secret", "/private/"]);
    assertPreSpawnRefusal(await refuseThrown(error), UNKNOWN);
  }
});

test("WK-1783 wrapped, bound, proxied, and lookalike production runners are untrusted", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1783-runner-identity-"));
  const marker = "WK1783_RUNNER_IDENTITY_SECRET";
  const mainRepo = path.join(root, marker, "missing-repository");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const wrapper = (input) => defaultTerminalCandidateRunGit(input);
  const bound = defaultTerminalCandidateRunGit.bind(null);
  const proxy = new Proxy(defaultTerminalCandidateRunGit, {});
  const lookalike = function defaultTerminalCandidateRunGit(input) {
    return defaultTerminalCandidateRunGit(input);
  };
  Object.defineProperty(lookalike, "production_terminal_candidate_runner", {
    value: true
  });
  Object.defineProperty(lookalike, "toString", {
    value: () => Function.prototype.toString.call(defaultTerminalCandidateRunGit)
  });
  for (const runGit of [wrapper, bound, proxy, lookalike]) {
    const error = await rejectedCoordinatorCarrier(runGit, { mainRepo, worktreeRoot: root });
    assertUntrustedRunnerTransport(error, [marker, mainRepo]);
    assertPreSpawnRefusal(await refuseThrown(error), UNKNOWN);
  }
});

test("WK-1783 remediation rejects exact forged, copied, getter, and proxy carriers", async (t) => {
  const exact = typedProjection(
    TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    { git_operation: "for-each-ref", git_status: 128 }
  );
  const { error: authentic } = await productionMissingRepositoryCarrier(t);
  assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(authentic), exact);

  const copied = new Error("copied secret");
  copied.terminal_candidate_failure = authentic.terminal_candidate_failure;
  const getter = new Error("getter secret");
  Object.defineProperty(getter, "terminal_candidate_failure", {
    get() { throw new Error("getter must never run"); }
  });
  const values = [
    carrier({ ...exact }, "exact-forgery"),
    copied,
    carrier(new Proxy({ ...exact }, {}), "projection-proxy"),
    new Proxy(carrier({ ...exact }, "carrier-proxy"), {}),
    getter,
    new Proxy(carrier({ ...exact }, "throwing-proxy"), {
      getOwnPropertyDescriptor() { throw new Error("proxy trap must never run"); }
    })
  ];
  for (const value of values) {
    assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(value), UNKNOWN);
    assertPreSpawnRefusal(await refuseThrown(value), UNKNOWN);
  }
  assert.equal(Object.isFrozen(projectAuthenticatedTerminalCandidateFailure(copied)), true);
});

test("WK-1783 remediation read-only authentication lookup exposes no mint or adoption route", async () => {
  const runtime = await import(RUNTIME_SOURCE_URL);
  for (const key of Object.keys(runtime)) {
    assert.doesNotMatch(key,
      /(?:(?:mint|adopt|register).*terminal.*failure|terminal.*failure.*(?:mint|adopt|register))/iu);
  }
  const forged = carrier(typedProjection(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED));
  assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(forged), UNKNOWN);
  assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(new Proxy(forged, {})), UNKNOWN);
  const injected = await injectedCarrier(new TerminalWkCandidateError("injected", {
    code: TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED
  }));
  assertUntrustedRunnerTransport(injected);
});

test("WK-1783#SLICE-002 collapses malformed and open projections to the byte-stable unknown form", async () => {
  const gitCode = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED;
  const nonGitCode = TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED;
  const valid = typedProjection(gitCode);
  const symbolOpen = { ...valid };
  symbolOpen[Symbol("secret")] = "symbol-secret";
  const accessor = { ...valid };
  Object.defineProperty(accessor, "message", {
    enumerable: true,
    get() {
      throw new Error("accessor-secret");
    }
  });
  const nonEnumerable = { ...valid };
  Object.defineProperty(nonEnumerable, "message", { value: TYPED_MESSAGE, enumerable: false });
  const classInstance = Object.assign(new class Projection {}, valid);
  const nullPrototype = Object.assign(Object.create(null), valid);

  const invalid = [
    undefined,
    null,
    "not a projection",
    7,
    new Error("projection-error-secret"),
    {},
    { ...valid, extra: "open-schema-secret" },
    { schema_version: SCHEMA_VERSION, kind: valid.kind, code: valid.code, message: valid.message },
    { ...valid, schema_version: "agent_launch.terminal_candidate_failure_projection.v2" },
    { ...valid, kind: "typed_candidate_error_prefix" },
    { ...valid, code: "agent_launch.terminal_wk_candidate.forged_prefix.v999" },
    { ...valid, message: `${TYPED_MESSAGE}: forged suffix` },
    { ...UNKNOWN, message: `${UNKNOWN_MESSAGE}: forged suffix` },
    { ...UNKNOWN, code: gitCode },
    { ...UNKNOWN, detail: {} },
    { ...typedProjection(nonGitCode), detail: { git_operation: "rev-parse", git_status: 1 } },
    { ...valid, detail: {} },
    { ...valid, detail: { git_operation: "status", git_status: 1 } },
    { ...valid, detail: { git_operation: "rev-parse", git_status: -1 } },
    { ...valid, detail: { git_operation: "rev-parse", git_status: 256 } },
    { ...valid, detail: { git_operation: "rev-parse", git_status: 1.5 } },
    { ...valid, detail: { git_operation: "rev-parse", git_status: "1" } },
    { ...valid, detail: { git_operation: "rev-parse", git_status: 1, stderr: "git-secret" } },
    {
      ...typedProjection(TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID),
      detail: { git_operation: "rev-parse", git_status: 1 }
    },
    symbolOpen,
    accessor,
    nonEnumerable,
    classInstance,
    nullPrototype
  ];

  const expectedBytes = JSON.stringify(UNKNOWN);
  for (const projection of invalid) {
    const result = await refuseThrown(carrier(projection, "carrier-secret"));
    assertPreSpawnRefusal(result, UNKNOWN);
    assert.equal(JSON.stringify(publicProjection(result)), expectedBytes);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "carrier-secret",
      "projection-error-secret",
      "open-schema-secret",
      "accessor-secret",
      "git-secret"
    ]) assert.equal(serialized.includes(secret), false);
  }
});

test("WK-1783#SLICE-002 rejects direct Error, non-Error, forged-prefix, path, and environment values", async () => {
  const secrets = [
    "TOP_SECRET_TOKEN_1783",
    "/private/WK-1783/credential-file",
    "Authorization: Bearer wk1783-secret",
    "DATABASE_URL=postgres://wk1783-secret"
  ];
  await assertUnknown(new Error(secrets.join(" ")), secrets);
  await assertUnknown({ code: "agent_launch.terminal_wk_candidate.git_failed.v1", secrets }, secrets);
  await assertUnknown(secrets.join(" "), secrets);
  await assertUnknown(carrier({
    schema_version: SCHEMA_VERSION,
    kind: "typed_candidate_error",
    code: TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    message: TYPED_MESSAGE,
    detail: {
      git_operation: "rev-parse",
      git_status: 128,
      args: [secrets[1]],
      stdout: secrets[0],
      stderr: secrets[2]
    }
  }, secrets[3]), secrets);
});

test("WK-1783#SLICE-002 redacts a production-default Git failure for a missing secret-bearing path", async () => {
  const secret = "wk1783-production-git-secret";
  const missingPath = `/tmp/${secret}/missing-repository`;
  const gitFailure = defaultTerminalCandidateRunGit({
    repo: missingPath,
    args: ["rev-parse", "HEAD"]
  });
  assert.equal(gitFailure.ok, false);
  assert.match(`${gitFailure.error ?? ""}${gitFailure.stderr ?? ""}`, new RegExp(secret));

  const error = new Error(gitFailure.error ?? gitFailure.stderr);
  error.code = "agent_launch.terminal_wk_candidate.git_failed.v1";
  error.terminal_candidate_failure = {
    schema_version: SCHEMA_VERSION,
    kind: "typed_candidate_error",
    code: TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    message: TYPED_MESSAGE,
    detail: {
      git_operation: "rev-parse",
      git_status: gitFailure.status ?? null,
      git_args: [missingPath],
      git_stderr: gitFailure.stderr ?? gitFailure.error
    }
  };
  await assertUnknown(error, [secret, missingPath]);
});

function rewriteImportsForDataUrl(source, sourceUrl) {
  return source.replace(
    /^(\s*(?:import\b[^\n]*\bfrom|\}\s+from)\s+)(["'])([^"']+)\2;$/gmu,
    (_match, from, quote, specifier) => {
      if (specifier.startsWith("node:")) return `${from}${quote}${specifier}${quote};`;
      const resolved = specifier.startsWith(".")
        ? new URL(specifier, sourceUrl).href
        : import.meta.resolve(specifier);
      return `${from}${quote}${resolved}${quote};`;
    }
  );
}

async function loadMutation(label, before, after, sourceUrl = BACKEND_SOURCE_URL) {
  const source = await readFile(sourceUrl, "utf8");
  const matches = source.split(before).length - 1;
  assert.equal(matches, 1, `${label} mutation target drifted`);
  const mutated = rewriteImportsForDataUrl(source.replace(before, after), sourceUrl);
  const url = `data:text/javascript;base64,${Buffer.from(`${mutated}\n// ${label}`).toString("base64")}`;
  try {
    return await import(url);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

async function assertSemanticMutationKilled(label, module, semanticAssertion) {
  let failure = null;
  try {
    await semanticAssertion(module);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, "ERR_ASSERTION", `${label} must fail its intended semantic assertion`);
  return label;
}

test("WK-1783 remediation loaded semantic mutations kill provenance and raw-fallback regressions", async () => {
  const authenticationCall = "return closedTerminalCandidateFailureProjection(\n    projectAuthenticatedTerminalCandidateFailure(error)\n  );";
  const ownPropertyTrust = "const descriptor = Object.getOwnPropertyDescriptor(error, \"terminal_candidate_failure\");\n  return closedTerminalCandidateFailureProjection(descriptor?.value);";
  const directPropertyTrust = "return closedTerminalCandidateFailureProjection(error?.terminal_candidate_failure);";
  const exact = typedProjection(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
  const killed = [];

  for (const [label, replacement, thrown] of [
    ["restore backend own-property trust", ownPropertyTrust, carrier({ ...exact })],
    ["accept exact forged projection", directPropertyTrust, carrier({ ...exact })],
    ["accept transparent projection proxy", directPropertyTrust,
      carrier(new Proxy({ ...exact }, {}))],
    ["accept transparent carrier proxy", ownPropertyTrust,
      new Proxy(carrier({ ...exact }), {})]
  ]) {
    const mutant = await loadMutation(label, authenticationCall, replacement);
    killed.push(await assertSemanticMutationKilled(label, mutant, async (module) => {
      assert.deepEqual(publicProjection(await refuseThrown(thrown, module)), UNKNOWN);
    }));
  }

  const prefixTrust = await loadMutation(
    "replace private authentication with property/prefix trust",
    "return terminalCandidateRecoveryFailures.get(error)?.failure ??\n    UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;",
    "return error?.terminal_candidate_failure ??\n    UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;",
    RUNTIME_SOURCE_URL
  );
  killed.push(await assertSemanticMutationKilled(
    "replace private authentication with property/prefix trust",
    prefixTrust,
    (module) => {
      const forged = carrier(typedProjection(
        "agent_launch.terminal_wk_candidate.forged_prefix.v999"
      ));
      assert.deepEqual(module.projectAuthenticatedTerminalCandidateFailure(forged), UNKNOWN);
    }
  ));

  const exposedMint = await loadMutation(
    "export a mint/adoption route",
    "const terminalCandidateRecoveryFailures = new WeakMap();",
    "const terminalCandidateRecoveryFailures = new WeakMap();\nexport function adoptTerminalCandidateFailureForMutation(error, failure) {\n  terminalCandidateRecoveryFailures.set(error, Object.freeze({ reason: \"forged\", failure }));\n}",
    RUNTIME_SOURCE_URL
  );
  killed.push(await assertSemanticMutationKilled("export a mint/adoption route", exposedMint, (module) => {
    assert.equal(Object.hasOwn(module, "adoptTerminalCandidateFailureForMutation"), false);
  }));

  const rawException = await loadMutation(
    "restore raw exception fallback",
    "message: recoveryFailure.message,",
    "message: error?.message ?? recoveryFailure.message,"
  );
  killed.push(await assertSemanticMutationKilled("restore raw exception fallback", rawException, async (module) => {
    const secret = "raw-exception-mutant-secret";
    const result = await module.createBackendTerminalReview(
      backendContext(async () => { throw carrier(null, secret); })
    ).recoverTerminalReviewContext(REVIEW_ADDRESS);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }));

  const rawGitDetail = await loadMutation(
    "restore raw Git-detail fallback",
    "recovery_detail: recoveryFailure",
    "recovery_detail: error?.terminal_candidate_failure ?? recoveryFailure"
  );
  killed.push(await assertSemanticMutationKilled("restore raw Git-detail fallback", rawGitDetail, async (module) => {
    const secret = "raw-git-detail-mutant-secret";
    const result = await module.createBackendTerminalReview(
      backendContext(async () => {
        throw carrier({ ...exact, git_stderr: secret });
      })
    ).recoverTerminalReviewContext(REVIEW_ADDRESS);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }));

  assert.deepEqual(killed, [
    "restore backend own-property trust",
    "accept exact forged projection",
    "accept transparent projection proxy",
    "accept transparent carrier proxy",
    "replace private authentication with property/prefix trust",
    "export a mint/adoption route",
    "restore raw exception fallback",
    "restore raw Git-detail fallback"
  ]);
});

test("WK-1783 loaded runner-identity mutations cannot mint authentication", async (t) => {
  const guard = "const authenticatesTerminalCandidateFailures =\n    runGit === PRODUCTION_TERMINAL_CANDIDATE_RUN_GIT;";
  const typedSource = () => {
    throw new TerminalWkCandidateError("mutant-selected typed code", {
      code: TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED
    });
  };
  const killed = [];

  for (const [label, replacement, runner] of [
    [
      "always authenticate runner",
      "const authenticatesTerminalCandidateFailures =\n    true;",
      typedSource
    ],
    [
      "authenticate any function runner",
      "const authenticatesTerminalCandidateFailures =\n    typeof runGit === \"function\";",
      typedSource
    ],
    [
      "trust production runner function name",
      "const authenticatesTerminalCandidateFailures =\n    runGit.name === PRODUCTION_TERMINAL_CANDIDATE_RUN_GIT.name;",
      function defaultTerminalCandidateRunGit() {
        return typedSource();
      }
    ],
    [
      "trust production runner property",
      "const authenticatesTerminalCandidateFailures =\n    runGit.production_terminal_candidate_runner === true;",
      Object.assign(typedSource, { production_terminal_candidate_runner: true })
    ]
  ]) {
    const mutant = await loadMutation(label, guard, replacement, RUNTIME_SOURCE_URL);
    killed.push(await assertSemanticMutationKilled(label, mutant, async (module) => {
      const error = await rejectedCoordinatorCarrier(runner, { module });
      assertUntrustedRunnerTransport(error);
    }));
  }

  const root = mkdtempSync(path.join(os.tmpdir(), "wk1783-proxy-mutant-"));
  const mainRepo = path.join(root, "proxy-mutant-secret", "missing-repository");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const proxyLabel = "accept transparent proxy as production runner";
  const proxyMutant = await loadMutation(
    proxyLabel,
    guard,
    "const authenticatesTerminalCandidateFailures =\n    runGit === PRODUCTION_TERMINAL_CANDIDATE_RUN_GIT || utilTypes.isProxy(runGit);",
    RUNTIME_SOURCE_URL
  );
  killed.push(await assertSemanticMutationKilled(proxyLabel, proxyMutant, async (module) => {
    const error = await rejectedCoordinatorCarrier(
      new Proxy(defaultTerminalCandidateRunGit, {}),
      { module, mainRepo, worktreeRoot: root }
    );
    assertUntrustedRunnerTransport(error);
  }));

  const registrationLabel = "register untrusted callback projection";
  const registrationMutant = await loadMutation(
    registrationLabel,
    "if (!authenticatesTerminalCandidateFailures) {\n        failUntrustedTerminalCandidateRunner();\n      }\n      // The deliberate control-flow refusals",
    "if (!authenticatesTerminalCandidateFailures) {\n        failTerminalCandidateConstruction(projectTerminalWkCandidateFailure(error));\n      }\n      // The deliberate control-flow refusals",
    RUNTIME_SOURCE_URL
  );
  killed.push(await assertSemanticMutationKilled(
    registrationLabel,
    registrationMutant,
    async (module) => {
      const error = await rejectedCoordinatorCarrier(typedSource, { module });
      assert.deepEqual(module.projectAuthenticatedTerminalCandidateFailure(error), UNKNOWN);
    }
  ));

  const propertyLabel = "copy terminal_candidate_failure onto untrusted transport";
  const propertyMutant = await loadMutation(
    propertyLabel,
    "function failUntrustedTerminalCandidateRunner() {\n  const error = new Error(TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE);\n  error.code = TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_CODE;\n  throw error;\n}",
    "function failUntrustedTerminalCandidateRunner() {\n  const error = new Error(TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_MESSAGE);\n  error.code = TERMINAL_CANDIDATE_UNTRUSTED_RUNNER_FAILURE_CODE;\n  error.terminal_candidate_failure = UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION;\n  throw error;\n}",
    RUNTIME_SOURCE_URL
  );
  killed.push(await assertSemanticMutationKilled(propertyLabel, propertyMutant, async (module) => {
    const error = await rejectedCoordinatorCarrier(typedSource, { module });
    assert.equal(Object.hasOwn(error, "terminal_candidate_failure"), false);
  }));

  assert.deepEqual(killed, [
    "always authenticate runner",
    "authenticate any function runner",
    "trust production runner function name",
    "trust production runner property",
    "accept transparent proxy as production runner",
    "register untrusted callback projection",
    "copy terminal_candidate_failure onto untrusted transport"
  ]);
});
