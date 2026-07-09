import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { computeNormalizedInputDigest } from './work-record-admission-shared.mjs';

const PACK_ID = 'worker_admission_v1';
const PROFILE_SCHEMA_VERSION = 'worker_admission.policy_profile.v1';
const DELIVERY_ENVELOPE_POLICY_PACK_ID = 'delivery_envelope_policy_v1';
const DELIVERY_ENVELOPE_POLICY_SCHEMA_VERSION = 'delivery-envelope-policy-profile.v1';

const CONTROL_SPECS = [
  { id: 'write_scope_count', deny: true },
  { id: 'write_scope_total_loc', deny: true },
  { id: 'max_write_file_loc', deny: true },
  { id: 'acceptance_criteria_count', deny: false },
  { id: 'validation_command_count', deny: false },
  { id: 'expected_changed_line_budget', deny: false },
  { id: 'declared_runtime_mode_count', deny: false },
  { id: 'artifact_kind_count', deny: false },
];

const ALLOWED_WAIVER_ALLOWABILITY = new Set([
  'reviewer_attestation',
  'accepted_authority',
]);

const DELIVERY_ENVELOPE_POLICY_METRICS = [
  'changed_line_count',
  'final_file_size',
  'changed_file_count',
  'scope_count',
];

const DELIVERY_ENVELOPE_POLICY_VALUE_KINDS = [
  'tolerance',
  'window',
];

const DELIVERY_ENVELOPE_POLICY_PARAMETER_VALUE_KEYS = new Set(
  DELIVERY_ENVELOPE_POLICY_METRICS.flatMap((metric) =>
    DELIVERY_ENVELOPE_POLICY_VALUE_KINDS.map((kind) => `${metric}.${kind}`),
  ),
);

const PROFILE_CANDIDATE_FILENAMES = [
  'org-policy-profile.json',
  'org-policy-profile.yaml',
  'org-policy-profile.v1.json',
  'org-policy-profile.v1.yaml',
  'policy-profile.json',
  'policy-profile.yaml',
  'policy-profile.v1.json',
  'policy-profile.v1.yaml',
  'worker-admission.policy-profile.json',
  'worker-admission.policy-profile.yaml',
  'worker-admission.policy-profile.v1.json',
  'worker-admission.policy-profile.v1.yaml',
  'worker-admission-policy-profile.json',
  'worker-admission-policy-profile.yaml',
  'worker-admission-policy-profile.v1.json',
  'worker-admission-policy-profile.v1.yaml',
];

const STRUCTURAL_BOUNDS = {
  maxDepth: 8,
  maxKeys: 256,
  maxNodes: 384,
  maxStringLength: 16384,
  maxArrayLength: 64,
};

function expectedParameterValueKeys() {
  return new Set(
    CONTROL_SPECS.flatMap((spec) => {
      const keys = [
        `${spec.id}.review_threshold`,
        `${spec.id}.waiver_allowability`,
      ];

      if (spec.deny) {
        keys.splice(1, 0, `${spec.id}.deny_threshold`);
      }

      return keys;
    }),
  );
}

const EXPECTED_PARAMETER_VALUE_KEYS = expectedParameterValueKeys();

function failClosed(reason) {
  return {
    status: 'fail_closed',
    reason,
  };
}

function schemaInvalid(message) {
  const error = new Error(message);
  error.code = 'schema_invalid';
  return error;
}

function extraTopLevelKey(message) {
  const error = new Error(message);
  error.code = 'extra_top_level_key';
  return error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

function candidateRoots(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') {
    return [];
  }

  const resolved = path.resolve(dir.trim());
  if (path.extname(resolved) === '.json' || path.extname(resolved) === '.yaml') {
    return [];
  }

  const workspaceRoot = path.basename(resolved) === '.agent-launch'
    ? path.dirname(resolved)
    : resolved;
  const launchRoot = path.basename(resolved) === '.agent-launch'
    ? resolved
    : path.join(resolved, '.agent-launch');

  return [
    launchRoot,
    path.join(workspaceRoot, '.agent-launch', 'launchers'),
    path.join(workspaceRoot, '.agent-launch', 'profiles'),
  ];
}

function candidateFiles(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') {
    return [];
  }

  const resolved = path.resolve(dir.trim());
  if (path.extname(resolved) === '.json' || path.extname(resolved) === '.yaml') {
    return [resolved];
  }

  const files = [];
  for (const root of candidateRoots(resolved)) {
    for (const name of PROFILE_CANDIDATE_FILENAMES) {
      files.push(path.join(root, name));
    }
  }

  return files;
}

async function readJsonProfile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  if (raw.trim() === '') {
    throw schemaInvalid('declared org policy profile is empty');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw schemaInvalid(error.message);
  }
}

