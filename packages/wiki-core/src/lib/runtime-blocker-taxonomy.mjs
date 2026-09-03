

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION = "runtime-blocker-codes.v1";
export const RUNTIME_BLOCKER_TAXONOMY_DESCRIPTOR_FILENAME = "runtime-blocker-codes.v1.json";
export const RUNTIME_BLOCKER_TAXONOMY_DESCRIPTOR_RELATIVE_PATH =
  "packages/wiki-core/data/runtime-blocker-codes.v1.json";
export const RUNTIME_BLOCKER_TAXONOMY_OWNER = "IN-0016";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DESCRIPTOR_PATH = path.join(
  THIS_DIR,
  "../../data",
  RUNTIME_BLOCKER_TAXONOMY_DESCRIPTOR_FILENAME
);

const RAW_DESCRIPTOR = JSON.parse(readFileSync(DEFAULT_DESCRIPTOR_PATH, "utf8"));

const RUNTIME_BLOCKER_ENTRY_KEYS = new Set([
  "code",
  "category",
  "actor_recovery",
  "blocking",
  "summary",
  "detail",
  "consumer_notes",
  "recovery",
  "aliases",
  "reasons",
  "wk_0532_subset"
]);

const RUNTIME_BLOCKER_DESCRIPTOR_KEYS = new Set([
  "schema_version",
  "owner",
  "description",
  "code_categories",
  "actor_recovery_values",
  "codes",
  "wk_0532_bootstrap_subset",
  "package_local_identity_namespaces",
  "private_cause_declarations",
  "non_registrable_authority_identities",
  "graph_impact_state_map"
]);

const GRAPH_IMPACT_STATE_MAP_KEYS = new Set([
  "description",
  "default_outcome",
  "rules"
]);

const GRAPH_IMPACT_RULE_KEYS = new Set([
  "when",
  "code",
  "blocking",
  "outcome"
]);

const RUNTIME_BLOCKER_RECOVERY_KEYS = new Set([
  "kind",
  "success_condition",
  "summary",
  "target",
  "route",
  "argument",
  "accepted_values",
  "arguments",
  "argument_bindings",
  "prerequisite"
]);

