import { createHash } from "node:crypto";

import {
  CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY,
  CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS,
  CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS,
  assessmentCollectionDescriptor
} from "@agent-chassis/controlled-contract";
import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  assertControlledContractSemanticProjectionBound,
  controlledContractPrettyJsonBytes
} from "./semantic-projection-bounds.mjs";

const STATE_RANK = Object.freeze({
  fail: 0,
  incomplete: 1,
  unevaluable: 2,
  review_only: 3,
  not_proven: 4,
  pass: 5,
  proven: 5
});

function compare(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex")}`;
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function stableId(prefix, value) {
  return `${prefix}-${digest(value).slice(7)}`;
}

function summaryWithBound(base, gaps, maximumBytes) {
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0 ||
      maximumBytes > CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes) {
    throw new ControlledContractToolError(
      "controlled_contract_semantic_projection_invalid",
      "assessment summary allowance is invalid",
      { changed: false, caller_correctable: false, maximum_bytes: maximumBytes }
    );
  }
  const result = {
    ...base,
    first_actionable_gaps: [],
    first_actionable_gap_count: 0,
    omitted_actionable_gap_count: gaps.length
  };
  for (const gap of gaps) {
    result.first_actionable_gaps.push(gap);
    result.first_actionable_gap_count = result.first_actionable_gaps.length;
    result.omitted_actionable_gap_count = gaps.length - result.first_actionable_gaps.length;
    if (controlledContractPrettyJsonBytes(result) <= maximumBytes) continue;
    result.first_actionable_gaps.pop();
    result.first_actionable_gap_count = result.first_actionable_gaps.length;
    result.omitted_actionable_gap_count = gaps.length - result.first_actionable_gaps.length;
    break;
  }
  return Object.freeze(assertControlledContractSemanticProjectionBound(
    result,
    maximumBytes,
    { projection_class: "compact_summary" }
  ));
}

export const CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY = Object.freeze({
  authoritative: false,
  read_only: true,
  experimental: true,
  proof_authority: false,
  requirement_authority: false,
  admission_authority: false,
  dispatch_authority: false,
  review_authority: false,
  integration_authority: false,
  publication_authority: false,
  completion_authority: false,
  runtime_proof: false,
  lifecycle_transition: false,
  grants: Object.freeze([])
});

function invalidProofProducerShape(collection, ordinal, reason) {
  throw new ControlledContractToolError(
    "controlled_contract_semantic_projection_invalid",
    "proof assessment does not match the package-owned producer shape",
    { changed: false, family: "proof", collection, ordinal, reason }
  );
}

function requiredObject(value, collection, ordinal, reason) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidProofProducerShape(collection, ordinal, reason);
  }
  return value;
}

function requiredString(value, collection, ordinal, reason) {
  if (typeof value !== "string" || value.length === 0) {
    invalidProofProducerShape(collection, ordinal, reason);
  }
  return value;
}

function packIdentity(pack, collection, ordinal, { nullable = false } = {}) {
  if (pack === null && nullable) return null;
  const value = requiredObject(pack, collection, ordinal, "pack_provenance_invalid");
  return Object.freeze({
    profile_id: requiredString(
      value.profile_id, collection, ordinal, "pack_profile_id_invalid"
    ),
    profile_version: requiredString(
      value.profile_version, collection, ordinal, "pack_profile_version_invalid"
    )
  });
}

function packKey(pack) {
  return `${pack.profile_id}@${pack.profile_version}`;
}

function packOutcomeState(pack, ordinal) {
  const profile = requiredString(
    pack.profile_discrimination, "per_pack", ordinal,
    "pack_profile_discrimination_invalid"
  );
  const exact = requiredString(
    pack.exact_binding, "per_pack", ordinal, "pack_exact_binding_invalid"
  );
  if (!["proven", "not_proven", "not_assessed"].includes(profile) ||
      !["proven", "not_proven", "not_applicable", "not_assessed"].includes(exact)) {
    invalidProofProducerShape("per_pack", ordinal, "pack_outcome_unsupported");
  }
  if (profile === "not_proven" || exact === "not_proven") return "not_proven";
  if (profile === "proven" && ["proven", "not_applicable"].includes(exact)) {
    return "proven";
  }
  return "not_assessed";
}

function provenancedDetail(row, collection, ordinal) {
  const value = requiredObject(row, collection, ordinal, "record_invalid");
  if (!Object.hasOwn(value, "pack") || !Object.hasOwn(value, "detail")) {
    invalidProofProducerShape(collection, ordinal, "provenance_envelope_invalid");
  }
  return {
    row: value,
    pack: packIdentity(value.pack, collection, ordinal, { nullable: true }),
    detail: requiredObject(value.detail, collection, ordinal, "detail_invalid")
  };
}

