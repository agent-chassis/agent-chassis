

import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";

import {
  ControlledContractToolError,
  controlledContractContentDigest,
  readCanonicalProofPlanInputs,
  readControlledContractCarrierFile,
  resolveControlledContractRepository,
  resolveCanonicalControlledContractCarrierSet
} from "../../lib/controlled-contract-tools.mjs";
import {
  ACCEPTANCE_COVERAGE_STATES,
  deriveControlledContractAcceptanceCoverage,
  deriveCriterionIdentitySet
} from
  "../../lib/controlled-contract-acceptance-coverage.mjs";
import { criterionIdentityInputs } from "./criterion-identity-projection.mjs";
import { assertPackageValidContract, loadControlledContractPackage } from
  "./package-runtime.mjs";

const ACCEPTANCE_COVERAGE_CARRIER_VERSION =
  "wiki-core-controlled-contract-acceptance-coverage.v1";
const ACCEPTANCE_COVERAGE_MAX_ROWS = 4096;
const ACCEPTANCE_COVERAGE_MAX_BYTES = 1048576;
import { OBLIGATION_COVERAGE_MAX_ROWS, OBLIGATION_COVERAGE_MAX_BYTES }
  from "@agent-chassis/controlled-contract";
const ACCEPTANCE_COVERAGE_BINDING_KEYS = Object.freeze([
  "workRecordLocatorDigest", "contractDigest", "contractNodeDigest",
  "proofPlanDigest", "selectedPackDigest", "mappingDigest",
  "assessmentDigest", "proofAssessmentDigest",
  "profileVersionDigest", "selectorArtifactDigest", "ownershipDigest",
  "verificationDigest", "optionalScopeDigest", "sourceDigest", "sourceKind"
]);

function exactObject(value, keys, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_invalid", `${name} must be an object`
    );
  }
  const unsupported = Object.keys(value).filter((key) => !keys.includes(key));
  if (unsupported.length > 0) throw new ControlledContractToolError(
    "acceptance_coverage_canonical_source_invalid", `${name} contains unsupported fields`,
    { name, fields: unsupported.sort() }
  );
  return value;
}

function normalizeAcceptanceCoverageSelectedUnit(selectedUnit) {
  if (selectedUnit === undefined || selectedUnit === null) return null;
  if (typeof selectedUnit !== "string" || !/^SLICE-[0-9]{3,}$/u.test(selectedUnit)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_selected_unit_invalid",
      "selected_unit must be a canonical SLICE-<digits> identity",
      { changed: false, selected_unit: selectedUnit }
    );
  }
  return selectedUnit;
}

function acceptanceCoverageStem(wkId, focus, selectedUnit) {
  const focused = focus === null ? wkId : `${wkId}-${focus}`;
  return selectedUnit === null
    ? focused : `${focused}--unit-${selectedUnit.toLowerCase()}`;
}

function acceptanceCoverageCarrierPath(repoRoot, wkId, focus, selectedUnit = null) {
  return path.resolve(repoRoot, "wiki", "contracts",
    `${acceptanceCoverageStem(wkId, focus, selectedUnit)}.` +
    "controlled-acceptance-coverage.json");
}

function acceptanceCoverageSourcePath(repoRoot, wkId, focus, selectedUnit = null) {
  return path.resolve(repoRoot, "wiki", "contracts",
    `${acceptanceCoverageStem(wkId, focus, selectedUnit)}.obligation-coverage.json`);
}

async function assertObligationCoverageSourcePathIntegrity(input, {
  requireSource = false
} = {}) {
  const focus = input.focus ?? null;
  const selectedUnit = normalizeAcceptanceCoverageSelectedUnit(input.selectedUnit);
  const repository = await resolveControlledContractRepository(input.repoRoot);
  const file = acceptanceCoverageSourcePath(
    repository.repository, input.wkId, focus, selectedUnit
  );
  if (path.dirname(file) !== repository.contracts ||
      file !== path.resolve(repository.contracts, path.basename(file))) {
    throw new ControlledContractToolError(
      "obligation_coverage_target_escape",
      "server-resolved obligation source escaped the canonical contract store",
      { changed: false }
    );
  }
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || await realpath(file) !== file) {
      throw new ControlledContractToolError(
        "obligation_coverage_target_escape",
        "server-resolved obligation source is not a real canonical file",
        { changed: false }
      );
    }
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    if (error?.code !== "ENOENT" || requireSource) {
      throw new ControlledContractToolError(
        error?.code === "ENOENT" ? "obligation_coverage_source_not_found"
          : "obligation_coverage_target_invalid",
        "server-resolved obligation source target failed path-integrity validation",
        { changed: false, cause: error?.code ?? null }
      );
    }
  }
  return Object.freeze({ file, repository });
}

async function readJsonAtFixedPath(file, { optional = false, source }) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw new ControlledContractToolError(
      error?.code === "ENOENT"
        ? "acceptance_coverage_canonical_source_unavailable"
        : "acceptance_coverage_canonical_source_invalid",
      `${source} is unavailable or invalid`, { source, cause: error?.code ?? error?.message }
    );
  }
}