const GRAPH_IMPACT_RULE_WHEN_KEYS = new Set([
  "graph_state",
  "staleness",
  "dirty_state",
  "overlay_state"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isUniqueNonEmptyStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function assertEntryRecoveryShape(entry) {
  if (!Object.hasOwn(entry, "recovery")) return;
  const recovery = entry.recovery;

  if (isNonEmptyString(recovery)) return;
  if (!isPlainObject(recovery)) {
    throw new Error(
      `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery must be a non-empty string or object`
    );
  }
  for (const key of Object.keys(recovery)) {
    if (!RUNTIME_BLOCKER_RECOVERY_KEYS.has(key)) {
      throw new Error(
        `invalid runtime blocker taxonomy entry recovery: ${entry.code} declares unknown recovery field ${key}`
      );
    }
  }
  if (!isNonEmptyString(recovery.kind) || !isNonEmptyString(recovery.success_condition)) {
    throw new Error(
      `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery must name a kind and success_condition`
    );
  }
  for (const key of ["summary", "target", "route", "argument", "prerequisite"]) {
    if (Object.hasOwn(recovery, key) && !isNonEmptyString(recovery[key])) {
      throw new Error(
        `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery ${key} must be a non-empty string`
      );
    }
  }
  if (Object.hasOwn(recovery, "accepted_values") && !isUniqueNonEmptyStringArray(recovery.accepted_values)) {
    throw new Error(
      `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery accepted_values must be a unique non-empty string array`
    );
  }
  if (Object.hasOwn(recovery, "arguments") && !isPlainObject(recovery.arguments)) {
    throw new Error(
      `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery arguments must be an object`
    );
  }
  if (Object.hasOwn(recovery, "argument_bindings")) {
    const bindings = recovery.argument_bindings;
    if (!isPlainObject(bindings) || Object.keys(bindings).length === 0) {
      throw new Error(
        `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery argument_bindings must be a non-empty object`
      );
    }
    for (const [argument, fact] of Object.entries(bindings)) {

      if (!isNonEmptyString(fact) || !/^[a-z][a-z0-9_]*$/u.test(fact)) {
        throw new Error(
          `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery argument_bindings.${argument} must name a snake_case refusal fact identity`
        );
      }

      if (isPlainObject(recovery.arguments) && Object.hasOwn(recovery.arguments, argument)) {
        throw new Error(
          `invalid runtime blocker taxonomy entry recovery: ${entry.code} recovery argument ${argument} is both fixed and bound`
        );
      }
    }
  }
}

function assertEntryOptionalFields(entry) {
  for (const key of Object.keys(entry)) {
    if (!RUNTIME_BLOCKER_ENTRY_KEYS.has(key)) {
      throw new Error(
        `invalid runtime blocker taxonomy entry: ${entry.code} declares unknown field ${key}`
      );
    }
  }
  for (const key of ["detail", "consumer_notes"]) {
    if (Object.hasOwn(entry, key) && !isNonEmptyString(entry[key])) {
      throw new Error(
        `invalid runtime blocker taxonomy entry: ${entry.code} ${key} must be a non-empty string`
      );
    }
  }
  if (Object.hasOwn(entry, "aliases") && !isUniqueNonEmptyStringArray(entry.aliases)) {
    throw new Error(
      `invalid runtime blocker taxonomy entry: ${entry.code} aliases must be a unique non-empty string array`
    );
  }
  if (Object.hasOwn(entry, "wk_0532_subset") && typeof entry.wk_0532_subset !== "boolean") {
    throw new Error(
      `invalid runtime blocker taxonomy entry: ${entry.code} wk_0532_subset must be a boolean`
    );
  }
  if (Object.hasOwn(entry, "reasons")) {
    const reasons = entry.reasons;
    if (!Array.isArray(reasons) || reasons.length === 0) {
      throw new Error(
        `invalid runtime blocker taxonomy entry: ${entry.code} reasons must be a non-empty array`
      );
    }
    const seenReasons = new Set();
    for (const reason of reasons) {
      if (!isPlainObject(reason) || !isNonEmptyString(reason.reason) || !isNonEmptyString(reason.summary)) {
        throw new Error(
          `invalid runtime blocker taxonomy entry: ${entry.code} reasons entries must name a reason and summary`
        );
      }
      if (seenReasons.has(reason.reason)) {
        throw new Error(
          `invalid runtime blocker taxonomy entry: ${entry.code} declares duplicate reason ${reason.reason}`
        );
      }
      seenReasons.add(reason.reason);
    }
  }
  assertEntryRecoveryShape(entry);
}

const PACKAGE_LOCAL_IDENTITY_NAMESPACE_KEYS = new Set([
  "namespace",
  "owner_package",
  "registered_members",
  "public_projection"
]);

const PACKAGE_LOCAL_IDENTITY_RE =
  /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+\.v[0-9]{1,3}$/u;

function assertPackageLocalIdentityNamespaces(descriptor, seenCodes) {
  const declared = descriptor.package_local_identity_namespaces;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(
      "runtime blocker taxonomy descriptor package_local_identity_namespaces must be a non-empty array"
    );
  }
  const seenNamespaces = new Set();
  for (const entry of declared) {
    if (!isPlainObject(entry)) {
      throw new Error("package_local_identity_namespaces entries must be objects");
    }
    for (const key of Object.keys(entry)) {
      if (!PACKAGE_LOCAL_IDENTITY_NAMESPACE_KEYS.has(key)) {
        throw new Error(
          `package_local_identity_namespaces entry declares unknown field ${key}`
        );
      }
    }
    if (!isNonEmptyString(entry.namespace) || !/^[a-z][a-z0-9_]*$/u.test(entry.namespace)) {
      throw new Error(
        `package_local_identity_namespaces entry has an invalid namespace: ${String(entry.namespace)}`
      );
    }
    if (seenNamespaces.has(entry.namespace)) {
      throw new Error(
        `package_local_identity_namespaces declares duplicate namespace ${entry.namespace}`
      );
    }
    seenNamespaces.add(entry.namespace);
    if (!isNonEmptyString(entry.owner_package)) {
      throw new Error(
        `package_local_identity_namespace ${entry.namespace} must name an owner_package`
      );
    }
    if (Object.hasOwn(entry, "registered_members") && typeof entry.registered_members !== "boolean") {
      throw new Error(
        `package_local_identity_namespace ${entry.namespace} registered_members must be a boolean`
      );
    }

    if (Object.hasOwn(entry, "public_projection")) {
      if (!isNonEmptyString(entry.public_projection) || !seenCodes.has(entry.public_projection)) {
        throw new Error(
          `package_local_identity_namespace ${entry.namespace} projects to unregistered code ${String(entry.public_projection)}`
        );
      }
    }
  }
}

const PRIVATE_CAUSE_DECLARATION_KEYS = new Set(["kind", "owner_package", "reason", "causes"]);
const PRIVATE_CAUSE_DECLARATION_KINDS = new Set([
  "launcher_action_token",
  "launcher_transition_cause"
]);

function assertPrivateCauseDeclarations(descriptor, seenCodes) {
  const declared = descriptor.private_cause_declarations;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(
      "runtime blocker taxonomy descriptor private_cause_declarations must be a non-empty array"
    );
  }
  const seenKinds = new Set();
  for (const entry of declared) {
    if (!isPlainObject(entry)) {
      throw new Error("private_cause_declarations entries must be objects");
    }
    for (const key of Object.keys(entry)) {
      if (!PRIVATE_CAUSE_DECLARATION_KEYS.has(key)) {
        throw new Error(`private_cause_declarations entry declares unknown field ${key}`);
      }
    }
    if (!PRIVATE_CAUSE_DECLARATION_KINDS.has(entry.kind)) {
      throw new Error(
        `private_cause_declarations entry declares unknown kind ${String(entry.kind)}`
      );
    }
    if (seenKinds.has(entry.kind)) {
      throw new Error(`private_cause_declarations declares duplicate kind ${entry.kind}`);
    }
    seenKinds.add(entry.kind);
    if (!isNonEmptyString(entry.owner_package) || !isNonEmptyString(entry.reason)) {
      throw new Error(
        `private_cause_declarations kind ${entry.kind} must name an owner_package and a reason`
      );
    }
    if (!isUniqueNonEmptyStringArray(entry.causes)) {
      throw new Error(
        `private_cause_declarations kind ${entry.kind} causes must be a unique non-empty string array`
      );
    }
    for (const cause of entry.causes) {
      if (seenCodes.has(cause)) {
        throw new Error(
          `private cause ${cause} is registered as a public mechanical code; a private cause is not published merely because it exists`
        );
      }
    }
  }
}

