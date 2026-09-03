import { DOMAINS } from "./projected-selection-constants.mjs";
import {
  canonicalValue,
  compareCodeUnits,
  domainSeparatedDigest
} from "./proof-aware-digest.mjs";
import {
  hasTrustedProjectedSelectionSupplement,
  registerAssessmentPackCycle
} from "./projected-selection-trust.mjs";

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function sameCanonical(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function assertCycleBinding(payload, binding) {
  const pairs = [
    ["contract", "contract"],
    ["compiled_proof_plan", "compiled_proof_plan"],
    ["assessment_manifest", "assessment_manifest"],
    ["per_pack_assessment", "per_pack_assessment"],
    ["pack_identity", "pack_identity"],
    ["profile_identity", "profile_identity"],
    ["guarantee_identity", "guarantee_identity"],
    ["admission_identity", "admission_identity"],
    ["evaluation_input", "evaluation_input"],
    ["exact_binding_declaration", "exact_binding_declaration"],
    ["exact_binding_result", "exact_binding_result"],
    ["exact_capture_source_set", "exact_capture_source_set"],
    ["projected_graph", "projected_graph"],
    ["binding_set_digest", "binding_set_digest"]
  ];
  if (payload.supplement !== undefined ||
      payload.projected_selection_supplement !== undefined) {
    throw new TypeError("assessment-pack cycle must remain upstream of supplements");
  }
  if (payload.assessment_identity !== binding.assessment_identity ||
      pairs.some(([payloadField, bindingField]) =>
        !sameCanonical(payload[payloadField] ?? null, binding[bindingField] ?? null))) {
    throw new TypeError("assessment-pack cycle binding does not equal its payload");
  }
}

function createAssessmentPackCycle(payload, cycleBinding) {
  const normalizedPayload = canonicalValue(structuredClone(payload));
  const digest = domainSeparatedDigest(DOMAINS.assessmentPackCycle, normalizedPayload);
  const normalizedBinding = structuredClone(cycleBinding);
  delete normalizedBinding.assessment_pack_cycle_digest;
  assertCycleBinding(normalizedPayload, normalizedBinding);
  normalizedBinding.assessment_pack_cycle_digest = digest;
  const value = deepFreeze({
    domain: DOMAINS.assessmentPackCycle,
    digest,
    payload: normalizedPayload,
    cycle_binding: normalizedBinding
  });
  registerAssessmentPackCycle(value);
  return value;
}

function validateAssessmentPackCycle(value) {
  try {
    if (value?.domain !== DOMAINS.assessmentPackCycle ||
        domainSeparatedDigest(DOMAINS.assessmentPackCycle, value.payload) !==
          value.digest ||
        value.cycle_binding.assessment_pack_cycle_digest !== value.digest) return false;
    const binding = structuredClone(value.cycle_binding);
    delete binding.assessment_pack_cycle_digest;
    assertCycleBinding(value.payload, binding);
    return true;
  } catch {
    return false;
  }
}

function buildSupplementCensus(entries) {
  const packIds = new Set();
  const cycleDigests = new Set();
  const normalized = [...entries].map((entry, ordinal) => {
    if (entry.ordinal !== ordinal) throw new TypeError(
      "supplement census ordinals must be complete and gap-free"
    );
    if (packIds.has(entry.pack_instance_id) ||
        cycleDigests.has(entry.assessment_pack_cycle_digest)) {
      throw new TypeError("supplement census identities must be unique");
    }
    packIds.add(entry.pack_instance_id);
    cycleDigests.add(entry.assessment_pack_cycle_digest);
    const notRequired = entry.requirement === "not_required" &&
      sameCanonical(entry.result, {
        status: "not_required", marker: "projected_selection_not_required"
      });
    const required = entry.requirement === "required" &&
      (entry.result?.status === "success"
        ? hasTrustedProjectedSelectionSupplement(entry.result) &&
          entry.result.cycle_binding.assessment_pack_cycle_digest ===
            entry.assessment_pack_cycle_digest
        : ["refused", "resource_limit", "unsupported_input",
            "missing_lossless_fact"].includes(entry.result?.status) &&
          entry.result.observed_binding.expected_assessment_pack_cycle_digest ===
            entry.assessment_pack_cycle_digest);
    if (!notRequired && !required) throw new TypeError(
      "supplement census result does not match its requirement and cycle"
    );
    return {
      ordinal,
      pack_instance_id: entry.pack_instance_id,
      assessment_pack_cycle_digest: entry.assessment_pack_cycle_digest,
      requirement: entry.requirement,
      result: structuredClone(entry.result)
    };
  });
  const payload = { entry_count: normalized.length, entries: normalized };
  return frozenClone({
    census_version: "controlled-contract-projected-selection-supplement-census.v1",
    entry_count: normalized.length,
    entries: normalized,
    complete: true,
    census_digest: domainSeparatedDigest(DOMAINS.supplementCensus, payload)
  });
}

function validRequiredResult(result, assessmentPackCycleDigest) {
  if (result?.status === "success") return (
    hasTrustedProjectedSelectionSupplement(result) &&
    result.cycle_binding.assessment_pack_cycle_digest === assessmentPackCycleDigest
  );
  return ["refused", "resource_limit", "unsupported_input",
    "missing_lossless_fact"].includes(result?.status) &&
    result.observed_binding.expected_assessment_pack_cycle_digest ===
      assessmentPackCycleDigest;
}

function buildPlanningPackCycle({ assessmentPackCycleDigest, requirement, result }) {
  if (requirement === "required") {
    if (!validRequiredResult(result, assessmentPackCycleDigest)) throw new TypeError(
      "planning-pack result belongs to another assessment-pack cycle"
    );
  } else if (requirement !== "not_required" || !sameCanonical(result, {
    status: "not_required", marker: "projected_selection_not_required"
  })) throw new TypeError("planning-pack not-required marker is noncanonical");
  const payload = {
    assessment_pack_cycle_digest: assessmentPackCycleDigest,
    projected_selection: requirement === "not_required"
      ? { requirement, marker: "projected_selection_not_required" }
      : {
          requirement,
          status: result.status,
          supplement_digest: result.status === "success"
            ? result.supplement_identity.digest : null
        }
  };
  return frozenClone({
    ...payload,
    planning_pack_cycle_digest: domainSeparatedDigest(
      DOMAINS.planningPackCycle, payload
    )
  });
}

function buildProofAwareInputCycle({ contract, compiledProofPlan, assessmentIdentity,
  assessmentManifest, supplementCensus, planningPackCycles }) {
  if (supplementCensus.complete !== true ||
      supplementCensus.entry_count !== planningPackCycles.length ||
      supplementCensus.entries.some((entry, ordinal) =>
        planningPackCycles[ordinal].assessment_pack_cycle_digest !==
          entry.assessment_pack_cycle_digest) ||
      new Set(planningPackCycles.map(
        ({ planning_pack_cycle_digest: digest }) => digest
      )).size !== planningPackCycles.length) throw new TypeError(
    "root planning cycle requires complete aligned supplement and planning-pack censuses"
  );
  const planningPackCensus = {
    entry_count: planningPackCycles.length,
    entries: planningPackCycles.map((cycle, ordinal) => ({
      ordinal,
      assessment_pack_cycle_digest: cycle.assessment_pack_cycle_digest,
      planning_pack_cycle_digest: cycle.planning_pack_cycle_digest
    }))
  };
  const payload = {
    contract,
    compiled_proof_plan: compiledProofPlan,
    assessment_identity: assessmentIdentity,
    assessment_manifest: assessmentManifest,
    supplement_census_digest: supplementCensus.census_digest,
    planning_pack_census: planningPackCensus,
    planning_policy: null,
    planning_implementation: null,
    unit_boundary: "unit1_supplement_handoff"
  };
  return frozenClone({
    cycle_version: "controlled-contract-proof-aware-input-cycle.experimental.v2",
    cycle_status: "supplement_handoff",
    ...payload,
    proof_aware_input_cycle_digest: domainSeparatedDigest(
      DOMAINS.proofAwareInputCycle, payload
    )
  });
}

export {
  buildPlanningPackCycle,
  buildProofAwareInputCycle,
  buildSupplementCensus,
  createAssessmentPackCycle,
  validateAssessmentPackCycle
};
