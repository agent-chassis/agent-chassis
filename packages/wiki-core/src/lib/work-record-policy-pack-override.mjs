import { existsSync, readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  cloneJson,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
  sortStrings
} from "./work-record-admission-shared.mjs";
import { WORK_RECORD_POLICY_PACK_V1 } from "./work-record-policy-pack-v1.mjs";

export const WORK_RECORD_POLICY_PACK_OVERRIDE_SCHEMA_VERSION =
  "worker-admission-policy-pack-override.v1";
export const WORK_RECORD_POLICY_PACK_OVERRIDE_DEFAULT_RELATIVE_PATH =
  "wiki/.worker-admission-policy-pack-override.json";

const POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES = Object.freeze({
  malformed_override: "worker_admission.policy_pack_override.malformed_override.v1",
  unknown_rule_id: "worker_admission.policy_pack_override.unknown_rule_id.v1",
  unknown_metric: "worker_admission.policy_pack_override.unknown_metric.v1",
  malformed_threshold: "worker_admission.policy_pack_override.malformed_threshold.v1",
  non_tunable_threshold: "worker_admission.policy_pack_override.non_tunable_threshold.v1",
  malformed_disable: "worker_admission.policy_pack_override.malformed_disable.v1"
});

function nonNegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function diagnostic(code, message, details = {}) {
  return {
    code,
    severity: "error",
    message,
    ...details
  };
}

function describeJsonRoot(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function ruleThresholdKey(kind, metric) {
  return `${kind}_when_${metric}_above`;
}

function normalizeWorkUnitAtomicityThresholdsFromPack(pack, workUnitRules) {
  const thresholds = cloneJson(pack.thresholds?.work_unit_atomicity ?? {});
  for (const rule of workUnitRules) {
    const metric = normalizeStringEntry(rule?.metric);
    if (!metric) {
      continue;
    }
    const reviewThreshold = nonNegativeIntegerOrNull(rule.review_threshold);
    if (reviewThreshold !== null && thresholds[ruleThresholdKey("review", metric)] === undefined) {
      thresholds[ruleThresholdKey("review", metric)] = reviewThreshold;
    }
    const denyThreshold = nonNegativeIntegerOrNull(rule.deny_threshold);
    if (denyThreshold !== null && thresholds[ruleThresholdKey("deny", metric)] === undefined) {
      thresholds[ruleThresholdKey("deny", metric)] = denyThreshold;
    }
  }
  return thresholds;
}

function buildRuleIndex(policyPack) {
  const rulesByFacet = new Map();
  const allRuleIds = new Set();
  const allMetrics = new Set();

  for (const [facet, rules] of Object.entries(isObject(policyPack?.rules) ? policyPack.rules : {})) {
    const facetRules = new Map();
    for (const rule of Array.isArray(rules) ? rules : []) {
      const id = normalizeStringEntry(rule?.id);
      const metric = normalizeStringEntry(rule?.metric);
      if (!id) {
        continue;
      }
      facetRules.set(id, rule);
      allRuleIds.add(id);
      if (metric) {
        allMetrics.add(metric);
      }
    }
    rulesByFacet.set(facet, facetRules);
  }

  return { rulesByFacet, allRuleIds, allMetrics };
}

function normalizeRuleOverrideEntries(value, diagnostics, pathLabel) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({
      path: `${pathLabel}[${index}]`,
      entry
    }));
  }
  if (isObject(value)) {
    return Object.entries(value).map(([id, entry]) => ({
      path: `${pathLabel}.${id}`,
      entry: isObject(entry) ? { id, ...entry } : { id, value: entry }
    }));
  }
  diagnostics.push(
    diagnostic(
      POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
      `${pathLabel} must be an object or array`,
      { path: pathLabel }
    )
  );
  return [];
}

function normalizeDisabledRuleEntries(value, diagnostics, pathLabel) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({ path: `${pathLabel}[${index}]`, entry }));
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([facet, entries]) =>
      normalizeDisabledRuleEntries(entries, diagnostics, `${pathLabel}.${facet}`).map((entry) => ({
        ...entry,
        facet
      }))
    );
  }
  diagnostics.push(
    diagnostic(
      POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_disable,
      `${pathLabel} must be an object or array`,
      { path: pathLabel }
    )
  );
  return [];
}