function assertNonRegistrableAuthorityIdentities(descriptor, seenCodes) {
  const declared = descriptor.non_registrable_authority_identities;
  if (!isPlainObject(declared)) {
    throw new Error(
      "runtime blocker taxonomy descriptor non_registrable_authority_identities must be an object"
    );
  }
  for (const key of Object.keys(declared)) {
    if (!["description", "owner", "identities"].includes(key)) {
      throw new Error(
        `non_registrable_authority_identities declares unknown field ${key}`
      );
    }
  }
  if (!isNonEmptyString(declared.description) || !isNonEmptyString(declared.owner)) {
    throw new Error(
      "non_registrable_authority_identities must name a description and an owner"
    );
  }
  if (!isUniqueNonEmptyStringArray(declared.identities)) {
    throw new Error(
      "non_registrable_authority_identities identities must be a unique non-empty string array"
    );
  }
  for (const identity of declared.identities) {
    if (seenCodes.has(identity)) {
      throw new Error(
        `${identity} is an authenticated authority identity: worker admission review thresholds and every other returned-policy semantic are CCE policy, not local taxonomy`
      );
    }
  }
}

function assertGraphImpactStateMapShape(descriptor, seenCodes) {
  const stateMap = descriptor.graph_impact_state_map;
  if (!isPlainObject(stateMap)) {
    throw new Error("runtime blocker taxonomy descriptor graph_impact_state_map must be an object");
  }
  for (const key of Object.keys(stateMap)) {
    if (!GRAPH_IMPACT_STATE_MAP_KEYS.has(key)) {
      throw new Error(
        `runtime blocker taxonomy descriptor graph_impact_state_map declares unknown field ${key}`
      );
    }
  }
  if (!isNonEmptyString(stateMap.description) || !isNonEmptyString(stateMap.default_outcome)) {
    throw new Error(
      "runtime blocker taxonomy descriptor graph_impact_state_map must name a description and default_outcome"
    );
  }
  if (!Array.isArray(stateMap.rules) || stateMap.rules.length === 0) {
    throw new Error("runtime blocker taxonomy descriptor graph_impact_state_map rules must be a non-empty array");
  }
  for (const rule of stateMap.rules) {
    if (!isPlainObject(rule) || !isPlainObject(rule.when)) {
      throw new Error("runtime blocker taxonomy graph_impact_state_map rules must be objects with a when clause");
    }
    for (const key of Object.keys(rule)) {
      if (!GRAPH_IMPACT_RULE_KEYS.has(key)) {
        throw new Error(
          `runtime blocker taxonomy graph_impact_state_map rule declares unknown field ${key}`
        );
      }
    }
    for (const [key, value] of Object.entries(rule.when)) {
      if (!GRAPH_IMPACT_RULE_WHEN_KEYS.has(key)) {
        throw new Error(
          `runtime blocker taxonomy graph_impact_state_map rule declares unknown when field ${key}`
        );
      }
      if (value !== null && !isNonEmptyString(value)) {
        throw new Error(
          `runtime blocker taxonomy graph_impact_state_map rule when field ${key} must be a non-empty string or null`
        );
      }
    }
    if (!seenCodes.has(rule.code)) {
      throw new Error(
        `runtime blocker taxonomy graph_impact_state_map rule names unregistered code ${String(rule.code)}`
      );
    }
    if (Object.hasOwn(rule, "blocking") && typeof rule.blocking !== "boolean") {
      throw new Error("runtime blocker taxonomy graph_impact_state_map rule blocking must be a boolean");
    }
    if (Object.hasOwn(rule, "outcome") && !isNonEmptyString(rule.outcome)) {
      throw new Error("runtime blocker taxonomy graph_impact_state_map rule outcome must be a non-empty string");
    }
  }
}

