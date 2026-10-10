

import { existsSync } from "node:fs";
import path from "node:path";

import { readRepositoryRuntimeConfig, repositoryRuntimeConfigPath } from "../test-runtime-setup/config.mjs";
import { ATTEMPT_SCRATCH_ROOT } from "../test-runtime-setup/ecosystems.mjs";
import { locateEnvironmentInputs } from "../test-runtime-setup/index.mjs";
import { readinessRecovery, testRuntimeEnvironmentId } from "../test-runtime-setup/readiness.mjs";
import { resolveEnvironmentRuntimeInputs, resolveProofEnvironment, resolveRunnerRuntimeInputs,
  workingCopyProjectDir } from "./runtime-inputs.mjs";

export const RUNTIME_CONFIGURATION_INVALID_CODE = "test_runtime_configuration_invalid";

function locationFailure(code, message, detail) {
  return Object.freeze({ ok: false, code, message, detail: { ...detail, authority_limb: "mechanical" },
    recovery: readinessRecovery() });
}

async function locate({ repositoryRoot, checkoutRoot, request, env }) {
  let saved;
  try {
    saved = readRepositoryRuntimeConfig(repositoryRoot);
  } catch (error) {
    return locationFailure(RUNTIME_CONFIGURATION_INVALID_CODE, error.message,
      { file: repositoryRuntimeConfigPath(repositoryRoot),
        correction: "correct or remove the saved runtime configuration; its locations are never ignored" });
  }
  const { ecosystem, project, members, toolchainNames, known } = request;

  const [root] = [repositoryRoot, checkoutRoot].filter((candidate) =>
    existsSync(project === "." ? candidate : path.join(candidate, project)));
  const base = root ?? checkoutRoot;
  const id = testRuntimeEnvironmentId({ ecosystem, project });
  const located = await locateEnvironmentInputs({ repositoryRoot: base,
    projectDir: project === "." ? base : path.join(base, project), ecosystem, project, members, toolchainNames,
    known, toolchainExecutables: Object.fromEntries(Object.entries(saved.present ? saved.toolchains : {})
      .map(([name, { executable }]) => [name, executable])),
    selection: (saved.present ? saved.environments[id] : undefined) ?? null, env });
  if (located.ok) return located;
  return locationFailure(located.code, located.message,
    { ...(located.detail ?? {}), environment: id,
      component: located.kind, ...(located.name === undefined ? {} : { toolchain: located.name }) });
}

async function resolveLocating(resolve, { repositoryRoot, checkoutRoot, env }) {
  const configured = resolve(null);
  if (configured.ok || configured.locate === undefined) return configured;
  const inputs = await locate({ repositoryRoot, checkoutRoot, request: configured.locate, env });
  return inputs.ok ? resolve(inputs) : inputs;
}

export async function resolveCurrentRunnerRuntime({ repositoryRoot, checkoutRoot, target, runner,
  environment = null, unconfigured = "discover", workingCopy = false, scratchRoot = ATTEMPT_SCRATCH_ROOT,
  compilerCache = false, env = process.env }) {
  const located = resolveProofEnvironment({ repositoryRoot, checkoutRoot, target, runner, environment,
    unconfigured });
  if (!located.configured || !located.ok) return { located, runtime: null };
  const runtime = await resolveLocating((inputs) => resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot,
    descriptor: runner, project: located.project, located: inputs, scratchRoot, compilerCache,
    workProjectDir: workingCopy ? workingCopyProjectDir(scratchRoot, located.project) : null }),
  { repositoryRoot, checkoutRoot, env });
  return { located, runtime };
}

export function resolveCurrentEnvironmentRuntime({ repositoryRoot, checkoutRoot, ecosystem, project,
  scratchRoot = ATTEMPT_SCRATCH_ROOT, env = process.env }) {
  return resolveLocating((inputs) => resolveEnvironmentRuntimeInputs({ repositoryRoot, checkoutRoot, ecosystem,
    project, located: inputs, scratchRoot }), { repositoryRoot, checkoutRoot, env });
}
