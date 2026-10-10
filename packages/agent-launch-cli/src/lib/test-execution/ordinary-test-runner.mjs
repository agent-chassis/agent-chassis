

import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { readinessRecovery } from "../test-runtime-setup/readiness.mjs";
import { resolveCurrentRunnerRuntime } from "./current-runtime.mjs";
import { SavedTestEntrypointsError, readSavedTestEntrypoints } from "../test-runtime-setup/test-entrypoints.mjs";
import { DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS, mintTestProofExecutionBudget } from "./confined-capture.mjs";
import { executeConfinedInvocation, withExecutionRoot } from "./confined-invocation.mjs";
import { resolveInstalledRunnerIntegration } from "./runner-integrations.mjs";
import { RunnerIntegrationPreconditionError } from "./runner-integrations/common.mjs";
import { configuredExecutableFailure } from "./runtime-inputs.mjs";

export const ORDINARY_TEST_RUN_SCHEMA_VERSION = "ordinary-test-file-run.v1";
export const ORDINARY_TEST_RUN_CODES = Object.freeze({
  REQUEST_INVALID: "ordinary_test_request_invalid",
  RUNNER_UNKNOWN: "ordinary_test_runner_unknown",
  TARGET_INVALID: "ordinary_test_target_invalid",
  TARGET_MISSING: "ordinary_test_target_missing",
  TARGET_NOT_FILE: "ordinary_test_target_not_file",
  TARGET_ESCAPES: "ordinary_test_target_escapes_checkout",
  SELECTOR_INVALID: "ordinary_test_selector_invalid",
  ENTRYPOINT_INVALID: "ordinary_test_entrypoint_invalid",
  SELECTION_UNSUPPORTED: "ordinary_test_selection_unsupported",
  SELECTION_UNRESOLVED: "ordinary_test_selection_unresolved"
});

const REQUEST_FIELDS = Object.freeze(["repositoryRoot", "checkoutRoot", "target", "runner", "environment",
  "selector", "timeoutMs", "budget"]);
const GLOB_CHARACTER = /[*?[\]{}]/u;
const SELECTOR_MAX_LENGTH = 1024;
const RUN_EVIDENCE_SCHEMA_VERSION = "ordinary-test-run.v1";

class OrdinaryRefusal extends Error {
  constructor(code, message, detail = {}, recovery = null) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.recovery = recovery;
  }
}

const refuse = (code, message, detail, recovery) => { throw new OrdinaryRefusal(code, message, detail, recovery); };

function targetDefect(value) {
  if (typeof value !== "string" || value.length === 0) return "it is not a nonempty string";
  if (value.includes("\0")) return "it contains NUL";
  if (value.includes("\\")) return "it contains a backslash";
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return "it is not repository-relative";
  if (GLOB_CHARACTER.test(value)) return "it contains a glob character";
  for (const segment of value.split("/")) {
    if (segment === "") return "it has an empty segment";
    if (segment === "." || segment === "..") return `it has a ${segment} segment`;
  }
  return null;
}

function checkoutFile(checkout, relative, codes) {
  const absolute = path.join(checkout, relative);
  let real;
  try {
    real = realpathSync(absolute);
  } catch (error) {
    refuse(codes.missing, `${relative} does not exist in the checkout`, { path: relative, errno: error?.code ?? null });
  }
  if (real !== checkout && !real.startsWith(`${checkout}/`)) {
    refuse(codes.escapes, `${relative} resolves outside the checkout`, { path: relative });
  }
  if (!lstatSync(real).isFile()) refuse(codes.notFile, `${relative} is not a regular file`, { path: relative });
  return real;
}

function absoluteRoot(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, `${name} must be an absolute launcher-resolved directory`,
      { field: name });
  }
  try {
    return realpathSync(value);
  } catch (error) {
    return refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, `${name} cannot be resolved`,
      { field: name, errno: error?.code ?? null });
  }
}