function validateAcceptanceCoverageCarrier(content, { wkId, focus, selectedUnit }) {
  exactObject(content, [
    "schema_version", "wk_id", "focus", "selected_unit", "source_identity",
    "source_bindings", "criterion_identities", "rows"
  ], "acceptance coverage carrier");
  if (content.schema_version !== ACCEPTANCE_COVERAGE_CARRIER_VERSION ||
      content.wk_id !== wkId || (content.focus ?? null) !== focus ||
      (content.selected_unit ?? null) !== selectedUnit) {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_mismatch",
      "canonical acceptance-coverage carrier identity mismatched",
      { expected_wk_id: wkId, actual_wk_id: content.wk_id ?? null,
        expected_focus: focus, actual_focus: content.focus ?? null,
        expected_selected_unit: selectedUnit,
        actual_selected_unit: content.selected_unit ?? null }
    );
  }
  exactObject(content.source_identity, ["source_kind", "content_digest"],
    "acceptance coverage carrier source_identity");
  if (content.source_identity.source_kind !== "obligation-coverage") {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_invalid",
      "acceptance coverage must bind the canonical obligation source"
    );
  }
  exactObject(content.source_bindings, ACCEPTANCE_COVERAGE_BINDING_KEYS,
    "acceptance coverage carrier source_bindings");
  if (!ACCEPTANCE_COVERAGE_BINDING_KEYS.every((key) =>
    Object.hasOwn(content.source_bindings, key))) {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_invalid",
      "acceptance coverage carrier source bindings are incomplete"
    );
  }
  acceptanceCoverageRows(content.rows);
  if (content.criterion_identities === null ||
      typeof content.criterion_identities !== "object" ||
      !Array.isArray(content.criterion_identities.identities)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_invalid",
      "acceptance coverage carrier criterion identities are invalid"
    );
  }
  return content;
}

async function readAcceptanceCoverageCarrier(input) {
  const focus = input.focus ?? null;
  const selectedUnit = normalizeAcceptanceCoverageSelectedUnit(input.selectedUnit);
  const file = acceptanceCoverageCarrierPath(
    input.repoRoot, input.wkId, focus, selectedUnit
  );
  const content = await readJsonAtFixedPath(file, {
    optional: true, source: "controlled-acceptance coverage carrier"
  });
  if (content === null) return null;
  validateAcceptanceCoverageCarrier(content, {
    wkId: input.wkId, focus, selectedUnit
  });
  return Object.freeze({ content, content_digest: controlledContractContentDigest(content), file });
}

async function readCanonicalWorkRecord(repoRoot, wkId, selectedUnit) {
  const file = path.resolve(repoRoot, "wiki", "work-records", `${wkId}.json`);
  const record = await readJsonAtFixedPath(file, { source: "canonical work record" });
  if (record?.id !== wkId) throw new ControlledContractToolError(
    "acceptance_coverage_canonical_source_mismatch", "canonical work record identity mismatched",
    { source: "work-record", expected: wkId, actual: record?.id ?? null });
  if (selectedUnit === null) return { record, unit: record };
  const unit = record.slices?.find((slice) => slice?.id === selectedUnit);
  if (!unit) throw new ControlledContractToolError("acceptance_coverage_selected_unit_not_found",
    "canonical selected slice does not exist", { wk_id: wkId,
      selected_unit: selectedUnit });
  return { record, unit };
}

async function readCanonicalObligationSource(input, { optional = false } = {}) {
  const focus = input.focus ?? null;
  const selectedUnit = normalizeAcceptanceCoverageSelectedUnit(input.selectedUnit);
  const file = acceptanceCoverageSourcePath(
    input.repoRoot, input.wkId, focus, selectedUnit
  );
  const content = await readJsonAtFixedPath(file, {
    optional, source: "canonical obligation-coverage carrier"
  });
  if (content === null) return null;

  const { validateObligationCoverageDraft } = await loadControlledContractPackage();
  const validation = validateObligationCoverageDraft(content);
  if (!validation.valid) throw new ControlledContractToolError(
    "acceptance_coverage_canonical_source_invalid",
    "canonical obligation-coverage carrier failed package validation",
    { source: "obligation-coverage", schema_errors: validation.schema_errors,
      diagnostics: validation.diagnostics }
  );
  if (validation.carrier.wk_id !== input.wkId ||
      validation.carrier.selected_unit !== selectedUnit || validation.carrier.focus !== focus) {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_mismatch",
      "canonical obligation source selected-unit identity mismatched",
      { expected_wk_id: input.wkId, actual_wk_id: validation.carrier.wk_id ?? null,
        expected_selected_unit: selectedUnit,
        actual_selected_unit: validation.carrier.selected_unit, expected_focus: focus, actual_focus: validation.carrier.focus }
    );
  }
  return Object.freeze({
    source_kind: "obligation-coverage",
    content: validation.carrier,
    content_digest: controlledContractContentDigest(validation.carrier),
    file
  });
}

function contractReferenceMeaning(reference) {
  if (reference === undefined) return null;
  return Object.freeze({
    reference_id: reference.reference_id,
    type_term: reference.type_term,
    identity: Object.freeze(structuredClone(reference.identity))
  });
}

