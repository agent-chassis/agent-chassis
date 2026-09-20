import {
  ControlledContractToolError,
  controlledContractCarrierFilename,
  controlledContractContentDigest,
  readCanonicalProofPlanInputs
} from "../../lib/controlled-contract-tools.mjs";
import { projectControlledContractCanonicalAuthoringPopulation } from
  "../../lib/controlled-contract-carrier-set-publication.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";

const PROSPECTIVE_COMPILATION_SCHEMA =
  "controlled-contract-refactor-prospective-compilation.v1";

export const CONTROLLED_CONTRACT_PROSPECTIVE_COMPILATION_ROLES = Object.freeze([
  "test_proofs", "proof_pack_bindings"
]);

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false,
    limb: "mechanical_failure",
    owner: "buildProspectiveProofPlan",
    ...details
  });
}

function carrier(result, kind) {
  return result.carriers.find(({ carrier_kind: carrierKind }) => carrierKind === kind) ?? null;
}

function descriptor({ kind, filename, sourceDigest, content }) {
  const prospectiveDigest = controlledContractContentDigest(content);
  return Object.freeze({ carrier_kind: kind, filename,
    source_content_digest: sourceDigest,
    prospective_content_digest: prospectiveDigest,
    changed: sourceDigest !== prospectiveDigest,
    content: structuredClone(content) });
}

export function effectiveControlledContractRefactorCarriers(packageResult,
  prospectiveCompilation = null) {
  if (prospectiveCompilation === null) return packageResult.carriers;
  const replacements = new Map([
    prospectiveCompilation.contract,
    prospectiveCompilation.proof_plan,
    ...prospectiveCompilation.evaluation_inputs
  ].map((row) => [row.filename, row]));
  const rows = packageResult.carriers.filter(({ filename }) =>
    !replacements.has(filename)).map((row) => structuredClone(row));
  rows.push(...replacements.values().map((row) => structuredClone(row)));
  return Object.freeze(rows.sort((left, right) =>
    left.carrier_kind.localeCompare(right.carrier_kind)));
}

export function controlledContractRefactorCanonicalMembers(packageResult,
  prospectiveCompilation = null) {
  return Object.fromEntries(effectiveControlledContractRefactorCarriers(
    packageResult, prospectiveCompilation).filter(({ filename,
      carrier_kind: carrierKind }) =>
      typeof filename === "string" && filename.length > 0 &&
      !["obligation_coverage", "acceptance_coverage"].includes(
        carrierKind)).map(({ filename, content }) =>
      [filename, structuredClone(content)]));
}

export async function inspectControlledContractRefactorProspectiveIdentities(
  packageResult, prospectiveCompilation = null, { pkg = null } = {}) {
  pkg ??= await loadControlledContractPackage();
  if (typeof pkg.inspectControlledContractRefactorIdentityPopulation !== "function") fail(
    "controlled_contract_refactor_package_incompatible",
    "loaded controlled-contract package has no identity-role taxonomy owner"
  );
  try {
    return pkg.inspectControlledContractRefactorIdentityPopulation({
      live_carriers: effectiveControlledContractRefactorCarriers(
        packageResult, prospectiveCompilation)
    });
  } catch (error) {
    throw new ControlledContractToolError(
      error?.code ?? "controlled_contract_refactor_identity_population_invalid",
      error?.message ?? "prospective refactor identity population is invalid",
      { changed: false, limb: "mechanical_failure",
        ...(error?.details ?? {}),
        owner: error?.owner ?? "controlled_contract_refactor_graph" }
    );
  }
}

