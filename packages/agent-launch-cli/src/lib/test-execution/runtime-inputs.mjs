

import path from "node:path";

import { DEFAULT_SYSTEM_READ_ONLY_ROOTS } from "../launch-isolation.mjs";
import { ATTEMPT_SCRATCH_ROOT, DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import {
  TEST_RUNTIME_READINESS_CODES,
  loadReadiness,
  resolveReadyRunnerInputs
} from "../test-runtime-setup/readiness.mjs";

export const ATTEMPT_HOME = `${ATTEMPT_SCRATCH_ROOT}/home`;
export const ATTEMPT_WORK_ROOT = `${ATTEMPT_SCRATCH_ROOT}/work`;

export function isUnderSystemRoot(absolute) {
  return DEFAULT_SYSTEM_READ_ONLY_ROOTS.some((root) =>
    absolute === root || absolute.startsWith(`${root}/`));
}

function uniqueBinds(binds) {
  const seen = new Set();
  return binds.filter(({ src, dst }) => {
    const key = `${src}\0${dst}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot, descriptor, project,
  candidateRecord = null, workProjectDir = null, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
  const ready = resolveReadyRunnerInputs({ repositoryRoot, checkoutRoot, descriptor, project,
    candidateRecord });
  if (!ready.ok) return ready;
  const binds = [];
  const binDirs = [];
  const executables = {};
  const toolchainIdentity = {};
  for (const [name, toolchain] of Object.entries(ready.toolchains)) {
    Object.assign(executables, toolchain.executables);
    for (const executable of Object.values(toolchain.executables)) {
      const directory = path.dirname(executable);
      if (!binDirs.includes(directory)) binDirs.push(directory);
    }
    const roots = toolchain.root && !isUnderSystemRoot(toolchain.root) ? [toolchain.root] : [];
    for (const root of roots) binds.push({ src: root, dst: root });
    toolchainIdentity[name] = { version: toolchain.version, source: toolchain.source,
      content_digest: toolchain.content_digest };
  }
  const ecosystem = DEPENDENCY_ECOSYSTEMS[descriptor.dependency_ecosystem];
  let binding = { binds: [], mountpoints: [], links: [], env: {}, values: {} };
  if (ready.preparation.status === "present") {
    binding = workProjectDir !== null && typeof ecosystem.workingCopyBinding === "function"
      ? ecosystem.workingCopyBinding({ preparedDir: ready.preparation.dir, workProjectDir, scratchRoot })
      : ecosystem.runtimeBinding({ preparedDir: ready.preparation.dir,
        projectHostDir: ready.projectDir, scratchRoot });
  }
  binds.push(...binding.binds);
  if (binding.values.python) {
    executables.python = binding.values.python;
    binDirs.unshift(path.dirname(binding.values.python));
  }
  const env = {
    PATH: [...binDirs, "/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter),
    HOME: `${scratchRoot}/home`,
    LANG: "C.UTF-8",
    CI: "true",
    ...binding.env
  };
  return Object.freeze({
    ok: true,
    binds: uniqueBinds(binds),
    mountpoints: binding.mountpoints,
    links: binding.links ?? [],
    env,
    executables,
    values: binding.values,
    scratchRoot,
    projectDir: ready.projectDir,
    identity: Object.freeze({
      readiness_digest: ready.readiness_digest,
      toolchains: toolchainIdentity,
      dependencies: Object.freeze({
        ecosystem: ready.preparation.ecosystem,
        status: ready.preparation.status,
        inputs_digest: ready.preparation.inputs_digest,
        content_digest: ready.preparation.content_digest ?? null
      })
    })
  });
}

export function resolveConfiguredRunnerProject({ repositoryRoot, target, runner }) {
  const loaded = loadReadiness(repositoryRoot);
  if (!loaded.ok) {
    return loaded.code === TEST_RUNTIME_READINESS_CODES.NOT_READY
      ? { configured: false, failure: loaded } : { configured: true, ok: false, failure: loaded };
  }
  const projects = loaded.record.selection
    .filter(({ provider_id: id }) => id === runner.runner_id)
    .map(({ project }) => project)
    .filter((project) => project === "." || target.startsWith(`${project}/`))
    .sort((left, right) => right.length - left.length);
  return projects.length === 0 ? { configured: false, failure: null }
    : { configured: true, ok: true, project: projects[0] };
}

export function resolveConfiguredPytestRuntime({ repositoryRoot, checkoutRoot, target, runner }) {
  const located = resolveConfiguredRunnerProject({ repositoryRoot, target, runner });
  if (!located.configured) return { configured: false };
  if (!located.ok) return located;
  const runtime = resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot, descriptor: runner,
    project: located.project });
  if (!runtime.ok) return { configured: true, ok: false, failure: runtime };
  return { configured: true, ok: true, project: located.project,
    interpreter: runtime.executables.python, readiness_digest: runtime.identity.readiness_digest,
    read_only_binds: runtime.binds,
    dependency_roots: runtime.values.venv === undefined ? [] : [runtime.values.venv] };
}