function validateRequest(request) {
  const unknown = Object.keys(request ?? {}).filter((key) => !REQUEST_FIELDS.includes(key));
  if (request === null || typeof request !== "object" || unknown.length > 0) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID,
      "an ordinary test run accepts only its launcher-resolved roots, one file, a runner, an environment, " +
      "a native selector and its timeout or budget; commands, arguments and environment variables are never inputs",
      { unknown_fields: unknown, allowed_fields: REQUEST_FIELDS });
  }
  const { runner, environment = null, selector = null, timeoutMs = DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
    budget = null } = request;
  const repositoryRoot = absoluteRoot(request.repositoryRoot, "repositoryRoot");
  const checkoutRoot = absoluteRoot(request.checkoutRoot, "checkoutRoot");
  const defect = targetDefect(request.target);
  if (defect !== null) {
    refuse(ORDINARY_TEST_RUN_CODES.TARGET_INVALID, `the target must be one literal repository-relative file: ${defect}`,
      { target: typeof request.target === "string" ? request.target : null });
  }
  const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === runner) ?? null;
  if (descriptor === null) {
    refuse(ORDINARY_TEST_RUN_CODES.RUNNER_UNKNOWN, `${JSON.stringify(runner)} is not a runtime runner`,
      { runner: typeof runner === "string" ? runner : null,
        runners: TEST_RUNTIME_RUNNER_CATALOG.runners.map(({ name }) => name) });
  }
  if (environment !== null && (typeof environment !== "string" || environment.length === 0)) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, "environment must be a published environment ID",
      { field: "environment" });
  }
  if (selector !== null && (typeof selector !== "string" || selector.length === 0 ||
      selector.length > SELECTOR_MAX_LENGTH || /[\0\r\n]/u.test(selector) || selector.startsWith("-"))) {
    refuse(ORDINARY_TEST_RUN_CODES.SELECTOR_INVALID, "a native selector is one nonempty line of at most " +
      `${SELECTOR_MAX_LENGTH} characters that does not begin with -`, { field: "selector" });
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, "timeoutMs must be a positive integer", { field: "timeoutMs" });
  }
  return { repositoryRoot, checkoutRoot, target: request.target, descriptor, environment, selector, timeoutMs,
    budget };
}

function overlayDestination(checkout, destination) {
  let stat = null;
  try { stat = lstatSync(destination); } catch { stat = null; }
  if (typeof destination !== "string" || !destination.startsWith(`${checkout}/`) || stat === null ||
      !stat.isFile() || realpathSync(destination) !== destination) {
    throw Object.assign(new Error(`${destination} is not an existing regular file of the checkout`),
      { code: "test_proof_source_overlay_invalid", detail: { path: destination } });
  }
  return destination;
}

const PROOF_STAGES = new WeakSet();
const COMPILER_CACHE_UNAVAILABLE_CODES = Object.freeze(["test_proof_native_compiler_cache_unavailable",
  "test_proof_native_compiler_cache_not_excluded"]);

export function mintProofStage({ compilerCache = null, compose }) {
  if (typeof compose !== "function") throw new TypeError("a proof stage requires its compose function");
  const stage = Object.freeze({ compilerCache, compose });
  PROOF_STAGES.add(stage);
  return stage;
}

export async function resolveTestFileRuntime({ repositoryRoot, checkoutRoot, target, descriptor, environment = null,
  compilerCache = null }) {
  const resolve = async (caching) => {
    const { located, runtime } = await resolveCurrentRunnerRuntime({ repositoryRoot, checkoutRoot, target,
      runner: descriptor, environment, compilerCache: caching });
    if (!located.configured) {
      return { ok: false, kind: "unrouted", code: "test_runtime_runner_not_prepared",
        message: `no ${descriptor.dependency_ecosystem} project in this checkout owns ${target}`,
        detail: { runner: descriptor.runner_id, target }, route: null,
        recovery: readinessRecovery(`No ${descriptor.dependency_ecosystem} installation root contains ${target}: ` +
          "neither a published environment nor a project manifest in the checkout. Declare the project that " +
          "contains it.") };
    }
    if (!located.ok) {
      return { ok: false, kind: "route", code: located.failure.code, message: located.failure.message,
        detail: located.failure.detail ?? {}, recovery: located.failure.recovery ?? null, route: null };
    }
    if (!runtime.ok) {
      return { ok: false, kind: "runtime", code: runtime.code,
        message: runtime.message ?? `the configured ${descriptor.name} runtime is not usable`,
        detail: runtime.detail ?? {}, recovery: runtime.recovery ?? null, route: located.route };
    }
    return { ok: true, project: located.project, route: located.route, runtime };
  };
  const resolved = await resolve(compilerCache !== null);
  if (!resolved.ok || compilerCache === null) {
    return resolved.ok ? { ...resolved, cache: { directory: null, choice: "none" } } : resolved;
  }
  try {
    return { ...resolved, cache: { directory: compilerCache.open(resolved.runtime), choice: "persistent" } };
  } catch (error) {
    if (!COMPILER_CACHE_UNAVAILABLE_CODES.includes(error?.code)) throw error;
    const scratch = await resolve(false);
    return scratch.ok ? { ...scratch, cache: { directory: null, choice: "attempt_scratch", reason: error.code } }
      : scratch;
  }
}

