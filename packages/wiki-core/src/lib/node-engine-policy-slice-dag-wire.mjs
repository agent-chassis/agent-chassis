import {
  computePolicySliceDagPolicyDigest, createPolicySliceDagOperationManifest, dispatchPolicySliceDagOperation,
  POLICY_SLICE_DAG_DISPATCH_BINDING, POLICY_SLICE_DAG_MAX_ADDRESS_LENGTH, POLICY_SLICE_DAG_MAX_DECLARED_DEPENDENCY_REFS,
  POLICY_SLICE_DAG_MAX_POLICY_RULES, POLICY_SLICE_DAG_MAX_SLICES, POLICY_SLICE_DAG_MAX_WORK_KINDS_PER_SELECTOR,
  POLICY_SLICE_DAG_OPERATION_MANIFEST_DIGEST, POLICY_SLICE_DAG_PACK_INPUT_SCHEMA_DIGEST,
  POLICY_SLICE_DAG_PACK_INPUT_SCHEMA_VERSION, POLICY_SLICE_DAG_POLICY_AUTHORITY_MODE, POLICY_SLICE_DAG_POLICY_SCHEMA_DIGEST,
  POLICY_SLICE_DAG_PROBLEM_TAXONOMY_DIGEST, POLICY_SLICE_DAG_REQUEST_DATA_SCHEMA_VERSION,
  POLICY_SLICE_DAG_REQUEST_SCHEMA_DIGEST, POLICY_SLICE_DAG_RESPONSE_SCHEMA_DIGEST, SLICE_DAG_POLICY_SCHEMA_VERSION,
} from "@agent-chassis/node-engine-sdk";

const MANIFEST = createPolicySliceDagOperationManifest();
const BINDING = MANIFEST.pack_binding;
export const NODE_ENGINE_POLICY_SLICE_DAG_PACK = BINDING.pack_id;
export const NODE_ENGINE_POLICY_SLICE_DAG_OPERATION = BINDING.operation_id;
export const NODE_ENGINE_POLICY_SLICE_DAG_OPERATION_VERSION = BINDING.operation_version;
export const NODE_ENGINE_POLICY_SLICE_DAG_REQUEST_DATA_SCHEMA_VERSION =
  POLICY_SLICE_DAG_REQUEST_DATA_SCHEMA_VERSION;
export const NODE_ENGINE_POLICY_SLICE_DAG_PACK_INPUT_SCHEMA_VERSION =
  POLICY_SLICE_DAG_PACK_INPUT_SCHEMA_VERSION;

export const NODE_ENGINE_POLICY_SLICE_DAG_CONTRACT_DIGESTS = Object.freeze({
  request: POLICY_SLICE_DAG_REQUEST_SCHEMA_DIGEST,
  pack_input: POLICY_SLICE_DAG_PACK_INPUT_SCHEMA_DIGEST,
  response: POLICY_SLICE_DAG_RESPONSE_SCHEMA_DIGEST,
  manifest: POLICY_SLICE_DAG_OPERATION_MANIFEST_DIGEST,
  policy: POLICY_SLICE_DAG_POLICY_SCHEMA_DIGEST,
  problem_taxonomy: POLICY_SLICE_DAG_PROBLEM_TAXONOMY_DIGEST,
});

export const NODE_ENGINE_POLICY_SLICE_DAG_MANIFEST_CAPS = Object.freeze({
  slices: POLICY_SLICE_DAG_MAX_SLICES,
  declared_dependency_refs: POLICY_SLICE_DAG_MAX_DECLARED_DEPENDENCY_REFS,
  policy_rules: POLICY_SLICE_DAG_MAX_POLICY_RULES,
  work_kinds_per_selector: POLICY_SLICE_DAG_MAX_WORK_KINDS_PER_SELECTOR,
  address_length: POLICY_SLICE_DAG_MAX_ADDRESS_LENGTH,
});

const STATUSES = new Set(["inbox", "todo", "active", "review", "done", "blocked", "parked", "cancelled"]);
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[a-z][a-z0-9_-]*$/u;

function refusal(reason_code) {
  return { accepted: false, reason_code };
}

function compareAddresses(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!plainObject(value)) throw new TypeError(`${label} must be an object`);
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size || Object.keys(value).some((key) => !expected.has(key))) {
    throw new TypeError(`${label} has invalid keys`);
  }
}

function requiredString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new TypeError(`${label} must be a valid string`);
  }
  return value;
}

function cloneSelector(value, label) {
  exactKeys(value, ["work_kind_in"], label);
  if (!Array.isArray(value.work_kind_in) || value.work_kind_in.some((kind) => typeof kind !== "string" || !TOKEN.test(kind))) {
    throw new TypeError(`${label}.work_kind_in must contain lowercase tokens`);
  }
  return { work_kind_in: [...value.work_kind_in] };
}