export function assertRuntimeBlockerDescriptorShape(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error("runtime blocker taxonomy descriptor must be an object");
  }
  for (const key of Object.keys(descriptor)) {
    if (!RUNTIME_BLOCKER_DESCRIPTOR_KEYS.has(key)) {
      throw new Error(`runtime blocker taxonomy descriptor declares unknown field ${key}`);
    }
  }
  if (descriptor.schema_version !== RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION) {
    throw new Error("runtime blocker taxonomy descriptor has an unsupported schema_version");
  }
  if (descriptor.owner !== RUNTIME_BLOCKER_TAXONOMY_OWNER) {
    throw new Error("runtime blocker taxonomy descriptor has an unexpected owner");
  }
  if (!isNonEmptyString(descriptor.description)) {
    throw new Error("runtime blocker taxonomy descriptor description must be a non-empty string");
  }
  const categories = descriptor.code_categories;
  const actorRecoveryValues = descriptor.actor_recovery_values;
  if (!isUniqueNonEmptyStringArray(categories)) {
    throw new Error("runtime blocker taxonomy descriptor categories must be a unique array");
  }
  if (!isUniqueNonEmptyStringArray(actorRecoveryValues)) {
    throw new Error("runtime blocker taxonomy descriptor actor recovery values must be a unique array");
  }
  if (!Array.isArray(descriptor.codes) || descriptor.codes.length === 0) {
    throw new Error("runtime blocker taxonomy descriptor codes must be a non-empty array");
  }
  const seenCodes = new Set();
  for (const entry of descriptor.codes) {
    if (!isPlainObject(entry)) {
      throw new Error("runtime blocker taxonomy entries must be objects");
    }
    if (
      typeof entry.code !== "string" ||
      entry.code.length === 0 ||
      seenCodes.has(entry.code) ||
      typeof entry.category !== "string" ||
      !categories.includes(entry.category) ||
      typeof entry.actor_recovery !== "string" ||
      !actorRecoveryValues.includes(entry.actor_recovery) ||
      typeof entry.blocking !== "boolean" ||
      typeof entry.summary !== "string" ||
      entry.summary.length === 0
    ) {
      throw new Error(`invalid runtime blocker taxonomy entry: ${String(entry.code)}`);
    }
    assertEntryOptionalFields(entry);
    seenCodes.add(entry.code);
  }
  const readiness = descriptor.codes.find((entry) => entry.code === "work_record_readiness_failure");
  if (
    !readiness ||
    readiness.recovery?.kind !== "exact_named_contract_defect" ||
    typeof readiness.recovery.target !== "string" ||
    typeof readiness.recovery.success_condition !== "string"
  ) {
    throw new Error("work_record_readiness_failure must target an exact named contract defect");
  }
  if (!isUniqueNonEmptyStringArray(descriptor.wk_0532_bootstrap_subset)) {
    throw new Error(
      "runtime blocker taxonomy descriptor wk_0532_bootstrap_subset must be a unique non-empty string array"
    );
  }
  assertPackageLocalIdentityNamespaces(descriptor, seenCodes);
  assertPrivateCauseDeclarations(descriptor, seenCodes);
  assertNonRegistrableAuthorityIdentities(descriptor, seenCodes);
  assertGraphImpactStateMapShape(descriptor, seenCodes);
  return descriptor;
}

