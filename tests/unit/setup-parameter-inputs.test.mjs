import assert from 'node:assert/strict';
import test from 'node:test';
import { SETUP_PARAMETER_ADAPTERS } from '../../packages/core/scripts/test-runtime-setup/parameter-adapters.mjs';
import { optionValue, parseSetupParameterInputs, readSetupParameterOption } from '../../packages/core/scripts/test-runtime-setup/parameter-inputs.mjs';
import { resolveSetupParameters } from '../../packages/core/scripts/test-runtime-setup/parameter-resolution.mjs';

const ids = [];
const testRuntimeEnvironmentId = ({ ecosystem, project }) => { ids.push({ ecosystem, project }); return `${ecosystem}@${project}`; };
const parse = (options) => parseSetupParameterInputs({ testRuntimeEnvironmentId, ...options });
const cli = (option, value) => ({ option, value });
const refuses = (options, code, source, correction) => assert.throws(() => parse(options), error => {
  assert.equal(error.code, code);
  assert.equal(error.detail.source, source);
  assert.equal(error.detail.correction, correction);
  return true;
});

test('registered transport accepts shared option values and submits partial config shapes', () => {
  assert.deepEqual(optionValue(['--value=x'], 0, '--value'), { value: 'x', next: 0 });
  assert.deepEqual(optionValue(['--value', 'x'], 0, '--value'), { value: 'x', next: 1 });
  const inputs = [];
  assert.equal(readSetupParameterOption(['--executable', 'python=/cli/python'], 0, inputs), 1);
  const pythonInputs = [];
  assert.equal(readSetupParameterOption(['--python-environment=.=/venv'], 0, pythonInputs), 0);
  assert.deepEqual(parse({ inputs: pythonInputs }).cli.environments, { 'python@.': { virtual_environment: '/venv' } });
  assert.throws(() => readSetupParameterOption(['--executable'], 0, []), { code: 'setup_parameter_invalid' });
  assert.equal(readSetupParameterOption(['--runner', 'pytest'], 0, inputs), null);
  const result = parse({ inputs, env: { AGENT_CHASSIS_PYTHON_ENVIRONMENTS: '{"services/api":"/env/api"}' } });
  assert.deepEqual(result.cli.toolchains.python, { executable: '/cli/python', version: null });
  assert.deepEqual(result.environment.environments, { 'python@services/api': { virtual_environment: '/env/api' } });
  assert.deepEqual(ids.at(-1), { ecosystem: 'python', project: 'services/api' });
  assert.deepEqual(SETUP_PARAMETER_ADAPTERS.filter(a => a.target === 'toolchains').map(a => a.parameter).sort(),
    ['deno', 'go', 'node', 'python', 'rust']);
});

test('explicit syntax and repeated keys fail before resolution even at losing tiers', () => {
  const pythonCorrection = '--python-environment .=/absolute/path/to/venv or AGENT_CHASSIS_PYTHON_ENVIRONMENTS=\'{".":"/absolute/path/to/venv"}\'';
  for (const value of ['{', '[]', 'null', '{".":3}', '{"/absolute":"/venv"}', '{".":"relative"}']) {
    refuses({ env: { AGENT_CHASSIS_PYTHON_ENVIRONMENTS: value } }, 'setup_parameter_invalid',
      'AGENT_CHASSIS_PYTHON_ENVIRONMENTS', pythonCorrection);
  }
  refuses({ inputs: [cli('--executable', 'node=/one'), cli('--executable', 'node=/two')] },
    'setup_parameter_duplicate', '--executable', 'supply --executable node=<absolute-path> exactly once');
  refuses({ inputs: [cli('--python-environment', '.=/one'), cli('--python-environment', '.=/two')] },
    'setup_parameter_duplicate', '--python-environment', 'supply --python-environment .=<absolute-path> exactly once');
  for (const value of ['unknown=/tool', 'node=relative', 'node', 'node=']) {
    assert.throws(() => parse({ inputs: [cli('--executable', value)] }), { code: 'setup_parameter_invalid' });
  }
  assert.throws(() => parse({ inputs: [cli('--executable', 'node=/good')],
    env: { AGENT_CHASSIS_NODE_EXECUTABLE: 'relative' } }), { code: 'setup_parameter_invalid' });
});

