

import { isObject } from "./work-record-admission-shared.mjs";

const NODE_ENGINE_BLAST_RADIUS_SEVERITY_BY_LOCAL_LEVEL = Object.freeze({
  low: "none",
  medium: "elevated",
  elevated: "elevated",
  critical: "critical"
});

function normalizeCarrierClusterCount(value) {
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function normalizeNodeEngineBlastRadiusSeverity(value) {
  if (typeof value !== "string") {
    return null;
  }
  return NODE_ENGINE_BLAST_RADIUS_SEVERITY_BY_LOCAL_LEVEL[value.trim().toLowerCase()] ?? null;
}

function normalizeNodeEngineCarrierFacts(value) {
  if (!isObject(value)) {
    return null;
  }
  const clusterCount = normalizeCarrierClusterCount(value.cluster_count);
  if (clusterCount === null) {
    return null;
  }

  const facts = {
    cluster_count: clusterCount
  };
  const severity = normalizeNodeEngineBlastRadiusSeverity(value.blast_radius_severity);
  if (severity) {
    facts.blast_radius_severity = severity;
  } else if (
    typeof value.blast_radius_severity === "string" &&
    ["none", "elevated", "critical"].includes(value.blast_radius_severity.trim().toLowerCase())
  ) {
    facts.blast_radius_severity = value.blast_radius_severity.trim().toLowerCase();
  }
  return facts;
}

export function createNodeEngineCarrierFactsFromDispatchReadiness(rawDispatchReadiness, dispatchReadiness) {
  const normalizedClusterCount = normalizeCarrierClusterCount(
    Array.isArray(dispatchReadiness?.clusters) ? dispatchReadiness.clusters.length : null
  );
  const clusterCount = normalizedClusterCount === 0 && dispatchReadiness?.dispatchable === true
    ? 1
    : normalizedClusterCount;
  if (clusterCount === null) {
    return null;
  }

  const rawBlastRadius = isObject(rawDispatchReadiness?.blast_radius)
    ? rawDispatchReadiness.blast_radius
    : null;
  const severity = normalizeNodeEngineBlastRadiusSeverity(rawBlastRadius?.level);
  return {
    cluster_count: clusterCount,
    ...(severity ? { blast_radius_severity: severity } : {})
  };
}

export function createNodeEngineCarrierFactsFromDerivedEvidence(derivedEvidence, normalizedRequest) {
  const storedFacts =
    normalizeNodeEngineCarrierFacts(normalizedRequest?.evidence?.node_engine_carrier_facts) ??
    normalizeNodeEngineCarrierFacts(normalizedRequest?.node_engine_carrier_facts) ??
    normalizeNodeEngineCarrierFacts(derivedEvidence?.metric_summary?.node_engine_carrier_facts);
  if (storedFacts) {
    return storedFacts;
  }

  const clusterCount = normalizeCarrierClusterCount(derivedEvidence?.metric_summary?.cluster_count);
  return clusterCount === null ? null : { cluster_count: clusterCount };
}