function normalizeRuleOverrideRoot(normalizedOverride, diagnostics) {
  const candidates = [
    ["rules", normalizedOverride.rules],
    ["rule_overrides", normalizedOverride.rule_overrides],
    ["ruleOverrides", normalizedOverride.ruleOverrides]
  ];
  let selectedRoot = {};
  let selectedPath = "rules";
  let selected = false;

  for (const [pathLabel, value] of candidates) {
    if (!Object.hasOwn(normalizedOverride, pathLabel)) {
      continue;
    }
    if (!isObject(value)) {
      diagnostics.push(
        diagnostic(
          POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
          `${pathLabel} must be an object`,
          { path: pathLabel }
        )
      );
      continue;
    }
    if (!selected) {
      selectedRoot = value;
      selectedPath = pathLabel;
      selected = true;
    }
  }

  return { root: selectedRoot, path: selectedPath };
}

function validateThreshold(value, { ruleId, metric, field, pathLabel }, diagnostics) {
  if (value === undefined) {
    return undefined;
  }
  const normalized = nonNegativeIntegerOrNull(value);
  if (normalized === null) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_threshold,
        `${pathLabel}.${field} for rule ${ruleId} metric ${metric} must be a non-negative integer`,
        { rule_id: ruleId, metric, field, path: `${pathLabel}.${field}` }
      )
    );
    return undefined;
  }
  return normalized;
}

function validateThresholdOverrideFields(overrideEntry, { ruleId, metric, kind, pathLabel }, diagnostics) {
  const fieldNames = kind === "review"
    ? ["review_threshold", "reviewThreshold"]
    : ["deny_threshold", "denyThreshold"];
  let selected;

  for (const field of fieldNames) {
    if (!Object.hasOwn(overrideEntry, field)) {
      continue;
    }
    const normalized = validateThreshold(
      overrideEntry[field],
      { ruleId, metric, field, pathLabel },
      diagnostics
    );
    if (selected === undefined && normalized !== undefined) {
      selected = normalized;
    }
  }

  return selected;
}

function hasThresholdOverride(overrideEntry, kind) {
  const fieldNames = kind === "review"
    ? ["review_threshold", "reviewThreshold"]
    : ["deny_threshold", "denyThreshold"];
  return fieldNames.some((field) => Object.hasOwn(overrideEntry, field));
}

function thresholdOverrideIsTunable(rule, kind) {
  const explicitTunable = rule?.tunable_thresholds ?? rule?.tunableThresholds;
  if (Array.isArray(explicitTunable)) {
    return explicitTunable.includes(kind);
  }
  if (isObject(explicitTunable) && Object.hasOwn(explicitTunable, kind)) {
    return explicitTunable[kind] !== false;
  }

  const explicitNonTunable = rule?.non_tunable_thresholds ?? rule?.nonTunableThresholds;
  if (Array.isArray(explicitNonTunable) && explicitNonTunable.includes(kind)) {
    return false;
  }
  if (isObject(explicitNonTunable) && explicitNonTunable[kind] === true) {
    return false;
  }

  const snakeField = `${kind}_threshold_tunable`;
  const camelField = `${kind}ThresholdTunable`;
  if (Object.hasOwn(rule, snakeField)) {
    return rule[snakeField] !== false;
  }
  if (Object.hasOwn(rule, camelField)) {
    return rule[camelField] !== false;
  }

  return true;
}

function rejectNonTunableThresholdOverride({ ruleId, metric, kind, pathLabel }, diagnostics) {
  diagnostics.push(
    diagnostic(
      POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.non_tunable_threshold,
      `${pathLabel}.${kind}_threshold for rule ${ruleId} metric ${metric} is not tunable through the policy-pack override`,
      { rule_id: ruleId, metric, field: `${kind}_threshold`, path: `${pathLabel}.${kind}_threshold` }
    )
  );
}