async function currentRuntime(validated, stage) {
  const resolved = await resolveTestFileRuntime({ ...validated, compilerCache: stage?.compilerCache ?? null });
  if (!resolved.ok) {
    refuse(resolved.code, resolved.message, resolved.kind === "runtime"
      ? { ...resolved.detail, route: resolved.route } : resolved.detail, resolved.recovery);
  }
  return resolved;
}

function savedAssociations(checkoutRoot, descriptor, project) {
  let saved;
  try {
    saved = readSavedTestEntrypoints(checkoutRoot);
  } catch (error) {
    if (!(error instanceof SavedTestEntrypointsError)) throw error;
    return refuse(error.code, error.message, error.detail);
  }
  const associations = saved.filter((entry) => entry.runner === descriptor.name && entry.project === project);
  for (const { entrypoint } of associations) {
    checkoutFile(checkoutRoot, entrypoint, { missing: ORDINARY_TEST_RUN_CODES.ENTRYPOINT_INVALID,
      escapes: ORDINARY_TEST_RUN_CODES.ENTRYPOINT_INVALID, notFile: ORDINARY_TEST_RUN_CODES.ENTRYPOINT_INVALID });
  }
  return Object.freeze(associations);
}

const DIAGNOSTIC_EXCERPT_MAX_BYTES = 256;

const ERROR_LINE_WORD =
  /\b[A-Za-z]*(?:Error|Exception)\b|\berror(?=[:[])|\bpanic(?:ked)?\b|\bFAIL(?:ED)?\b|\bfatal\b/u;

function utf8Bounded(text, limit, fromEnd) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let cut = fromEnd ? bytes.length - limit : limit;
  while (cut > 0 && cut < bytes.length && (bytes[cut] & 0xc0) === 0x80) cut += fromEnd ? 1 : -1;
  return (fromEnd ? bytes.subarray(cut) : bytes.subarray(0, cut)).toString("utf8");
}

function captureExcerpt(text) {
  const total = Buffer.byteLength(text, "utf8");
  const match = ERROR_LINE_WORD.exec(text);
  if (match !== null) {
    const start = text.lastIndexOf("\n", match.index) + 1;
    return { basis: "first_error_line", offset: Buffer.byteLength(text.slice(0, start), "utf8"),
      text: utf8Bounded(text.slice(start), DIAGNOSTIC_EXCERPT_MAX_BYTES, false), total_bytes: total };
  }
  if (total <= DIAGNOSTIC_EXCERPT_MAX_BYTES) return { basis: "whole", offset: 0, text, total_bytes: total };
  const tail = utf8Bounded(text, DIAGNOSTIC_EXCERPT_MAX_BYTES, true);
  return { basis: "tail", offset: total - Buffer.byteLength(tail, "utf8"), text: tail, total_bytes: total };
}

