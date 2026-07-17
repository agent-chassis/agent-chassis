

import {
  isObject,
  normalizeString,
  normalizeRepoPath,
  normalizeControlledValue,
  normalizeBoolean,
  normalizeProvenance,
  normalizeFacetProvenance,
  selectArrayCandidate
} from "./work-record-feature-vector-normalize.mjs";
import {
  WORK_UNIT_ACTIVITY_KIND_VALUES,
  WORK_UNIT_ARTIFACT_KIND_VALUES,
  WORK_UNIT_OPERATION_VALUES,
  WORK_UNIT_GRANULARITY_VALUES,
  WORK_UNIT_SCENARIO_KIND_VALUES,
  WORK_UNIT_VERIFICATION_METHOD_VALUES
} from "./work-record-feature-vector-vocabulary.mjs";

function normalizeActivityArtifactTargetEntry(entry, index) {
  if (!isObject(entry)) {
    return {
      id: `target-${index + 1}`,
      path: null,
      name: null,
      activity_kind: null,
      artifact_kind: null,
      operation: null,
      granularity: null,
      optional: false,
      facet_provenance: {
        id: "unavailable",
        path: "unavailable",
        name: "unavailable",
        activity_kind: "unavailable",
        artifact_kind: "unavailable",
        operation: "unavailable",
        granularity: "unavailable",
        optional: "unavailable"
      }
    };
  }

  const legacyKind = normalizeControlledValue(entry.kind, WORK_UNIT_GRANULARITY_VALUES);
  const path = normalizeRepoPath(entry.path ?? entry.file ?? entry.target ?? entry.repo_path ?? entry.repoPath);
  const name = normalizeString(entry.name ?? entry.symbol ?? entry.id);
  const activityKind = normalizeControlledValue(entry.activity_kind ?? entry.activityKind, WORK_UNIT_ACTIVITY_KIND_VALUES);
  const artifactKind = normalizeControlledValue(entry.artifact_kind ?? entry.artifactKind, WORK_UNIT_ARTIFACT_KIND_VALUES);
  const operation = normalizeControlledValue(entry.operation, new Set(WORK_UNIT_OPERATION_VALUES));
  const granularity =
    normalizeControlledValue(entry.granularity ?? entry.kind, new Set(WORK_UNIT_GRANULARITY_VALUES)) ?? legacyKind;
  const optional = normalizeBoolean(entry.optional) ?? false;
  const id = normalizeString(entry.id) ?? `target-${index + 1}`;

  return {
    id,
    path,
    name,
    activity_kind: activityKind,
    artifact_kind: artifactKind,
    operation,
    granularity,
    optional,
    facet_provenance: normalizeFacetProvenance(entry.facet_provenance, {
      id: normalizeString(entry.id) ? "authored_record" : "derived_normalizer",
      path: path ? "authored_record" : "unavailable",
      name: name ? "authored_record" : "unavailable",
      activity_kind: entry.activity_kind ?? entry.activityKind ? "authored_record" : "unavailable",
      artifact_kind: entry.artifact_kind ?? entry.artifactKind ? "authored_record" : "unavailable",
      operation: entry.operation ? "authored_record" : "unavailable",
      granularity: entry.granularity ? "authored_record" : legacyKind ? "derived_normalizer" : "unavailable",
      optional: entry.optional !== undefined ? "authored_record" : "unavailable"
    })
  };
}

function normalizeActivityArtifactTargetsFromSources(source, selectedSlice, inputKind = "feature_vector") {
  const rawTargets = inputKind === "canonical_work_record"
    ? selectArrayCandidate([selectedSlice, source], ["expected_edit_targets"])
    : selectArrayCandidate([source], ["activity_artifact_targets"]);
  return rawTargets.map((entry, index) => normalizeActivityArtifactTargetEntry(entry, index));
}