function diagnosticCode(detail, ordinal) {
  requiredString(detail.source, "diagnostics", ordinal, "diagnostic_source_invalid");
  const value = requiredObject(
    detail.detail, "diagnostics", ordinal, "diagnostic_detail_invalid"
  );
  if (typeof value.code === "string" && value.code.length > 0) return value.code;
  if (typeof value.reason_code === "string" && value.reason_code.length > 0) {
    return value.reason_code;
  }
  invalidProofProducerShape("diagnostics", ordinal, "diagnostic_code_invalid");
}

function proofDiagnosticItem(row, ordinal, packStates, structure) {
  const producer = provenancedDetail(row, "diagnostics", ordinal);
  const code = diagnosticCode(producer.detail, ordinal);
  const state = producer.pack === null
    ? requiredString(structure, "diagnostics", ordinal, "structure_state_invalid")
    : packStates.get(packKey(producer.pack));
  if (typeof state !== "string") {
    invalidProofProducerShape("diagnostics", ordinal, "diagnostic_pack_unknown");
  }
  const subjectId = producer.detail.detail?.subject?.id ?? null;
  return Object.freeze({
    diagnostic_id: stableId("diagnostic", { code, state, row: producer.row }),
    code,
    state,
    axis: typeof producer.detail.detail?.axis === "string"
      ? producer.detail.detail.axis : null,
    subject_id: typeof subjectId === "string" ? subjectId : null
  });
}

function integrationDiagnosticItem(row, ordinal) {
  const code = typeof row?.code === "string" ? row.code
    : typeof row?.source === "string" ? row.source : "assessment_diagnostic";
  const state = typeof row?.state === "string" ? row.state : "not_proven";
  const subjectId = row?.subject?.id ?? null;
  return Object.freeze({
    diagnostic_id: stableId("diagnostic", { code, state, subjectId, ordinal, row }),
    code,
    state,
    axis: typeof row?.axis === "string" ? row.axis : null,
    subject_id: typeof subjectId === "string" ? subjectId : null
  });
}

function proofCollections(assessment) {
  if (assessment?.schema_version !== "controlled-contract-multi-pack-assessment.v1") {
    invalidProofProducerShape("assessment", null, "schema_version_unsupported");
  }
  for (const collection of [
    "per_pack", "diagnostics", "proof_exclusions", "missing_inputs"
  ]) if (!Array.isArray(assessment[collection])) {
    invalidProofProducerShape(collection, null, "collection_invalid");
  }
  const perPackOutcomes = assessment.per_pack.map((value, ordinal) => {
    const pack = requiredObject(value, "per_pack", ordinal, "pack_result_invalid");
    const identity = packIdentity(pack, "per_pack", ordinal);
    return Object.freeze({
      pack_id: packKey(identity),
      profile_id: identity.profile_id,
      profile_version: identity.profile_version,
      state: packOutcomeState(pack, ordinal),
      profile_discrimination: pack.profile_discrimination,
      exact_binding: pack.exact_binding
    });
  }).sort((a, b) => compare(a.pack_id, b.pack_id));
  const packStates = new Map(perPackOutcomes.map(({ pack_id: id, state }) => [id, state]));
  const diagnostics = assessment.diagnostics.map((row, ordinal) =>
    proofDiagnosticItem(row, ordinal, packStates, assessment.structure));
  const integrity = requiredObject(
    assessment.cross_carrier_integrity,
    "cross_carrier_integrity",
    null,
    "axis_invalid"
  );
  if (integrity.axis !== "cross_carrier_integrity" ||
      !Array.isArray(integrity.findings)) {
    invalidProofProducerShape("cross_carrier_integrity", null, "axis_invalid");
  }
  const integrityFindings = integrity.findings.map((row, ordinal) =>
    Object.freeze(structuredClone(requiredObject(
      row, "cross_carrier_integrity", ordinal, "finding_invalid"
    )))).sort((left, right) => compare(
    left.integrity_finding_id, right.integrity_finding_id));
  if (new Set(integrityFindings.map(({ integrity_finding_id: id }) => id)).size !==
      integrityFindings.length) {
    invalidProofProducerShape("cross_carrier_integrity", null,
      "finding_identity_not_unique");
  }
  return Object.freeze({
    per_pack_outcomes: Object.freeze(perPackOutcomes),
    diagnostics: Object.freeze(diagnostics.sort((a, b) =>
      (STATE_RANK[a.state] ?? 99) - (STATE_RANK[b.state] ?? 99) ||
      compare(a.diagnostic_id, b.diagnostic_id))),
    proof_exclusions: Object.freeze(assessment.proof_exclusions.map((row, ordinal) => {
      const producer = provenancedDetail(row, "proof_exclusions", ordinal);
      return Object.freeze({
        exclusion_id: requiredString(
          producer.detail.exclusion_id, "proof_exclusions", ordinal,
          "exclusion_id_invalid"
        )
      });
    }).sort((a, b) => compare(a.exclusion_id, b.exclusion_id))),
    missing_inputs: Object.freeze(assessment.missing_inputs.map((row, ordinal) => {
      const producer = provenancedDetail(row, "missing_inputs", ordinal);
      const inputId = requiredString(
        producer.detail.input_id, "missing_inputs", ordinal, "missing_input_id_invalid"
      );
      const code = requiredString(
        producer.detail.reason_code, "missing_inputs", ordinal,
        "missing_input_code_invalid"
      );
      return Object.freeze({
        missing_input_id: stableId("missing-input", {
          pack: producer.pack,
          input_id: inputId
        }),
        code
      });
    }).sort((a, b) => compare(a.missing_input_id, b.missing_input_id))),
    cross_carrier_integrity: Object.freeze(integrityFindings)
  });
}