function applyThresholdOverride({ mergedPack, rule, overrideEntry, pathLabel, diagnostics }) {
  const ruleId = normalizeStringEntry(rule.id);
  const metric = normalizeStringEntry(rule.metric);
  if (!metric) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.unknown_metric,
        `rule ${ruleId} does not declare a supported metric`,
        { rule_id: ruleId, metric: null, path: pathLabel }
      )
    );
    return;
  }

  const reviewThreshold = validateThresholdOverrideFields(
    overrideEntry,
    { ruleId, metric, kind: "review", pathLabel },
    diagnostics
  );
  if (hasThresholdOverride(overrideEntry, "review") && !thresholdOverrideIsTunable(rule, "review")) {
    rejectNonTunableThresholdOverride({ ruleId, metric, kind: "review", pathLabel }, diagnostics);
    return;
  }
  if (hasThresholdOverride(overrideEntry, "deny") && !thresholdOverrideIsTunable(rule, "deny")) {
    rejectNonTunableThresholdOverride({ ruleId, metric, kind: "deny", pathLabel }, diagnostics);
    return;
  }
  const denyThreshold = validateThresholdOverrideFields(
    overrideEntry,
    { ruleId, metric, kind: "deny", pathLabel },
    diagnostics
  );
  if (reviewThreshold !== undefined) {
    rule.review_threshold = reviewThreshold;
    mergedPack.thresholds.work_unit_atomicity[ruleThresholdKey("review", metric)] = reviewThreshold;
  }
  if (denyThreshold !== undefined) {
    rule.deny_threshold = denyThreshold;
    mergedPack.thresholds.work_unit_atomicity[ruleThresholdKey("deny", metric)] = denyThreshold;
  }
}

function applyRuleOverride({
  mergedPack,
  overrideEntry,
  rulesByFacet,
  allRuleIds,
  allMetrics,
  disabledRuleIds,
  pathLabel,
  diagnostics
}) {
  if (!isObject(overrideEntry)) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
        `${pathLabel} must be an object`,
        { path: pathLabel }
      )
    );
    return;
  }

  const ruleId = normalizeStringEntry(overrideEntry.id ?? overrideEntry.rule_id ?? overrideEntry.ruleId);
  if (!ruleId || !allRuleIds.has(ruleId)) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.unknown_rule_id,
        `${pathLabel} references unknown rule id ${ruleId ?? "<missing>"}`,
        { rule_id: ruleId, path: pathLabel }
      )
    );
    return;
  }

  const facet = normalizeStringEntry(overrideEntry.facet) ?? "work_unit_atomicity";
  const facetRules = rulesByFacet.get(facet);
  const baseRule = facetRules?.get(ruleId);
  if (!baseRule) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.unknown_rule_id,
        `${pathLabel} references rule ${ruleId} outside facet ${facet}`,
        { rule_id: ruleId, facet, path: pathLabel }
      )
    );
    return;
  }

  const metric = normalizeStringEntry(overrideEntry.metric);
  if (metric && (!allMetrics.has(metric) || metric !== baseRule.metric)) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.unknown_metric,
        `${pathLabel} for rule ${ruleId} references unsupported metric ${metric}`,
        { rule_id: ruleId, metric, path: `${pathLabel}.metric` }
      )
    );
    return;
  }

  const targetRule = mergedPack.rules[facet].find((rule) => rule.id === ruleId);
  applyThresholdOverride({
    mergedPack,
    rule: targetRule,
    overrideEntry,
    pathLabel,
    diagnostics
  });

  if (Object.hasOwn(overrideEntry, "disabled") || Object.hasOwn(overrideEntry, "enabled")) {
    const hasDisabled = Object.hasOwn(overrideEntry, "disabled");
    const hasEnabled = Object.hasOwn(overrideEntry, "enabled");
    if (hasDisabled && typeof overrideEntry.disabled !== "boolean") {
      diagnostics.push(
        diagnostic(
          POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_disable,
          `${pathLabel}.disabled for rule ${ruleId} must be a boolean`,
          { rule_id: ruleId, path: `${pathLabel}.disabled` }
        )
      );
      return;
    }
    if (hasEnabled && typeof overrideEntry.enabled !== "boolean") {
      diagnostics.push(
        diagnostic(
          POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_disable,
          `${pathLabel}.enabled for rule ${ruleId} must be a boolean`,
          { rule_id: ruleId, path: `${pathLabel}.enabled` }
        )
      );
      return;
    }
    const disabled = hasDisabled ? overrideEntry.disabled : overrideEntry.enabled === false;
    if (disabled) {
      targetRule.disabled = true;
      disabledRuleIds.add(ruleId);
    }
  }
}