function contractPropositionMeaning(proposition, referencesById) {
  if (proposition === undefined) return null;
  return Object.freeze({
    proposition_id: proposition.proposition_id,
    operator: proposition.operator,
    subject_reference_id: proposition.subject_reference_id,
    subject: contractReferenceMeaning(referencesById.get(
      proposition.subject_reference_id
    )),
    operands: Object.freeze((proposition.operands ?? []).map((operand) =>
      operand.kind === "reference" ? Object.freeze({
        ...structuredClone(operand),
        reference: contractReferenceMeaning(referencesById.get(operand.reference_id))
      }) : Object.freeze(structuredClone(operand)))),
    applicability_context: Object.freeze({
      ...structuredClone(proposition.applicability_context),
      operand_references: Object.freeze(
        (proposition.applicability_context?.operand_reference_ids ?? []).map(
          (referenceId) => contractReferenceMeaning(referencesById.get(referenceId))
        )
      )
    })
  });
}

function contractTestDefinitionMeaning(proof, referencesById) {
  const declared = (field, project = (value) => structuredClone(value)) =>
    proof[field] === undefined ? {} : { [field]: Object.freeze(project(proof[field])) };
  return Object.freeze({
    edge_kind: "test_definition_for_verification_claim",
    test_proof_id: proof.test_proof_id,
    verification_claim_id: proof.verification_claim_id,
    ...declared("test_selector"),
    ...declared("system_under_test_boundary", (boundary) => ({
      ...structuredClone(boundary),
      ...(boundary.subject_reference_ids === undefined ? {} : {
        subject_references: Object.freeze(boundary.subject_reference_ids.map(
          (referenceId) => contractReferenceMeaning(referencesById.get(referenceId))
        ))
      })
    })),
    ...declared("observable_result"),
    ...declared("falsifiers"),
    evidence_status: "declared_not_executed"
  });
}

function contractNodeFacts(contract) {
  const claims = Array.isArray(contract.claims) ? contract.claims : [];
  const references = Array.isArray(contract.references) ? contract.references : [];
  const referencesById = new Map(references.map(
    (reference) => [reference.reference_id, reference]
  ));
  const propositions = new Map((contract.propositions ?? []).map(
    (proposition) => [proposition.proposition_id, proposition]
  ));
  const relationsBySource = new Map();
  for (const relation of contract.relations ?? []) {
    if (relation.role !== "verifies") continue;
    const sourceRelations = relationsBySource.get(relation.source_claim_id) ?? [];
    sourceRelations.push(Object.freeze({
      edge_kind: "claim_verifies_claim",
      relation_id: relation.relation_id,
      role: relation.role,
      source_claim_id: relation.source_claim_id,
      target_claim_id: relation.target_claim_id,
      evidence_status: "declared_not_executed"
    }));
    relationsBySource.set(relation.source_claim_id, sourceRelations);
  }
  const definitionsByClaim = new Map();
  for (const proof of contract.test_proofs ?? []) {
    const definitions = definitionsByClaim.get(proof.verification_claim_id) ?? [];
    definitions.push(contractTestDefinitionMeaning(proof, referencesById));
    definitionsByClaim.set(proof.verification_claim_id, definitions);
  }
  const claimFacts = claims.map((claim) => ({
    id: claim.claim_id,
    mandatory: claim.modality === "MUST",
    semantic: Object.freeze({
      node_kind: "claim",
      claim_kind: claim.kind,
      modality: claim.modality,
      proposition: contractPropositionMeaning(
        propositions.get(claim.proposition_id), referencesById
      ),
      ...(claim.falsifying_proposition_id === undefined ? {} : {
        falsifying_proposition: contractPropositionMeaning(
          propositions.get(claim.falsifying_proposition_id), referencesById
        )
      }),
      ...(claim.verification_method === undefined ? {} : {
        verification_method: claim.verification_method
      })
    }),
    declared_verification: Object.freeze({
      relationships: Object.freeze(relationsBySource.get(claim.claim_id) ?? []),
      test_definitions: Object.freeze(definitionsByClaim.get(claim.claim_id) ?? []),
      executed_outcomes_included: false
    })
  }));
  const referenceFacts = references.map((reference) => ({
    id: reference.reference_id,
    mandatory: false,
    semantic: Object.freeze({
      node_kind: "reference",
      reference: contractReferenceMeaning(reference)
    }),
    declared_verification: Object.freeze({
      relationships: Object.freeze([]),
      test_definitions: Object.freeze([]),
      executed_outcomes_included: false
    })
  }));
  return [...claimFacts, ...referenceFacts]
    .filter(({ id }) => typeof id === "string" && id.length > 0)
    .map(Object.freeze);
}