test('whole temporary config owns conflicts and ignores malformed ambient transports', () => {
  const result = parse({ runtimeConfig: 'temporary.json', env: {
    AGENT_CHASSIS_NODE_EXECUTABLE: 'relative', AGENT_CHASSIS_PYTHON_ENVIRONMENTS: 'bad' } });
  assert.deepEqual(result.ignored, ['AGENT_CHASSIS_NODE_EXECUTABLE', 'AGENT_CHASSIS_PYTHON_ENVIRONMENTS']);
  assert.deepEqual(result.environment, { toolchains: {}, environments: {} });
  for (const flag of ['--executable', '--python-environment']) {
    refuses({ runtimeConfig: 'temporary.json', inputs: [cli(flag, 'bad')] }, 'setup_parameter_conflict', flag,
      `remove ${flag} and use --runtime-config temporary.json alone, or remove --runtime-config`);
  }
  for (const flag of ['--runner', '--toolchain']) assert.throws(() => parse({ runtimeConfig: 'temporary.json',
    runners: flag === '--runner' ? [{ runner: 'pytest', project: '.' }] : [],
    toolchainVersions: flag === '--toolchain' ? { python: '3.14.0' } : {} }), { code: 'setup_parameter_conflict' });
});

test('Python precedence merges mixed project keys per environment ID and toolchains per name', async () => {
  const parameters = parse({ inputs: [cli('--executable', 'python=/cli/python'), cli('--python-environment', '.=/cli/root')],
    env: { AGENT_CHASSIS_PYTHON_EXECUTABLE: '/env/python', AGENT_CHASSIS_PYTHON_ENVIRONMENTS:
      '{".":"/env/root","services/api":"/env/api"}' } });
  const saved = { present: true, toolchains: { python: { executable: '/saved/python', version: '3.14.0' },
    node: { executable: '/saved/node', version: null } }, environments: {
    'python@.': { virtual_environment: '/saved/root' }, 'python@services/api': { virtual_environment: '/saved/api' },
    'python@worker': { virtual_environment: '/saved/worker' } } };
  const result = await resolveSetupParameters({ required: ['python'], parameters, saved, runtimeConfig: null,
    locatePathToolchains: true, findOnPath: () => assert.fail('explicit choice must win'), env: {},
    prompt: () => assert.fail('must not ask'), output: { write() {} }, context: {} });
  assert.deepEqual(result.toolchains, { python: { executable: '/cli/python', version: '3.14.0' } });
  assert.deepEqual(result.environments, { 'python@.': { virtual_environment: '/cli/root' },
    'python@services/api': { virtual_environment: '/env/api' }, 'python@worker': { virtual_environment: '/saved/worker' } });
  assert.deepEqual(result.savedToolchains.node, saved.toolchains.node);
});

test('prompt answers share parameter validation and retain their actual source', async () => {
  const options = { required: ['node'], saved: { present: false },
    runtimeConfig: null, locatePathToolchains: true, findOnPath: () => null, env: {},
    output: { write() {} }, context: {} };
  const failed = await resolveSetupParameters({ ...options,
    prompt: async () => ({ ok: true, executable: 'relative', source: 'your answer' }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'unresolved');
  assert.equal(failed.phase, 'toolchain');
  assert.equal(failed.failure.code, 'setup_parameter_invalid');
  assert.deepEqual(failed.failure.detail, { parameter: 'node', source: 'your answer',
    correction: '--executable node=/absolute/path/to/node or AGENT_CHASSIS_NODE_EXECUTABLE=/absolute/path/to/node' });
  assert.equal(failed.correction, failed.failure.detail.correction);
  const unrelated = new Error('input stream failed');
  await assert.rejects(resolveSetupParameters({ ...options, prompt: async () => { throw unrelated; } }),
    error => error === unrelated);
  const resolved = await resolveSetupParameters({ ...options,
    prompt: async () => ({ ok: true, executable: '/answer/node', source: 'your answer' }) });
  assert.deepEqual(resolved.toolchains, { node: { executable: '/answer/node', version: null } });
});
