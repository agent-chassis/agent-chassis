import { createHash } from "node:crypto";
import {
  lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import {
  ARTIFACT_RELATIVE_ROOT,
  AssessmentArtifactError,
  assessExactBoundContractFiles,
  canonicalDigest,
  canonicalJson,
  normalizeContractForIdentity,
  normalizeEvaluationInputForIdentity,
  projectContractAssessment
} from "./contract-assessment.mjs";
import { checkContract } from "../bin/check-contract.mjs";
import {
  assertAdmittedProofPackSnapshot,
  loadAdmittedProofPack
} from "./admitted-proof-packs.mjs";
import { canonicalDigest as exactCanonicalDigest } from "./exact-binding-common.mjs";
import { assessmentSupplementContextFor } from
  "./lossless-supplement-context.mjs";
import { evaluateVerificationProfileV1 } from "./verification-profile-v1.mjs";
import {
  PROOF_INTENT_ARTIFACT,
  PROOF_INTENT_DIGESTS,
  ProofIntentSelectionError,
  selectProofPacks
} from "./proof-intent-selection.mjs";

const packageRoot = new URL("../", import.meta.url);
const [proofPlanSchema, assessmentSchema] = await Promise.all([
  readJson(new URL("schema/controlled-contract-proof-plan.v1.schema.json", packageRoot)),
  readJson(new URL(
    "schema/controlled-contract-multi-pack-assessment.v1.schema.json", packageRoot
  ))
]);
const { validateProofPlan, validateMultiPackAssessment } = await compiledValidators(
  "controlled-contract.multi-pack-assessment.v1", {
    validators: {
      validateProofPlan: proofPlanSchema,
      validateMultiPackAssessment: assessmentSchema
    }
  }
);
const PUBLISHABLE_MULTI_ASSESSMENTS = new WeakSet();
const OBLIGATION_SELECTOR_PACKS = new WeakMap();
const MULTI_LOSSLESS_FILES = Object.freeze([
  "assessment.json",
  "assessment.md",
  "structural.full.json",
  "proof-packs.full.json",
  "manifest.json"
]);

class ProofPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofPlanError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function compareCodeUnits(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function packKey(value) {
  return `${value.profile_id}@${value.profile_version}`;
}

function packProvenance(value) {
  return { profile_id: value.profile_id, profile_version: value.profile_version };
}

function normalizedProofPlanForIdentity(plan) {
  return {
    schema_version: plan.schema_version,
    requested_intents: sortedUnique(plan.requested_intents),
    digests: clone(plan.digests),
    packs: [...plan.packs].map((entry) => ({
      profile_id: entry.profile_id,
      profile_version: entry.profile_version,
      requested_intents: sortedUnique(entry.requested_intents),
      evaluation_input: entry.evaluation_input === null ? null : {
        content_reference: entry.source_digests.evaluation_input === null
          ? null
          : `controlled-contract-evaluation-input://sha256/${entry.source_digests.evaluation_input}`
      },
      exact_binding: entry.exact_binding === null ? null : {
        sources: clone(entry.exact_binding.sources)
      },
      source_digests: clone(entry.source_digests)
    })).sort((left, right) => compareCodeUnits(packKey(left), packKey(right)))
  };
}

function expectedPackSourceDigests(pack, evaluationInput = null,
  exactBindingSources = null) {
  return {
    profile: pack.profile_digest,
    admission: pack.admission_digest,
    guarantee: pack.admission.guarantee_digest,
    adequacy_declaration: pack.admission.certification.adequacy_declaration_digest,
    adequacy_result: pack.admission.certification.adequacy_result_digest,
    evaluation_input: evaluationInput === null ? null
      : canonicalDigest(normalizeEvaluationInputForIdentity(evaluationInput)),
    ...(pack.admission_version === 2 ? {
      exact_binding_sources: exactBindingSources === null ? null
        : exactCanonicalDigest(exactBindingSources),
      exact_binding_declaration: pack.exact_binding_declaration_digest,
      exact_binding_certification: pack.exact_binding_certification_digest
    } : {})
  };
}

function assertDigestBindings(entry, expected) {
  const actual = entry.source_digests;
  const expectedKeys = Object.keys(expected).sort(compareCodeUnits);
  const actualKeys = Object.keys(actual).sort(compareCodeUnits);
  if (canonicalJson(expectedKeys) !== canonicalJson(actualKeys)) throw new ProofPlanError(
    "proof_plan_source_digest_shape_conflict",
    "the pack request source-digest fields do not match its admitted carrier version",
    { pack: packProvenance(entry), expected_keys: expectedKeys, actual_keys: actualKeys }
  );
  for (const field of expectedKeys) if (actual[field] !== expected[field]) {
    throw new ProofPlanError(
      "proof_plan_source_digest_stale",
      `the ${field} digest does not bind the declared pack input`,
      {
        pack: packProvenance(entry), digest_kind: field,
        expected: expected[field], actual: actual[field] ?? null
      }
    );
  }
}

function validatePlanSemantics(plan, contract) {
  if (!validateProofPlan(plan)) throw new ProofPlanError(
    "proof_plan_schema_invalid",
    "the proof plan is schema-invalid",
    { diagnostics: clone(validateProofPlan.errors) }
  );
  const keys = plan.packs.map(packKey);
  if (new Set(keys).size !== keys.length) throw new ProofPlanError(
    "proof_plan_duplicate_pack", "the proof plan contains duplicate pack identities"
  );
  for (const [field, expected] of Object.entries(PROOF_INTENT_DIGESTS)) {
    if (field === "algorithm") continue;
    if (plan.digests[field] !== expected) throw new ProofPlanError(
      "proof_plan_substrate_digest_stale", `the proof plan ${field} digest is stale`,
      { digest_kind: field, expected, actual: plan.digests[field] ?? null }
    );
  }
  const actualContractDigest = canonicalDigest(normalizeContractForIdentity(contract));
  if (plan.digests.contract !== actualContractDigest) throw new ProofPlanError(
    "proof_plan_contract_digest_stale",
    "the proof plan contract digest does not bind the supplied controlled contract",
    { expected: actualContractDigest, actual: plan.digests.contract }
  );
  if (plan.packs.length === 0) {
    if (plan.requested_intents.length !== 0) throw new ProofPlanError(
      "proof_plan_intent_uncovered",
      "a zero-pack structural plan cannot claim requested proof intents"
    );
    return;
  }
  let selection;
  try {
    selection = selectProofPacks({
      contract,
      requestedIntents: plan.requested_intents,
      expectedDigests: PROOF_INTENT_DIGESTS
    });
  } catch (error) {
    if (error instanceof ProofIntentSelectionError) throw new ProofPlanError(
      error.code, error.message, error.details
    );
    throw error;
  }
  if (selection.uncovered_intents.length > 0 ||
      selection.hard_incompatibilities.length > 0) throw new ProofPlanError(
    "proof_plan_intent_not_assessable",
    "the proof plan contains an uncovered or mechanically incompatible intent",
    {
      uncovered_intents: selection.uncovered_intents,
      hard_incompatibilities: selection.hard_incompatibilities
    }
  );
  const intentById = new Map(PROOF_INTENT_ARTIFACT.intents.map((intent) => [
    intent.intent_id, intent
  ]));
  const assigned = [];
  for (const entry of plan.packs) {
    if (entry.requested_intents.length === 0) throw new ProofPlanError(
      "proof_plan_pack_intent_missing",
      "every declared pack must bind at least one requested controlled intent",
      { pack: packProvenance(entry) }
    );
    for (const intentId of entry.requested_intents) {
      if (!plan.requested_intents.includes(intentId)) throw new ProofPlanError(
        "proof_plan_pack_intent_extraneous",
        "a pack binds an intent absent from the plan-level request",
        { pack: packProvenance(entry), intent_id: intentId }
      );
      const capable = intentById.get(intentId)?.capable_packs ?? [];
      if (!capable.some((candidate) => packKey(candidate) === packKey(entry))) {
        throw new ProofPlanError(
          "proof_plan_pack_intent_mismatch",
          "the declared pack is not intrinsically mapped to its requested intent",
          { pack: packProvenance(entry), intent_id: intentId }
        );
      }
      assigned.push(intentId);
    }
  }
  if (canonicalJson(assigned.sort(compareCodeUnits)) !==
      canonicalJson([...plan.requested_intents].sort(compareCodeUnits))) {
    throw new ProofPlanError(
      "proof_plan_intent_assignment_conflict",
      "every requested intent must be assigned to exactly one declared pack"
    );
  }
}

async function readOptionalEvaluation(entry, planDirectory) {
  if (entry.evaluation_input === null) return { missing: true, value: null };
  const inputPath = path.resolve(planDirectory, entry.evaluation_input.path);
  let source;
  try {
    source = await readFile(inputPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { missing: true, value: null, inputPath };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new ProofPlanError(
      "proof_plan_evaluation_input_invalid_json",
      "a pack-specific evaluation input is not valid JSON",
      { pack: packProvenance(entry), cause: error.message }
    );
  }
  return { missing: false, value, inputPath };
}

function missingPackProjection(entry, pack, missingInputs) {
  return {
    entry,
    pack,
    projected: null,
    admitted_evaluation: null,
    selector_assessment: null,
    selector_exact_binding: null,
    evaluation_input: null,
    missing_inputs: missingInputs.map((inputId) => ({
      input_id: inputId,
      reason_code: `${inputId}_missing`,
      remediation: `Supply ${inputId.replaceAll("_", " ")} for this pack request.`
    }))
  };
}

async function assessPackEntry(entry, {
  inputPath,
  planDirectory,
  contract,
  structuralResult,
  structuralInputSource
}) {
  const pack = await loadAdmittedProofPack(entry.profile_id);
  if (pack.profile.profile_version !== entry.profile_version) throw new ProofPlanError(
    "proof_plan_pack_version_stale",
    "the requested pack version is not the admitted catalog version",
    { pack: packProvenance(entry), admitted_version: pack.profile.profile_version }
  );
  const evaluation = await readOptionalEvaluation(entry, planDirectory);
  if (evaluation.missing) {
    const expected = expectedPackSourceDigests(
      pack, null, entry.exact_binding?.sources ?? null
    );
    assertDigestBindings(entry, expected);
    const missing = ["evaluation_input"];
    if (pack.admission_version === 2 && entry.exact_binding === null) {
      missing.push("exact_capture_root", "exact_binding_sources");
    }
    return missingPackProjection(entry, pack, missing);
  }
  const expected = expectedPackSourceDigests(
    pack, evaluation.value, entry.exact_binding?.sources ?? null
  );
  assertDigestBindings(entry, expected);
  const selectorAssessment = evaluateVerificationProfileV1({
    contract: clone(contract),
    profile: clone(pack.profile),
    evaluation_input: clone(evaluation.value)
  });
  if (pack.admission_version === 1) {
    if (entry.exact_binding !== null) throw new ProofPlanError(
      "proof_plan_exact_binding_unexpected", "a v1 pack rejects exact-binding inputs",
      { pack: packProvenance(entry) }
    );
    return {
      entry,
      pack,
      projected: projectContractAssessment({
        mode: "admitted_profile",
        contract: clone(contract),
        structuralResult: clone(structuralResult),
        structuralInputSource,
        evaluationInput: clone(evaluation.value),
        proofPack: pack
      }),
      admitted_evaluation: null,
      selector_assessment: selectorAssessment,
      selector_exact_binding: null,
      evaluation_input: clone(evaluation.value),
      missing_inputs: []
    };
  }
  if (entry.exact_binding === null) return {
    ...missingPackProjection(
      entry, pack, ["exact_capture_root", "exact_binding_sources"]
    ),
    admitted_evaluation: selectorAssessment,
    selector_assessment: selectorAssessment,
    evaluation_input: clone(evaluation.value)
  };
  const captureRoot = path.resolve(planDirectory, entry.exact_binding.capture_root);
  const expectedContract = path.resolve(captureRoot, entry.exact_binding.contract_path);
  const expectedEvaluation = path.resolve(
    captureRoot, entry.exact_binding.evaluation_input_path
  );
  if (expectedContract !== path.resolve(inputPath) ||
      expectedEvaluation !== path.resolve(evaluation.inputPath)) {
    throw new ProofPlanError(
      "proof_plan_exact_capture_path_conflict",
      "exact capture paths must identify this plan's contract and pack evaluation input",
      { pack: packProvenance(entry) }
    );
  }
  const projected = await assessExactBoundContractFiles({
    captureRoot,
    contractPath: entry.exact_binding.contract_path,
    profileId: entry.profile_id,
    evaluationInputPath: entry.exact_binding.evaluation_input_path,
    exactBindingSources: entry.exact_binding.sources
  });
  const capturedContractDigest = projected.assessment.digests.source.contract;
  const capturedEvaluationDigest =
    projected.assessment.digests.source.evaluation_input;
  if (capturedContractDigest !== canonicalDigest(
    normalizeContractForIdentity(contract)
  ) || capturedEvaluationDigest !== expected.evaluation_input) {
    throw new ProofPlanError(
      "proof_plan_captured_input_changed",
      "exact capture evaluated contract or evaluation bytes different from the plan-bound snapshots",
      {
        pack: packProvenance(entry),
        captured_contract_digest: capturedContractDigest,
        captured_evaluation_input_digest: capturedEvaluationDigest
      }
    );
  }
  return {
    entry,
    pack,
    projected,
    admitted_evaluation: null,
    selector_assessment: selectorAssessment,
    selector_exact_binding:
      assessmentSupplementContextFor(projected)?.exact_binding_result ?? null,
    evaluation_input: clone(evaluation.value),
    missing_inputs: []
  };
}

function aggregatePackResult(observation) {
  const { entry, pack, projected, missing_inputs: missingInputs } = observation;
  const assessment = projected?.assessment ?? null;
  const admittedEvaluation = observation.admitted_evaluation;
  return {
    profile_id: pack.profile.profile_id,
    profile_version: pack.profile.profile_version,
    requested_intents: sortedUnique(entry.requested_intents),
    admission_version: pack.admission_version,
    profile_discrimination: assessment?.profile_discrimination ??
      (admittedEvaluation === null ? "not_assessed" : "not_proven"),
    exact_binding: pack.admission_version === 1
      ? "not_applicable" : assessment?.exact_binding ?? "not_assessed",
    guarantee: pack.admission.guarantee,
    diagnostic_count: assessment?.diagnostics.length ??
      admittedEvaluation?.diagnostics.length ?? 0,
    exclusion_count: pack.admission.explicit_exclusions.length,
    missing_input_count: missingInputs.length,
    assessment_identity: assessment?.assessment_identity ?? null,
    source_digests: clone(entry.source_digests)
  };
}

function aggregateAxis(packResults, field, filter = () => true) {
  const relevant = packResults.filter(filter);
  if (relevant.length === 0) return "not_assessed";
  return relevant.every((result) => result[field] === "proven")
    ? "proven" : "not_proven";
}

function provenanceDetail(observation, detail) {
  return { pack: packProvenance(observation.entry), detail: clone(detail) };
}

function assessmentCycleDigest({ plan, contract, structural, observations }) {
  return canonicalDigest({
    cycle_version: "controlled-contract-multi-pack-assessment-cycle.v1",
    contract: canonicalDigest(normalizeContractForIdentity(contract)),
    proof_plan: canonicalDigest(normalizedProofPlanForIdentity(plan)),
    structural_result: canonicalDigest(structural.reports.structural),
    packs: observations.map((observation) => ({
      pack: packProvenance(observation.pack.profile),
      profile_digest: observation.pack.profile_digest,
      admission_digest: observation.pack.admission_digest,
      component_exclusion_applicability_digest:
        observation.pack.component_exclusion_applicability_digest,
      source_digests: clone(observation.entry.source_digests),
      pack_assessment_identity:
        observation.projected?.assessment.assessment_identity ?? null
    })).sort((left, right) => compareCodeUnits(packKey(left.pack), packKey(right.pack)))
  });
}

function authenticatedApplicabilityProjection(observation, cycleDigest) {
  const { pack } = observation;
  assertAdmittedProofPackSnapshot(pack);
  if (pack.component_exclusion_applicability === null) return null;
  return {
    projection_version:
      "controlled-contract-assessment-component-exclusion-applicability.v1",
    assessment_cycle_digest: cycleDigest,
    profile_id: pack.profile.profile_id,
    profile_version: pack.profile.profile_version,
    profile_digest: pack.profile_digest,
    admission_digest: pack.admission_digest,
    component_exclusion_applicability_digest:
      pack.component_exclusion_applicability_digest,
    source_digests: {
      ...clone(observation.entry.source_digests),
      component_exclusion_applicability:
        pack.component_exclusion_applicability_digest
    },
    components: clone(pack.component_exclusion_applicability.components)
  };
}

function buildAggregateAssessment({ plan, contract, structural, observations }) {
  const packResults = observations.map(aggregatePackResult).sort((left, right) =>
    compareCodeUnits(packKey(left), packKey(right))
  );
  const profileDiscrimination = aggregateAxis(packResults, "profile_discrimination");
  const exactBinding = aggregateAxis(
    packResults, "exact_binding", ({ admission_version: version }) => version === 2
  );
  const diagnostics = [
    ...structural.assessment.diagnostics.map((detail) => ({
      pack: null,
      detail: clone(detail)
    })),
    ...observations.flatMap((observation) => [
    ...(observation.projected?.assessment.diagnostics ?? []).filter(({ source }) =>
      !["structural_schema", "structural_validation", "structural_decomposition"]
        .includes(source)
    ).map((detail) =>
      provenanceDetail(observation, detail)
    ),
    ...(observation.admitted_evaluation?.diagnostics ?? []).map((detail) =>
      provenanceDetail(observation, {
        source: "admitted_profile_evaluation", detail
      })
    ),
    ...observation.missing_inputs.map((detail) => provenanceDetail(observation, {
      source: "proof_plan_input", detail
    }))
    ])
  ].sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));
  const proofExclusions = observations.flatMap((observation) =>
    observation.pack.admission.explicit_exclusions.map((exclusionId) =>
      provenanceDetail(observation, {
        exclusion_id: exclusionId,
        adequacy_control_outcome: "release_certified"
      })
    )
  ).sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));
  const missingInputs = observations.flatMap((observation) =>
    observation.missing_inputs.map((detail) => provenanceDetail(observation, detail))
  ).sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));
  const cycleDigest = assessmentCycleDigest({ plan, contract, structural, observations });
  const proofPacksFull = observations.map((observation) => {
    const applicability = authenticatedApplicabilityProjection(observation, cycleDigest);
    return {
      pack: packProvenance(observation.entry),
      requested_intents: sortedUnique(observation.entry.requested_intents),
      admission: clone(observation.pack.admission),
      source_digests: {
        ...clone(observation.entry.source_digests),
        component_exclusion_applicability:
          observation.pack.component_exclusion_applicability_digest
      },
      component_exclusion_applicability:
        clone(observation.pack.component_exclusion_applicability),
      component_exclusion_applicability_digest:
        observation.pack.component_exclusion_applicability_digest,
      authenticated_component_exclusion_applicability: applicability,
      missing_inputs: clone(observation.missing_inputs),
      admitted_evaluation: clone(observation.admitted_evaluation),
      assessment: clone(observation.projected?.assessment ?? null),
      reports: clone(observation.projected?.reports ?? null)
    };
  }).sort((left, right) => compareCodeUnits(packKey(left.pack), packKey(right.pack)));
  const baseDigests = {
    algorithm: "sha256-canonical-json-v1",
    contract: canonicalDigest(normalizeContractForIdentity(contract)),
    proof_plan: canonicalDigest(normalizedProofPlanForIdentity(plan)),
    catalog: PROOF_INTENT_DIGESTS.catalog,
    vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
    profiles: PROOF_INTENT_DIGESTS.profiles,
    intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact,
    structural_result: canonicalDigest(structural.reports.structural),
    proof_packs_result: canonicalDigest(proofPacksFull)
  };
  const identity = canonicalDigest({
    schema_version: "controlled-contract-multi-pack-assessment.v1",
    tool_version: "controlled-contract-assess-multi.v1",
    axes: {
      structure: structural.assessment.structure,
      profile_discrimination: profileDiscrimination,
      exact_binding: exactBinding
    },
    digests: baseDigests
  });
  const assessment = {
    schema_version: "controlled-contract-multi-pack-assessment.v1",
    assessment_identity: identity,
    requested_proof_intents: sortedUnique(plan.requested_intents),
    selected_pack_count: plan.packs.length,
    evaluated_pack_count: observations.filter(({ projected, admitted_evaluation: admitted }) =>
      projected !== null || admitted !== null
    ).length,
    structure: structural.assessment.structure,
    profile_discrimination: profileDiscrimination,
    exact_binding: exactBinding,
    assessment_scope: "planning",
    authority: "non_authoritative",
    overall_code: [
      `structure_${structural.assessment.structure}`,
      `profile_${profileDiscrimination}`,
      `exact_binding_${exactBinding}`
    ].join("__"),
    per_pack: packResults,
    diagnostics,
    proof_exclusions: proofExclusions,
    missing_inputs: missingInputs,
    digests: baseDigests,
    lossless_report: {
      content_reference:
        `controlled-contract-assessment://sha256/${identity}/manifest.json`,
      files: [...MULTI_LOSSLESS_FILES]
    }
  };
  if (!validateMultiPackAssessment(assessment)) throw new ProofPlanError(
    "multi_pack_assessment_invalid",
    "multi-pack aggregation emitted a schema-invalid result",
    { diagnostics: clone(validateMultiPackAssessment.errors) }
  );
  return deepFreeze({
    assessment: clone(assessment),
    reports: {
      structural: clone(structural.reports.structural),
      proofPacks: {
        report_version: "controlled-contract-multi-pack-full-report.v1",
        assessment_identity: identity,
        packs: proofPacksFull
      }
    }
  });
}

