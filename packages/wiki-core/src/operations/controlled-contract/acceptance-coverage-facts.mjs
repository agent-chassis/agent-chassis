

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
import { ACCEPTANCE_COVERAGE_STATES } from
  "../../lib/controlled-contract-acceptance-coverage.mjs";
import { assertPackageValidContract, loadControlledContractPackage } from
  "./package-runtime.mjs";

const ACCEPTANCE_COVERAGE_CARRIER_VERSION =
  "wiki-core-controlled-contract-acceptance-coverage.v1";
const ACCEPTANCE_COVERAGE_MAX_ROWS = 4096;
const ACCEPTANCE_COVERAGE_MAX_BYTES = 1048576;
const OBLIGATION_COVERAGE_MAX_ROWS = ACCEPTANCE_COVERAGE_MAX_ROWS;
const OBLIGATION_COVERAGE_MAX_BYTES = ACCEPTANCE_COVERAGE_MAX_BYTES;
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

  const { validateObligationCoverageCarrier } = await loadControlledContractPackage();
  const validation = validateObligationCoverageCarrier(content);
  if (!validation.valid) throw new ControlledContractToolError(
    "acceptance_coverage_canonical_source_invalid",
    "canonical obligation-coverage carrier failed package validation",
    { source: "obligation-coverage", schema_errors: validation.schema_errors,
      diagnostics: validation.diagnostics }
  );
  if (validation.carrier.wk_id !== input.wkId ||
      (validation.carrier.focus ?? null) !== selectedUnit) {
    throw new ControlledContractToolError(
      "acceptance_coverage_canonical_source_mismatch",
      "canonical obligation source selected-unit identity mismatched",
      { expected_wk_id: input.wkId, actual_wk_id: validation.carrier.wk_id ?? null,
        expected_selected_unit: selectedUnit,
        actual_selected_unit: validation.carrier.focus ?? null }
    );
  }
  return Object.freeze({
    source_kind: "obligation-coverage",
    content: validation.carrier,
    content_digest: controlledContractContentDigest(validation.carrier),
    file
  });
}

function contractNodeFacts(contract) {
  const claims = Array.isArray(contract.claims) ? contract.claims : [];
  const references = Array.isArray(contract.references) ? contract.references : [];
  return [...claims.map((claim) => ({
    id: claim.claim_id,
    mandatory: claim.modality === "MUST"
  })), ...references.map((reference) => ({
    id: reference.reference_id,
    mandatory: false
  }))].filter(({ id }) => typeof id === "string" && id.length > 0);
}

async function selectedPackFacts({ repoRoot, wkId, focus, canonicalSet, plan }) {
  if (plan === null) throw new ControlledContractToolError(
    "controlled_contract_proof_plan_missing",
    "canonical proof plan is required to resolve selected-pack coverage",
    { changed: false }
  );
  const loaded = await readCanonicalProofPlanInputs({
    repoRoot, wkId, focus, canonicalSet
  });
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
    contract: loaded.contract.content,
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
  for (const [index, filename] of selectedPaths.entries()) {
    const evaluationInput = loaded.evaluationInputs[filename];
    for (const binding of evaluationInput.reference_bindings ?? []) {
      for (const referenceId of binding.reference_ids ?? []) nodeIds.add(referenceId);
    }
    for (const binding of evaluationInput.claim_pattern_bindings ?? []) {
      if (typeof binding.claim_id === "string") nodeIds.add(binding.claim_id);
    }
    const plannedPack = plan.content.packs[index];
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
          evaluation_stage: pattern.required_by_stage
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
    selectedPacks: Object.freeze(selectedPacks)
  });
}