function assertDescriptorShape(descriptor) {
  return assertRuntimeBlockerDescriptorShape(descriptor);
}

assertDescriptorShape(RAW_DESCRIPTOR);

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      freezeDeep(value[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

export const RUNTIME_BLOCKER_DESCRIPTOR = freezeDeep(JSON.parse(JSON.stringify(RAW_DESCRIPTOR)));

const codeEntries = RUNTIME_BLOCKER_DESCRIPTOR.codes.map((entry) => [entry.code, entry]);
const codeMap = new Map(codeEntries);

export const RUNTIME_BLOCKER_CODE_VALUES = Object.freeze(codeEntries.map(([code]) => code));

export const RUNTIME_BLOCKER_CODES = Object.freeze(
  Object.fromEntries(codeEntries.map(([code]) => [toEnumKey(code), code]))
);

export const RUNTIME_BLOCKER_CATEGORY_VALUES = Object.freeze(
  RUNTIME_BLOCKER_DESCRIPTOR.code_categories.slice()
);

export const RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES = Object.freeze([
  "role_policy",
  "caller_identity",
  "work_record_readiness",
  "transport",
  "backend",
  "filesystem",
  "sandbox",
  "validation",
  "route",
  "discovery",
  "review_transport",
  "monitor_handle",
  "bootstrap",
  "graph_impact",
  "graph_impact_persistence",
  "taxonomy",
  "operator_recovery"
]);

export const WK_0532_BOOTSTRAP_SUBSET = Object.freeze(
  RUNTIME_BLOCKER_DESCRIPTOR.wk_0532_bootstrap_subset.slice()
);

function toEnumKey(code) {
  return String(code).toUpperCase();
}

export function getRuntimeBlockerEntry(code) {
  return codeMap.get(code) ?? null;
}

export function isRuntimeBlockerCode(code) {
  return codeMap.has(code);
}

export function isBlockingRuntimeBlocker(code) {
  const entry = codeMap.get(code);
  return entry ? Boolean(entry.blocking) : false;
}

export function evaluateGraphImpactBlocker(input = {}) {
  const evidence = {
    graph_state: input.graph_state ?? null,
    staleness: input.staleness ?? null,
    dirty_state: input.dirty_state ?? null,
    overlay_state: input.overlay_state ?? null
  };
  const rules = RUNTIME_BLOCKER_DESCRIPTOR.graph_impact_state_map?.rules ?? [];
  for (const rule of rules) {
    if (matchesGraphImpactRule(rule.when ?? {}, evidence)) {
      const result = buildBlockerResult(rule.code, evidence);
      return Object.freeze({
        ...result,
        outcome: rule.outcome ?? null
      });
    }
  }
  return null;
}

function matchesGraphImpactRule(when, evidence) {
  for (const [key, expected] of Object.entries(when)) {
    if (expected === null || expected === undefined) {
      continue;
    }
    if (evidence[key] !== expected) {
      return false;
    }
  }
  return true;
}

export function assertRuntimeBlockerSubset(codes, { required = null } = {}) {
  if (!Array.isArray(codes) && !(codes instanceof Set)) {
    throw new TypeError("assertRuntimeBlockerSubset expects an array or Set of codes");
  }
  const observed = new Set(codes);
  const unknown = [];
  for (const code of observed) {
    if (!isRuntimeBlockerCode(code)) {
      unknown.push(code);
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `runtime blocker subset assertion failed: codes not in taxonomy: ${unknown.join(", ")}`
    );
  }
  if (required) {
    const requiredSet = new Set(required);
    const missing = [];
    for (const code of requiredSet) {
      if (!observed.has(code)) {
        missing.push(code);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `runtime blocker subset assertion failed: required codes missing: ${missing.join(", ")}`
      );
    }
  }
  return true;
}

function buildBlockerResult(code, evidence) {
  const entry = codeMap.get(code);
  return Object.freeze({
    schema_version: RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION,
    code,
    category: entry?.category ?? null,
    blocking: Boolean(entry?.blocking),
    summary: entry?.summary ?? null,
    evidence: Object.freeze({ ...evidence })
  });
}

const PACKAGE_LOCAL_IDENTITY_NAMESPACES = Object.freeze(
  new Map(
    RUNTIME_BLOCKER_DESCRIPTOR.package_local_identity_namespaces.map((entry) => [
      entry.namespace,
      Object.freeze({
        namespace: entry.namespace,
        owner_package: entry.owner_package,
        registered_members: entry.registered_members === true,
        public_projection: entry.public_projection ?? null
      })
    ])
  )
);

export const PACKAGE_LOCAL_IDENTITY_NAMESPACE_VALUES = Object.freeze(
  [...PACKAGE_LOCAL_IDENTITY_NAMESPACES.keys()].sort()
);

export function getPackageLocalIdentityNamespace(identity) {
  if (typeof identity !== "string" || !PACKAGE_LOCAL_IDENTITY_RE.test(identity)) {
    return null;
  }
  return PACKAGE_LOCAL_IDENTITY_NAMESPACES.get(identity.slice(0, identity.indexOf("."))) ?? null;
}

export function isDeclaredPackageLocalIdentity(identity) {
  return getPackageLocalIdentityNamespace(identity) !== null;
}

const PRIVATE_CAUSES_BY_KIND = Object.freeze(
  new Map(
    RUNTIME_BLOCKER_DESCRIPTOR.private_cause_declarations.map((entry) => [
      entry.kind,
      Object.freeze({
        kind: entry.kind,
        owner_package: entry.owner_package,
        reason: entry.reason,
        causes: Object.freeze(entry.causes.slice())
      })
    ])
  )
);

const PRIVATE_CAUSE_OWNER_BY_IDENTITY = new Map(
  RUNTIME_BLOCKER_DESCRIPTOR.private_cause_declarations.flatMap((entry) =>
    entry.causes.map((cause) => [cause, entry.kind])
  )
);

export const PRIVATE_CAUSE_DECLARATION_VALUES = Object.freeze(
  [...PRIVATE_CAUSES_BY_KIND.values()]
);

export const NON_REGISTRABLE_AUTHORITY_IDENTITIES = Object.freeze(
  RUNTIME_BLOCKER_DESCRIPTOR.non_registrable_authority_identities.identities.slice()
);

const NON_REGISTRABLE_AUTHORITY_IDENTITY_SET = new Set(NON_REGISTRABLE_AUTHORITY_IDENTITIES);

export function getPrivateCauseKind(identity) {
  return typeof identity === "string"
    ? PRIVATE_CAUSE_OWNER_BY_IDENTITY.get(identity) ?? null
    : null;
}

export function isDeclaredPrivateCause(identity) {
  return getPrivateCauseKind(identity) !== null;
}

export function isPublicMechanicalRefusalCode(code) {
  if (!isRuntimeBlockerCode(code)) return false;
  return !isDeclaredPrivateCause(code) && !NON_REGISTRABLE_AUTHORITY_IDENTITY_SET.has(code);
}

export function classifySemanticIdentity(identity) {
  if (isRuntimeBlockerCode(identity)) return "public_mechanical_code";
  const privateKind = getPrivateCauseKind(identity);
  if (privateKind === "launcher_action_token") return "private_launcher_token";
  if (privateKind !== null) return "private_launcher_cause";
  if (typeof identity === "string" && NON_REGISTRABLE_AUTHORITY_IDENTITY_SET.has(identity)) {
    return "authenticated_authority";
  }
  return isDeclaredPackageLocalIdentity(identity) ? "private_package_cause" : "unrecognized";
}

export function isPreservableSemanticIdentity(identity) {
  return isRuntimeBlockerCode(identity) || isDeclaredPackageLocalIdentity(identity);
}

export function projectPublicBlockerCodeForIdentity(identity) {
  if (isRuntimeBlockerCode(identity)) return identity;
  const namespace = getPackageLocalIdentityNamespace(identity);
  return namespace === null ? null : namespace.public_projection;
}

export function loadRuntimeBlockerTaxonomy() {

  return {
    schema_version: RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION,
    descriptor_path: RUNTIME_BLOCKER_TAXONOMY_DESCRIPTOR_RELATIVE_PATH,
    owner: RUNTIME_BLOCKER_TAXONOMY_OWNER,
    description: RUNTIME_BLOCKER_DESCRIPTOR.description,
    code_categories: RUNTIME_BLOCKER_CATEGORY_VALUES.slice(),
    codes: RUNTIME_BLOCKER_DESCRIPTOR.codes.map((entry) => ({
      code: entry.code,
      category: entry.category,
      actor_recovery: entry.actor_recovery ?? null,
      blocking: Boolean(entry.blocking),
      summary: entry.summary,
      detail: entry.detail ?? null,
      consumer_notes: entry.consumer_notes ?? null,

      recovery: Object.hasOwn(entry, "recovery")
        ? JSON.parse(JSON.stringify(entry.recovery))
        : null,
      aliases: Object.hasOwn(entry, "aliases") ? entry.aliases.slice() : [],
      wk_0532_subset: Object.hasOwn(entry, "wk_0532_subset") ? entry.wk_0532_subset : false
    })),
    actor_recovery_values: RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values.slice(),
    graph_impact_state_map: JSON.parse(
      JSON.stringify(RUNTIME_BLOCKER_DESCRIPTOR.graph_impact_state_map)
    ),
    wk_0532_bootstrap_subset: WK_0532_BOOTSTRAP_SUBSET.slice()
  };
}

export async function readRuntimeBlockerDescriptorFile(
  descriptorPath = DEFAULT_DESCRIPTOR_PATH
) {
  return readFile(descriptorPath, "utf8");
}

for (const code of WK_0532_BOOTSTRAP_SUBSET) {
  if (!codeMap.has(code)) {
    throw new Error(
      `runtime-blocker-codes.v1.json declares WK-0532 subset code "${code}" that is not in the codes array`
    );
  }
}

for (const category of RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES) {
  if (!RUNTIME_BLOCKER_CATEGORY_VALUES.includes(category)) {
    throw new Error(
      `runtime blocker dispatch-facing category "${category}" is not a declared descriptor code category`
    );
  }
}
