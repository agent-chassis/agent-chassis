import { parseTestRuntimeConfig } from
  '@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/config.mjs';
import { SETUP_PARAMETER_ADAPTERS } from './parameter-adapters.mjs';

export function optionValue(argv, index, name) {
  const arg = argv[index];
  if (arg.startsWith(`${name}=`)) return { value: arg.slice(name.length + 1), next: index };
  if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return { value: argv[index + 1], next: index + 1 };
}

function refuse(code, parameter, source, cause, correction) {
  const error = new Error(`${code}: ${parameter} from ${source}: ${cause}. Correction: ${correction}`);
  Object.assign(error, { code, detail: { parameter, source, correction } });
  throw error;
}

function correction(adapter) {
  return `${adapter.option} ${adapter.example} or ${adapter.environment}=${adapter.environmentExample}`;
}

export function readSetupParameterOption(argv, index, inputs) {
  const option = argv[index].split('=')[0];
  const adapters = SETUP_PARAMETER_ADAPTERS.filter((entry) => entry.option === option);
  if (adapters.length === 0) return null;
  try {
    const { value, next } = optionValue(argv, index, option);
    inputs.push({ option, value });
    return next;
  } catch (error) {
    refuse('setup_parameter_invalid', option, option, error.message, correction(adapters[0]));
  }
}

export function normalizeSetupParameter(adapter, key, value, source, bindings = {}) {
  try {
    return parseTestRuntimeConfig(JSON.stringify(adapter.partial(key, value, bindings)), { source });
  } catch (error) {
    refuse('setup_parameter_invalid', key, source, error.message, correction(adapter));
  }
}

export function parseSetupParameterInputs({ inputs = [], env = {}, runtimeConfig = null,
  runners = [], toolchainVersions = {}, help = false, ...bindings } = {}) {
  if (!help && runtimeConfig !== null) {
    const flags = [...inputs.map(({ option }) => option),
      ...(runners.length ? ['--runner'] : []),
      ...(Object.keys(toolchainVersions).length ? ['--toolchain'] : [])];
    if (flags.length) refuse('setup_parameter_conflict', flags[0], flags[0],
      `--runtime-config cannot be combined with ${flags[0]}`,
      `remove ${flags[0]} and use --runtime-config ${runtimeConfig} alone, or remove --runtime-config`);
  }
  const ignored = runtimeConfig === null ? [] : SETUP_PARAMETER_ADAPTERS
    .filter(({ environment }) => env[environment] !== undefined).map(({ environment }) => environment);
  const tiers = { cli: { toolchains: {}, environments: {} },
    environment: { toolchains: {}, environments: {} }, ignored };
  const seen = new Set();
  for (const { option, value } of inputs) {
    const separator = value.indexOf('=');
    const key = separator < 0 ? '' : value.slice(0, separator);
    const adapters = SETUP_PARAMETER_ADAPTERS.filter((entry) => entry.option === option);
    const adapter = adapters.find((entry) => !entry.keyed || entry.parameter === key);
    if (separator < 0 || adapter === undefined) refuse('setup_parameter_invalid', key || option, option,
      'expected a declared key followed by =<absolute-path>', correction(adapters[0]));
    const identity = `${option}:${key}`;
    if (seen.has(identity)) refuse('setup_parameter_duplicate', key, option,
      'repeated CLI key', `supply ${option} ${key}=<absolute-path> exactly once`);
    seen.add(identity);
    Object.assign(tiers.cli[adapter.target],
      normalizeSetupParameter(adapter, key, value.slice(separator + 1), option, bindings)[adapter.target]);
  }
  if (runtimeConfig !== null) return tiers;
  for (const adapter of SETUP_PARAMETER_ADAPTERS) {
    const raw = env[adapter.environment];
    if (raw === undefined) continue;
    let entries;
    if (adapter.keyed) entries = [[adapter.parameter, raw]];
    else {
      try {
        const map = JSON.parse(raw);
        if (map === null || typeof map !== 'object' || Array.isArray(map)) throw new Error('expected one JSON object');
        entries = Object.entries(map);
      } catch (error) {
        refuse('setup_parameter_invalid', adapter.parameter, adapter.environment, error.message, correction(adapter));
      }
    }
    for (const [key, value] of entries) Object.assign(tiers.environment[adapter.target],
      normalizeSetupParameter(adapter, key, value, adapter.environment, bindings)[adapter.target]);
  }
  return tiers;
}

export function reportIgnoredSetupParameters(parameters, output) {
  if (parameters.ignored.length) output.write(`Ignored adapter variables because --runtime-config supplies the whole configuration: ${parameters.ignored.join(', ')}\n`);
}
