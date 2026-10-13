

import { existsSync } from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { readRepositoryRuntimeConfig, repositoryRuntimeConfigPath } from "../test-runtime-setup/config.mjs";
import { discoverRepositoryEnvironments } from "../test-runtime-setup/discovery.mjs";
import { ATTEMPT_SCRATCH_ROOT, DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import { locateEnvironmentInputs } from "../test-runtime-setup/index.mjs";
import { npmInstallationTrees, npmPreparationFields } from "../test-runtime-setup/npm-installation.mjs";
import { loadExecutionConfiguration, measureProjectInputs, readinessRecovery, recordedEnvironment,
  testRuntimeEnvironmentId } from "../test-runtime-setup/readiness.mjs";
import { TestRuntimeSetupError } from "../test-runtime-setup/toolchains.mjs";
import { resolveEnvironmentRuntimeInputs, resolveProofEnvironment, resolveRunnerRuntimeInputs,
  workingCopyProjectDir } from "./runtime-inputs.mjs";

export const RUNTIME_CONFIGURATION_INVALID_CODE = "test_runtime_configuration_invalid";

function locationFailure(code, message, detail) {
  return Object.freeze({ ok: false, code, message, detail: { ...detail, authority_limb: "mechanical" },
    recovery: readinessRecovery() });
}

function locationBase({ repositoryRoot, checkoutRoot, project }) {
  const [root] = [repositoryRoot, checkoutRoot].filter((candidate) =>
    existsSync(project === "." ? candidate : path.join(candidate, project)));
  return root ?? checkoutRoot;
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

  const base = locationBase({ repositoryRoot, checkoutRoot, project });
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
  compilerCache = false, hostPath = undefined, env = process.env }) {
  const located = resolveProofEnvironment({ repositoryRoot, checkoutRoot, target, runner, environment,
    unconfigured });
  if (!located.configured || !located.ok) return { located, runtime: null };
  const runtime = await resolveLocating((inputs) => resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot,
    descriptor: runner, project: located.project, located: inputs, scratchRoot, compilerCache,
    workProjectDir: workingCopy ? workingCopyProjectDir(scratchRoot, located.project) : null,
    hostPath }),
  { repositoryRoot, checkoutRoot, env });
  return { located, runtime };
}

export function resolveCurrentEnvironmentRuntime({ repositoryRoot, checkoutRoot, ecosystem, project,
  scratchRoot = ATTEMPT_SCRATCH_ROOT, env = process.env }) {
  return resolveLocating((inputs) => resolveEnvironmentRuntimeInputs({ repositoryRoot, checkoutRoot, ecosystem,
    project, located: inputs, scratchRoot }), { repositoryRoot, checkoutRoot, env });
}

export function selectNpmDependency({ repositoryRoot, checkoutRoot, project }) {
  const ecosystem = "npm";
  const { configuration } = loadExecutionConfiguration(repositoryRoot);
  const configured = (configuration.preparations ?? []).find((entry) =>
    entry.ecosystem === ecosystem && entry.project === project) ?? null;
  if (configured !== null) return configured;
  try {
    readRepositoryRuntimeConfig(repositoryRoot);
  } catch {
    return null;
  }
  const id = testRuntimeEnvironmentId({ ecosystem, project });
  const members = recordedEnvironment(configuration, { ecosystem, project })?.members ??
    discoverRepositoryEnvironments(checkoutRoot, TEST_RUNTIME_RUNNER_CATALOG.runners,
      { targets: [project === "." ? "." : `${project}/member`] }).find((entry) => entry.id === id)?.members ?? [];
  const base = locationBase({ repositoryRoot, checkoutRoot, project });
  const projectDir = project === "." ? base : path.join(base, project);
  const without = (status) => Object.freeze({ ecosystem, project, members, status, workspace_links: [] });
  try {
    if (measureProjectInputs(ecosystem, projectDir, { members, checkoutRoot: base }).status === "none") {
      return without("none");
    }
    const located = DEPENDENCY_ECOSYSTEMS.npm.locate({ projectDir, members });
    if (located.absent === true) return without("absent");
    return Object.freeze({ ecosystem, project, members, status: "present", source: located.source,
      dir: located.dir, ...npmPreparationFields(located) });
  } catch (error) {
    if (!(error instanceof TestRuntimeSetupError)) throw error;
    return null;
  }
}

export function selectNpmDependencyTree({ repositoryRoot, checkoutRoot, directory }) {
  const at = (project, owner) => owner === "." ? project : project === "." ? owner : `${project}/${owner}`;
  const treeOf = (project) => {
    const dependency = selectNpmDependency({ repositoryRoot, checkoutRoot, project });
    const tree = npmInstallationTrees(dependency).find(({ owner }) => at(project, owner) === directory);
    return tree === undefined ? null : { dependency, project, tree };
  };
  const { configuration } = loadExecutionConfiguration(repositoryRoot);
  const owners = [...(configuration.environments ?? []),
    ...(directory === "." ? [] : discoverRepositoryEnvironments(checkoutRoot, TEST_RUNTIME_RUNNER_CATALOG.runners,
      { targets: [`${directory}/package.json`] }))]
    .filter((entry) => entry.ecosystem === "npm" && entry.project !== directory &&
      (entry.members ?? []).some((member) => at(entry.project, member) === directory));
  for (const project of new Set(owners.map((entry) => entry.project))) {
    const selected = treeOf(project);
    if (selected !== null) return selected;
  }
  return treeOf(directory);
}
