import {
  bundleBytes,
  normalizeContractForIdentity,
  normalizeEvaluationInputForIdentity
} from "../../lib/contract-assessment.mjs";
import {
  assessmentSupplementContextFor
} from "../../lib/lossless-supplement-context.mjs";
import {
  buildProjectedSelectionSupplement,
  commitment,
  createAssessmentPackCycle,
  projectedSelectionCommitments
} from "../../lib/projected-selection-supplement.mjs";
import { canonicalJsonBytes } from "../../lib/proof-aware-digest.mjs";
import { createSubject } from "./projected-evaluation-binding-fixture.mjs";

const subject = await createSubject();
try {
  const projected = subject.project();
  const context = assessmentSupplementContextFor(projected);
  const selection = projectedSelectionCommitments(context.projected_evaluation);
  const binding = {
    contract: commitment("controlled-contract:contract-identity:v1",
      normalizeContractForIdentity(subject.contract)),
    compiled_proof_plan: commitment("controlled-contract:compiled-proof-plan:v1", {
      packs: [{ profile_id: subject.profile.profile_id }]
    }),
    assessment_identity: projected.assessment.assessment_identity,
    assessment_manifest: commitment("controlled-contract:assessment-manifest:v1",
      JSON.parse(bundleBytes(projected).get("manifest.json"))),
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
      "controlled-contract:exact-capture-source-set:v1",
      context.exact_binding_sources),
    projected_graph: selection.projected_graph,
    binding_set_digest: subject.exactBindingResult.binding_set_sha256
  };
  const cycle = createAssessmentPackCycle({
    ordinal: 0,
    pack_instance_id: `${subject.profile.profile_id}@${subject.profile.profile_version}`,
    ...binding,
    adequacy_declaration_digest:
      subject.pack.admission.certification.adequacy_declaration_digest,
    adequacy_result_digest:
      subject.pack.admission.certification.adequacy_result_digest,
    profile_result: projected.assessment.digests.results.admitted_profile,
    exact_binding_certification:
      subject.pack.exact_binding_certification_digest,
    selected_node_result: selection.selected_node_result,
    exact_context_digest: subject.exactBindingResult.context.context_sha256
  }, binding);
  const supplement = buildProjectedSelectionSupplement({
    cycle, projectedEvaluation: context.projected_evaluation
  });
  process.stdout.write(canonicalJsonBytes({
    assessment_identity: projected.assessment.assessment_identity,
    cycle_digest: cycle.digest,
    graph_digest: supplement.projected_graph.graph_digest,
    supplement_digest: supplement.supplement_identity.digest
  }).toString("utf8"));
} finally {
  await subject.cleanup();
}