async function selectedPackFacts({ repoRoot, wkId, focus, canonicalSet, plan,
  contractOverride = null, requestContent = undefined,
  evaluationInputOverrides = null }) {
  if (plan === null) throw new ControlledContractToolError(
    "controlled_contract_proof_plan_missing",
    "canonical proof plan is required to resolve selected-pack coverage",
    { changed: false }
  );
  const canonicalInputs = await readCanonicalProofPlanInputs({
    repoRoot, wkId, focus, canonicalSet, requestContent
  });

  const loaded = evaluationInputOverrides === null ? canonicalInputs : {
    ...canonicalInputs,
    evaluationInputs: { ...canonicalInputs.evaluationInputs,
      ...evaluationInputOverrides }
  };
  const selectedPaths = plan.content?.packs?.map(
    (pack) => pack?.evaluation_input?.path
  ) ?? [];
  const missingPath = selectedPaths.find((filename) =>
    typeof filename !== "string" ||
    !Object.hasOwn(loaded.evaluationInputs, filename));
  if (missingPath !== undefined) throw new ControlledContractToolError(
    "controlled_contract_evaluation_input_missing",
    "a proof-plan-selected evaluation input is absent from the canonical carrier set",
    { changed: false, evaluation_input: missingPath ?? null }
  );
  const pkg = await loadControlledContractPackage();
  const currentPlan = await pkg.buildProofPlan({
    contract: contractOverride?.content ?? loaded.contract.content,
    request: loaded.request.content,
    evaluationInputs: loaded.evaluationInputs
  });
  const currentDigest = controlledContractContentDigest(currentPlan);
  if (currentDigest !== plan.content_digest) throw new ControlledContractToolError(
    "controlled_contract_proof_plan_stale",
    "canonical proof plan is stale against its authenticated source inputs",
    { changed: false, expected_content_digest: plan.content_digest,
      actual_content_digest: currentDigest }
  );
  const nodeIds = new Set();
  const selectedPacks = [];
  const claimParticipation = [];
  for (const [index, filename] of selectedPaths.entries()) {
    const evaluationInput = loaded.evaluationInputs[filename];
    for (const binding of evaluationInput.reference_bindings ?? []) {
      for (const referenceId of binding.reference_ids ?? []) nodeIds.add(referenceId);
    }
    const plannedPack = plan.content.packs[index];

    const participation = await pkg.evaluateSelectedPackClaimParticipation({
      contract: contractOverride?.content ?? loaded.contract.content,
      evaluationInput,
      profileId: plannedPack.profile_id,
      profileVersion: plannedPack.profile_version
    });
    for (const claimId of participation.claim_ids) nodeIds.add(claimId);
    claimParticipation.push(Object.freeze({
      pack_id: plannedPack.profile_id,
      profile_id: participation.profile_id,
      profile_version: participation.profile_version,
      profile_digest: participation.profile_digest,
      evaluation_input_path: filename,
      satisfaction: participation.satisfaction,
      covered_claims: participation.covered_claims,
      claim_ids: participation.claim_ids
    }));
    const authoring = await pkg.describeProofPackAuthoring({
      profileId: plannedPack.profile_id,
      profileVersion: plannedPack.profile_version,
      requestedIntents: plannedPack.requested_intents
    });
    const selectorFields = Object.freeze({
      reference_binding: "reference_binding_patterns",
      claim: "claim_patterns",
      relation: "relation_patterns",
      collection: "collection_patterns",
      resolver_fact: "resolver_fact_patterns",
      evidence: "evidence_patterns"
    });
    const selectors = [];
    for (const [kind, field] of Object.entries(selectorFields)) {
      for (const pattern of authoring.proof_obligations?.[field] ?? []) {
        selectors.push(Object.freeze({
          kind,
          component_id: pattern.pattern_id,

        }));
      }
    }
    selectedPacks.push(Object.freeze({
      pack_id: plannedPack.profile_id,
      profile_id: plannedPack.profile_id,
      profile_version: plannedPack.profile_version,
      requested_intents: Object.freeze([...plannedPack.requested_intents]),
      evaluation_input_path: filename,
      evaluation_input_digest: controlledContractContentDigest(evaluationInput),
      source_digests: Object.freeze(structuredClone(plannedPack.source_digests ?? {})),
      selectors: Object.freeze(selectors)
    }));
  }
  return Object.freeze({
    nodeIds: Object.freeze([...nodeIds].sort()),
    selectedPacks: Object.freeze(selectedPacks),
    claimParticipation: Object.freeze(claimParticipation)
  });
}

async function resolveCanonicalCoverageFacts(input, { sourceOptional = false,
  canonicalOverride = null, savedApplications = false } = {}) {
  const focus = input.focus ?? null;
  const selectedUnit = normalizeAcceptanceCoverageSelectedUnit(input.selectedUnit);
  const repository = await resolveControlledContractRepository(input.repoRoot);
  const { record, unit } = await readCanonicalWorkRecord(
    repository.repository, input.wkId, selectedUnit
  );
  const canonicalSet = canonicalOverride?.canonicalSet ??
    await resolveCanonicalControlledContractCarrierSet({
      repoRoot: repository.repository, wkId: input.wkId, focus
    });
  const canonicalContract = canonicalOverride?.contract ??
    await readControlledContractCarrierFile({
      repoRoot: repository.repository, wkId: input.wkId, focus, carrierKind: "contract",
      canonicalSet
    });
  const pkg = await loadControlledContractPackage();
  const source = Object.hasOwn(canonicalOverride ?? {}, "obligationSource")
    ? canonicalOverride.obligationSource
    : await readCanonicalObligationSource({
      ...input, repoRoot: repository.repository
    }, { optional: sourceOptional });
  const caseSource = selectedUnit === null ? source : await readCanonicalObligationSource({
    ...input, repoRoot: repository.repository, selectedUnit: null
  }, { optional: true });
  const cases = caseSource?.content.cases ?? [];
  const { resolveDerivedProofAuthoringContract } = await import(
    "./proof-authoring-source.mjs"
  );
  const contract = await resolveDerivedProofAuthoringContract({
    repoRoot: repository.repository,
    wkId: input.wkId,
    focus,
    canonicalContract,
    cases
  });

  assertPackageValidContract(pkg.validateNativeTestProofAuthoringContract(contract.content));
  const plan = savedApplications ? null : Object.hasOwn(canonicalOverride ?? {}, "proofPlan")
    ? canonicalOverride.proofPlan : await (async () => {
    try {
      return await readControlledContractCarrierFile({
        repoRoot: repository.repository, wkId: input.wkId, focus,
        carrierKind: "proof_plan", canonicalSet
      });
    } catch (error) {
      if (error?.code === "controlled_contract_carrier_not_found") return null;
      throw error;
    }
  })();
  const packFacts = savedApplications
    ? { nodeIds: [], selectedPacks: [], claimParticipation: [] }
    : await selectedPackFacts({
    repoRoot: repository.repository, wkId: input.wkId, focus, canonicalSet, plan,
    contractOverride: contract,
    requestContent: canonicalOverride?.proofPlanRequest?.content,
    evaluationInputOverrides: canonicalOverride?.evaluationInputs ?? null
  });
  const contractNodeSemantics = contractNodeFacts(contract.content);
  return Object.freeze({
    repoRoot: repository.repository,
    contractsRoot: repository.contracts,
    wkId: input.wkId,
    focus,
    selectedUnit,
    record,
    unit,
    canonicalSet,
    canonicalContract,
    contract,
    caseSource,
    cases,
    contractNodes: Object.freeze(contractNodeSemantics.map(({ id, mandatory }) =>
      Object.freeze({ id, mandatory }))),
    contractNodeSemantics: Object.freeze(contractNodeSemantics),
    selectedPackNodeIds: packFacts.nodeIds,
    selectedPacks: packFacts.selectedPacks,

    selectedPackClaimParticipation: packFacts.claimParticipation,
    plan,
    source
  });
}