function clonePolicy(policy) {
  exactKeys(policy, ["schema_version", "policy_id", "policy_version", "rules"], "organization_policy");
  if (policy.schema_version !== SLICE_DAG_POLICY_SCHEMA_VERSION) {
    throw new TypeError("organization_policy.schema_version is invalid");
  }
  requiredString(policy.policy_id, "organization_policy.policy_id");
  requiredString(policy.policy_version, "organization_policy.policy_version");
  if (!Array.isArray(policy.rules)) throw new TypeError("organization_policy.rules must be an array");
  return {
    schema_version: policy.schema_version,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    rules: policy.rules.map((rule, index) => {
      const label = `organization_policy.rules[${index}]`;
      exactKeys(rule, ["rule_id", "prerequisite_selector", "dependent_selector", "requirement"], label);
      return {
        rule_id: requiredString(rule.rule_id, `${label}.rule_id`),
        prerequisite_selector: cloneSelector(rule.prerequisite_selector, `${label}.prerequisite_selector`),
        dependent_selector: cloneSelector(rule.dependent_selector, `${label}.dependent_selector`),
        requirement: rule.requirement === "all_matching_slices_done"
          ? rule.requirement
          : (() => { throw new TypeError(`${label}.requirement is invalid`); })(),
      };
    }),
  };
}

function projectInput(input) {
  exactKeys(input, ["record_id", "work_record_source_digest", "organization_policy", "organization_policy_digest", "slices"], "canonical projection");
  const recordId = requiredString(input.record_id, "record_id");
  const sourceDigest = requiredString(input.work_record_source_digest, "work_record_source_digest", DIGEST);
  const policyDigest = requiredString(input.organization_policy_digest, "organization_policy_digest", DIGEST);
  if (!Array.isArray(input.slices)) throw new TypeError("slices must be an array");

  const addresses = new Set();
  const slices = input.slices.map((slice, index) => {
    const label = `slices[${index}]`;
    exactKeys(slice, ["address", "work_kind", "status", "depends_on"], label);
    const address = requiredString(slice.address, `${label}.address`);
    if (addresses.has(address)) throw new TypeError(`duplicate slice address: ${address}`);
    addresses.add(address);
    if (typeof slice.work_kind !== "string" || !TOKEN.test(slice.work_kind)) {
      throw new TypeError(`${label}.work_kind must be a lowercase token`);
    }
    if (!STATUSES.has(slice.status)) throw new TypeError(`${label}.status is invalid`);
    if (!Array.isArray(slice.depends_on) || slice.depends_on.some((dependency) => typeof dependency !== "string" || dependency.length === 0)) {
      throw new TypeError(`${label}.depends_on must contain strings`);
    }
    return { address, work_kind: slice.work_kind, status: slice.status, depends_on: [...slice.depends_on] };
  }).sort((left, right) => compareAddresses(left.address, right.address));

  return {
    record_id: recordId,
    work_record_source_digest: sourceDigest,
    organization_policy: clonePolicy(input.organization_policy),
    organization_policy_digest: policyDigest,
    slices,
  };
}

export function projectNodeEnginePolicySliceDagRequest(input) {
  const projected = projectInput(input);
  return {
    pack: BINDING.pack_id,
    operation: BINDING.operation_id,
    operation_version: BINDING.operation_version,
    data: {
      schema_version: POLICY_SLICE_DAG_REQUEST_DATA_SCHEMA_VERSION,
      subject: {
        record_id: projected.record_id,
        work_record_source_digest: projected.work_record_source_digest,
      },
      slices: projected.slices,
    },
    pack_input: {
      schema_version: POLICY_SLICE_DAG_PACK_INPUT_SCHEMA_VERSION,
      request_contract_digest: POLICY_SLICE_DAG_REQUEST_SCHEMA_DIGEST,
      organization_policy: projected.organization_policy,
      organization_policy_digest: projected.organization_policy_digest,
      organization_policy_authority_mode: POLICY_SLICE_DAG_POLICY_AUTHORITY_MODE,
    },
  };
}

export const buildNodeEnginePolicySliceDagWireBody = projectNodeEnginePolicySliceDagRequest;

export async function dispatchNodeEnginePolicySliceDagOperation(input, transport) {
  if (!plainObject(transport) || typeof transport.validate !== "function") return refusal("transport_invalid");
  const request = projectNodeEnginePolicySliceDagRequest(input);
  if (computePolicySliceDagPolicyDigest(request.pack_input.organization_policy) !== request.pack_input.organization_policy_digest) return refusal("policy_digest_mismatch");
  return await dispatchPolicySliceDagOperation(transport, MANIFEST, POLICY_SLICE_DAG_DISPATCH_BINDING, request);
}