function applyDisabledRuleEntry({ entry, pathLabel, allRuleIds, disabledRuleIds, diagnostics }) {
  const ruleId = isNonEmptyString(entry)
    ? String(entry).trim()
    : isObject(entry)
      ? normalizeStringEntry(entry.id ?? entry.rule_id ?? entry.ruleId)
      : null;
  if (!ruleId || !allRuleIds.has(ruleId)) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_disable,
        `${pathLabel} references unknown or malformed disabled rule ${ruleId ?? "<missing>"}`,
        { rule_id: ruleId, path: pathLabel }
      )
    );
    return;
  }
  disabledRuleIds.add(ruleId);
}

function normalizeOverrideValue(value) {
  if (!isObject(value)) {
    return {};
  }
  if (isObject(value.policy_pack_override)) {
    return value.policy_pack_override;
  }
  if (isObject(value.policyPackOverride)) {
    return value.policyPackOverride;
  }
  return value;
}

export function mergeWorkerAdmissionPolicyPackOverride({
  defaultPack = WORK_RECORD_POLICY_PACK_V1,
  override,
  overrideSource = null
} = {}) {
  const mergedPack = cloneJson(defaultPack);
  const diagnostics = [];

  if (override === undefined) {
    return {
      ok: true,
      source: "local_default",
      override_present: false,
      override_source: overrideSource,
      policy_pack: mergedPack,
      diagnostics
    };
  }

  if (!isObject(override)) {
    return {
      ok: false,
      source: "local_override_invalid",
      override_present: true,
      override_source: overrideSource,
      policy_pack: null,
      diagnostics: [
        diagnostic(
          POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
          `worker-admission policy override root must be a JSON object; received ${describeJsonRoot(override)}`,
          { path: "$", root_type: describeJsonRoot(override) }
        )
      ]
    };
  }

  const normalizedOverride = normalizeOverrideValue(override);

  if (Object.keys(normalizedOverride).length === 0) {
    return {
      ok: true,
      source: "local_default",
      override_present: false,
      override_source: overrideSource,
      policy_pack: mergedPack,
      diagnostics
    };
  }

  const { rulesByFacet, allRuleIds, allMetrics } = buildRuleIndex(defaultPack);
  const disabledRuleIds = new Set();
  const schemaVersion = normalizeStringEntry(normalizedOverride.schema_version);
  if (schemaVersion && schemaVersion !== WORK_RECORD_POLICY_PACK_OVERRIDE_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
        `policy pack override schema_version ${schemaVersion} is not supported`,
        { schema_version: schemaVersion, path: "schema_version" }
      )
    );
  }

  const ruleOverrideRoot = normalizeRuleOverrideRoot(normalizedOverride, diagnostics);
  for (const [facet, value] of Object.entries(ruleOverrideRoot.root)) {
    for (const { entry, path: entryPath } of normalizeRuleOverrideEntries(
      value,
      diagnostics,
      `${ruleOverrideRoot.path}.${facet}`
    )) {
      applyRuleOverride({
        mergedPack,
        overrideEntry: entry,
        rulesByFacet,
        allRuleIds,
        allMetrics,
        disabledRuleIds,
        pathLabel: entryPath,
        diagnostics
      });
    }
  }

  for (const { entry, path: entryPath } of normalizeDisabledRuleEntries(
    normalizedOverride.disabled_rules ?? normalizedOverride.disabledRules,
    diagnostics,
    "disabled_rules"
  )) {
    applyDisabledRuleEntry({
      entry,
      pathLabel: entryPath,
      allRuleIds,
      disabledRuleIds,
      diagnostics
    });
  }

  for (const ruleId of disabledRuleIds) {
    for (const [facet, rules] of Object.entries(mergedPack.rules)) {
      const targetRule = rules.find((rule) => rule.id === ruleId);
      if (targetRule) {
        targetRule.disabled = true;
        mergedPack.disabled_rule_ids = sortStrings([...(mergedPack.disabled_rule_ids ?? []), ruleId]);
        mergedPack.disabled_rules_by_facet = {
          ...(mergedPack.disabled_rules_by_facet ?? {}),
          [facet]: sortStrings([...(mergedPack.disabled_rules_by_facet?.[facet] ?? []), ruleId])
        };
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      source: "local_override_invalid",
      override_present: true,
      override_source: overrideSource,
      policy_pack: null,
      diagnostics
    };
  }

  return {
    ok: true,
    source: "local_override",
    override_present: true,
    override_source: overrideSource,
    policy_pack: mergedPack,
    diagnostics
  };
}

