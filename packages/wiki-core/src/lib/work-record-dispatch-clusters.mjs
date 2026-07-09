

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  clone,
  compareArrays,
  isBashWrapperPath,
  isNonEmptyString,
  isObject,
  getShimWrapperPackageAndBasename,
  isShimDelegatePathForWrapper,
  isShimTestPathForWrapper,
  stringifyPathList,
  toNonNegativeInteger,
  uniqueBy
} from "./work-record-dispatch-shared.mjs";
import {
  evidencePathMatchesSubjectPath,
  graphImpactHasUnavailableSubjectPath,
  graphImpactMatchesSubject
} from "./work-record-dispatch-graph.mjs";
import {
  computeReviewedUnitSourceDigest,
  validateReviewAttestation
} from "./work-record-review-attestation.mjs";
import {
  computeAdmissionSidecarDigest,
  findPersistedWorkerAdmissionEvidenceEntry,
  normalizeAdmissionSidecarPath,
  sidecarBindsToPersistedEntry
} from "./work-record-admission-evidence-sidecar.mjs";

const EXTRACTION_SPLICE_ALLOWED_TARGET_OPERATIONS = new Set(["create", "modify"]);
const EXTRACTION_SPLICE_MAX_CHANGED_LINE_BUDGET = 200;
const EXTRACTION_SPLICE_REVIEW_ATTESTATION_CONTROL = "write_scope_total_loc";

function isExpiredEscalation(escalation, now) {
  if (!isNonEmptyString(escalation?.expires_at)) {
    return false;
  }

  const expiresAt = Date.parse(escalation.expires_at);
  const current = Date.parse(now);
  if (Number.isNaN(expiresAt) || Number.isNaN(current)) {
    return true;
  }
  return expiresAt <= current;
}

export function collectAcceptedEscalations(recordId, sliceId, writeScope, now, escalations) {
  const validMatches = [];
  const expiredMatches = [];
  const scopeMismatches = [];

  for (const escalation of Array.isArray(escalations) ? escalations : []) {
    if (!isObject(escalation) || escalation.kind !== "critical_blast_radius" || escalation.status !== "accepted") {
      continue;
    }

    const scope = isObject(escalation.scope) ? escalation.scope : {};
    if (scope.unit !== recordId || (scope.slice_id ?? null) !== (sliceId ?? null)) {
      continue;
    }

    const escalationWriteScope = stringifyPathList(scope.write_scope);
    const selectedWriteScope = stringifyPathList(writeScope);
    const writeScopeMatches = compareArrays(escalationWriteScope, selectedWriteScope);
    const expired = isExpiredEscalation(escalation, now);

    if (!writeScopeMatches) {
      scopeMismatches.push(escalation);
      continue;
    }
    if (expired) {
      expiredMatches.push(escalation);
      continue;
    }
    validMatches.push(escalation);
  }

  return {
    validMatches,
    expiredMatches,
    scopeMismatches
  };
}

