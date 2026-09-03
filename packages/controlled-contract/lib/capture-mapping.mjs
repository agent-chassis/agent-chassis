

import {
  assertAdmittedProofPackSnapshot,
  loadAdmittedProofPack
} from "./admitted-proof-packs.mjs";
import {
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";
import {
  EVALUATION_INPUT_VERSION_V1,
  validateEvaluationInputSchemaV1
} from "./verification-profile-schema-v1.mjs";

const CAPTURE_ROLE_DEFECTS = Object.freeze({
  ROLE_UNFILLABLE: "role_unfillable",
  TYPE_TERM_UNSUPPORTED: "type_term_unsupported",
  IDENTITY_KIND_UNSUPPORTED: "identity_kind_unsupported",
  CARDINALITY_INVALID: "cardinality_invalid",
  REFERENCE_IDENTITY_CONFLICT: "reference_identity_conflict"
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnosticScalar(value) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean": return value;
    case "function": return "[function]";
    case "symbol": return "[symbol]";
    case "bigint": return "[bigint]";
    default: return "[object]";
  }
}

function createCaptureResultFactory({ schemaVersion, identity = {}, nullFields = [] } = {}) {
  const fixedIdentity = { ...identity };
  const emptyAdditional = Object.fromEntries(nullFields.map((field) => [field, null]));
  return Object.freeze({
    refuse(code, reason, detail = null) {
      return deepFreeze({
        schema_version: schemaVersion,
        mapped: false,
        ...fixedIdentity,
        source: null,
        references: null,
        evaluation_input: null,
        ...emptyAdditional,
        refusal: {
          code,
          reason,
          detail: detail === null ? null : structuredClone(detail)
        }
      });
    },
    accept({ source, references, evaluationInput, additional = {} } = {}) {
      return deepFreeze({
        schema_version: schemaVersion,
        mapped: true,
        ...fixedIdentity,
        source,
        references,
        evaluation_input: evaluationInput,
        ...emptyAdditional,
        ...additional,
        refusal: null
      });
    }
  });
}

async function resolveCapturePackSnapshot({ pack, profileId }) {
  if (pack === null || pack === undefined) {
    return { admitted: await loadAdmittedProofPack(profileId), unrecognized: false };
  }
  try {
    return { admitted: assertAdmittedProofPackSnapshot(pack), unrecognized: false };
  } catch {
    return { admitted: null, unrecognized: true };
  }
}

function capturePackIdentityMismatch(profile, { profileId, profileVersion }) {
  if (profile.profile_id === profileId && profile.profile_version === profileVersion) {
    return null;
  }
  return {
    expected: { profile_id: profileId, profile_version: profileVersion },
    supplied: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version
    }
  };
}

function resolveExactlyOneEvaluationStage(profile) {
  const stages = profile.evaluation_stages ?? [];
  if (stages.length !== 1 || typeof stages[0] !== "string" || stages[0].length === 0) {
    return { stage: null, declaredStageCount: stages.length };
  }
  return { stage: stages[0], declaredStageCount: stages.length };
}

function selectAllowedTerm(preferred, allowed) {
  if (allowed === undefined || allowed === null) return preferred[0];
  return preferred.find((candidate) => allowed.includes(candidate)) ?? null;
}

function cardinalityMismatch(cardinality, count) {
  if (cardinality === "exactly_one" && count !== 1) return "exactly_one";
  if (cardinality === "one_or_more" && count < 1) return "one_or_more";
  if (cardinality === "zero_or_one" && count > 1) return "zero_or_one";
  return null;
}