export function ordinaryRunDiagnostic(run) {
  if (run.ran === false) {
    for (const source of ["blocker_message", "spawn_error"]) {
      const text = run[source];
      if (typeof text === "string" && text.length > 0) {
        return Object.freeze({ source, basis: "whole", offset: 0, text,
          total_bytes: Buffer.byteLength(text, "utf8") });
      }
    }
  }
  const captured = ["stderr", "stdout"].filter((source) => typeof run[source] === "string" && run[source].length > 0)
    .map((source) => ({ source, ...captureExcerpt(run[source]) }));
  const chosen = captured.find(({ basis }) => basis === "first_error_line") ?? captured[0];
  return chosen === undefined ? null : Object.freeze(chosen);
}

class SelectionUnresolved extends Error {
  constructor(run) {
    super("the runner's own selection command did not complete successfully");
    this.code = ORDINARY_TEST_RUN_CODES.SELECTION_UNRESOLVED;
    this.detail = Object.freeze({ reason: "selection_command_unsuccessful", phase: "selection",
      disposition: run.disposition,
      ran: run.ran, exit_code: run.exit_code, timed_out: run.timed_out, cancelled: run.cancelled,
      output_truncated: run.output_truncated === true, blocker_code: run.blocker_code ?? null,
      diagnostic: ordinaryRunDiagnostic(run) ?? Object.freeze({ source: "none" }) });
  }
}

function selectionUnresolved(error, resolution) {
  return Object.freeze({ schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION, status: "selection_unresolved",
    ok: false, proof_credit: false, code: ORDINARY_TEST_RUN_CODES.SELECTION_UNRESOLVED, message: error.message,
    detail: error.detail ?? {}, resolution });
}

function refusal(error, extra = {}) {
  return Object.freeze({ schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION, status: "refused", ok: false,
    proof_credit: false, code: error.code, message: error.message, detail: error.detail ?? {},
    recovery: error.recovery ?? null, ...extra });
}

export function runOrdinaryTestFile(request) {
  return runTestFile(request, null);
}

export function runProofStageTestFile(request, stage) {
  if (!PROOF_STAGES.has(stage)) {
    throw Object.assign(new Error("a proof stage contribution must be launcher-minted"),
      { code: "test_proof_stage_untrusted" });
  }
  return runTestFile(request, stage);
}

