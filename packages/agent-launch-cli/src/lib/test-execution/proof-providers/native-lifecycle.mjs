

import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

import {
  resolveNativeTestSelector,
  testProofProviderFamily,
  testRuntimeRunner
} from "@agent-chassis/controlled-contract/test-proof";

import { ATTEMPT_SCRATCH_ROOT } from "../../test-runtime-setup/ecosystems.mjs";
import { readinessRecovery } from "../../test-runtime-setup/readiness.mjs";
import { DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS } from "../confined-capture.mjs";
import { nativeNodeId, projectNativeObservation } from "../native-observation.mjs";
import { resolveInstalledRunnerIntegration } from "../runner-integrations.mjs";
import { resolveProofEnvironment, resolveRunnerRuntimeInputs, workingCopyProjectDir } from "../runtime-inputs.mjs";
import { selectWorkingCopySource } from "../source-selection.mjs";
import { SourceInstrumentationError } from "../source-instrumentation/index.mjs";
import {
  TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES,
  assertClosedInput,
  assertPreparedRuntime,
  brandPreparedRuntime,
  candidateResult,
  catalogDescriptor,
  fail,
  falsifierResult,
  launcherResolvedWorktree,
  mintProviderExecution,
  nativeInterruptedRun,
  providerEvidence,
  runDeclaredTest,
  selectedTestExecutionInput,
  traversalResult
} from "./execution.mjs";

export const NATIVE_RUNTIME_INPUTS_SCHEMA_VERSION = "workspace-agent-test-proof-native-runtime-inputs.v1";
export const OBSERVER_CONFIG_SCHEMA_VERSION = "launcher-test-proof-observer-config.v1";
export const OBSERVER_CONFIG_ENV = "LAUNCHER_TEST_PROOF_CONFIG";
const CAPABILITY_MODES = Object.freeze({ candidate_execution: "candidate",
  falsifier_execution: "falsifier", boundary_traversal: "traversal" });
const FALSIFIER_REASON_CODE = "test_proof_fault.result_inversion.v1";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export class NativeAttemptRefusal extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "NativeAttemptRefusal";
    this.code = code;
    this.detail = detail;
  }
}

export function refuseAttempt(code, message, detail = null) {
  throw new NativeAttemptRefusal(code, message, detail);
}

function assetDigest(spec) {
  return sha256(JSON.stringify(canonical({ family: spec.family_id,
    assets: Object.fromEntries(spec.assets.map((asset) => [path.basename(asset),
      sha256(readFileSync(asset))])) })));
}

export function runtimeInputsDigest(runtime, providerAssetDigest) {
  return sha256(JSON.stringify(canonical({ schema_version: NATIVE_RUNTIME_INPUTS_SCHEMA_VERSION,
    readiness_digest: runtime.identity.readiness_digest, environment: runtime.identity.environment,
    toolchains: runtime.identity.toolchains,
    dependencies: runtime.identity.dependencies, provider_asset_digest: providerAssetDigest })));
}

function unavailable(resolved, code, detail, budget) {
  return brandPreparedRuntime({ status: "unavailable", provider_id: resolved.provider_id,
    run: nativeInterruptedRun(code, detail, budget) });
}

function refusedRun(code, detail) {
  return Object.freeze({ ran: false, disposition: "not_run", ok: false, exit_code: null,
    signal: null, timed_out: false, blocker_code: code, output_truncated: false,
    output_elided_bytes: 0, test_proof_observation: Object.freeze({ valid: false, code,
      ...(detail === null ? {} : { detail }) }) });
}