function identityBindings({ unit, contract, contractNodeSemantics, plan, source,
  scopeRecord }) {
  const criteria = Array.isArray(unit.acceptance?.criteria) ? unit.acceptance.criteria : [];
  const packs = Array.isArray(plan?.content?.packs) ? plan.content.packs : [];
  const bindings = {
    workRecordLocatorDigest: controlledContractContentDigest(criteria.map((criterion, index) => ({
      locator: `/acceptance/criteria/${index}`, criterion
    }))),
    contractDigest: contract.content_digest,
    contractNodeDigest: controlledContractContentDigest(contractNodeSemantics),
    proofPlanDigest: plan?.content_digest ?? "sha256:absent",
    selectedPackDigest: controlledContractContentDigest(packs),
    assessmentDigest: null,
    proofAssessmentDigest: null,
    profileVersionDigest: controlledContractContentDigest(packs.map((pack) => ({
      profile_id: pack.profile_id, profile_version: pack.profile_version
    }))),
    selectorArtifactDigest: controlledContractContentDigest(packs.map((pack) => ({
      profile_id: pack.profile_id, source_digests: pack.source_digests ?? null
    }))),
    ownershipDigest: controlledContractContentDigest({
      repo_paths: unit.repo_paths ?? [], write_scope: unit.write_scope ?? []
    }),
    verificationDigest: controlledContractContentDigest(unit.acceptance?.validation ?? []),
    optionalScopeDigest: scopeRecord === null
      ? null : controlledContractContentDigest(scopeRecord),
    sourceDigest: source?.content_digest ?? "sha256:absent",
    sourceKind: source?.source_kind ?? "obligation-coverage"
  };
  bindings.mappingDigest = controlledContractContentDigest(bindings);
  return Object.freeze(bindings);
}

function coverageAuthoringApplicability(rows) {
  return Object.freeze({
    mode: 'saved_selections',
    selection_relationships: Object.freeze(rows.map(row => Object.freeze({
      obligation_id: row.obligation_id, selection: structuredClone(row.selection),
      controlled_contract_node_ids: structuredClone(row.controlled_contract_node_ids ?? []),
      design_status: row.design_status
    }))),
    inferred_relationship_count: 0,
    caller_selects_mapping: true
  });
}

async function currentObligationCoverageContext(base) {
  const pkg = await loadControlledContractPackage();
  const { bindings } = obligationCoverageCriterionIdentities(base);
  const identitySet = pkg.deriveCriterionIdentitySet({
    criteria: criterionIdentityInputs(base.unit.acceptance?.criteria ?? []),
    selectedUnitDigest: bindings.selectedUnitDigest,
    bindings
  });
  const criteria = identitySet.identities.map((entry, index) => Object.freeze({
    ...structuredClone(entry),
    criterion: structuredClone(base.unit.acceptance.criteria[index]),
    source_locator: obligationCoverageCriterionLocator(index)
  }));
  return Object.freeze({ bindings, identitySet, criteria: Object.freeze(criteria) });
}

function acceptanceCoverageUnitDigest(resolved) {
  return controlledContractContentDigest({
    selected_unit: controlledContractContentDigest(resolved.unit),
    bindings: resolved.bindings
  });
}

function acceptanceCoverageAuthoringIdentity(resolved) {
  return controlledContractContentDigest({
    unit_digest: acceptanceCoverageUnitDigest(resolved),
    source_identity: {
      source_kind: resolved.source?.source_kind ?? "obligation-coverage",
      content_digest: resolved.source?.content_digest ?? null
    }
  });
}

function changedAcceptanceCoverageBindings(bound, current) {
  if (!bound) return [];
  return ACCEPTANCE_COVERAGE_BINDING_KEYS.filter((key) => bound[key] !== current[key]);
}