async function runTestFile(request, stage) {
  let validated;
  let associations;
  let prepared;
  try {
    validated = validateRequest(request);
    const { checkoutRoot, target, descriptor } = validated;
    const absoluteFile = checkoutFile(checkoutRoot, target, { missing: ORDINARY_TEST_RUN_CODES.TARGET_MISSING,
      escapes: ORDINARY_TEST_RUN_CODES.TARGET_ESCAPES, notFile: ORDINARY_TEST_RUN_CODES.TARGET_NOT_FILE });
    prepared = await currentRuntime(validated, stage);
    associations = savedAssociations(checkoutRoot, descriptor, prepared.project);
    validated.absoluteFile = absoluteFile;
  } catch (error) {
    if (error instanceof OrdinaryRefusal) return refusal(error);
    throw error;
  }
  const { checkoutRoot, target, descriptor, selector, timeoutMs } = validated;
  const { project, route, runtime, cache } = prepared;
  const ownedBudget = validated.budget === null ? mintTestProofExecutionBudget({ timeoutMs }) : null;
  const budget = validated.budget ?? ownedBudget;
  const resolution = [];
  const baseEvidence = (phase) => ({ schema_version: RUN_EVIDENCE_SCHEMA_VERSION, operation: "ordinary_test",
    phase, target, runner: descriptor.runner_id, raw_exec_enabled: false });

  const projectDir = project === "." ? checkoutRoot : path.join(checkoutRoot, project);
  let contribution = null;

  const staged = (invocation, phase) => {
    const additions = contribution?.additions ?? {};
    return {
      ...invocation,
      env: { ...(invocation.env ?? {}), ...(additions.env ?? {}) },
      directories: [...(additions.directories ?? []), ...(invocation.directories ?? []), ...runtime.directories],
      readOnlyBinds: [...(invocation.readOnlyBinds ?? []), ...(additions.readOnlyBinds ?? [])],
      ...(additions.writes === undefined ? {} : { writes: additions.writes }),
      ...(phase === "run" && additions.channel !== undefined ? { channel: additions.channel } : {}),
      ...(cache.directory === null ? {} : { writableCache: cache.directory })
    };
  };

  const execute = (invocation, phase) => {
    const unavailable = configuredExecutableFailure(runtime, invocation.command);
    if (unavailable !== null) {
      throw new OrdinaryRefusal(unavailable.code, unavailable.message, { ...unavailable.detail, route },
        unavailable.recovery);
    }
    const confined = (owned) => executeConfinedInvocation({ checkout: checkoutRoot, runtime, invocation: owned,
      timeoutMs, budget, baseEvidence: baseEvidence(phase),
      ...(phase === "run" && contribution !== null ? { nativeReport: contribution.nativeReport ?? null,
        observe: contribution.observe ?? null } : {}) });
    const overlays = contribution?.additions?.overlays ?? [];
    if (overlays.length === 0) return confined(staged(invocation, phase));

    return withExecutionRoot((executionRoot) => {
      const directory = path.join(executionRoot.root, "overlay");
      mkdirSync(directory, { mode: 0o700 });
      const binds = overlays.map(({ path: destination, content }, index) => {
        const source = path.join(directory, String(index));
        writeFileSync(source, content, { mode: 0o400 });
        return { src: source, dst: overlayDestination(checkoutRoot, destination) };
      });
      const owned = staged(invocation, phase);
      return confined({ ...owned, executionRoot, readOnlyBinds: [...owned.readOnlyBinds, ...binds] });
    });
  };

  const metadata = async (invocation) => {
    const run = await execute(invocation, "selection");
    resolution.push(Object.freeze({ invocation: Object.freeze({ command: invocation.command,
      args: Object.freeze([...invocation.args]), cwd: invocation.cwd }), run }));
    if (run.ok !== true || run.output_truncated === true) throw new SelectionUnresolved(run);
    return run;
  };
  try {
    const file = project === "." ? target : path.posix.relative(project, target);
    if (stage !== null) {
      contribution = await stage.compose({ runtime, project, route, cache, checkout: checkoutRoot, projectDir,
        target, file, entrypoints: associations });
    }
    let plan;
    try {
      plan = await resolveInstalledRunnerIntegration(descriptor).ordinaryInvocation({ runtime,
        checkout: checkoutRoot, projectDir, project, target, absoluteFile: validated.absoluteFile, file, selector,
        entrypoints: associations, metadata, proof: contribution?.proof ?? null });
    } catch (error) {
      if (error instanceof SelectionUnresolved || (error instanceof RunnerIntegrationPreconditionError &&
          error.code === ORDINARY_TEST_RUN_CODES.SELECTION_UNRESOLVED)) {
        return selectionUnresolved(error, Object.freeze(resolution));
      }
      if (error instanceof RunnerIntegrationPreconditionError || error instanceof OrdinaryRefusal) {
        return refusal(error, { resolution: Object.freeze(resolution) });
      }
      throw error;
    }
    const { invocation, harness, selection = {} } = plan;
    let run;
    try {
      run = await execute(invocation, "run");
    } catch (error) {
      if (error instanceof OrdinaryRefusal) return refusal(error, { resolution: Object.freeze(resolution) });
      throw error;
    }
    return Object.freeze({
      schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION,
      status: run.ran === true ? "executed" : "not_run",
      ok: run.ok === true,
      proof_credit: false,
      run,
      resolution: Object.freeze(resolution),
      identity: Object.freeze({
        runner: descriptor.name,
        runner_id: descriptor.runner_id,
        target,
        selector,
        project,
        environment: runtime.identity.environment,
        route,
        readiness_digest: runtime.identity.readiness_digest,
        ...(runtime.identity.configuration_record_status === undefined ? {}
          : { configuration_record_status: runtime.identity.configuration_record_status }),
        toolchains: runtime.identity.toolchains,
        dependencies: runtime.identity.dependencies,
        harness,
        selection: Object.freeze({ ...selection }),
        invocation: Object.freeze({ command: invocation.command, args: Object.freeze([...invocation.args]),
          cwd: invocation.cwd })
      })
    });
  } finally {
    ownedBudget?.dispose();
  }
}
