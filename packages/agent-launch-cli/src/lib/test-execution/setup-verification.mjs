

import { TOOLCHAIN_RECIPES } from "../test-runtime-setup/recipes.mjs";
import { runConfinedInvocation } from "./confined-invocation.mjs";
import { resolveInstalledRunnerIntegration } from "./runner-integrations.mjs";
import { resolveRunnerRuntimeInputs } from "./runtime-inputs.mjs";

const PROBE_TIMEOUT_MS = 120000;

function tail(text, limit = 2000) {
  return text.length <= limit ? text : `...${text.slice(-limit)}`;
}

async function probe({ checkout, runtime, invocation }) {
  const invoked = await runConfinedInvocation({ checkout, runtime, invocation,
    timeoutMs: PROBE_TIMEOUT_MS });
  if (invoked.status !== "completed") {
    return { ok: false, code: invoked.code ?? `sandbox_probe_${invoked.status}`,
      diagnostic: invoked.error?.message ?? null };
  }
  const { capture, driver } = invoked;
  const ok = driver?.phase === "exited" && driver.exit_code === 0 && !capture.timedOut;
  return { ok, code: ok ? null : "test_runtime_sandbox_visibility_failed",
    exit_code: driver?.exit_code ?? null, driver_phase: driver?.phase ?? null,
    stdout: capture.stdout.text, diagnostic: ok ? null : tail(`${capture.stderr.text}\n${capture.stdout.text}`.trim()) };
}

export async function verifyCandidateReadiness({ repositoryRoot, candidateRecord, selection }) {
  const outcomes = [];
  const versionChecked = new Set();
  for (const { descriptor, project } of selection) {
    const runtime = resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot: repositoryRoot,
      descriptor, project, candidateRecord });
    if (!runtime.ok) {
      outcomes.push({ provider_id: descriptor.runner_id, project, check: "runtime_inputs",
        ok: false, code: runtime.code, diagnostic: runtime.message });
      continue;
    }
    for (const name of descriptor.toolchains) {
      if (versionChecked.has(`${name}\0${project}`)) continue;
      versionChecked.add(`${name}\0${project}`);
      const recipe = TOOLCHAIN_RECIPES[name];
      const toolchain = candidateRecord.toolchains[name];
      const result = await probe({ checkout: repositoryRoot, runtime, invocation: {
        command: runtime.executables[recipe.probe.executable] ?? toolchain.executables[recipe.probe.executable],
        args: [...recipe.probe.args], cwd: runtime.projectDir,
        env: toolchain.executables.rustc ? { RUSTC: toolchain.executables.rustc } : {} } });
      const observed = result.ok ? recipe.probe.version(result.stdout.trim()) : null;
      const ok = result.ok && observed === toolchain.version;
      outcomes.push({ provider_id: descriptor.runner_id, project, check: `toolchain:${name}`,
        ok, code: ok ? null : result.ok ? "test_runtime_version_mismatch" : result.code,
        observed_version: observed, expected_version: toolchain.version,
        diagnostic: ok ? null : result.diagnostic });
    }
    const integration = resolveInstalledRunnerIntegration(descriptor);
    let invocation;
    try {
      invocation = integration.setupProbe({ runtime, projectDir: runtime.projectDir });
    } catch (error) {
      outcomes.push({ provider_id: descriptor.runner_id, project, check: "runner", ok: false,
        code: error?.code ?? "test_runtime_runner_probe_failed", diagnostic: error?.message ?? null });
      continue;
    }
    const result = await probe({ checkout: repositoryRoot, runtime, invocation });
    outcomes.push({ provider_id: descriptor.runner_id, project, check: "runner", ok: result.ok,
      code: result.ok ? null : result.code, diagnostic: result.diagnostic });
  }
  return outcomes;
}