function extractParameterValues(candidate) {
  if (!isPlainObject(candidate)) {
    throw schemaInvalid('org policy profile carrier must be a plain object');
  }

  const keys = Object.keys(candidate);
  if (!Object.hasOwn(candidate, 'parameter_values')) {
    throw schemaInvalid('org policy profile must expose parameter_values');
  }

  if (keys.some((key) => key !== 'parameter_values' && key !== 'delivery_envelope_policy')) {
    throw extraTopLevelKey('unexpected top-level key in org policy profile carrier');
  }

  if (!isPlainObject(candidate.parameter_values)) {
    throw schemaInvalid('parameter_values must be a plain object');
  }

  return candidate.parameter_values;
}

function hasExpectedParameterValueKeys(parameterValues) {
  if (!isPlainObject(parameterValues)) {
    return false;
  }

  const keys = Object.keys(parameterValues);
  return keys.length === EXPECTED_PARAMETER_VALUE_KEYS.size &&
    keys.every((key) => EXPECTED_PARAMETER_VALUE_KEYS.has(key));
}

function locateProfileCandidate(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  return Object.hasOwn(value, 'parameter_values') ? value : null;
}

function validateWaiverAllowability(controlId, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw schemaInvalid(`${controlId}.waiver_allowability must be a non-empty array`);
  }

  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !ALLOWED_WAIVER_ALLOWABILITY.has(entry)) {
      throw schemaInvalid(`${controlId}.waiver_allowability contains an unsupported entry`);
    }

    if (seen.has(entry)) {
      throw schemaInvalid(`${controlId}.waiver_allowability contains a duplicate entry`);
    }

    seen.add(entry);
  }

  return value;
}

function validateControl(controlId, parameterValues) {
  if (typeof controlId !== 'string' || controlId === '') {
    throw schemaInvalid('control id must be a non-empty string');
  }

  if (!isPlainObject(parameterValues)) {
    throw schemaInvalid('parameter_values must be a plain object');
  }

  const spec = CONTROL_SPECS.find((entry) => entry.id === controlId);
  if (!spec) {
    throw schemaInvalid(`unknown control id: ${controlId}`);
  }

  const reviewThresholdKey = `${controlId}.review_threshold`;
  const denyThresholdKey = `${controlId}.deny_threshold`;
  const waiverAllowabilityKey = `${controlId}.waiver_allowability`;
  const reviewThreshold = parameterValues[reviewThresholdKey];

  if (!isNonNegativeInteger(reviewThreshold)) {
    throw schemaInvalid(`${reviewThresholdKey} must be a non-negative integer`);
  }

  validateWaiverAllowability(controlId, parameterValues[waiverAllowabilityKey]);

  if (!spec.deny) {
    if (Object.hasOwn(parameterValues, denyThresholdKey)) {
      throw schemaInvalid(`unexpected key: ${denyThresholdKey}`);
    }
    return;
  }

  const denyThreshold = parameterValues[denyThresholdKey];
  if (!isNonNegativeInteger(denyThreshold)) {
    throw schemaInvalid(`${denyThresholdKey} must be a non-negative integer`);
  }

  if (denyThreshold < reviewThreshold) {
    throw schemaInvalid(`${denyThresholdKey} must be greater than or equal to ${reviewThresholdKey}`);
  }
}

function validateDeliveryEnvelopePolicy(candidate) {
  if (candidate === undefined) {
    return null;
  }

  if (!isPlainObject(candidate)) {
    throw schemaInvalid('delivery_envelope_policy must be a plain object');
  }

  const keys = Object.keys(candidate);
  if (!Object.hasOwn(candidate, 'schema_version')) {
    throw schemaInvalid('delivery_envelope_policy must expose schema_version');
  }
  if (!Object.hasOwn(candidate, 'parameter_values')) {
    throw schemaInvalid('delivery_envelope_policy must expose parameter_values');
  }
  if (keys.some((key) => key !== 'schema_version' && key !== 'parameter_values')) {
    throw extraTopLevelKey('unexpected key in delivery_envelope_policy');
  }
  if (candidate.schema_version !== DELIVERY_ENVELOPE_POLICY_SCHEMA_VERSION) {
    throw schemaInvalid('unsupported delivery_envelope_policy schema_version');
  }
  if (!isPlainObject(candidate.parameter_values)) {
    throw schemaInvalid('delivery_envelope_policy.parameter_values must be a plain object');
  }

  validateStructuralBounds(candidate.parameter_values);

  for (const [key, value] of Object.entries(candidate.parameter_values)) {
    if (!DELIVERY_ENVELOPE_POLICY_PARAMETER_VALUE_KEYS.has(key)) {
      throw schemaInvalid(`unknown delivery_envelope_policy parameter: ${key}`);
    }
    if (!isNonNegativeInteger(value)) {
      throw schemaInvalid(`delivery_envelope_policy.${key} must be a non-negative integer`);
    }
  }

  return {
    schema_version: DELIVERY_ENVELOPE_POLICY_SCHEMA_VERSION,
    parameter_values: candidate.parameter_values,
  };
}

