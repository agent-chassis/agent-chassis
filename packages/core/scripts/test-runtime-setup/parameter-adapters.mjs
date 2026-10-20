
import { TOOLCHAIN_RECIPES } from
  '@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/recipes.mjs';

export const SETUP_PARAMETER_ADAPTERS = Object.freeze([
  ...Object.entries(TOOLCHAIN_RECIPES).map(([name, recipe]) => Object.freeze({
    parameter: name, option: '--executable', environment: `AGENT_CHASSIS_${name.toUpperCase()}_EXECUTABLE`,
    target: 'toolchains', keyed: true,
    example: `${name}=/absolute/path/to/${recipe.host_command}`,
    environmentExample: `/absolute/path/to/${recipe.host_command}`,
    prompt: `Absolute path to ${recipe.host_command} (blank to abort): `,
    command: recipe.host_command,
    partial: (key, value) => ({ toolchains: { [key]: { executable: value } } })
  })),
  Object.freeze({ parameter: 'python-environment', option: '--python-environment',
    environment: 'AGENT_CHASSIS_PYTHON_ENVIRONMENTS', target: 'environments', keyed: false,
    example: '.=/absolute/path/to/venv', environmentExample: '\'{".":"/absolute/path/to/venv"}\'',
    partial: (project, value, { testRuntimeEnvironmentId }) => ({ environments: {
      [testRuntimeEnvironmentId({ ecosystem: 'python', project })]: { virtual_environment: value }
    } }) })
]);

export const SETUP_PARAMETER_HELP = `  --executable <toolchain>=<absolute-path> (repeatable, one per toolchain)
                                keys: ${SETUP_PARAMETER_ADAPTERS.filter(adapter => adapter.target === "toolchains").map(adapter => adapter.parameter).join(", ")}
  --python-environment <project>=<absolute-venv-path> (repeatable; root is '.')
  --non-interactive             suppress all setup questions
Adapter environment inputs:
${SETUP_PARAMETER_ADAPTERS.map(({ environment, environmentExample }) => `  ${environment}=${environmentExample}`).join('\n')}
Locations resolve per key: CLI > adapter environment > saved configuration > detection.
Runtime-only setup never prompts. Supplied choices are saved when all toolchains
are ready; dry runs and --runtime-config never save. --runtime-config excludes
--runner, --toolchain, --executable and --python-environment and ignores adapter
environment variables with a notice.`;