export function rebindAcceptanceCoverageFactsToObligationSource(resolved, content) {
  const source = Object.freeze({ source_kind: "obligation-coverage",
    content: structuredClone(content),
    content_digest: controlledContractContentDigest(content), file: null });
  const withoutMapping = Object.fromEntries(ACCEPTANCE_COVERAGE_BINDING_KEYS.filter(
    (key) => key !== "mappingDigest").map((key) => [key,
    key === "sourceDigest" ? source.content_digest
      : key === "sourceKind" ? source.source_kind : resolved.bindings[key]]));
  const bindings = Object.freeze({ ...withoutMapping,
    mappingDigest: controlledContractContentDigest(withoutMapping) });
  return Object.freeze({ ...resolved, source, bindings,
    changed_bindings: Object.freeze(changedAcceptanceCoverageBindings(
      resolved.carrier?.content.source_bindings, bindings)) });
}

function acceptanceCoverageFactsFromRows(resolved, rows) {
  const normalizedRows = acceptanceCoverageRows(rows);
  const changedBindings = changedAcceptanceCoverageBindings(
    resolved.carrier?.content.source_bindings, resolved.bindings
  );
  const stale = changedBindings.length > 0;
  const unitDigest = acceptanceCoverageUnitDigest(resolved);
  const currentIdentities = deriveCriterionIdentitySet({
    criteria: criterionIdentityInputs(resolved.criteria),
    selectedUnitDigest: unitDigest,
    bindings: resolved.bindings
  }).identities;
  const rowByCriterion = new Map(normalizedRows.map((row) => [
    row.criterion_identity, row
  ]));
  return {
    unit: {
      id: resolved.selectedUnit === null
        ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`,
      kind: resolved.selectedUnit === null ? "wk" : "slice",
      digest: unitDigest
    },

    criteria: criterionIdentityInputs(resolved.criteria),
    bindings: structuredClone(resolved.bindings),
    ...(resolved.carrier?.content.criterion_identities === undefined
      ? {}
      : { priorCriterionIdentities: structuredClone(
          resolved.carrier.content.criterion_identities) }),
    mappings: normalizedRows.map(({ criterion_identity, node_ids }) => ({
      criterionIdentity: criterion_identity,
      nodeIds: structuredClone(node_ids)
    })),

    contractNodes: structuredClone(resolved.contractNodes),
    selectedPackNodeIds: structuredClone(resolved.selectedPackNodeIds),
    criterionAxes: currentIdentities.map(({ identity }) => {
      const axes = rowByCriterion.get(identity)?.axes;
      return {
        criterionIdentity: identity,
        structuralVerification: stale ? "stale" : axes?.structural_verification ?? "unknown",
        implementationOwnership: stale ? "stale" : axes?.implementation_ownership ?? "unknown",
        verificationOwnership: stale ? "stale" : axes?.verification_ownership ?? "unknown",
        scopeFeasibility: stale ? "stale" : axes?.scope_feasibility ?? "unknown"
      };
    }),
    ...(resolved.scope_facts === undefined ? {} : { scopeFacts: resolved.scope_facts }),
    proofCoverage: stale
      ? structuredClone((resolved.proof_coverage ?? []).map((fact) => ({
          ...fact, state: "stale"
        })))
      : structuredClone(resolved.proof_coverage ?? []),
    resultFacts: structuredClone(resolved.result_facts ?? null)
  };
}

async function resolveAcceptanceCoverageFacts(input, { requireCarrier = false,
  canonicalOverride = null, savedApplications = false, obligationFacts: suppliedObligationFacts = null } = {}) {
  const base = await resolveCanonicalCoverageFacts(input, { canonicalOverride, savedApplications,
    sourceOptional: savedApplications });
  const { repoRoot, wkId, focus, selectedUnit, record, unit, canonicalSet,
    contract, contractNodes, contractNodeSemantics, selectedPackNodeIds,
    selectedPacks, plan, source,
    selectedPackClaimParticipation } = base;
  const carrier = await readAcceptanceCoverageCarrier(input);
  if (requireCarrier && carrier === null) throw new ControlledContractToolError(
    "acceptance_coverage_carrier_not_found", "canonical acceptance-coverage carrier is absent",
    { changed: false }
  );
  const scopeRecord = await readJsonAtFixedPath(
    path.resolve(repoRoot, "wiki", "work-records", "WK-2025.json"),
    { optional: true, source: "optional scope work record" }
  );
  const bindings = identityBindings({
    unit, contract: base.canonicalContract, contractNodeSemantics, plan, source,
    scopeRecord
  });
  const pkg = await loadControlledContractPackage();
  const acceptanceIdentitySet = pkg.deriveCriterionIdentitySet({
    criteria: criterionIdentityInputs(unit.acceptance?.criteria ?? []),
    selectedUnitDigest: controlledContractContentDigest({
      selected_unit: controlledContractContentDigest(unit), bindings
    }),
    bindings
  });
  const acceptanceCriteria = acceptanceIdentitySet.identities.map((entry, index) => ({
    ...structuredClone(entry),
    source_locator: obligationCoverageCriterionLocator(index)
  }));
  const obligationFacts = suppliedObligationFacts ?? await resolveObligationCoverageFacts(input, { canonicalOverride, allowIncomplete: true, savedApplications });
  const unitDigest = controlledContractContentDigest({
    selected_unit: controlledContractContentDigest(unit),
    carrier: carrier?.content_digest ?? null,
    bindings
  });
  const resolved = {
    wkId,
    focus,
    selectedUnit,
    record,
    unit,
    unit_digest: unitDigest,
    criteria: structuredClone(unit.acceptance?.criteria ?? []),
    criteria_with_locators: Object.freeze(acceptanceCriteria.map(Object.freeze)),
    contract,
    contractNodes: Object.freeze(contractNodes),
    contractNodeSemantics: Object.freeze(contractNodeSemantics),
    selectedPackNodeIds,
    selectedPacks,
    selectedPackClaimParticipation,
    plan,
    carrier,
    source,
    bindings,
    changed_bindings: Object.freeze(changedAcceptanceCoverageBindings(
      carrier?.content.source_bindings, bindings
    )),
    authoringApplicability: coverageAuthoringApplicability(obligationFacts.rows),
    rows: structuredClone(carrier?.content.rows ?? []),
    scope_facts: scopeRecord === null
      ? undefined
      : { status: "available", source: "WK-2025", facts: { digest: bindings.optionalScopeDigest } },
    proof_coverage: [],
    obligationResolution: obligationFacts.resolution,
    result_facts: null
  };
  const facts = {
    ...resolved,
    authoring_identity: acceptanceCoverageAuthoringIdentity(resolved),
    ...deriveControlledContractAcceptanceCoverage(
      acceptanceCoverageFactsFromRows(resolved, resolved.rows)
    )
  };

  return Object.freeze({ ...facts,
    selected_unit_digest: acceptanceCoverageUnitDigest(facts) });
}

function obligationCoverageCriterionLocator(index) {
  return `/acceptance/criteria/${index}`;
}

function obligationCoverageSourceLocatorDigest({
  criterion,
  criterionIdentity,
  obligationId,
  sourceLocator,
  statement
}) {
  return controlledContractContentDigest({
    source_locator: sourceLocator,
    criterion_identity: criterionIdentity,
    criterion,
    obligation_id: obligationId,
    statement
  });
}

function obligationCoverageCriterionIdentities(base) {
  const bindings = Object.freeze({
    workRecordDigest: controlledContractContentDigest(base.record),
    selectedUnitDigest: controlledContractContentDigest(base.unit),
    contractGeneration: base.canonicalSet.generation,
    contractDigest: base.canonicalContract.content_digest,
    contractNodeDigest: controlledContractContentDigest(base.contractNodeSemantics),
    proofPlanDigest: base.plan?.content_digest ?? "sha256:absent",
    selectedPackDigest: controlledContractContentDigest(base.selectedPacks),
    sourceLocatorDigest: controlledContractContentDigest({
      wk_id: base.wkId,
      focus: base.focus,
      selected_unit: base.selectedUnit,
      basename: path.basename(acceptanceCoverageSourcePath(
        base.repoRoot, base.wkId, base.focus, base.selectedUnit
      ))
    }),
    mappingDigest: controlledContractContentDigest({
      source_kind: "obligation-coverage",
      wk_id: base.wkId,
      focus: base.focus,
      selected_unit: base.selectedUnit
    })
  });
  return Object.freeze({ bindings });
}

function obligationCoverageRowCurrentness(row, resolved) {
  const criterionIndex = resolved.criteria.findIndex(
    ({ source_locator: locator }) => locator === row.source_locator
  );
  if (criterionIndex === -1) return "criterion_locator";
  const criterionFact = resolved.criteria[criterionIndex];
  const expectedLocatorDigest = obligationCoverageSourceLocatorDigest({
    criterion: criterionFact.criterion,
    criterionIdentity: criterionFact.identity,
    criterionSetDigest: resolved.criterionIdentities.digest,
    obligationId: row.obligation_id,
    sourceLocator: criterionFact.source_locator,
    statement: row.statement
  });
  if (expectedLocatorDigest !== row.source_locator_digest) return "source_locator_digest";
  const nodeIds = new Set(resolved.contractNodes.map(({ id }) => id));
  if (row.controlled_contract_node_ids.some((id) => !nodeIds.has(id))) {
    return "controlled_contract_nodes";
  }
  if (row.proof.kind === "explicit_gap") return null;
  const matchingPack = resolved.selectedPacks.find((pack) =>
    pack.pack_id === row.proof.pack_id &&
    pack.profile_id === row.proof.profile_id &&
    pack.profile_version === row.proof.profile_version &&
    pack.requested_intents.includes(row.proof.requested_intent) &&
    pack.selectors.some((selector) =>
      selector.kind === row.proof.selector.kind &&
      selector.component_id === row.proof.selector.component_id
    ));
  return matchingPack ? null : "selected_pack_mapping";
}

async function resolveObligationCoverageFacts(input, { requireSource = false,
  canonicalOverride = null, allowIncomplete = false, savedApplications = false } = {}) {
  await assertObligationCoverageSourcePathIntegrity(input, { requireSource });
  const base = await resolveCanonicalCoverageFacts(input, { sourceOptional: true,
    canonicalOverride, savedApplications });
  if (requireSource && base.source === null) throw new ControlledContractToolError(
    "obligation_coverage_source_not_found",
    "canonical obligation-coverage source is absent",
    { changed: false }
  );
  const { bindings, identitySet, criteria } =
    await currentObligationCoverageContext(base);
  const sourceRelative = path.relative(base.repoRoot, acceptanceCoverageSourcePath(
    base.repoRoot, base.wkId, base.focus, base.selectedUnit
  )).split(path.sep).join("/");
  const sourceLocator = Object.freeze({
    kind: "canonical_obligation_coverage",
    repository_relative: sourceRelative,
    digest: bindings.sourceLocatorDigest
  });
  const prospectiveIdentity = Object.freeze({
    source_kind: "obligation-coverage",
    wk_id: base.wkId,
    controlled_focus: base.focus,
    selected_unit: base.selectedUnit,
    locator_digest: sourceLocator.digest,
    content_digest: base.source?.content_digest ?? null
  });
  const authoringIdentity = controlledContractContentDigest({
    repository: base.canonicalSet.repository ?? null,
    unit: base.selectedUnit === null ? base.wkId : `${base.wkId}#${base.selectedUnit}`,
    work_record_digest: bindings.workRecordDigest,
    controlled_contract_generation: base.canonicalSet.generation,
    controlled_contract_manifest_digest: base.canonicalSet.manifest_content_digest ?? null,
    contract_digest: base.canonicalContract.content_digest,
    proof_plan_digest: base.plan?.content_digest ?? null,
    selected_pack_digest: bindings.selectedPackDigest,
    source_locator_digest: sourceLocator.digest,
    source_content_digest: base.source?.content_digest ?? null
  });
  const { resolveProofAuthoringContext } = await import('./proof-authoring-source.mjs');
  const { resolveProofAuthoring } = await import('@agent-chassis/controlled-contract/proof-authoring');
  const resolution = base.source === null ? null : await resolveProofAuthoring(
    base.source.content, await resolveProofAuthoringContext(base));
  if (!allowIncomplete && base.source !== null && resolution.mapping === null) {
    throw new ControlledContractToolError('obligation_coverage_resolution_required',
      'Complete obligation consumers require a resolved mapping', {
        changed: false, limb: 'mechanical_failure', resolution
      });
  }

  const resolvedRows = resolution?.mapping?.obligations ??
    resolution?.obligation_facts ?? [];

  const staleReasons = [];
  return Object.freeze({
    ...base,
    bindings,
    criteria: Object.freeze(criteria),
    criterionIdentities: identitySet,
    sourceLocator,
    prospectiveIdentity,
    authoringIdentity,
    authoringApplicability: coverageAuthoringApplicability(resolvedRows),
    sourceCurrent: staleReasons.length === 0,
    staleReasons: Object.freeze(staleReasons),
    resolution,
    draftRows: Object.freeze(structuredClone(base.source?.content.obligations ?? [])),
    rows: Object.freeze(structuredClone(resolvedRows))
  });
}