export function maybeCollapseShimClusters(policy, subject, effectiveGraphState) {

  if (!effectiveGraphState?.graph_available) {
    return policy;
  }
  if (!policy?.split_recommendation?.required) {
    return policy;
  }
  if (!Array.isArray(policy.clusters) || policy.clusters.length <= 1) {
    return policy;
  }

  const allPaths = [
    ...(Array.isArray(subject?.write_scope) ? subject.write_scope : []),
    ...(Array.isArray(subject?.repo_paths) ? subject.repo_paths : [])
  ].filter(isNonEmptyString);

  const wrapperPaths = [...new Set(allPaths.filter(isBashWrapperPath))];
  if (wrapperPaths.length === 0) {
    return policy;
  }

  if (wrapperPaths.length !== 1) {
    return policy;
  }

  const wrapperPath = wrapperPaths[0];
  const wrapperInfo = getShimWrapperPackageAndBasename(wrapperPath);
  if (!wrapperInfo) {
    return policy;
  }

  const expectedShimTest = `tests/${wrapperInfo.basename}-shim.test.mjs`;
  const delegatePaths = allPaths.filter((candidatePath) =>
    isShimDelegatePathForWrapper(wrapperPath, candidatePath)
  );
  if (delegatePaths.length === 0 || !allPaths.includes(expectedShimTest)) {
    return policy;
  }

  const writeScope = Array.isArray(subject?.write_scope) ? subject.write_scope : [];
  const extraImplWriteScope = writeScope.filter(
    (p) =>
      !p.startsWith("wiki/") &&
      !p.startsWith("docs/") &&
      !isBashWrapperPath(p) &&
      p !== expectedShimTest
  );
  if (extraImplWriteScope.length > 0) {
    return policy;
  }

  const coordinationOnlyClusters = policy.clusters.filter((cluster) => {
    const clusterInputPaths = stringifyPathList(cluster?.input_paths);
    return (
      clusterInputPaths.length > 0 &&
      clusterInputPaths.every((p) => p.startsWith("wiki/") || p.startsWith("docs/"))
    );
  });
  const shimCandidateClusters = policy.clusters.filter(
    (cluster) => !coordinationOnlyClusters.includes(cluster)
  );

  const clusterDescriptors = shimCandidateClusters.map((cluster) => {
    const inputPaths = stringifyPathList(cluster?.input_paths);
    const hasWrapper = inputPaths.includes(wrapperPath);
    const hasDelegate = inputPaths.some((candidatePath) =>
      isShimDelegatePathForWrapper(wrapperPath, candidatePath)
    );
    const hasShimTest = inputPaths.some((candidatePath) =>
      isShimTestPathForWrapper(wrapperInfo.basename, candidatePath)
    );
    const roleCount = [hasWrapper, hasDelegate, hasShimTest].filter(Boolean).length;

    const allShimFamily = inputPaths.every(
      (p) =>
        p === wrapperPath ||
        isShimDelegatePathForWrapper(wrapperPath, p) ||
        p === expectedShimTest
    );

    return {
      cluster,
      inputPaths,
      hasWrapper,
      hasDelegate,
      hasShimTest,
      roleCount,
      allShimFamily
    };
  });

  if (clusterDescriptors.some((descriptor) => descriptor.roleCount === 0 || !descriptor.allShimFamily)) {
    return policy;
  }

  const wrapperClusters = clusterDescriptors.filter((descriptor) => descriptor.hasWrapper);
  const delegateClusters = clusterDescriptors.filter((descriptor) => descriptor.hasDelegate);
  const shimTestClusters = clusterDescriptors.filter((descriptor) => descriptor.hasShimTest);

  if (
    wrapperClusters.length === 0 ||
    delegateClusters.length === 0 ||
    shimTestClusters.length === 0
  ) {
    return policy;
  }

  const matchedClusterCount = new Set([
    ...wrapperClusters.map((descriptor) => descriptor.cluster),
    ...delegateClusters.map((descriptor) => descriptor.cluster),
    ...shimTestClusters.map((descriptor) => descriptor.cluster)
  ]).size;
  if (matchedClusterCount !== shimCandidateClusters.length || matchedClusterCount < 2 || matchedClusterCount > 3) {
    return policy;
  }

  const inputPaths = stringifyPathList([
    ...clusterDescriptors.flatMap((descriptor) => descriptor.inputPaths),
    ...coordinationOnlyClusters.flatMap((cluster) =>
      stringifyPathList(cluster?.input_paths)
    )
  ]);
  const affectedSurfaces = uniqueBy(
    policy.clusters.flatMap((cluster) =>
      Array.isArray(cluster.affected_surfaces) ? cluster.affected_surfaces : []
    ),
    (entry) => `${entry.kind}:${entry.path}`
  ).sort((left, right) =>
    `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`)
  );
  const likelyTests = uniqueBy(
    policy.clusters.flatMap((cluster) =>
      Array.isArray(cluster.likely_tests) ? cluster.likely_tests : []
    ),
    (entry) => entry.path
  ).sort((left, right) => left.path.localeCompare(right.path));
  const docsContracts = [
    ...new Set(
      policy.clusters.flatMap((cluster) =>
        Array.isArray(cluster.docs_contracts) ? cluster.docs_contracts : []
      )
    )
  ].sort((left, right) => left.localeCompare(right));
  const canonicalRefs = uniqueBy(
    policy.clusters.flatMap((cluster) =>
      Array.isArray(cluster.canonical_refs) ? cluster.canonical_refs : []
    ),
    (entry) => `${entry.id ?? ""}|${entry.path ?? ""}`
  );

  const collapsedSplitRec = {
    required: false,
    reason: "shim_wrapper_single_cluster.v1: collapsed wrapper, delegate, and shim test into a single shim_cluster"
  };

  const collapsedCluster = {
    cluster_id: "shim_cluster",
    input_paths: inputPaths,
    affected_surfaces: affectedSurfaces,
    likely_tests: likelyTests,
    docs_contracts: docsContracts,
    canonical_refs: canonicalRefs,
    derived_evidence: [
      {
        kind: "shim_wrapper_single_cluster_v1",
        rule: "shim_wrapper_single_cluster.v1",
        wrapper_path: wrapperPath,
        shim_test: expectedShimTest
      }
    ],
    confidence: "high",
    split_recommendation: collapsedSplitRec
  };

  return {
    ...policy,
    cluster_count: 1,
    clusters: [collapsedCluster],
    split_recommendation: collapsedSplitRec
  };
}