function diagnosticStateFor(subjectId, diagnostics) {
  const states = diagnostics.filter((row) => row.subject_id === subjectId).map((row) => row.state);
  return states.sort((a, b) => (STATE_RANK[a] ?? 99) - (STATE_RANK[b] ?? 99))[0] ?? "pass";
}

function integrationCollections(assessment) {
  const diagnostics = values(assessment?.diagnostics).map(integrationDiagnosticItem);
  const gapRows = diagnostics.filter(({ state }) => state !== "pass");
  const axes = values(assessment?.axis_results).map((axis) => Object.freeze({
    axis: axis.axis,
    state: axis.denominator_state,
    applicability: axis.applicability,
    counts: structuredClone(axis.counts ?? {})
  })).sort((a, b) => compare(a.axis, b.axis));
  const lossless = assessment?.lossless_denominators ?? {};
  const joins = assessment?.lossless_joins ?? {};
  const obligationByRequirement = new Map(values(joins.requirement_to_obligations)
    .map((row) => [row.requirement_id, values(row.obligation_ids).length]));
  const scenarioCountByObligation = new Map(values(joins.obligation_to_scenarios)
    .map((row) => [row.obligation_id, values(row.scenario_ids).length]));
  const requirementCoverage = values(lossless.requirements).map((row) => {
    const count = obligationByRequirement.get(row.requirement_id) ?? 0;
    return Object.freeze({
      requirement_id: row.requirement_id,
      state: count > 0 ? "pass" : "incomplete",
      obligation_count: count
    });
  }).sort((a, b) => compare(a.requirement_id, b.requirement_id));
  const scenarioIds = values(lossless.integration_scenario_ids);
  const scenarioCoverage = scenarioIds.map((scenarioId) => Object.freeze({
    scenario_id: scenarioId,
    state: diagnosticStateFor(scenarioId, diagnostics)
  })).sort((a, b) => compare(a.scenario_id, b.scenario_id));
  const interactionCoverage = values(joins.interaction_to_scenarios).map((row) => Object.freeze({
    interaction_id: row.interaction_id,
    state: values(row.scenario_ids).length > 0 ? "pass" : "incomplete",
    scenario_count: values(row.scenario_ids).length
  })).sort((a, b) => compare(a.interaction_id, b.interaction_id));
  const questionIds = values(lossless.review_question_ids);
  const reviewQuestionResults = questionIds.map((questionId) => Object.freeze({
    question_id: questionId,
    state: "review_only",
    axis: diagnostics.find((row) => row.subject_id === questionId)?.axis ?? null
  })).sort((a, b) => compare(a.question_id, b.question_id));
  const unsupportedAxes = axes.filter(({ state }) => state === "unsupported").map((row) =>
    Object.freeze({ axis: row.axis, state: row.state }));
  const codeCounts = new Map();
  for (const row of diagnostics) {
    const key = `${row.code}\u0000${row.state}`;
    codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
  }
  const diagnosticCodeSummaries = [...codeCounts].map(([key, count]) => {
    const [code, state] = key.split("\u0000");
    return Object.freeze({ code, state, count });
  }).sort((a, b) => compare(`${a.code}\u0000${a.state}`, `${b.code}\u0000${b.state}`));
  return Object.freeze({
    axes: Object.freeze(axes),
    gaps: Object.freeze(gapRows),
    requirement_coverage: Object.freeze(requirementCoverage),
    scenario_coverage: Object.freeze(scenarioCoverage),
    interaction_coverage: Object.freeze(interactionCoverage),
    review_question_results: Object.freeze(reviewQuestionResults),
    unsupported_axes: Object.freeze(unsupportedAxes),
    diagnostic_code_summaries: Object.freeze(diagnosticCodeSummaries),
    _obligation_scenario_counts: scenarioCountByObligation
  });
}