function validateStructuralBounds(value) {
  const state = {
    nodes: 0,
    keys: 0,
  };
  walkStructuralBounds(value, 0, state);
}

function walkStructuralBounds(value, depth, state) {
  if (depth > STRUCTURAL_BOUNDS.maxDepth) {
    throw schemaInvalid('over_structural_bound');
  }

  state.nodes += 1;
  if (state.nodes > STRUCTURAL_BOUNDS.maxNodes) {
    throw schemaInvalid('over_structural_bound');
  }

  if (value === null) {
    return;
  }

  const valueType = typeof value;
  if (valueType === 'string') {
    if (value.length > STRUCTURAL_BOUNDS.maxStringLength) {
      throw schemaInvalid('over_structural_bound');
    }
    return;
  }

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw schemaInvalid('schema_invalid');
    }
    return;
  }

  if (valueType === 'boolean') {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > STRUCTURAL_BOUNDS.maxArrayLength) {
      throw schemaInvalid('over_structural_bound');
    }

    for (const item of value) {
      walkStructuralBounds(item, depth + 1, state);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw schemaInvalid('schema_invalid');
  }

  const keys = Object.keys(value);
  state.keys += keys.length;
  if (state.keys > STRUCTURAL_BOUNDS.maxKeys) {
    throw schemaInvalid('over_structural_bound');
  }

  for (const key of keys) {
    if (key === '') {
      throw schemaInvalid('schema_invalid');
    }

    const entry = value[key];
    if (entry === undefined) {
      throw schemaInvalid('schema_invalid');
    }

    walkStructuralBounds(entry, depth + 1, state);
  }
}

function validateProfile(candidate) {
  try {
    const parameterValues = extractParameterValues(candidate);
    validateStructuralBounds(parameterValues);
    const deliveryEnvelopePolicy = validateDeliveryEnvelopePolicy(candidate.delivery_envelope_policy);

    if (!hasExpectedParameterValueKeys(parameterValues)) {
      throw schemaInvalid('org policy profile must contain exactly the expected parameter_values keys');
    }

    for (const { id } of CONTROL_SPECS) {
      validateControl(id, parameterValues);
    }

    const profile = { parameter_values: parameterValues };
    const digest = computeNormalizedInputDigest({
      pack_id: PACK_ID,
      profile_schema_version: PROFILE_SCHEMA_VERSION,
      profile,
    });

    if (!deliveryEnvelopePolicy) {
      return { status: 'profile', profile, digest };
    }

    return {
      status: 'profile',
      profile,
      digest,
      delivery_envelope_policy: deliveryEnvelopePolicy,
      delivery_envelope_policy_digest: computeNormalizedInputDigest({
        pack_id: DELIVERY_ENVELOPE_POLICY_PACK_ID,
        profile_schema_version: DELIVERY_ENVELOPE_POLICY_SCHEMA_VERSION,
        profile: deliveryEnvelopePolicy,
      }),
    };
  } catch (error) {
    if (error?.message === 'over_structural_bound') {
      return failClosed('over_structural_bound');
    }

    return failClosed(error?.code === 'extra_top_level_key' ? 'extra_top_level_key' : 'schema_invalid');
  }
}

async function loadOrgPolicyProfile(options = {}) {
  if (Object.hasOwn(options, 'profile')) {
    return validateProfile(options.profile);
  }

  if (Object.hasOwn(options, 'profilePath')) {
    try {
      return validateProfile(await readJsonProfile(path.resolve(options.profilePath)));
    } catch (error) {
      return isMissingPathError(error)
        ? { status: 'absent' }
        : failClosed('schema_invalid');
    }
  }

  const files = candidateFiles(options.dir);
  if (files.length === 0) {
    return { status: 'absent' };
  }

  for (const filePath of files) {
    let parsed;
    try {
      parsed = await readJsonProfile(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }

      return failClosed('schema_invalid');
    }

    const candidate = locateProfileCandidate(parsed);
    if (!candidate) {
      return failClosed('schema_invalid');
    }

    return validateProfile(candidate);
  }

  return { status: 'absent' };
}

const loadOrgPolicyProfileCarrier = loadOrgPolicyProfile;
const loadOrgPolicyProfileFromDir = loadOrgPolicyProfile;
const readOrgPolicyProfile = loadOrgPolicyProfile;

export {
  ALLOWED_WAIVER_ALLOWABILITY,
  CONTROL_SPECS,
  DELIVERY_ENVELOPE_POLICY_PACK_ID,
  DELIVERY_ENVELOPE_POLICY_PARAMETER_VALUE_KEYS,
  DELIVERY_ENVELOPE_POLICY_SCHEMA_VERSION,
  PACK_ID,
  PROFILE_SCHEMA_VERSION,
  loadOrgPolicyProfile,
  loadOrgPolicyProfileCarrier,
  loadOrgPolicyProfileFromDir,
  readOrgPolicyProfile,
  validateControl,
  validateProfile,
};

export default loadOrgPolicyProfile;