function isCoordinationOnlyCluster(cluster) {
  const clusterInputPaths = stringifyPathList(cluster?.input_paths);
  return (
    clusterInputPaths.length > 0 &&
    clusterInputPaths.every((p) => p.startsWith("wiki/") || p.startsWith("docs/"))
  );
}

function normalizeExtractionSpliceTargets(subject) {
  const expectedTargets = Array.isArray(subject?.expected_edit_targets)
    ? subject.expected_edit_targets
    : [];
  if (expectedTargets.length < 2) {
    return null;
  }

  const normalizedTargets = [];
  const seenPaths = new Set();
  for (const target of expectedTargets) {
    if (!isObject(target)) {
      return null;
    }
    if (target.optional === true) {
      return null;
    }

    const path = isNonEmptyString(target.path) ? target.path.trim() : null;
    const operation = isNonEmptyString(target.operation) ? target.operation.trim() : null;
    if (!path || !operation || !EXTRACTION_SPLICE_ALLOWED_TARGET_OPERATIONS.has(operation)) {
      return null;
    }
    if (
      path.endsWith("/") ||
      path.includes("*") ||
      path.startsWith("docs/") ||
      path.startsWith("wiki/") ||
      seenPaths.has(path)
    ) {
      return null;
    }
    seenPaths.add(path);
    normalizedTargets.push({
      path,
      operation,
      kind: isNonEmptyString(target.kind) ? target.kind.trim() : null,
      name: isNonEmptyString(target.name) ? target.name.trim() : null
    });
  }

  const expectedChangedLineBudget = toNonNegativeInteger(subject?.expected_changed_line_budget);
  if (
    expectedChangedLineBudget === null ||
    expectedChangedLineBudget > EXTRACTION_SPLICE_MAX_CHANGED_LINE_BUDGET
  ) {
    return null;
  }

  return {
    expectedChangedLineBudget,
    targets: normalizedTargets,
    targetPaths: stringifyPathList(normalizedTargets.map((target) => target.path))
  };
}

