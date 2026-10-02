

import { createHash } from "node:crypto";

import { observeExecutable } from "./runtime-inputs/executable-lookup.mjs";
import {
  fingerprintPopulation,
  measurePopulationContent
} from "./runtime-inputs/population-identity.mjs";

export const SIDECAR_PROVIDER_INPUT_RECORD_SCHEMA = "sidecar-provider-input.v2";

export const SIDECAR_PROVIDER_INPUT_FACETS = Object.freeze([
  "committed_inputs", "tool", "settings", "dependencies", "invocation"
]);

function canonical(value, identity = false) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry, identity)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => !identity || key !== "fingerprint").sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key], identity)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a nonempty string`);
  return value;
}

function committedDigest(entries) {
  if (!Array.isArray(entries)) throw new TypeError("provider input committedEntries must be an array");
  const hash = createHash("sha256");
  const seen = new Set();
  for (const entry of [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    const entryPath = text(entry?.path, "committed input path");
    if (seen.has(entryPath)) throw new TypeError(`duplicate committed input path: ${entryPath}`);
    seen.add(entryPath);
    hash.update(`${entryPath}\0${text(entry.mode, "committed input mode")}\0${text(entry.blob_oid, "committed input blob_oid")}\n`);
  }
  return { entry_count: seen.size, digest: `sha256:${hash.digest("hex")}` };
}

function settingsFacet(settings) {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("provider input settings must be an object");
  }
  return Object.fromEntries(Object.keys(settings).sort().map((key) => {
    const value = settings[key];
    if (value !== null && typeof value !== "string") {
      throw new TypeError(`provider input setting ${key} must be a string or null`);
    }
    return [key, value];
  }));
}

function invocationFacet(invocation) {
  if (!Array.isArray(invocation?.args) || invocation.args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("provider input invocation.args must be an array of strings");
  }
  if (typeof invocation.commit_sensitive !== "boolean") {
    throw new TypeError("provider input invocation.commit_sensitive must be a boolean");
  }
  return { args: [...invocation.args], commit_sensitive: invocation.commit_sensitive };
}

export function createSidecarProviderInputRecord({ provider, project, committedEntries, tool,
  settings = {}, dependencies = null, invocation }) {
  if (!Array.isArray(tool)) throw new TypeError("provider input tool must be an array of observations");
  return Object.freeze(structuredClone({
    schema: SIDECAR_PROVIDER_INPUT_RECORD_SCHEMA,
    provider: text(provider, "provider"),
    project: text(project, "project"),
    committed_inputs: committedDigest(committedEntries),
    tool,
    settings: settingsFacet(settings),
    dependencies,
    invocation: invocationFacet(invocation)
  }));
}

export function compareSidecarProviderInputRecords(prior, current) {
  if (!prior || prior.schema !== SIDECAR_PROVIDER_INPUT_RECORD_SCHEMA ||
      !current || current.schema !== SIDECAR_PROVIDER_INPUT_RECORD_SCHEMA) {
    return Object.freeze({ equal: false, current: false, changed: Object.freeze(["record"]) });
  }
  const changed = SIDECAR_PROVIDER_INPUT_FACETS.filter((facet) =>
    canonical(prior[facet], true) !== canonical(current[facet], true));
  if (prior.provider !== current.provider || prior.project !== current.project) changed.unshift("project");
  const equal = changed.length === 0;
  return Object.freeze({ equal, current: equal && canonical(prior) === canonical(current),
    changed: Object.freeze(changed) });
}

export function withSidecarProviderInputFacets(record, facets) {
  return Object.freeze(structuredClone({ ...record, ...facets }));
}

function observePopulation(population, prior, measure) {
  const sorted = [...population].sort();
  try {
    const fingerprint = fingerprintPopulation(sorted);
    const kept = prior && typeof prior.content_digest === "string" && prior.fingerprint === fingerprint &&
      canonical(prior.population) === canonical(sorted);
    const content_digest = kept ? prior.content_digest
      : measure ? measurePopulationContent(sorted).content_digest : null;
    return { population: sorted, content_digest, fingerprint };
  } catch (error) {
    return { population: sorted, state: "unavailable", code: error?.code ?? "unmeasurable" };
  }
}

export function observeSidecarProviderTools(roles, searchPath, { prior = null, measure = true } = {}) {
  return roles.map(({ role, command, executable, population }) => {
    const observed = observeExecutable(executable === undefined ? { command, searchPath } : { executable });
    if (observed.status === "absent") return { role, status: "absent" };
    if (observed.status !== "found") {
      return { role, status: "failed", code: observed.code, message: observed.message };
    }
    const previous = prior?.find((entry) => entry.role === role && entry.status === "found" &&
      entry.resolved_path === observed.resolved_path);
    const measured = observePopulation(population(observed.resolved_path), previous, measure);
    if (measured.state === "unavailable") {
      return { role, status: "failed", code: "runtime_input_population_unmeasurable",
        message: `${role} population ${measured.population.join(", ")} could not be measured: ${measured.code}` };
    }
    return { role, status: "found", resolved_path: observed.resolved_path, ...measured };
  });
}

export function observeSidecarProviderDependencies(population, { prior = null, measure = true } = {}) {
  if (population === null) return null;
  return observePopulation(population, prior, measure);
}