function obligationSelectorPacks(projected, observations) {
  const fullPacks = new Map(projected.reports.proofPacks.packs.map((pack) => [
    packKey(pack.pack), pack
  ]));
  return deepFreeze(observations.map((observation) => {
    const aggregate = aggregatePackResult(observation);
    const full = fullPacks.get(packKey(observation.entry));
    return {
      pack_id: observation.entry.profile_id,
      requested_intents: sortedUnique(observation.entry.requested_intents),
      pack_snapshot: observation.pack,
      assessment: observation.selector_assessment,
      authenticated_component_exclusion_applicability:
        clone(full.authenticated_component_exclusion_applicability),
      evaluation_input_present: observation.evaluation_input !== null,
      profile_discrimination: aggregate.profile_discrimination,
      exact_binding: observation.selector_exact_binding
    };
  }));
}

function recognizedObligationGuaranteeSelectorPacks(projected) {
  const packs = OBLIGATION_SELECTOR_PACKS.get(projected);
  if (packs === undefined) throw new AssessmentArtifactError(
    "assessment_projection_untrusted",
    "obligation selectors require this module's exact assessment projection"
  );
  return packs;
}

function verifiedCanonicalSupplementInputs({ ordinal, packInstanceId, plan, contract,
  projected, manifest, observation, pack, context, perPackAssessment, cycle }) {
  const selection = context?.projected_evaluation?.selection ?? null;
  return {
    ordinal,
    pack_instance_id: packInstanceId,
    assessment_pack_cycle_digest: cycle.digest,
    contract: normalizeContractForIdentity(contract),
    compiled_proof_plan: normalizedProofPlanForIdentity(plan),
    assessment_identity: projected.assessment.assessment_identity,
    assessment_manifest: manifest,
    assessment_manifest_census: {
      entry_count: manifest.files.length,
      entries: manifest.files
    },
    per_pack_assessment: perPackAssessment,
    pack_identity: {
      admission_version: pack.admission_version,
      profile: pack.profile,
      admission: pack.admission,
      declaration: pack.declaration ?? null,
      certification: pack.certification ?? null
    },
    profile_identity: pack.profile,
    guarantee_identity: pack.admission.guarantee,
    admission_identity: pack.admission,
    adequacy_declaration_digest:
      pack.admission.certification.adequacy_declaration_digest,
    adequacy_result_digest: pack.admission.certification.adequacy_result_digest,
    evaluation_input: observation.evaluation_input === null ? null
      : normalizeEvaluationInputForIdentity(observation.evaluation_input),
    profile_result: observation.projected?.reports.admittedProof === undefined
      ? null : observation.projected.assessment.digests.results.admitted_profile,
    exact_binding_declaration: context?.exact_binding_declaration ?? null,
    exact_binding_certification: pack.certification ?? null,
    exact_binding_result: context?.exact_binding_result ?? null,
    exact_capture_source_set: context?.exact_binding_sources ?? null,
    projected_graph: selection?.graph ?? context?.projected_envelope?.graph ?? null,
    selected_node_result: selection === null ? null : {
      pattern_selections: selection.pattern_selections,
      universal_iterations: selection.universal_iterations,
      association_selections: selection.association_selections
    },
    binding_set_digest: context?.exact_binding_result?.binding_set_sha256 ?? null,
    exact_context_digest: context === null ? null : exactCanonicalDigest(
      context.exact_binding_result.context
    )
  };
}