function resolveExtractionSpliceAdmissionEvidence(record, unit, sourceDigest, suppliedAdmissionEvidence) {
  if (isObject(suppliedAdmissionEvidence)) {
    return suppliedAdmissionEvidence;
  }

  const persistedEntry = findPersistedWorkerAdmissionEvidenceEntry(record, unit, sourceDigest);
  if (!persistedEntry) {
    return null;
  }
  if (isObject(persistedEntry.normalized_request)) {
    return clone(persistedEntry);
  }

  const sidecarPath = normalizeAdmissionSidecarPath(persistedEntry.sidecar_path);
  if (!sidecarPath || !isNonEmptyString(persistedEntry.sidecar_digest)) {
    return null;
  }

  const sidecar = JSON.parse(readFileSync(path.resolve(process.cwd(), sidecarPath), "utf8"));

  if (!sidecarBindsToPersistedEntry(sidecar, persistedEntry)) {
    return null;
  }
  if (computeAdmissionSidecarDigest(sidecar) !== persistedEntry.sidecar_digest) {
    return null;
  }
  return clone(sidecar);
}

function collectExtractionSpliceReviewAttestations(record, subject, unit, persistedAdmissionEvidence, now) {
  const sourceDigest = computeReviewedUnitSourceDigest({ record, unit: subject });
  const admissionEvidence = resolveExtractionSpliceAdmissionEvidence(
    record,
    unit,
    sourceDigest,
    persistedAdmissionEvidence
  );
  const attestations = uniqueBy(
    Array.isArray(admissionEvidence?.normalized_request?.evidence?.review_attestations)
      ? admissionEvidence.normalized_request.evidence.review_attestations
      : [],
    (entry) => (isNonEmptyString(entry?.attestation_id) ? entry.attestation_id.trim() : JSON.stringify(entry))
  );

  if (!isNonEmptyString(sourceDigest)) {
    return [];
  }

  const matchedAttestations = [];
  for (const attestation of attestations) {
    if (!isObject(attestation)) {
      continue;
    }

    const verdict = validateReviewAttestation(attestation, {
      repo: record?.repo,
      unit_address: unit?.address,
      source_digest: sourceDigest,
      required_role_class: attestation.reviewer_role_class,
      required_controls: [EXTRACTION_SPLICE_REVIEW_ATTESTATION_CONTROL],
      admitting_run_id: "extraction_splice_single_cluster.v1",
      now
    });

    if (verdict?.valid === true) {
      matchedAttestations.push(clone(attestation));
    }
  }

  return matchedAttestations;
}

function graphImpactCoversExtractionSpliceTargets(graphImpact, subject, unit, targetPaths) {
  if (!graphImpactMatchesSubject(graphImpact, subject, unit)) {
    return false;
  }

  const evidencePaths = stringifyPathList([
    ...(Array.isArray(graphImpact?.validated_paths) ? graphImpact.validated_paths : []),
    ...(Array.isArray(graphImpact?.input_paths) ? graphImpact.input_paths : [])
  ]);
  if (evidencePaths.length === 0) {
    return false;
  }

  const normalizedTargets = stringifyPathList(targetPaths);
  if (normalizedTargets.length === 0) {
    return false;
  }

  if (graphImpactHasUnavailableSubjectPath(graphImpact, normalizedTargets)) {
    return false;
  }

  return normalizedTargets.every((targetPath) =>
    evidencePaths.some((evidencePath) => evidencePathMatchesSubjectPath(targetPath, evidencePath))
  );
}