function resolveRuntime({ spec, input, worktree, workProjectDir = null,
  scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
  const runner = testRuntimeRunner({ name: spec.runtime_runner });
  const located = resolveProofEnvironment({ repositoryRoot: input.authority.main_repo,
    checkoutRoot: worktree, target: input.target, runner, environment: input.environment ?? null });
  if (!located.configured || !located.ok) {

    const code = located.failure?.code ?? "test_runtime_runner_not_prepared";
    const recovery = located.configured ? located.failure.recovery ?? null
      : readinessRecovery(`No prepared ${runner.dependency_ecosystem} environment owns ${input.target}; ` +
        "rerun local test-runtime setup after the project that contains it declares its dependencies.");
    return { ok: false, code, detail: { failure: "configured_runtime_not_ready",
      readiness_code: code, recovery,
      ...(located.failure?.detail === undefined ? {} : { route: located.failure.detail }) } };
  }
  const project = located.project;
  const runtime = resolveRunnerRuntimeInputs({ repositoryRoot: input.authority.main_repo,
    checkoutRoot: worktree, descriptor: runner, project,
    workProjectDir: workProjectDir === null ? null : workingCopyProjectDir(scratchRoot, project),
    scratchRoot });
  if (!runtime.ok) {
    return { ok: false, code: runtime.code, detail: { failure: "configured_runtime_not_ready",
      readiness_code: runtime.code, recovery: runtime.recovery ?? null, route: located.route } };
  }
  return { ok: true, runner, project, runtime, route: located.route };
}

function readAuthenticatedSource(worktree, project, relative) {
  if (project !== "." && !relative.startsWith(`${project}/`)) {
    refuseAttempt("test_proof_native_selection_unsupported",
      "native proof sources must belong to the prepared runtime project",
      { path: relative, project });
  }
  const absolute = path.join(worktree, relative);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    return refuseAttempt("test_proof_native_selection_unsupported",
      "a declared native proof source is absent", { path: relative, errno: error?.code ?? null });
  }
  if (!stat.isFile() || realpathSync(absolute) !== absolute) {
    refuseAttempt("test_proof_native_selection_unsupported",
      "a declared native proof source is not a regular checkout file", { path: relative });
  }
  const bytes = readFileSync(absolute);
  return { source: bytes.toString("utf8"), digest: sha256(bytes) };
}