export function normalizeWorkUnitAtomicityPolicyProfileFromPack(policyPack, { source = null } = {}) {
  const pack = isObject(policyPack) ? policyPack : WORK_RECORD_POLICY_PACK_V1;
  const workUnitRules = Array.isArray(pack.rules?.work_unit_atomicity)
    ? pack.rules.work_unit_atomicity
    : [];
  return {
    profile_id: normalizeStringEntry(pack.profile_id) ?? WORK_RECORD_POLICY_PACK_V1.profile_id,
    profile_version: normalizeStringEntry(pack.profile_version) ?? WORK_RECORD_POLICY_PACK_V1.profile_version,
    source: normalizeStringEntry(source) ?? "policy_pack",
    thresholds: normalizeWorkUnitAtomicityThresholdsFromPack(pack, workUnitRules),
    rules: cloneJson(workUnitRules),
    disabled_rule_ids: sortStrings([
      ...(Array.isArray(pack.disabled_rule_ids) ? pack.disabled_rule_ids : []),
      ...workUnitRules
        .filter((rule) => rule?.disabled === true)
        .map((rule) => rule.id)
    ])
  };
}

export async function loadWorkspaceWorkerAdmissionPolicyPackOverride({
  workspaceRoot = process.cwd(),
  relativePath = WORK_RECORD_POLICY_PACK_OVERRIDE_DEFAULT_RELATIVE_PATH,
  defaultPack = WORK_RECORD_POLICY_PACK_V1
} = {}) {
  const overridePath = path.resolve(workspaceRoot, relativePath);
  try {
    await access(overridePath);
  } catch {
    return mergeWorkerAdmissionPolicyPackOverride({
      defaultPack,
      overrideSource: overridePath
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(overridePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      source: "local_override_invalid",
      override_present: true,
      override_source: overridePath,
      policy_pack: null,
      diagnostics: [
        diagnostic(
          POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
          `failed to read or parse worker-admission policy override at ${overridePath}: ${error.message}`,
          { path: overridePath }
        )
      ]
    };
  }

  return mergeWorkerAdmissionPolicyPackOverride({
    defaultPack,
    override: parsed,
    overrideSource: overridePath
  });
}

export function loadWorkspaceWorkerAdmissionPolicyPackOverrideSync({
  workspaceRoot = process.cwd(),
  relativePath = WORK_RECORD_POLICY_PACK_OVERRIDE_DEFAULT_RELATIVE_PATH,
  defaultPack = WORK_RECORD_POLICY_PACK_V1
} = {}) {
  const overridePath = path.resolve(workspaceRoot, relativePath);
  if (!existsSync(overridePath)) {
    return mergeWorkerAdmissionPolicyPackOverride({
      defaultPack,
      overrideSource: overridePath
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(overridePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      source: "local_override_invalid",
      override_present: true,
      override_source: overridePath,
      policy_pack: null,
      diagnostics: [
        diagnostic(
          POLICY_PACK_OVERRIDE_DIAGNOSTIC_CODES.malformed_override,
          `failed to read or parse worker-admission policy override at ${overridePath}: ${error.message}`,
          { path: overridePath }
        )
      ]
    };
  }

  return mergeWorkerAdmissionPolicyPackOverride({
    defaultPack,
    override: parsed,
    overrideSource: overridePath
  });
}