export function maybeCollapseExtractionSpliceClusters(policy, record, subject, unit, effectiveGraphState, graphImpact, persistedAdmissionEvidence, now) {

  if (!effectiveGraphState?.graph_available) {
    return policy;
  }
  if (!policy?.split_recommendation?.required) {
    return policy;
  }
  if (!Array.isArray(policy.clusters) || policy.clusters.length <= 1) {
    return policy;
  }

  const extractionTargets = normalizeExtractionSpliceTargets(subject);
  if (!extractionTargets) {
    return policy;
  }

  const matchedAttestations = collectExtractionSpliceReviewAttestations(record, subject, unit, persistedAdmissionEvidence, now);
  if (matchedAttestations.length === 0) {
    return policy;
  }

  const sourceTargets = extractionTargets.targets.filter((target) => target.operation === "modify");
  if (sourceTargets.length !== 1) {
    return policy;
  }

  const sourcePath = sourceTargets[0].path;

  const destinationTargets = extractionTargets.targets.filter((target) => target.path !== sourcePath);
  if (destinationTargets.length === 0) {
    return policy;
  }

  if (destinationTargets.some((target) => !EXTRACTION_SPLICE_ALLOWED_TARGET_OPERATIONS.has(target.operation))) {
    return policy;
  }

  const allTargetPaths = stringifyPathList(extractionTargets.targets.map((target) => target.path));
  if (!graphImpactCoversExtractionSpliceTargets(graphImpact, subject, unit, allTargetPaths)) {
    return policy;
  }

  const coordinationOnlyClusters = policy.clusters.filter((cluster) => isCoordinationOnlyCluster(cluster));
  const implementationClusters = policy.clusters.filter(
    (cluster) => !isCoordinationOnlyCluster(cluster)
  );
  const implementationPaths = stringifyPathList(
    implementationClusters.flatMap((cluster) => stringifyPathList(cluster?.input_paths))
  );
  if (!compareArrays(implementationPaths, allTargetPaths)) {
    return policy;
  }

  const affectedSurfaces = uniqueBy(
    policy.clusters.flatMap((cluster) =>
      Array.isArray(cluster.affected_surfaces) ? cluster.affected_surfaces : []
    ),
    (entry) => `${entry.kind}:${entry.path}`
  ).sort((left, right) =>
    `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`)
  );
  const likelyTests = uniqueBy(
    policy.clusters.flatMap((cluster) =>
      Array.isArray(cluster.likely_tests) ? cluster.likely_tests : []
    ),
    (entry) => entry.path
  ).sort((left, right) => left.path.localeCompare(right.path));
  const docsContracts = [
    ...new Set(
      policy.clusters.flatMap((cluster) =>
        Array.isArray(cluster.docs_contracts) ? cluster.docs_contracts : []
      )
    )
  ].sort((left, right) => left.localeCompare(right));
  const canonicalRefs = uniqueBy(
    policy.clusters.flatMap((cluster) =>
      Array.isArray(cluster.canonical_refs) ? cluster.canonical_refs : []
    ),
    (entry) => `${entry.id ?? ""}|${entry.path ?? ""}`
  );

  const collapsedSplitRec = {
    required: false,
    reason:
      "extraction_splice_single_cluster.v1: collapsed accepted extraction splice source and destination paths into a single logical cluster"
  };

  const collapsedCluster = {
    cluster_id: "extraction_splice_cluster",
    input_paths: stringifyPathList([
      ...implementationPaths,
      ...coordinationOnlyClusters.flatMap((cluster) => stringifyPathList(cluster?.input_paths))
    ]),
    affected_surfaces: affectedSurfaces,
    likely_tests: likelyTests,
    docs_contracts: docsContracts,
    canonical_refs: canonicalRefs,
    derived_evidence: [
      {
        kind: "extraction_splice_single_cluster_v1",
        rule: "extraction_splice_single_cluster.v1",
        source_path: sourcePath,
        destination_paths: stringifyPathList(destinationTargets.map((target) => target.path)),
        review_attestation_ids: stringifyPathList(
          matchedAttestations.map((attestation) => attestation.attestation_id)
        ),
        expected_changed_line_budget: extractionTargets.expectedChangedLineBudget,
        graph_coverage: {
          graph_available: true,
          target_paths: allTargetPaths
        }
      }
    ],
    confidence: "high",
    split_recommendation: collapsedSplitRec
  };

  return {
    ...policy,
    cluster_count: 1,
    clusters: [collapsedCluster],
    split_recommendation: collapsedSplitRec
  };
}