export function nativeProviderImplementation(spec) {
  const family = testProofProviderFamily(spec.selector_kind);
  if (family === null || family.family_id !== spec.family_id) {
    throw new Error(`native provider spec ${spec.family_id} names no package family`);
  }
  const candidateDescriptor = family.providers.candidate_execution;
  const falsifierDescriptor = family.providers.falsifier_execution;
  const targetExtensions = family.source_suffixes;

  async function withProofScratchRoot(callback) {
    const scratchRoot = mkdtempSync("/tmp/agent-chassis-proof-");
    try {
      return await callback(scratchRoot);
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  async function prepareInScratch(resolved, input, scratchRoot) {
    assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
      "executionBudget", "environment"], "provider preparation refuses caller-supplied executable authority");
    selectedTestExecutionInput(input);
    const worktree = launcherResolvedWorktree(input);
    const located = resolveRuntime({ spec, input, worktree, scratchRoot });
    if (!located.ok) return unavailable(resolved, located.code, located.detail, input.executionBudget);
    const integration = resolveInstalledRunnerIntegration(located.runner);
    let probe;
    try {
      probe = integration.setupProbe({ runtime: located.runtime,
        projectDir: located.runtime.projectDir });
    } catch (error) {
      return unavailable(resolved, typeof error?.code === "string" ? error.code
        : "test_proof_native_runtime_unavailable", error?.detail ?? null, input.executionBudget);
    }
    const providerAssetDigest = assetDigest(spec);
    const expectation = { capability: "preparation", family_id: spec.family_id };
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, [], expectation, {
      runtime: located.runtime,
      invocation: { command: probe.command, args: probe.args, cwd: probe.cwd,
        env: probe.env ?? {}, scratchRoot },
      target_extensions: targetExtensions,
      timeout_ms: DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
      observe: ({ exitCode }) => (exitCode === 0 ? { valid: true, status: "prepared" }
        : { valid: false, code: "test_proof_native_runtime_unavailable" })
    }));
    const prepared = run.test_proof_observation?.valid === true;
    const inputsDigest = runtimeInputsDigest(located.runtime, providerAssetDigest);
    return brandPreparedRuntime({
      schema_version: "workspace-agent-test-proof-native-preparation.v1",
      status: prepared ? "prepared" : "unavailable",
      provider_id: resolved.provider_id,
      provider_version: resolved.provider_version,
      selector_kind: spec.selector_kind,
      project: located.project,
      runtime: Object.freeze({
        runtime_source: "launcher_readiness",
        runtime_runner: located.runner.runner_id,
        project: located.project,
        environment: located.runtime.identity.environment,
        route: located.route,
        readiness_digest: located.runtime.identity.readiness_digest,
        provider_asset_digest: providerAssetDigest,
        runtime_inputs_digest: inputsDigest,
        dependency_population: Object.freeze({ source: "launcher_readiness",
          readiness_digest: located.runtime.identity.readiness_digest,
          environment: located.runtime.identity.environment,
          route: located.route,
          toolchains: located.runtime.identity.toolchains,
          dependencies: located.runtime.identity.dependencies })
      }),
      runtime_inputs_digest: inputsDigest,
      consumer_compilation: "attempt_private",
      run
    });
  }

  async function prepare(resolved, input) {
    return withProofScratchRoot((scratchRoot) => prepareInScratch(resolved, input, scratchRoot));
  }

  function attemptResult(mode, { observation, run, resolved, provider }) {
    const artifacts = Object.freeze(observation?.artifacts ?? []);
    if (mode === "candidate") return candidateResult({ observation, run, artifacts, provider });
    if (mode === "falsifier") return falsifierResult({ observation, run, artifacts, provider });
    return traversalResult({ observation, run, artifacts, provider, selection: resolved.selection });
  }

  async function executeInScratch(resolved, input, selectedTest, scratchRoot) {
    const worktree = launcherResolvedWorktree(input);
    const prepared = assertPreparedRuntime(input.preparedRuntime, resolved);
    const mode = CAPABILITY_MODES[resolved.capability];
    const provider = providerEvidence(resolved, resolved.capability);
    const located = resolveRuntime({ spec, input, worktree, workProjectDir: true, scratchRoot });
    if (!located.ok) fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
      "the prepared native runtime is no longer ready", located.detail);
    const providerAssetDigest = assetDigest(spec);
    const currentDigest = runtimeInputsDigest(located.runtime, providerAssetDigest);
    if (located.project !== prepared.project || currentDigest !== prepared.runtime_inputs_digest ||
        located.runtime.identity.environment !== prepared.runtime.environment) {
      throw Object.assign(new Error("installed native runtime inputs changed after preparation"), {
        code: "test_proof_native_runtime_inputs_stale",
        detail: { expected: prepared.runtime_inputs_digest, actual: currentDigest } });
    }
    const native = resolveNativeTestSelector({ provider_id: selectedTest.provider_id,
      provider_version: selectedTest.provider_version, node_id: selectedTest.node_id },
    { path: selectedTest.file });
    if (!native.valid || native.selector_kind !== spec.selector_kind) fail(
      TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
      "the selected test belongs to another provider family");
    const project = located.project;
    const workRoot = path.join(scratchRoot, "work");
    const workProject = workingCopyProjectDir(scratchRoot, project);
    const privateRoot = path.join(scratchRoot, ".launcher-test-proof");
    const configPath = path.join(privateRoot, "config.json");
    const channelPath = path.join(privateRoot, "channel.jsonl");
    const selection = resolved.selection ?? {};
    const moduleRelative = mode === "falsifier" ? selection.mutation.module_path
      : mode === "traversal" ? selection.module_path : null;
    const nonce = randomBytes(32).toString("hex");
    const attempt = Object.freeze({
      mode,
      nonce,
      worktree,
      project,
      projectHost: project === "." ? worktree : path.join(worktree, project),
      workRoot,
      workProject,
      privateRoot,
      configPath,
      channelPath,
      runtime: located.runtime,
      selectedTest,
      test: native.selection.title_path ?? native.selection.identifier_path,
      testFile: selectedTest.file,
      testFileWork: path.join(workRoot, selectedTest.file),
      module: moduleRelative,
      moduleWork: moduleRelative === null ? null : path.join(workRoot, moduleRelative),
      mutation: mode === "falsifier" ? { function_name: selection.mutation.function_name,
        replacement: selection.mutation.replacement } : null,
      read: (relative) => readAuthenticatedSource(worktree, project, relative),
      workPath: (relative) => path.join(workRoot, relative)
    });
    let plan;
    try {
      if (moduleRelative !== null && !family.source_suffixes.some((suffix) =>
        moduleRelative.endsWith(suffix))) {
        refuseAttempt("test_proof_native_selection_unsupported",
          "the declared module is not a source of this provider family", { path: moduleRelative });
      }
      const layout = await spec.layout(attempt);
      const instrumentation = await spec.instrument(attempt, layout);
      const invocation = spec.invocation(attempt, layout);
      const source = await selectWorkingCopySource(attempt.projectHost);
      if (!source.ok) {
        refuseAttempt(source.code, source.message, { ...source.detail, recovery: source.recovery });
      }
      plan = { layout, instrumentation, invocation, source };
    } catch (error) {
      if (!(error instanceof SourceInstrumentationError) && !(error instanceof NativeAttemptRefusal) &&
          !(typeof error?.code === "string" && error.code.startsWith("test_runtime_"))) throw error;
      const detail = error instanceof SourceInstrumentationError
        ? { reason: error.reason, ...error.detail } : error.detail ?? null;
      return attemptResult(mode, { resolved, provider,
        observation: { valid: false, code: error.code, detail },
        run: refusedRun(error.code, detail) });
    }
    const { instrumentation, invocation, source } = plan;

    const config = {
      schema_version: OBSERVER_CONFIG_SCHEMA_VERSION,
      nonce,
      channel: channelPath,
      repository_root: workRoot,
      test_file: attempt.testFileWork,
      selected: { file: selectedTest.file, test: attempt.test,
        ...(instrumentation.selected_extra ?? {}) },
      runner_options: typeof spec.runner_options === "function"
        ? spec.runner_options(attempt) : spec.runner_options ?? {},
      ...(instrumentation.config ?? {})
    };
    const moduleFacts = instrumentation.module ?? null;
    const expectation = {
      capability: resolved.capability,
      family_id: spec.family_id,
      provider_id: selectedTest.provider_id,
      provider_version: selectedTest.provider_version,
      candidate_mechanism: candidateDescriptor.observation_mechanisms[0],
      identity_format: spec.identity_format,
      completion: spec.completion,
      window_start: spec.window_start ?? "test_start",
      declared_node_ids: (instrumentation.declared_tests ?? []).map((test) =>
        nativeNodeId(selectedTest.file, test, spec.identity_format)),
      attempt_nonce: nonce,
      node_id: selectedTest.node_id,
      target: selectedTest.file,
      target_test_id: selectedTest.test_id,
      runtime_inputs_digest: prepared.runtime_inputs_digest,
      worktree,
      ...(mode === "falsifier" ? {
        mutation_id: selection.mutation.mutation_id,
        failure_reason_code: FALSIFIER_REASON_CODE,
        observation_seam: falsifierDescriptor.observation_seams[0]
      } : {}),
      ...(mode === "traversal" ? { observation_seam: selection.observation_seam } : {}),
      ...(moduleFacts === null ? {} : { instrumentation: moduleFacts })
    };
    const writes = [
      { path: configPath, content: `${JSON.stringify(config)}\n` },
      ...(instrumentation.writes ?? [])
    ];
    const run = await runDeclaredTest(input, mintProviderExecution(resolved, [], expectation, {
      runtime: located.runtime,
      invocation: {
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        env: { ...(invocation.env ?? {}), [OBSERVER_CONFIG_ENV]: configPath },

        directories: [privateRoot, ...(invocation.directories ?? []), ...located.runtime.directories],
        copies: [{ from: attempt.projectHost, to: workProject, entries: source.entries }],
        links: located.runtime.links,
        writes,
        channel: { kind: "file", path: channelPath },
        scratchRoot,
        readOnlyBinds: spec.assets.map((asset) => ({ src: asset, dst: asset }))
      },
      target_extensions: targetExtensions,
      timeout_ms: DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
      observe: ({ channelBytes, exitCode, channelOverflow }) => projectNativeObservation({
        channelBytes, channelOverflow, exitCode, expectation })
    }));
    return attemptResult(mode, { observation: run.test_proof_observation, run, resolved, provider });
  }

  async function execute(resolved, input, selectedTest) {
    return withProofScratchRoot((scratchRoot) =>
      executeInScratch(resolved, input, selectedTest, scratchRoot));
  }

  return Object.freeze({ family_id: spec.family_id, prepare, execute,
    describe: () => Object.freeze({ family_id: spec.family_id,
      runtime_runner: spec.runtime_runner, assets: [...spec.assets],
      candidate_provider: catalogDescriptor(candidateDescriptor.provider_id)?.provider_id ?? null }) });
}