function normalizeScenarioEntry(entry, index) {
  if (!isObject(entry)) {
    return {
      id: `scenario-${index + 1}`,
      kind: null,
      scenario_kind: null,
      process_boundary: null,
      asserts_contract: null,
      asserts_provenance_field: null,
      uses_stub: null,
      runtime_mode: null,
      artifact_kind: null,
      facet_provenance: {
        id: "unavailable",
        kind: "unavailable",
        scenario_kind: "unavailable",
        process_boundary: "unavailable"
      }
    };
  }

  const kind = normalizeControlledValue(entry.kind ?? entry.scenario_kind, new Set(WORK_UNIT_SCENARIO_KIND_VALUES));
  const id = normalizeString(entry.id) ?? `scenario-${index + 1}`;
  const processBoundary = normalizeBoolean(entry.process_boundary);
  const artifactKind = normalizeControlledValue(entry.artifact_kind, new Set(WORK_UNIT_ARTIFACT_KIND_VALUES));
  const runtimeMode = normalizeString(entry.runtime_mode);
  const usesStub = normalizeString(entry.uses_stub);
  const assertsContract = normalizeString(entry.asserts_contract);
  const assertsProvenanceField = normalizeString(entry.asserts_provenance_field);

  return {
    id,
    kind,
    scenario_kind: kind,
    process_boundary: processBoundary ?? (kind === "process_boundary_crossing" ? true : null),
    asserts_contract: assertsContract,
    asserts_provenance_field: assertsProvenanceField,
    uses_stub: usesStub,
    runtime_mode: runtimeMode,
    artifact_kind: artifactKind,
    facet_provenance: normalizeFacetProvenance(entry.facet_provenance, {
      id: entry.id ? "authored_record" : "derived_normalizer",
      kind: entry.kind ?? entry.scenario_kind ? "authored_record" : "unavailable",
      scenario_kind: entry.scenario_kind ? "authored_record" : entry.kind ? "derived_normalizer" : "unavailable",
      process_boundary: entry.process_boundary !== undefined ? "authored_record" : "unavailable",
      asserts_contract: entry.asserts_contract ? "authored_record" : "unavailable",
      asserts_provenance_field: entry.asserts_provenance_field ? "authored_record" : "unavailable",
      uses_stub: entry.uses_stub ? "authored_record" : "unavailable",
      runtime_mode: entry.runtime_mode ? "authored_record" : "unavailable",
      artifact_kind: entry.artifact_kind ? "authored_record" : "unavailable"
    })
  };
}

function normalizeScenariosFromSources(source, selectedSlice, inputKind = "feature_vector") {
  const rawScenarios = inputKind === "canonical_work_record"
    ? selectArrayCandidate([selectedSlice, source], ["scenarios", "scenario_inventory", "scenarioInventory"])
    : selectArrayCandidate([source], ["scenarios"]);
  return rawScenarios.map((entry, index) => normalizeScenarioEntry(entry, index));
}

function normalizeEvidenceTargetReference(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  if (isObject(rawValue)) {
    const id = normalizeString(rawValue.id ?? rawValue.target_id ?? rawValue.scenario_id);
    const name = normalizeString(rawValue.name ?? rawValue.target_name);
    const kind = normalizeString(rawValue.kind);
    return id || name || kind ? { id, name, kind } : null;
  }

  return {
    id: normalizeString(rawValue),
    name: null,
    kind: null
  };
}

function resolveEvidenceTarget(reference, targetsById, scenariosById, targetsByName, scenariosByName) {
  const normalizedReference = normalizeEvidenceTargetReference(reference);
  if (!normalizedReference) {
    return {
      evidence_target: null,
      evidence_target_resolution_status: "not_applicable",
      resolved_evidence_target: null
    };
  }

  const directId = normalizedReference.id;
  if (directId) {
    const targetCandidate = targetsById.get(directId) ?? null;
    const scenarioCandidate = scenariosById.get(directId) ?? null;
    if (targetCandidate && !scenarioCandidate) {
      return {
        evidence_target: directId,
        evidence_target_resolution_status: "resolved",
        resolved_evidence_target: {
          kind: "activity_artifact_target",
          id: directId,
          name: targetCandidate.name
        }
      };
    }
    if (scenarioCandidate && !targetCandidate) {
      return {
        evidence_target: directId,
        evidence_target_resolution_status: "resolved",
        resolved_evidence_target: {
          kind: "scenario",
          id: directId,
          name: scenarioCandidate.id
        }
      };
    }
    if (targetCandidate && scenarioCandidate) {
      return {
        evidence_target: directId,
        evidence_target_resolution_status: "ambiguous",
        resolved_evidence_target: null
      };
    }
  }

  const name = normalizedReference.name ?? directId;
  if (name) {
    const targetCandidates = targetsByName.get(name) ?? [];
    const scenarioCandidates = scenariosByName.get(name) ?? [];
    const uniqueCandidates = [...targetCandidates, ...scenarioCandidates];
    if (uniqueCandidates.length === 1) {
      const candidate = uniqueCandidates[0];
      return {
        evidence_target: name,
        evidence_target_resolution_status: "resolved",
        resolved_evidence_target: candidate.kind === "scenario"
          ? { kind: "scenario", id: candidate.id, name: candidate.name }
          : { kind: "activity_artifact_target", id: candidate.id, name: candidate.name }
      };
    }
    if (uniqueCandidates.length > 1) {
      return {
        evidence_target: name,
        evidence_target_resolution_status: "ambiguous",
        resolved_evidence_target: null
      };
    }
  }

  return {
    evidence_target: directId ?? name,
    evidence_target_resolution_status: "unresolved",
    resolved_evidence_target: null
  };
}