function collectionCounts(descriptors, collections) {
  return Object.freeze(Object.fromEntries(descriptors.map(({ collection }) => [
    collection, values(collections[collection]).length
  ])));
}

function totalCount(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function assertTaskRelevantRows(family, descriptors, collections) {
  for (const descriptor of descriptors) {
    const expected = [...descriptor.fields].sort(compare);
    for (const [ordinal, row] of values(collections[descriptor.collection]).entries()) {
      const actual = Object.keys(row).sort(compare);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new ControlledContractToolError(
          "controlled_contract_assessment_descriptor_incomplete",
          "assessment row does not match its task-relevant public field inventory",
          { changed: false, family, collection: descriptor.collection, ordinal,
            expected_fields: expected, actual_fields: actual }
        );
      }
    }
  }
}

function assertDescriptorCompleteness(family, descriptors, collections) {
  const declared = descriptors.map(({ collection }) => collection).sort(compare);
  const implemented = Object.keys(collections).filter((key) => !key.startsWith("_"))
    .sort(compare);
  if (JSON.stringify(declared) !== JSON.stringify(implemented)) {
    throw new ControlledContractToolError(
      "controlled_contract_assessment_descriptor_incomplete",
      "package-owned assessment collection descriptors do not cover the implemented population",
      { changed: false, family, declared, implemented }
    );
  }
}

export function projectControlledContractProofAssessmentSummary(assessment, sourceIdentity,
  maximumBytes = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes,
  sourceCurrent = false) {
  const collections = proofCollections(assessment);
  assertDescriptorCompleteness(
    "proof", CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS, collections
  );
  assertTaskRelevantRows("proof", CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS,
    collections);
  const gaps = collections.diagnostics.filter(({ state }) => state !== "pass");
  const counts = collectionCounts(CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS,
    collections);
  const integrity = assessment.cross_carrier_integrity;
  return summaryWithBound({
    schema_version: "controlled-contract-proof-assessment-summary.v1",
    family: "proof",
    state: assessment?.overall_code ?? "assessment_unavailable",
    authority: CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY,
    source: structuredClone(sourceIdentity ?? {}),
    source_current: sourceCurrent === true,
    cross_carrier_integrity: Object.freeze({
      axis: integrity.axis,
      state: integrity.state,
      package_result_digest: integrity.package_result_digest,
      counts: structuredClone(integrity.counts),
      returned_count: 0,
      omitted_count: collections.cross_carrier_integrity.length,
      authority: structuredClone(integrity.authority)
    }),
    counts,
    total_count: totalCount(counts),
    omitted_count: totalCount(counts),
    unavailable_collections: Object.freeze([]),
    compact_omission: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.compact_omission,
    continuation: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation,
    supported_next_call: "workspace_controlled_contract_assessment_query"
  }, gaps, maximumBytes);
}

export function projectControlledContractIntegrationAssessmentSummary(assessment, sourceIdentity,
  maximumBytes = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes) {
  const collections = integrationCollections(assessment);
  assertDescriptorCompleteness(
    "integration_test_design",
    CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS,
    collections
  );
  assertTaskRelevantRows("integration_test_design",
    CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS, collections);
  const counts = collectionCounts(CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS,
    collections);
  return summaryWithBound({
    schema_version: "controlled-contract-integration-assessment-summary.v1",
    family: "integration_test_design",
    state: assessment?.state ?? "unevaluable",
    authority: CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY,
    source: structuredClone(sourceIdentity ?? {}),
    source_current: true,
    denominators: structuredClone(assessment?.denominators ?? {}),
    coverage: structuredClone(assessment?.coverage ?? {}),
    axis_state_counts: Object.freeze(Object.fromEntries(
      Object.entries(assessment?.diagnostic_summary ?? {}).sort(([a], [b]) => compare(a, b))
    )),
    counts,
    total_count: totalCount(counts),
    omitted_count: totalCount(counts),
    unsupported_axes: Object.freeze(collections.unsupported_axes.map(({ axis }) => axis)),
    compact_omission: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.compact_omission,
    continuation: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation,
    supported_next_call: "workspace_controlled_contract_integration_test_design_query"
  }, collections.gaps, maximumBytes);
}

