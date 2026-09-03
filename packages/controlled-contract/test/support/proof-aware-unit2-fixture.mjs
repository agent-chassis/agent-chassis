import {
  bundleBytes,
  normalizeContractForIdentity,
  normalizeEvaluationInputForIdentity
} from "../../lib/contract-assessment.mjs";
import {
  assessmentSupplementContextFor
} from "../../lib/lossless-supplement-context.mjs";
import {
  buildPlanningPackCycle,
  buildProjectedSelectionSupplement,
  buildProofAwareInputCycle,
  buildSupplementCensus,
  commitment,
  createAssessmentPackCycle,
  projectedSelectionCommitments
} from "../../lib/projected-selection-supplement.mjs";
import {
  createUnit2Input
} from "../../lib/proof-aware-unit2-construction.mjs";
import {
  createSubject
} from "./projected-evaluation-binding-fixture.mjs";

async function createProofAwareUnit2Fixture(options = {}) {
  const subjectFactory = options.subjectFactory ?? createSubject;
  const subject = await subjectFactory(options);
  const projected = subject.project();
  const context = assessmentSupplementContextFor(projected);
  const selection = projectedSelectionCommitments(context.projected_evaluation);
  const contractValue = normalizeContractForIdentity(subject.contract);
  const planValue = { packs: [{ profile_id: subject.profile.profile_id }] };
  const manifestValue = JSON.parse(bundleBytes(projected).get("manifest.json"));
  const binding = {
    contract: commitment("controlled-contract:contract-identity:v1", contractValue),
    compiled_proof_plan: commitment("controlled-contract:compiled-proof-plan:v1",
      planValue),
    assessment_identity: projected.assessment.assessment_identity,
    assessment_manifest: commitment("controlled-contract:assessment-manifest:v1",
      manifestValue),
    per_pack_assessment: commitment("controlled-contract:per-pack-assessment:v1",
      projected.assessment),
    pack_identity: commitment("controlled-contract:pack-identity:v1", subject.pack),
    profile_identity: commitment("controlled-contract:profile-identity:v1",
      subject.profile),
    guarantee_identity: commitment("controlled-contract:guarantee-identity:v1",
      subject.pack.admission.guarantee),
    admission_identity: commitment("controlled-contract:admission-identity:v1",
      subject.pack.admission),
    evaluation_input: commitment("controlled-contract:evaluation-input:v1",
      normalizeEvaluationInputForIdentity(subject.evaluationInput)),
    exact_binding_declaration: commitment(
      "controlled-contract:exact-binding-declaration:v1", subject.declaration),
    exact_binding_result: commitment("controlled-contract:exact-binding-result:v1",
      subject.exactBindingResult),
    exact_capture_source_set: commitment(
      "controlled-contract:exact-capture-source-set:v1", context.exact_binding_sources),
    projected_graph: selection.projected_graph,
    binding_set_digest: subject.exactBindingResult.binding_set_sha256
  };
  const packInstanceId =
    `${subject.profile.profile_id}@${subject.profile.profile_version}`;
  const cycle = createAssessmentPackCycle({
    ordinal: 0,
    pack_instance_id: packInstanceId,
    ...binding,
    assessment_manifest_census: {
      entry_count: manifestValue.files.length,
      entries: manifestValue.files
    },
    adequacy_declaration_digest:
      subject.pack.admission.certification.adequacy_declaration_digest,
    adequacy_result_digest:
      subject.pack.admission.certification.adequacy_result_digest,
    profile_result: projected.assessment.digests.results.admitted_profile,
    exact_binding_certification: subject.pack.exact_binding_certification_digest,
    selected_node_result: selection.selected_node_result,
    exact_context_digest: subject.exactBindingResult.context.context_sha256
  }, binding);
  const supplement = buildProjectedSelectionSupplement({
    cycle,
    projectedEvaluation: context.projected_evaluation
  });
  if (supplement.status !== "success") throw new Error(
    `fixture supplement failed: ${JSON.stringify(supplement)}`
  );
  const supplementCensus = buildSupplementCensus([{
    ordinal: 0,
    pack_instance_id: packInstanceId,
    assessment_pack_cycle_digest: cycle.digest,
    requirement: "required",
    result: supplement
  }]);
  const planningPackCycle = buildPlanningPackCycle({
    assessmentPackCycleDigest: cycle.digest,
    requirement: "required",
    result: supplement
  });
  const rootCycle = buildProofAwareInputCycle({
    contract: binding.contract,
    compiledProofPlan: binding.compiled_proof_plan,
    assessmentIdentity: binding.assessment_identity,
    assessmentManifest: binding.assessment_manifest,
    supplementCensus,
    planningPackCycles: [planningPackCycle]
  });
  const bundle = bundleBytes(projected);
  const assessmentFiles = manifestValue.files.map((file, ordinal) => ({
    ordinal,
    locator: file.name,
    artifact_kind: file.name === "assessment.json" ? "assessment_index"
      : file.name.includes("structural") ? "structural_assessment"
      : file.name.includes("admitted-proof") ? "admitted_profile_assessment"
          : file.name.includes("proof-pack-admission") ? "proof_pack_admission"
            : file.name.includes("exact-binding") ? "exact_binding_assessment"
          : "informational_rendering",
    exact_bytes: bundle.get(file.name)
  }));
  const unit1 = {
    assessment_pack_cycles: [cycle],
    supplement_census: supplementCensus,
    planning_pack_cycles: [planningPackCycle],
    root_cycle: rootCycle
  };
  const authoritativeValues = {
    contract: contractValue,
    compiled_proof_plan: planValue,
    assessment_index: projected.assessment,
    assessment_manifest: manifestValue,
    assessment_files: assessmentFiles,
    structural_assessment: projected.reports.structural,
    proof_packs_assessment: {
      admitted_profile: projected.reports.admittedProof,
      proof_pack_admission: projected.reports.proofPackAdmission
    },
    admitted_profile_assessment: projected.reports.admittedProof,
    proof_pack_admission: projected.reports.proofPackAdmission,
    exact_binding_assessment: projected.reports.exactBinding,
    packs: [{
      ordinal: 0,
      pack_instance_id: packInstanceId,
      assessment_pack_cycle_digest: cycle.digest,
      pack_identity: subject.pack,
      profile_identity: subject.profile,
      guarantee_identity: subject.pack.admission.guarantee,
      admission_identity: subject.pack.admission,
      adequacy_declaration_digest:
        subject.pack.admission.certification.adequacy_declaration_digest,
      adequacy_result_digest:
        subject.pack.admission.certification.adequacy_result_digest,
      evaluation_input: normalizeEvaluationInputForIdentity(subject.evaluationInput),
      per_pack_assessment: projected.assessment,
      profile_result: projected.assessment.digests.results.admitted_profile,
      exact_binding_declaration: subject.declaration,
      exact_binding_certification: subject.pack.exact_binding_certification_digest,
      exact_binding_result: subject.exactBindingResult,
      exact_capture_source_set: context.exact_binding_sources,
      projected_graph: supplement.projected_graph,
      selected_node_result: selection.selected_node_result,
      binding_set_digest: subject.exactBindingResult.binding_set_sha256,
      projected_selection_supplement: supplement
    }]
  };
  return {
    input: createUnit2Input({ unit1, authoritativeValues }),
    subject,
    projected,
    supplement,
    cleanup: subject.cleanup
  };
}

export { createProofAwareUnit2Fixture };
