import { SETUP_PARAMETER_ADAPTERS } from './parameter-adapters.mjs';
import { normalizeSetupParameter, parseSetupParameterInputs } from './parameter-inputs.mjs';

export async function resolveSetupParameters({ required, parameters, saved,
  runtimeConfig, locatePathToolchains, findOnPath, env, prompt, output, context }) {
  const inputs = parameters ?? parseSetupParameterInputs();
  const savedConfig = saved.present ? saved : { toolchains: {}, environments: {} };
  const resolved = Object.fromEntries(['toolchains', 'environments'].map((target) =>
    [target, { ...savedConfig[target], ...inputs.environment[target], ...inputs.cli[target] }]));
  const toolchains = {};
  for (const name of required) {
    Object.assign(context, { phase: 'toolchain', toolchain: name });
    const adapter = SETUP_PARAMETER_ADAPTERS.find((entry) => entry.target === 'toolchains' && entry.parameter === name);
    let entry = resolved.toolchains[name];
    let source = inputs.cli.toolchains[name] ? adapter.option
      : inputs.environment.toolchains[name] ? adapter.environment
        : runtimeConfig === null ? 'agent-chassis-runtime.json' : '--runtime-config';
    if (entry === undefined && locatePathToolchains) {
      const located = findOnPath(adapter.command, env.PATH);
      if (located !== null) { entry = { executable: located.real, version: null }; source = 'PATH'; }
    }
    if (entry === undefined && !locatePathToolchains) continue;
    if (entry === undefined) {
      const answer = await prompt(adapter);
      if (!answer.ok) return answer;

      try {
        entry = normalizeSetupParameter(adapter, name, answer.executable, answer.source).toolchains[name];
      } catch (error) {
        if (error.code !== 'setup_parameter_invalid') throw error;
        output.write(`${error.message}\n`);
        return { ok: false, status: 'unresolved', phase: 'toolchain',
          failure: { code: error.code, message: error.message, detail: error.detail },
          correction: error.detail.correction };
      }
      source = answer.source;
    }
    toolchains[name] = { ...entry, version: savedConfig.toolchains[name]?.version ?? null };
    output.write(`Toolchain ${name}: ${entry.executable} (${source})\n`);
  }

  Object.assign(toolchains, runtimeConfig?.toolchains);
  return { ok: true, toolchains, environments: resolved.environments,
    savedToolchains: { ...savedConfig.toolchains, ...toolchains } };
}