function matchesSelector(item, selector, descriptor) {
  if (selector === null || selector === undefined) return true;
  if (typeof selector !== "object" || Array.isArray(selector)) return false;
  return Object.entries(selector).every(([key, value]) => {
    if (key === "id") return item[descriptor.stable_id] === value;
    return item[key] === value;
  });
}

function projectPage({ family, assessment, collection, selector = null, ordinal = 0,
  maximumItems = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items,
  sourceCurrent = true, changedSourceClasses = [] }) {
  const descriptor = assessmentCollectionDescriptor(family, collection);
  if (!descriptor) throw new ControlledContractToolError(
    "controlled_contract_assessment_collection_invalid",
    "assessment query selected an unsupported semantic collection",
    { changed: false, family, collection }
  );
  if (!Number.isInteger(ordinal) || ordinal < 0 || !Number.isInteger(maximumItems) ||
      maximumItems < 1 || maximumItems > CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items) {
    throw new ControlledContractToolError(
      "controlled_contract_assessment_selector_invalid",
      "assessment query ordinal or item ceiling is invalid",
      { changed: false, ordinal, maximum_items: maximumItems }
    );
  }
  const unknownSelector = selector && Object.keys(selector).find((key) =>
    !descriptor.selectors.includes(key));
  if (unknownSelector) throw new ControlledContractToolError(
    "controlled_contract_assessment_selector_invalid",
    "assessment query selector is not declared for the selected collection",
    { changed: false, family, collection, selector_key: unknownSelector }
  );
  const collections = family === "proof"
    ? proofCollections(assessment) : integrationCollections(assessment);
  assertDescriptorCompleteness(
    family,
    family === "proof" ? CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS
      : CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS,
    collections
  );
  assertTaskRelevantRows(family,
    family === "proof" ? CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS
      : CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS,
    collections);
  const all = values(collections[collection]);
  const matched = all.filter((item) => matchesSelector(item, selector, descriptor));
  const page = {
    schema_version: "controlled-contract-assessment-semantic-page.v1",
    family,
    collection,
    selector: selector === null ? null : canonicalValue(selector),
    source_current: sourceCurrent === true,
    changed_source_classes: Object.freeze([...new Set(changedSourceClasses)].sort(compare)),
    authority: CONTROLLED_CONTRACT_ASSESSMENT_NON_AUTHORITY,
    offset: ordinal,
    matched_count: matched.length,
    returned_count: 0,
    omitted_count: Math.max(0, matched.length - ordinal),
    items: [],
    has_more: ordinal < matched.length,
    next_ordinal: ordinal < matched.length ? ordinal : null,
    item_limit: maximumItems,
    continuation: CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation
  };
  if (collection !== "cross_carrier_integrity") {
    const items = matched.slice(ordinal, ordinal + maximumItems);
    return Object.freeze({ ...page,
      returned_count: items.length,
      omitted_count: Math.max(0, matched.length - ordinal - items.length),
      items: Object.freeze(items),
      has_more: ordinal + items.length < matched.length,
      next_ordinal: ordinal + items.length < matched.length
        ? ordinal + items.length : null
    });
  }
  for (const item of matched.slice(ordinal, ordinal + maximumItems)) {
    page.items.push(item);
    page.returned_count += 1;
    page.omitted_count -= 1;
    page.has_more = ordinal + page.returned_count < matched.length;
    page.next_ordinal = page.has_more ? ordinal + page.returned_count : null;
    if (controlledContractPrettyJsonBytes(page) <=
        CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes) continue;
    page.items.pop();
    page.returned_count -= 1;
    page.omitted_count += 1;
    page.has_more = ordinal + page.returned_count < matched.length;
    page.next_ordinal = page.has_more ? ordinal + page.returned_count : null;
    break;
  }
  if (page.returned_count === 0 && ordinal < matched.length) {
    throw new ControlledContractToolError(
      "controlled_contract_semantic_projection_invalid",
      "one semantic assessment item cannot fit the declared detail-page bound",
      { changed: false, family, collection, ordinal,
        maximum_bytes: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes }
    );
  }
  page.items = Object.freeze(page.items);
  return Object.freeze(assertControlledContractSemanticProjectionBound(
    page,
    CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
    { projection_class: "detail_page", family, collection }
  ));
}

export function projectControlledContractProofAssessmentPage(input) {
  return projectPage({ ...input, family: "proof" });
}

export function projectControlledContractIntegrationAssessmentPage(input) {
  return projectPage({ ...input, family: "integration_test_design" });
}