async function resolveCanonicalCoverageFacts(input, { sourceOptional = false } = {}) {
  const focus = input.focus ?? null;
  const selectedUnit = normalizeAcceptanceCoverageSelectedUnit(input.selectedUnit);
  const repository = await resolveControlledContractRepository(input.repoRoot);
  const { record, unit } = await readCanonicalWorkRecord(
    repository.repository, input.wkId, selectedUnit
  );
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
    repoRoot: repository.repository, wkId: input.wkId, focus
  });
  const contract = await readControlledContractCarrierFile({
    repoRoot: repository.repository, wkId: input.wkId, focus, carrierKind: "contract",
    canonicalSet
  });
  const pkg = await loadControlledContractPackage();
  assertPackageValidContract(pkg.validateStableTestProofContract(contract.content));
  const plan = await (async () => {
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
  const packFacts = await selectedPackFacts({
    repoRoot: repository.repository, wkId: input.wkId, focus, canonicalSet, plan
  });
  const source = await readCanonicalObligationSource({
    ...input, repoRoot: repository.repository
  }, { optional: sourceOptional });
  return Object.freeze({
    repoRoot: repository.repository,
    contractsRoot: repository.contracts,
    wkId: input.wkId,
    focus,
    selectedUnit,
    record,
    unit,
    canonicalSet,
    contract,
    contractNodes: Object.freeze(contractNodeFacts(contract.content)),
    selectedPackNodeIds: packFacts.nodeIds,
    selectedPacks: packFacts.selectedPacks,
    plan,
    source
  });
}

function identityBindings({ unit, contract, contractNodes, plan, source, scopeRecord }) {
  const criteria = Array.isArray(unit.acceptance?.criteria) ? unit.acceptance.criteria : [];
  const packs = Array.isArray(plan?.content?.packs) ? plan.content.packs : [];
  const bindings = {
    workRecordLocatorDigest: controlledContractContentDigest(criteria.map((criterion, index) => ({
      locator: `/acceptance/criteria/${index}`, criterion
    }))),
    contractDigest: contract.content_digest,
    contractNodeDigest: controlledContractContentDigest(contractNodes),
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
    sourceDigest: source.content_digest,
    sourceKind: source.source_kind
  };
  bindings.mappingDigest = controlledContractContentDigest(bindings);
  return Object.freeze(bindings);
}

function coverageAuthoringApplicability({
  rows = [],
  criteria,
  criterionIdentityDigest,
  rowCurrentness
}) {
  const currentCriteriaByLocator = new Map(criteria.map((criterion) => [
    criterion.source_locator, criterion
  ]));
  const criterionRelationships = rows.flatMap((row) => {
    const criterion = currentCriteriaByLocator.get(row?.source_locator);
    if (criterion === undefined || rowCurrentness(row) !== null ||
        !Array.isArray(row.controlled_contract_node_ids) ||
        row.mechanism === undefined || row.proof === undefined) return [];
    return [{
      source_locator: row.source_locator,
      criterion_identity: criterion.identity,
      criterion_identity_digest: criterionIdentityDigest,
      obligation_id: row.obligation_id,
      controlled_contract_node_ids: structuredClone(row.controlled_contract_node_ids),
      mechanism: structuredClone(row.mechanism),
      proof: structuredClone(row.proof)
    }];
  });
  return Object.freeze({
    mode: "shared_admitted_alternatives",
    criterion_relationships: Object.freeze(criterionRelationships.map(Object.freeze)),
    inferred_relationship_count: 0,
    caller_selects_mapping: true
  });
}

async function currentObligationCoverageContext(base) {
  const pkg = await loadControlledContractPackage();
  const { bindings } = obligationCoverageCriterionIdentities(base);
  const identitySet = pkg.deriveCriterionIdentitySet({
    criteria: structuredClone(base.unit.acceptance?.criteria ?? []),
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

async function resolveAcceptanceCoverageFacts(input, { requireCarrier = false } = {}) {
  const base = await resolveCanonicalCoverageFacts(input);
  const { repoRoot, wkId, focus, selectedUnit, record, unit, canonicalSet,
    contract, contractNodes, selectedPackNodeIds, selectedPacks, plan, source } = base;
  const carrier = await readAcceptanceCoverageCarrier(input);
  if (requireCarrier && carrier === null) throw new ControlledContractToolError(
    "acceptance_coverage_carrier_not_found", "canonical acceptance-coverage carrier is absent",
    { changed: false }
  );
  const scopeRecord = await readJsonAtFixedPath(
    path.resolve(repoRoot, "wiki", "work-records", "WK-2025.json"),
    { optional: true, source: "optional scope work record" }
  );
  const bindings = identityBindings({ unit, contract, contractNodes, plan, source, scopeRecord });
  const pkg = await loadControlledContractPackage();
  const acceptanceIdentitySet = pkg.deriveCriterionIdentitySet({
    criteria: structuredClone(unit.acceptance?.criteria ?? []),
    selectedUnitDigest: controlledContractContentDigest({
      selected_unit: controlledContractContentDigest(unit), bindings
    }),
    bindings
  });
  const acceptanceCriteria = acceptanceIdentitySet.identities.map((entry, index) => ({
    ...structuredClone(entry),
    source_locator: obligationCoverageCriterionLocator(index)
  }));
  const obligationContext = await currentObligationCoverageContext(base);
  const obligationCurrentness = (row) => obligationCoverageRowCurrentness(row, {
    criteria: obligationContext.criteria,
    criterionIdentities: obligationContext.identitySet,
    contractNodes,
    selectedPacks: base.selectedPacks
  });
  const unitDigest = controlledContractContentDigest({
    selected_unit: controlledContractContentDigest(unit),
    carrier: carrier?.content_digest ?? null,
    bindings
  });
  return Object.freeze({
    wkId,
    focus,
    selectedUnit,
    record,
    unit,
    unit_digest: unitDigest,
    criteria: structuredClone(unit.acceptance?.criteria ?? []),
    contract,
    contractNodes: Object.freeze(contractNodes),
    selectedPackNodeIds,
    selectedPacks,
    plan,
    carrier,
    source,
    bindings,
    authoringApplicability: coverageAuthoringApplicability({
      rows: source?.content?.obligations ?? [],
      criteria: acceptanceCriteria,
      criterionIdentityDigest: acceptanceIdentitySet.digest,
      rowCurrentness: obligationCurrentness
    }),
    rows: structuredClone(carrier?.content.rows ?? []),
    scope_facts: scopeRecord === null
      ? undefined
      : { status: "available", source: "WK-2025", facts: { digest: bindings.optionalScopeDigest } },
    proof_coverage: [],
    result_facts: null
  });
}

function obligationCoverageCriterionLocator(index) {
  return `/acceptance/criteria/${index}`;
}

function obligationCoverageSourceLocatorDigest({
  criterion,
  criterionIdentity,
  criterionSetDigest,
  obligationId,
  sourceLocator,
  statement
}) {
  return controlledContractContentDigest({
    source_locator: sourceLocator,
    criterion_identity: criterionIdentity,
    criterion_identity_set_digest: criterionSetDigest,
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
    contractDigest: base.contract.content_digest,
    contractNodeDigest: controlledContractContentDigest(base.contractNodes),
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
      selector.component_id === row.proof.selector.component_id &&
      selector.evaluation_stage === row.proof.evaluation_stage
    ));
  return matchingPack ? null : "selected_pack_mapping";
}

async function resolveObligationCoverageFacts(input, { requireSource = false } = {}) {
  await assertObligationCoverageSourcePathIntegrity(input, { requireSource });
  const base = await resolveCanonicalCoverageFacts(input, { sourceOptional: true });
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
    contract_digest: base.contract.content_digest,
    proof_plan_digest: base.plan?.content_digest ?? null,
    selected_pack_digest: bindings.selectedPackDigest,
    source_locator_digest: sourceLocator.digest,
    source_content_digest: base.source?.content_digest ?? null
  });
  const staleReasons = base.source === null ? [] : (() => {
    const currentLocators = new Set();
    const reasons = base.source.content.obligations.map((row) => {
      const reason = obligationCoverageRowCurrentness(row, {
        criteria, criterionIdentities: identitySet,
        contractNodes: base.contractNodes, selectedPacks: base.selectedPacks
      });
      if (reason === null) currentLocators.add(row.source_locator);
      return reason;
    }).filter(Boolean);
    if (criteria.some(({ source_locator: locator }) => !currentLocators.has(locator))) {
      reasons.push("criterion_population_incomplete");
    }
    return [...new Set(reasons)].sort();
  })();
  return Object.freeze({
    ...base,
    bindings,
    criteria: Object.freeze(criteria),
    criterionIdentities: identitySet,
    sourceLocator,
    prospectiveIdentity,
    authoringIdentity,
    authoringApplicability: coverageAuthoringApplicability({
      rows: base.source?.content?.obligations ?? [],
      criteria,
      criterionIdentityDigest: identitySet.digest,
      rowCurrentness: (row) => obligationCoverageRowCurrentness(row, {
        criteria, criterionIdentities: identitySet,
        contractNodes: base.contractNodes, selectedPacks: base.selectedPacks
      })
    }),
    sourceCurrent: staleReasons.length === 0,
    staleReasons: Object.freeze(staleReasons),
    rows: Object.freeze(structuredClone(base.source?.content.obligations ?? []))
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
  acceptanceCoverageSourcePath,
  acceptanceCoverageRows,
  exactObject,
  assertObligationCoverageSourcePathIntegrity,
  obligationCoverageSourceLocatorDigest,
  readAcceptanceCoverageCarrier,
  readCanonicalObligationSource,
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
};