async function assessProofPlan({ inputPath, proofPlan, planDirectory = process.cwd() }) {
  const resolvedInput = path.resolve(inputPath);
  const source = await readFile(resolvedInput, "utf8");
  let contract;
  try {
    contract = JSON.parse(source);
  } catch (error) {
    throw new ProofPlanError(
      "proof_plan_contract_invalid_json", "the controlled contract is not valid JSON",
      { cause: error.message }
    );
  }
  validatePlanSemantics(proofPlan, contract);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cc-proof-plan-"));
  try {
    const snapshotPath = path.join(temporary, "contract.json");
    await writeFile(snapshotPath, source, { flag: "wx" });
    const structuralResult = await checkContract(snapshotPath);
    const structural = projectContractAssessment({
      mode: "structural_only",
      contract: clone(contract),
      structuralResult,
      structuralInputSource: source
    });
    const observations = [];
    for (const entry of [...proofPlan.packs].sort((left, right) =>
      compareCodeUnits(packKey(left), packKey(right))
    )) observations.push(await assessPackEntry(entry, {
      inputPath: resolvedInput,
      planDirectory: path.resolve(planDirectory),
      contract,
      structuralResult,
      structuralInputSource: source
    }));
    const projected = buildAggregateAssessment({
      plan: proofPlan, contract, structural, observations
    });
    PUBLISHABLE_MULTI_ASSESSMENTS.add(projected);
    OBLIGATION_SELECTOR_PACKS.set(projected,
      obligationSelectorPacks(projected, observations));
    return projected;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function assessProofPlanFiles({ inputPath, proofPlanPath }) {
  const resolvedPlan = path.resolve(proofPlanPath);
  let proofPlan;
  try {
    proofPlan = JSON.parse(await readFile(resolvedPlan, "utf8"));
  } catch (error) {
    throw new ProofPlanError(
      "proof_plan_invalid_json", "the proof plan is not valid JSON",
      { cause: error.message }
    );
  }
  return assessProofPlan({
    inputPath,
    proofPlan,
    planDirectory: path.dirname(resolvedPlan)
  });
}

function markdownMultiPackAssessment(assessment) {
  const lines = [
    "# Controlled Contract Multi-Pack Assessment", "",
    `## STRUCTURE: ${assessment.structure.toUpperCase()}`, "",
    `## PROFILE DISCRIMINATION: ${assessment.profile_discrimination.toUpperCase().replaceAll("_", " ")}`, "",
    `## EXACT BINDING: ${assessment.exact_binding.toUpperCase().replaceAll("_", " ")}`, "",
    "## ASSESSMENT SCOPE: PLANNING", "",
    "This assessment evaluates authored contract structure and proof-plan discrimination. Delivered runtime behavior is outside its scope.", "",
    "## AUTHORITY: NON-AUTHORITATIVE", "",
    `Requested proof intents: ${assessment.requested_proof_intents.length}`,
    `Selected packs: ${assessment.selected_pack_count}`,
    `Evaluated packs: ${assessment.evaluated_pack_count}`, "",
    "## Per-pack outcomes", ""
  ];
  if (assessment.per_pack.length === 0) lines.push("No proof packs were selected.");
  for (const pack of assessment.per_pack) lines.push(
    `- \`${pack.profile_id}@${pack.profile_version}\`: profile ${pack.profile_discrimination}; exact binding ${pack.exact_binding}; intents ${pack.requested_intents.map((id) => `\`${id}\``).join(", ")}`
  );
  lines.push(
    "", `Diagnostics: ${assessment.diagnostics.length}`,
    `Exclusions: ${assessment.proof_exclusions.length}`,
    `Missing inputs: ${assessment.missing_inputs.length}`, "",
    "Each guarantee, diagnostic, exclusion, and missing input retains its pack provenance.", ""
  );
  return lines.join("\n");
}

function multiPackManifestFor(projected) {
  if (!PUBLISHABLE_MULTI_ASSESSMENTS.has(projected)) throw new AssessmentArtifactError(
    "assessment_projection_untrusted",
    "multi-pack manifests require this module's exact assessment projection"
  );
  const files = new Map([
    ["assessment.json", canonicalJson(projected.assessment)],
    ["assessment.md", markdownMultiPackAssessment(projected.assessment)],
    ["structural.full.json", canonicalJson(projected.reports.structural)],
    ["proof-packs.full.json", canonicalJson(projected.reports.proofPacks)]
  ]);
  return deepFreeze({
    manifest_version: "controlled-contract-assessment-manifest.v1",
    assessment_identity: projected.assessment.assessment_identity,
    content_reference: projected.assessment.lossless_report.content_reference,
    source_digests: clone(projected.assessment.digests),
    files: [...files].map(([name, contents]) => ({
      name, sha256: sha256Bytes(contents), bytes: Buffer.byteLength(contents)
    }))
  });
}

function multiPackBundleBytes(projected) {
  if (!PUBLISHABLE_MULTI_ASSESSMENTS.has(projected)) throw new AssessmentArtifactError(
    "assessment_projection_untrusted",
    "multi-pack bundles require this module's exact assessment projection"
  );
  const files = new Map([
    ["assessment.json", canonicalJson(projected.assessment)],
    ["assessment.md", markdownMultiPackAssessment(projected.assessment)],
    ["structural.full.json", canonicalJson(projected.reports.structural)],
    ["proof-packs.full.json", canonicalJson(projected.reports.proofPacks)]
  ]);
  const manifest = multiPackManifestFor(projected);
  files.set("manifest.json", canonicalJson(manifest));
  return files;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) &&
    relative !== ".." && !path.isAbsolute(relative));
}

async function ensureArtifactRoot(repository) {
  let parent = repository;
  for (const segment of ARTIFACT_RELATIVE_ROOT.split(path.sep)) {
    const candidate = path.join(parent, segment);
    try {
      await mkdir(candidate, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await lstat(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AssessmentArtifactError(
      "assessment_artifact_root_escape",
      "fixed assessment artifact root contains a non-directory or symbolic link"
    );
    const resolved = await realpath(candidate);
    if (!pathIsWithin(repository, resolved)) throw new AssessmentArtifactError(
      "assessment_artifact_root_escape", "assessment artifact root escaped the repository"
    );
    parent = resolved;
  }
  return parent;
}

async function verifyExistingBundle(directory, expected) {
  const names = (await readdir(directory)).sort(compareCodeUnits);
  const expectedNames = [...expected.keys()].sort(compareCodeUnits);
  if (canonicalJson(names) !== canonicalJson(expectedNames)) throw new AssessmentArtifactError(
    "assessment_artifact_collision", "existing multi-pack bundle has a different file set"
  );
  for (const [name, contents] of expected) {
    const file = path.join(directory, name);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() ||
        await readFile(file, "utf8") !== contents) throw new AssessmentArtifactError(
      "assessment_artifact_collision", "existing multi-pack bundle bytes differ"
    );
  }
}

async function writeMultiPackAssessmentBundle(projected, { repositoryRoot }) {
  if (!PUBLISHABLE_MULTI_ASSESSMENTS.has(projected)) throw new AssessmentArtifactError(
    "assessment_projection_untrusted",
    "multi-pack bundles may be written only from this module's file assessment"
  );
  const repository = await realpath(path.resolve(repositoryRoot));
  const artifactRoot = await ensureArtifactRoot(repository);
  const target = path.join(artifactRoot, projected.assessment.assessment_identity);
  const files = multiPackBundleBytes(projected);
  try {
    await verifyExistingBundle(target, files);
    return deepFreeze({
      reused: true, directory: target,
      content_reference: projected.assessment.lossless_report.content_reference
    });
  } catch (error) {
    if (error instanceof AssessmentArtifactError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = await mkdtemp(path.join(
    artifactRoot, `.${projected.assessment.assessment_identity}.tmp-`
  ));
  try {
    for (const [name, contents] of files) await writeFile(
      path.join(temporary, name), contents,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      await verifyExistingBundle(target, files);
      await rm(temporary, { recursive: true, force: true });
      return deepFreeze({
        reused: true, directory: target,
        content_reference: projected.assessment.lossless_report.content_reference
      });
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return deepFreeze({
    reused: false, directory: target,
    content_reference: projected.assessment.lossless_report.content_reference
  });
}

function compactMultiPackAssessment(assessment) {
  if (!validateMultiPackAssessment(assessment)) throw new ProofPlanError(
    "multi_pack_assessment_invalid", "compact output requires a valid multi-pack result"
  );
  return deepFreeze({
    requested_proof_intents: [...assessment.requested_proof_intents],
    selected_pack_count: assessment.selected_pack_count,
    evaluated_pack_count: assessment.evaluated_pack_count,
    overall_code: assessment.overall_code,
    structure: assessment.structure,
    profile_discrimination: assessment.profile_discrimination,
    exact_binding: assessment.exact_binding,
    assessment_scope: "planning",
    authority: "non_authoritative",
    per_pack: assessment.per_pack.map((pack) => ({
      profile_id: pack.profile_id,
      profile_version: pack.profile_version,
      profile_discrimination: pack.profile_discrimination,
      exact_binding: pack.exact_binding
    })),
    diagnostic_count: assessment.diagnostics.length,
    exclusion_count: assessment.proof_exclusions.length,
    missing_input_count: assessment.missing_inputs.length,
    artifact: assessment.lossless_report.content_reference
  });
}

export {
  MULTI_LOSSLESS_FILES,
  ProofPlanError,
  assessProofPlan,
  assessProofPlanFiles,
  compactMultiPackAssessment,
  expectedPackSourceDigests,
  markdownMultiPackAssessment,
  multiPackManifestFor,
  multiPackBundleBytes,
  normalizedProofPlanForIdentity,
  recognizedObligationGuaranteeSelectorPacks,
  validateMultiPackAssessment,
  validateProofPlan,
  writeMultiPackAssessmentBundle
};
