

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
      aliases: Array.isArray(entry.aliases) ? entry.aliases.slice() : [],
      wk_0532_subset: Boolean(entry.wk_0532_subset)
    })),
    actor_recovery_values: Array.isArray(RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values)
      ? RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values.slice()
      : [],
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