const ACCEPTANCE_COVERAGE_ROW_AXES = Object.freeze([
  "authored_contract_coverage", "structural_verification",
  "selected_pack_guarantee_coverage", "implementation_ownership",
  "verification_ownership", "scope_feasibility"
]);

function acceptanceCoverageRows(rows, name = "rows") {
  if (!Array.isArray(rows)) throw new ControlledContractToolError(
    "acceptance_coverage_request_invalid", `${name} must be an array`
  );
  return rows.map((row, index) => {
    const rowName = `${name}[${index}]`;
    exactObject(row, ["criterion_identity", "node_ids", "axes"], rowName);
    exactObject(row.axes, ACCEPTANCE_COVERAGE_ROW_AXES, `${rowName}.axes`);
    if (!ACCEPTANCE_COVERAGE_ROW_AXES.every((axis) => Object.hasOwn(row.axes, axis)) ||
        typeof row.criterion_identity !== "string" || row.criterion_identity.length === 0 ||
        !Array.isArray(row.node_ids) ||
        row.node_ids.some((node) => typeof node !== "string" || node.length === 0) ||
        ACCEPTANCE_COVERAGE_ROW_AXES.some((axis) =>
          typeof row.axes[axis] !== "string" ||
          !ACCEPTANCE_COVERAGE_STATES.includes(row.axes[axis]))) {
      throw new ControlledContractToolError(
        "acceptance_coverage_request_invalid", `${rowName} is not a closed coverage row`
      );
    }
    return structuredClone(row);
  });
}

export {
  ACCEPTANCE_COVERAGE_BINDING_KEYS,
  ACCEPTANCE_COVERAGE_CARRIER_VERSION,
  ACCEPTANCE_COVERAGE_MAX_BYTES,
  ACCEPTANCE_COVERAGE_MAX_ROWS,
  OBLIGATION_COVERAGE_MAX_BYTES,
  OBLIGATION_COVERAGE_MAX_ROWS,
  acceptanceCoverageCarrierPath,
  acceptanceCoverageAuthoringIdentity,
  acceptanceCoverageFactsFromRows,
  acceptanceCoverageSourcePath,
  acceptanceCoverageRows,
  acceptanceCoverageUnitDigest,
  changedAcceptanceCoverageBindings,
  exactObject,
  assertObligationCoverageSourcePathIntegrity,
  obligationCoverageSourceLocatorDigest,
  readAcceptanceCoverageCarrier,
  readCanonicalObligationSource,
  readCanonicalWorkRecord, normalizeAcceptanceCoverageSelectedUnit,
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
};
