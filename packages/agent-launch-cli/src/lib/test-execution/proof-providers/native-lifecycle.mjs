

import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  resolveNativeTestSelector,
  testProofProviderFamily,
  testRuntimeRunner
} from "@agent-chassis/controlled-contract/test-proof";

import { DEPENDENCY_ECOSYSTEMS } from "../../test-runtime-setup/ecosystems.mjs";
import { nativeNodeId, openNativeObservation } from "../native-observation.mjs";
import { mintProofStage, resolveTestFileRuntime } from "../ordinary-test-runner.mjs";
import { resolveInstalledRunnerIntegration } from "../runner-integrations.mjs";
import { nativeCompilerCachePath, openNativeCompilerCache } from "../runtime-inputs.mjs";
import { SourceInstrumentationError } from "../source-instrumentation/index.mjs";
import { copyProofSource, planProofSourceCopy } from "../proof-source-copy.mjs";
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

export function runtimeProvenanceSincePreparation(prepared, runtime, currentDigest) {
  if (currentDigest === prepared.runtime_inputs_digest) return null;
  return Object.freeze({ changed_since_preparation: true, runtime_inputs_digest: currentDigest,
    preparation_runtime_inputs_digest: prepared.runtime_inputs_digest,
    readiness_digest: runtime.identity.readiness_digest, environment: runtime.identity.environment,
    toolchains: runtime.identity.toolchains, dependencies: runtime.identity.dependencies });
}

