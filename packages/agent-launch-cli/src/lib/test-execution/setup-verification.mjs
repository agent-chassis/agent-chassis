

import { ATTEMPT_SCRATCH_ROOT, DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import { TOOLCHAIN_RECIPES } from "../test-runtime-setup/recipes.mjs";
import { runConfinedInvocation } from "./confined-invocation.mjs";
import { resolveInstalledRunnerIntegration } from "./runner-integrations.mjs";
import { resolveEnvironmentRuntimeInputs, workingCopyProjectDir } from "./runtime-inputs.mjs";
import { selectWorkingCopySource } from "./source-selection.mjs";

const PROBE_TIMEOUT_MS = 120000;

function tail(text, limit = 2000) {
  return text.length <= limit ? text : `...${text.slice(-limit)}`;
}

async function probe({ checkout, runtime, invocation }) {
  const invoked = await runConfinedInvocation({ checkout, runtime, invocation, timeoutMs: PROBE_TIMEOUT_MS });
  if (invoked.status !== "completed") {
    return { ok: false, code: invoked.code ?? `sandbox_probe_${invoked.status}`,
      diagnostic: invoked.error?.message ?? null };
  }
  const { capture, driver } = invoked;
  const ok = driver?.phase === "exited" && driver.exit_code === 0 && !capture.timedOut;
  return { ok, code: ok ? null : "test_runtime_sandbox_visibility_failed",
    exit_code: driver?.exit_code ?? null, driver_phase: driver?.phase ?? null,
    stdout: capture.stdout.text, diagnostic: ok ? null
      : tail([driver?.error, capture.stderr.text, capture.stdout.text].filter(Boolean).join("\n").trim()) };
}

const within = (directory, candidate) => typeof candidate === "string" &&
  (candidate === directory || candidate.startsWith(`${directory}/`));

export async function planEnvironmentProbes({ repositoryRoot, candidateRecord, environment }) {
  const { ecosystem, project, descriptors } = environment;
  const workingCopy = typeof DEPENDENCY_ECOSYSTEMS[ecosystem].workingCopyBinding === "function"
    ? workingCopyProjectDir(ATTEMPT_SCRATCH_ROOT, project) : null;
  const runtime = resolveEnvironmentRuntimeInputs({ repositoryRoot, checkoutRoot: repositoryRoot,
    ecosystem, project, candidateRecord, workProjectDir: workingCopy });
  if (!runtime.ok) return { ok: false, code: runtime.code, diagnostic: runtime.message };
  const projectDir = workingCopy ?? runtime.projectDir;
  let selection = null;
  const inProject = async (invocation) => {
    if (workingCopy === null || !within(workingCopy, invocation.cwd)) return { invocation };
    selection ??= await selectWorkingCopySource(runtime.projectDir);
    if (!selection.ok) {
      return { failure: { code: selection.code, diagnostic: `${selection.message}\n${selection.recovery}` } };
    }
    return { invocation: { ...invocation,
      directories: [...(invocation.directories ?? []), ...runtime.directories],
      copies: [{ from: runtime.projectDir, to: workingCopy, entries: selection.entries }],
      links: runtime.links } };
  };
  const probes = [];
  for (const name of Object.keys(runtime.toolchains).sort()) {
    const recipe = TOOLCHAIN_RECIPES[name];
    const toolchain = candidateRecord.toolchains[name];

    probes.push({ provider_id: null, check: `toolchain:${name}`, toolchain: name, ...await inProject({
      command: runtime.executables[recipe.probe.executable] ?? toolchain.executables[recipe.probe.executable],
      args: [...recipe.probe.args], cwd: runtime.projectDir,
      env: toolchain.executables.rustc ? { RUSTC: toolchain.executables.rustc } : {} }) });
  }
  for (const descriptor of descriptors) {
    const integration = resolveInstalledRunnerIntegration(descriptor);
    let invocation;
    try {
      invocation = integration.setupProbe({ runtime, projectDir });
    } catch (error) {
      probes.push({ provider_id: descriptor.runner_id, check: "runner", failure: {
        code: error?.code ?? "test_runtime_runner_probe_failed", diagnostic: error?.message ?? null } });
      continue;
    }
    probes.push({ provider_id: descriptor.runner_id, check: "runner", ...await inProject(invocation) });
  }
  return { ok: true, checkout: repositoryRoot, runtime, probes };
}

export async function verifyCandidateReadiness({ repositoryRoot, candidateRecord, environments,
  progress = () => {} }) {
  const outcomes = [];
  for (const environment of environments) {
    const { id, project } = environment;
    const row = (providerId, check, fields) => outcomes.push({ environment: id, provider_id: providerId,
      project, check, ...fields });
    progress({ phase: "sandbox_plan", environment: id });
    const planned = await planEnvironmentProbes({ repositoryRoot, candidateRecord, environment });
    if (!planned.ok) {
      row(null, "runtime_inputs", { ok: false, code: planned.code, diagnostic: planned.diagnostic });
      continue;
    }
    for (const step of planned.probes) {
      const { provider_id: providerId, check, toolchain: name } = step;
      progress({ phase: "sandbox_check", environment: id, check: providerId ?? check });
      const result = step.failure !== undefined ? { ok: false, ...step.failure }
        : await probe({ checkout: planned.checkout, runtime: planned.runtime, invocation: step.invocation });
      if (name === undefined) {
        row(providerId, check, { ok: result.ok, code: result.ok ? null : result.code,
          diagnostic: result.diagnostic });
        continue;
      }
      const recipe = TOOLCHAIN_RECIPES[name];
      const toolchain = candidateRecord.toolchains[name];
      const observed = result.ok ? recipe.probe.version(result.stdout.trim()) : null;
      const ok = result.ok && observed === toolchain.version;
      row(null, check, { ok, code: ok ? null : result.ok ? "test_runtime_version_mismatch" : result.code,
        observed_version: observed, expected_version: toolchain.version,
        diagnostic: ok ? null : result.diagnostic });
    }
  }
  return outcomes;
}