function normalizeAcceptanceCriterionEntry(entry, index, resolutionIndex) {
  if (!isObject(entry)) {
    const text = normalizeString(entry);
    return {
      id: `criterion-${index + 1}`,
      text,
      verification_method: null,
      evidence_target: null,
      evidence_target_resolution_status: "not_applicable",
      resolved_evidence_target: null,
      facet_provenance: {
        text: text ? "authored_record" : "unavailable",
        verification_method: "unavailable",
        evidence_target: "unavailable",
        evidence_target_resolution_status: "not_applicable"
      }
    };
  }

  const text = normalizeString(entry.text ?? entry.criterion ?? entry.value);
  const verificationMethod = normalizeControlledValue(
    entry.verification_method ?? entry.verificationMethod,
    new Set(WORK_UNIT_VERIFICATION_METHOD_VALUES)
  );
  const evidenceTargetResolution = resolveEvidenceTarget(
    entry.evidence_target ?? entry.evidenceTarget,
    resolutionIndex.targetsById,
    resolutionIndex.scenariosById,
    resolutionIndex.targetsByName,
    resolutionIndex.scenariosByName
  );

  return {
    id: normalizeString(entry.id) ?? `criterion-${index + 1}`,
    text,
    verification_method: verificationMethod,
    evidence_target: evidenceTargetResolution.evidence_target,
    evidence_target_resolution_status: evidenceTargetResolution.evidence_target_resolution_status,
    resolved_evidence_target: evidenceTargetResolution.resolved_evidence_target,
    facet_provenance: normalizeFacetProvenance(entry.facet_provenance, {
      id: entry.id ? "authored_record" : "derived_normalizer",
      text: text ? "authored_record" : "unavailable",
      verification_method: entry.verification_method ?? entry.verificationMethod ? "authored_record" : "unavailable",
      evidence_target: entry.evidence_target ?? entry.evidenceTarget ? "authored_record" : "unavailable",
      evidence_target_resolution_status:
        evidenceTargetResolution.evidence_target_resolution_status === "resolved"
          ? "derived_normalizer"
          : evidenceTargetResolution.evidence_target_resolution_status === "not_applicable"
            ? "not_applicable"
            : "derived_normalizer"
    })
  };
}

function buildAcceptanceResolutionIndex(activityArtifactTargets, scenarios) {
  const targetsById = new Map();
  const targetsByName = new Map();
  const scenariosById = new Map();
  const scenariosByName = new Map();

  for (const target of Array.isArray(activityArtifactTargets) ? activityArtifactTargets : []) {
    if (!isObject(target)) {
      continue;
    }
    const id = normalizeString(target.id);
    const name = normalizeString(target.name);
    if (id) {
      targetsById.set(id, target);
    }
    if (name) {
      const list = targetsByName.get(name) ?? [];
      list.push(target);
      targetsByName.set(name, list);
    }
  }

  for (const scenario of Array.isArray(scenarios) ? scenarios : []) {
    if (!isObject(scenario)) {
      continue;
    }
    const id = normalizeString(scenario.id);
    const name = normalizeString(scenario.id);
    if (id) {
      scenariosById.set(id, scenario);
    }
    if (name) {
      const list = scenariosByName.get(name) ?? [];
      list.push(scenario);
      scenariosByName.set(name, list);
    }
  }

  return {
    targetsById,
    targetsByName,
    scenariosById,
    scenariosByName
  };
}

function normalizeAcceptanceMethodsFromSources(
  source,
  selectedSlice,
  activityArtifactTargets,
  scenarios,
  inputKind = "feature_vector"
) {
  const rawCriteria = inputKind === "canonical_work_record"
    ? selectArrayCandidate([selectedSlice?.acceptance, source.acceptance], ["criteria"])
    : selectArrayCandidate([source], ["acceptance_methods"]);

  const resolutionIndex = buildAcceptanceResolutionIndex(activityArtifactTargets, scenarios);
  return rawCriteria.map((entry, index) => normalizeAcceptanceCriterionEntry(entry, index, resolutionIndex));
}

function normalizeEscalations(value = []) {
  return (Array.isArray(value) ? value : []).map((entry, index) => {
    if (!isObject(entry)) {
      return {
        id: `escalation-${index + 1}`,
        kind: null,
        status: null,
        provenance: "unavailable"
      };
    }
    return {
      id: normalizeString(entry.id) ?? `escalation-${index + 1}`,
      kind: normalizeString(entry.kind),
      status: normalizeString(entry.status),
      provenance: normalizeProvenance(entry.provenance)
    };
  });
}

export {
  normalizeActivityArtifactTargetsFromSources,
  normalizeScenariosFromSources,
  normalizeAcceptanceMethodsFromSources,
  normalizeEscalations
};