export function withRuntimeProvenance(run, provenance) {
  return provenance === null ? run : Object.freeze({ ...run, runtime_environment_observed: provenance });
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
  const runtimeRunner = testRuntimeRunner({ name: spec.runtime_runner });
  const compilerCacheEnv = DEPENDENCY_ECOSYSTEMS[runtimeRunner.dependency_ecosystem]?.compilerCacheEnv ?? null;
  const runnerIntegration = () => resolveInstalledRunnerIntegration(runtimeRunner);

  const cachesCompilation = () => typeof runnerIntegration().compilerCache === "string" || compilerCacheEnv !== null;

  function openCompilerCache(input, runtime) {
    const repositoryRoot = input.authority.main_repo;
    if (runtime.compilerCache !== null) {
      return openNativeCompilerCache({ repositoryRoot, ...runtime.compilerCache });
    }
    return openNativeCompilerCache({ repositoryRoot,
      directory: nativeCompilerCachePath(repositoryRoot, runnerIntegration().compilerCache) });
  }

  const compilerCachePolicy = (input) => cachesCompilation()
    ? { open: (runtime) => openCompilerCache(input, runtime) } : null;

  function attemptFacts({ mode, worktree, workRoot = worktree, project, projectHost, runtime, selectedTest, test,
    moduleRelative }) {
    return {
      mode,
      worktree,
      project,
      projectHost,
      workRoot,
      runtime,
      selectedTest,
      test,
      testFile: selectedTest.file,
      testFileWork: path.join(workRoot, selectedTest.file),
      module: moduleRelative,
      moduleWork: moduleRelative === null ? null : path.join(workRoot, moduleRelative),
      read: (relative) => readAuthenticatedSource(worktree, project, relative),
      workPath: (relative) => path.join(workRoot, relative)
    };
  }

  async function prepare(resolved, input) {
    assertClosedInput(input, ["authority", "target", "authorizedTargets", "selectedTest",
      "executionBudget", "environment"], "provider preparation refuses caller-supplied executable authority");
    selectedTestExecutionInput(input);
    const worktree = launcherResolvedWorktree(input);
    const located = await resolveTestFileRuntime({ repositoryRoot: input.authority.main_repo,
      checkoutRoot: worktree, target: input.target, descriptor: runtimeRunner,
      environment: input.environment ?? null, compilerCache: compilerCachePolicy(input) });
    if (!located.ok) {

      return unavailable(resolved, located.code, { failure: "configured_runtime_not_ready",
        readiness_code: located.code, recovery: located.recovery,
        ...(located.kind === "route" ? { route: located.detail }
          : located.kind === "runtime" ? { route: located.route, ...located.detail } : {}) },
      input.executionBudget);
    }
    const { runtime, route, cache } = located;
    const providerAssetDigest = assetDigest(spec);
    const inputsDigest = runtimeInputsDigest(runtime, providerAssetDigest);
    return brandPreparedRuntime({
      schema_version: "workspace-agent-test-proof-native-preparation.v1",
      status: "prepared",
      provider_id: resolved.provider_id,
      provider_version: resolved.provider_version,
      selector_kind: spec.selector_kind,
      project: located.project,
      runtime: Object.freeze({
        runtime_source: "launcher_readiness",
        runtime_runner: runtimeRunner.runner_id,
        project: located.project,
        environment: runtime.identity.environment,
        route,
        readiness_digest: runtime.identity.readiness_digest,
        provider_asset_digest: providerAssetDigest,
        runtime_inputs_digest: inputsDigest,
        dependency_population: Object.freeze({ source: "launcher_readiness",
          readiness_digest: runtime.identity.readiness_digest,
          environment: runtime.identity.environment,
          route,
          toolchains: runtime.identity.toolchains,
          dependencies: runtime.identity.dependencies })
      }),
      runtime_inputs_digest: inputsDigest,
      consumer_compilation: "attempt_private",

      native_compiler_cache: Object.freeze({ choice: cache.choice,
        ...(cache.reason === undefined ? {} : { reason: cache.reason }) })
    });
  }

  function attemptResult(mode, { observation, run, resolved, provider }) {
    const artifacts = Object.freeze(observation?.artifacts ?? []);
    if (mode === "candidate") return candidateResult({ observation, run, artifacts, provider });
    if (mode === "falsifier") return falsifierResult({ observation, run, artifacts, provider });
    return traversalResult({ observation, run, artifacts, provider, selection: resolved.selection });
  }

  async function execute(resolved, input, selectedTest) {
    const prepared = assertPreparedRuntime(input.preparedRuntime, resolved);
    const worktree = launcherResolvedWorktree(input);
    const mode = CAPABILITY_MODES[resolved.capability];
    const provider = providerEvidence(resolved, resolved.capability);
    const native = resolveNativeTestSelector({ provider_id: selectedTest.provider_id,
      provider_version: selectedTest.provider_version, node_id: selectedTest.node_id },
    { path: selectedTest.file });
    if (!native.valid || native.selector_kind !== spec.selector_kind) fail(
      TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.CAPABILITY_MISMATCH,
      "the selected test belongs to another provider family");
    const selection = resolved.selection ?? {};
    const moduleRelative = mode === "falsifier" ? selection.mutation.module_path
      : mode === "traversal" ? selection.module_path : null;
    const nonce = randomBytes(32).toString("hex");
    let provenance = null;
    let composed = false;

    const compose = async ({ runtime, project, cache, projectDir, executionRoot }) => {
      composed = true;

      const providerAssetDigest = assetDigest(spec);
      if (project !== prepared.project || providerAssetDigest !== prepared.runtime.provider_asset_digest ||
          runtime.identity.environment !== prepared.runtime.environment) {
        throw Object.assign(new Error("the native provider or its routed environment changed after preparation"), {
          code: "test_proof_native_runtime_inputs_stale",
          detail: { provider_asset_digest: { expected: prepared.runtime.provider_asset_digest,
            actual: providerAssetDigest },
          environment: { expected: prepared.runtime.environment, actual: runtime.identity.environment },
          project: { expected: prepared.project, actual: project } } });
      }
      const currentDigest = runtimeInputsDigest(runtime, providerAssetDigest);
      provenance = runtimeProvenanceSincePreparation(prepared, runtime, currentDigest);
      const privateRoot = path.join(executionRoot.scratch, ".launcher-test-proof");
      const configPath = path.join(privateRoot, "config.json");
      const channelPath = path.join(privateRoot, "channel.jsonl");

      const copiedSource = spec.runtime_runner === "go-test"
        ? null : copyProofSource({
          plan: planProofSourceCopy(worktree, { repositoryRoot: input.authority.main_repo }),
          destinationRoot: path.join(executionRoot.scratch, "proof-source") });
      const workRoot = copiedSource?.destinationRoot ?? worktree;
      const workProject = project === "." ? workRoot : path.join(workRoot, project);
      const attempt = Object.freeze({
        ...attemptFacts({ mode, worktree, workRoot, project, projectHost: workProject, runtime, selectedTest,
          test: native.selection.title_path ?? native.selection.identifier_path, moduleRelative }),
        nonce,
        workProject,
        privateRoot,
        configPath,
        channelPath,

        compilerCache: cache.directory,
        mutation: mode === "falsifier" ? { function_name: selection.mutation.function_name,
          replacement: selection.mutation.replacement } : null
      });
      if (moduleRelative !== null && !family.source_suffixes.some((suffix) =>
        moduleRelative.endsWith(suffix))) {
        refuseAttempt("test_proof_native_selection_unsupported",
          "the declared module is not a source of this provider family", { path: moduleRelative });
      }
      const layout = await spec.layout(attempt);
      const instrumentation = await spec.instrument(attempt, layout);

      const config = {
        schema_version: OBSERVER_CONFIG_SCHEMA_VERSION,
        nonce,
        channel: channelPath,
        repository_root: workRoot,
        project_directory: workProject,
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
        runtime_inputs_digest: currentDigest,
        worktree,
        ...(mode === "falsifier" ? {
          mutation_id: selection.mutation.mutation_id,
          failure_reason_code: FALSIFIER_REASON_CODE,
          observation_seam: falsifierDescriptor.observation_seams[0]
        } : {}),
        ...(mode === "traversal" ? { observation_seam: selection.observation_seam } : {}),
        ...(moduleFacts === null ? {} : { instrumentation: moduleFacts })
      };
      return {
        proof: spec.proof(attempt, layout),
        additions: {
          env: { [OBSERVER_CONFIG_ENV]: configPath },
          directories: [privateRoot],
          observerConfig: { path: configPath, value: config },
          writes: instrumentation.writes ?? [],
          ...(copiedSource === null ? {} : { copyRoot: copiedSource.destinationRoot }),
          channel: { kind: "file", path: channelPath },
          readOnlyBinds: spec.assets.map((asset) => ({ src: asset, dst: asset }))
        },
        nativeReport: typeof spec.report === "function" ? () => spec.report(attempt, layout) : null,

        observe: { open: () => openNativeObservation({ expectation }) }
      };
    };
    let run;
    try {
      run = await runDeclaredTest(input, mintProviderExecution(resolved, {
        runner: spec.runtime_runner,
        environment: input.environment ?? null,
        targetExtensions,
        stage: mintProofStage({ compilerCache: compilerCachePolicy(input), compose })
      }));
    } catch (error) {
      if (!(error instanceof SourceInstrumentationError) && !(error instanceof NativeAttemptRefusal) &&
          !(typeof error?.code === "string" && error.code.startsWith("test_runtime_"))) throw error;
      const detail = error instanceof SourceInstrumentationError
        ? { reason: error.reason, ...error.detail } : error.detail ?? null;
      return attemptResult(mode, { resolved, provider,
        observation: { valid: false, code: error.code, detail },
        run: refusedRun(error.code, detail) });
    }

    if (!composed && run.ran === false && run.runner_execution?.status === "refused" &&
        typeof run.blocker_code === "string" && run.blocker_code.startsWith("test_runtime_")) {
      fail(TEST_PROOF_PROVIDER_REGISTRY_ERROR_CODES.EXECUTION_UNTRUSTED,
        "the prepared native runtime can no longer be resolved",
        { failure: "configured_runtime_not_ready", readiness_code: run.blocker_code,
          ...(run.test_proof_observation?.detail ?? {}) });
    }
    run = withRuntimeProvenance(run, provenance);
    return attemptResult(mode, { observation: run.test_proof_observation, run, resolved, provider });
  }

  return Object.freeze({ family_id: spec.family_id, prepare, execute,
    describe: () => Object.freeze({ family_id: spec.family_id,
      runtime_runner: spec.runtime_runner, assets: [...spec.assets],
      candidate_provider: catalogDescriptor(candidateDescriptor.provider_id)?.provider_id ?? null }) });
}