export async function compileControlledContractRefactorProspectiveProofPlan({
  repoRoot, wkId, focus = null, source, packageResult
}) {
  if (!source?.canonicalSet) return null;
  const requestCarrier = carrier(packageResult, "proof_plan_request");
  if (requestCarrier === null) return null;
  const prospectiveContractCarrier = carrier(packageResult, "contract");
  const sourceContractCarrier = source.liveCarriers.find(
    ({ carrier_kind: kind }) => kind === "contract") ?? null;
  if (prospectiveContractCarrier === null || sourceContractCarrier === null) fail(
    "controlled_contract_prospective_proof_plan_source_incomplete",
    "prospective proof-plan compilation requires authenticated source and prospective contracts"
  );
  let loaded;
  try {
    loaded = await readCanonicalProofPlanInputs({ repoRoot, wkId, focus,
      canonicalSet: source.canonicalSet, requestContent: requestCarrier.content });
  } catch (error) {
    fail(error?.code ?? "controlled_contract_prospective_proof_plan_source_invalid",
      error?.message ?? "prospective proof-plan source inputs are invalid",
      error?.details ?? {});
  }
  const pkg = await loadControlledContractPackage();
  if (typeof pkg.buildProspectiveProofPlan !== "function") fail(
    "controlled_contract_refactor_package_incompatible",
    "loaded controlled-contract package has no prospective proof-plan owner"
  );
  let built;
  try {
    built = await pkg.buildProspectiveProofPlan({
      sourceContract: sourceContractCarrier.content,
      prospectiveContract: prospectiveContractCarrier.content,
      request: requestCarrier.content,
      evaluationInputs: loaded.evaluationInputs
    });
  } catch (error) {
    fail(error?.code ?? "controlled_contract_prospective_proof_plan_invalid",
      error?.message ?? "prospective proof-plan compilation failed",
      error?.details ?? {});
  }
  const priorPlan = carrier(packageResult, "proof_plan");
  const contractDescriptor = descriptor({ kind: "contract",
    filename: prospectiveContractCarrier.filename,
    sourceDigest: prospectiveContractCarrier.source_content_digest,
    content: built.contract });
  const proofPlanDescriptor = descriptor({ kind: "proof_plan",
    filename: priorPlan?.filename ?? controlledContractCarrierFilename({
      wkId, focus, carrierKind: "proof_plan"
    }), sourceDigest: priorPlan?.source_content_digest ?? null,
    content: built.proof_plan });
  const evaluationInputDescriptors = Object.entries(built.evaluation_inputs).map(
    ([filename, content]) => {
      const prior = packageResult.carriers.find(({ filename: carrierFilename }) =>
        carrierFilename === filename) ?? source.liveCarriers.find(
        ({ filename: carrierFilename }) => carrierFilename === filename) ?? null;
      if (prior === null || prior.carrier_kind !== "evaluation_input") fail(
        "controlled_contract_prospective_proof_input_missing",
        "prospective proof-plan compilation cannot bind an unauthenticated evaluation input",
        { filename }
      );
      return descriptor({ kind: "evaluation_input", filename,
        sourceDigest: prior.source_content_digest ?? prior.content_digest,
        content });
    }).sort((left, right) => left.filename.localeCompare(right.filename));
  const provisional = Object.freeze({
    schema_version: PROSPECTIVE_COMPILATION_SCHEMA,
    owner: "buildProspectiveProofPlan",
    contract: contractDescriptor,
    proof_plan: proofPlanDescriptor,
    evaluation_inputs: Object.freeze(evaluationInputDescriptors),
    generated_bindings: structuredClone(built.generated_bindings),
    generated_stable_test_proofs:
      structuredClone(built.generated_stable_test_proofs),
    removed_stable_test_proofs:
      structuredClone(built.removed_stable_test_proofs),
    counts: Object.freeze({ generated_stable_test_proofs:
      built.counts.generated_stable_test_proofs,
    removed_stable_test_proofs: built.counts.removed_stable_test_proofs,
    generated_bindings: built.counts.generated_bindings }),
    source_bindings: Object.freeze({
      contract_content_digest: sourceContractCarrier.content_digest,
      proof_plan_request_content_digest:
        controlledContractContentDigest(requestCarrier.content),
      evaluation_input_content_digests: Object.freeze(Object.fromEntries(
        Object.entries(loaded.evaluationInputs).sort(([left], [right]) =>
          left.localeCompare(right)).map(([filename, content]) =>
          [filename, controlledContractContentDigest(content)])))
    })
  });
  await inspectControlledContractRefactorProspectiveIdentities(
    packageResult, provisional, { pkg });
  const canonicalMembers = controlledContractRefactorCanonicalMembers(
    packageResult, provisional);
  const loadedRecord = await loadWorkRecordById({ dir: repoRoot, id: wkId });
  const target = await projectControlledContractCanonicalAuthoringPopulation({
    repository: loadedRecord.record.repo,
    wkId,
    focus,
    canonical_members: canonicalMembers
  });
  return Object.freeze({ ...provisional, target });
}

export { PROSPECTIVE_COMPILATION_SCHEMA };