function planCaptureRoleBindings(profile, plan) {
  const declared = profile.reference_roles ?? [];
  const plannedRoles = plan.map(({ role }) => role);
  const unfillable = declared
    .map(({ role }) => role)
    .filter((role) => !plannedRoles.includes(role));
  if (unfillable.length > 0) {
    return {
      bindings: null,
      references: null,
      defect: {
        kind: CAPTURE_ROLE_DEFECTS.ROLE_UNFILLABLE,
        detail: { unfillable_roles: [...unfillable].sort(compareCodeUnits) }
      }
    };
  }
  const bindings = [];
  const references = new Map();
  for (const definition of declared) {
    const role = definition.role;
    const entry = plan.find((candidate) => candidate.role === role);
    const typeTerm = selectAllowedTerm(entry.typeTerms, definition.allowed_type_terms);
    if (typeTerm === null) {
      return {
        bindings: null,
        references: null,
        defect: {
          kind: CAPTURE_ROLE_DEFECTS.TYPE_TERM_UNSUPPORTED,
          detail: { role, allowed_type_terms: [...(definition.allowed_type_terms ?? [])] }
        }
      };
    }
    const identityKind = selectAllowedTerm(
      entry.identityKinds, definition.allowed_identity_kinds
    );
    if (identityKind === null) {
      return {
        bindings: null,
        references: null,
        defect: {
          kind: CAPTURE_ROLE_DEFECTS.IDENTITY_KIND_UNSUPPORTED,
          detail: {
            role,
            allowed_identity_kinds: [...(definition.allowed_identity_kinds ?? [])]
          }
        }
      };
    }
    const members = entry.build(identityKind);
    const defectiveCardinality = cardinalityMismatch(definition.cardinality, members.length);
    if (defectiveCardinality !== null) {
      return {
        bindings: null,
        references: null,
        defect: {
          kind: CAPTURE_ROLE_DEFECTS.CARDINALITY_INVALID,
          detail: {
            role,
            cardinality: definition.cardinality,
            member_count: members.length
          }
        }
      };
    }
    bindings.push({
      role,
      reference_ids: members.map(({ reference_id: referenceId }) => referenceId)
    });
    for (const { reference_id: referenceId, identity } of members) {
      const reference = { reference_id: referenceId, type_term: typeTerm, identity };
      const existing = references.get(referenceId);
      if (existing === undefined) {
        references.set(referenceId, reference);
        continue;
      }
      if (!canonicalJsonBytes(existing).equals(canonicalJsonBytes(reference))) {
        return {
          bindings: null,
          references: null,
          defect: {
            kind: CAPTURE_ROLE_DEFECTS.REFERENCE_IDENTITY_CONFLICT,
            detail: { role, reference_id: referenceId }
          }
        };
      }
    }
  }
  return { bindings, references: [...references.values()], defect: null };
}

function assembleCaptureEvaluationInput({ stage, referenceBindings, numberBindings = [] }) {
  return {
    input_version: EVALUATION_INPUT_VERSION_V1,
    evaluation_stage: stage,
    reference_bindings: referenceBindings,
    number_bindings: numberBindings,
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    stable_evaluation: {}
  };
}

function captureEvaluationInputDiagnostics(evaluationInput) {
  if (validateEvaluationInputSchemaV1(evaluationInput)) return null;
  return structuredClone(validateEvaluationInputSchemaV1.errors ?? []);
}

function canonicalCaptureEvaluationInputJson(result, subject) {
  if (!isPlainObject(result) || result.mapped !== true || result.evaluation_input === null) {
    throw new TypeError(
      `canonical evaluation-input bytes require a mapped ${subject} result`
    );
  }
  return canonicalJsonBytes(result.evaluation_input, { file: true });
}

export {
  CAPTURE_ROLE_DEFECTS,
  assembleCaptureEvaluationInput,
  canonicalCaptureEvaluationInputJson,
  capturePackIdentityMismatch,
  captureEvaluationInputDiagnostics,
  cardinalityMismatch,
  createCaptureResultFactory,
  diagnosticScalar,
  isPlainObject,
  planCaptureRoleBindings,
  resolveCapturePackSnapshot,
  resolveExactlyOneEvaluationStage,
  selectAllowedTerm
};
