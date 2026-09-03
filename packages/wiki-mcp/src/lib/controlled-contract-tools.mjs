import {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  ControlledContractToolError,
  assertControlledContractSemanticProjectionBound,
  assessControlledContractOperation,
  buildProofPlanOperation,
  consumeControlledContractAssessmentSnapshot,
  consumeControlledContractIntegrationAssessmentSnapshot,
  createCommonProofCaptureOperation,
  describeProofPackOperation,
  discoverControlledProofIntentsOperation,
  inspectProofPackBindingsOperation,
  queryControlledVocabularyOperation,
  selectProofPacksOperation,
  queryControlledContractPrivateScopeCensusOperation
} from "@agent-chassis/wiki-core";
import {
  buildProofAuthoringSkeletonOperation,
  continueControlledContractAuthoringOperation,
  continueControlledContractProofGraphOperation,
  controlledContractAuthoringStateOperation,
  createControlledContractCarrierOperation,
  createControlledContractAcceptanceCoverageOperation,
  createControlledContractObligationCoverageOperation,
  describeControlledContractAcceptanceCoverageOperation,
  describeControlledContractObligationCoverageOperation,
  describeControlledContractAuthoringOperation,
  patchControlledContractCarrierOperation,
  patchControlledContractVerificationBundleOperation,
  queryControlledContractAcceptanceCoverageOperation,
  queryControlledContractObligationCoverageOperation,
  rebaseControlledContractAcceptanceCoverageOperation,
  rebaseControlledContractObligationCoverageOperation,
  removeControlledContractAcceptanceCoverageOperation,
  removeControlledContractObligationCoverageOperation,
  upsertControlledContractAcceptanceCoverageOperation,
  upsertControlledContractObligationCoverageOperation,
  queryControlledContractCarrierOperation
} from "@agent-chassis/wiki-core/src/operations/controlled-contract.mjs";
import {
  CARRIER_TARGETS,
  ACCEPTANCE_COVERAGE_STATES,
  CONTROLLED_CONTRACT_CARRIER_QUERY_TARGETS,
  CONTROLLED_CONTRACT_FOCUS_GRAMMAR,
  describeControlledContractTestProofAuthoring,
  getControlledContractProjectionSpills,
  isControlledContractFocus,
  patchControlledContractTestProofBindings,
  queryControlledContractTestProofBindings
} from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  PROOF_INTENT_DISCOVERY_QUERY_POLICY
} from "@agent-chassis/controlled-contract/proof-intent-discovery";
import {
  CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS,
  INTEGRATION_PREFIX_PROFILE,
  VERIFICATION_BUNDLE_VOCABULARY
} from "@agent-chassis/controlled-contract";
import {
  controlledContractAssessmentSnapshots
} from "./controlled-contract-assessment-snapshots.mjs";
import {
  createControlledContractCoverageAuthoringSessions
} from "./controlled-contract-coverage-authoring-sessions.mjs";
import {
  createControlledContractTaskCursorCodec
} from "./controlled-contract-task-cursors.mjs";
import {
  registerControlledContractRuntimeProofTool
} from "./controlled-contract-runtime-proof-tool.mjs";
import { registerVerifyProofTool } from "./verify-proof-tool.mjs";
import { registerCommonProofCaptureTools } from "./common-proof-capture-tools.mjs";
import {
  patchControlledContractAcceptanceCoverageOperation,
  patchControlledContractObligationCoverageOperation,
  refuseMalformedControlledContractObligationCoverageRequest
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/acceptance-coverage-operations.mjs";
import { coverageAuthoringActionProjection } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/coverage-recovery-guidance.mjs";
import {
  buildControlledContractRefactorPlanOperation,
  consumeControlledContractRefactorPlanSnapshot,
  finalizeControlledContractRefactorPlanOperation,
  queryControlledContractRefactorPlan
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/refactor-semantic-operations.mjs";
import { controlledContractAssessmentSummaryAllowance } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/semantic-projection-bounds.mjs";
import { controlledContractOperation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs";
import {
  applyControlledContractRefactorOperation,
  queryControlledContractRefactorReceipt
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/refactor-operations.mjs";
import { persistControlledContractRefactorItemReference } from "./mcp-response.mjs";
import {
  assessControlledContractIntegrationTestDesignOperation,
  refuseMalformedControlledContractIntegrationTestDesignRequest
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/integration-test-design-assessment-operations.mjs";
import {
  CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS,
  CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AXES,
  CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_PUBLIC_REQUEST_KEYS
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";

import { createHash } from "node:crypto";

import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { shouldExposeTool } from "./tool-profile.mjs";
import { projectControlledContractCoverageDescribeForRole } from
  "./controlled-contract-recovery-presentation.mjs";
import {
  activeMcpInlineByteLimit,
  assertNoControlledContractRawResponse,
  measureMcpInlineResultBytes
} from "./mcp-response.mjs";

const QUERY_INDEX_BYTES = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.index_list_bytes;
const QUERY_SELECTED_BYTES = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes;
const INTEGRATION_PREFIX_RECEIPT_BYTES =
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes;
const ASSESSMENT_IDENTITY_PLACEHOLDER = "I".repeat(43);
export const CONTROLLED_CONTRACT_REFACTOR_SNAPSHOT_LIMIT = 32;
export const CONTROLLED_CONTRACT_REFACTOR_SEMANTIC_PAYLOAD_MAX_BYTES = 1024 * 1024;
export const CONTROLLED_CONTRACT_REFACTOR_SEMANTIC_PAYLOAD_MAX_DEPTH = 32;

function assertRefactorSemanticPayloadBounds(args) {
  const payload = args.plan_identity === undefined ? args.mode : {
    obligation_dispositions: args.obligation_dispositions,
    acceptance_dispositions: args.acceptance_dispositions
  };
  const stack = [{ value: payload, depth: 0 }];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (depth > CONTROLLED_CONTRACT_REFACTOR_SEMANTIC_PAYLOAD_MAX_DEPTH) {
      throw new ControlledContractToolError(
        "controlled_contract_refactor_payload_depth_exceeded",
        "refactor semantic payload exceeds the adapter nesting-depth bound",
        { changed: false, maximum_depth:
          CONTROLLED_CONTRACT_REFACTOR_SEMANTIC_PAYLOAD_MAX_DEPTH });
    }
    if (seen.has(value)) throw new ControlledContractToolError(
      "controlled_contract_refactor_request_invalid",
      "refactor semantic payload must be acyclic plain data", { changed: false });
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > CONTROLLED_CONTRACT_REFACTOR_SEMANTIC_PAYLOAD_MAX_BYTES) {
    throw new ControlledContractToolError(
      "controlled_contract_refactor_payload_too_large",
      "refactor semantic payload exceeds the adapter serialized-byte bound",
      { changed: false, actual_bytes: bytes,
        maximum_bytes: CONTROLLED_CONTRACT_REFACTOR_SEMANTIC_PAYLOAD_MAX_BYTES });
  }
}

const INTEGRATION_PREFIX_PROFILE_ID = INTEGRATION_PREFIX_PROFILE.profile_id;
const INTEGRATION_PREFIX_PROFILE_VERSION = INTEGRATION_PREFIX_PROFILE.profile_version;

function prettyJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

export function materializeControlledContractAssessmentResponse({
  result,
  snapshot,
  family,
  workspaceRepo = null,
  snapshots = controlledContractAssessmentSnapshots
}) {
  if (snapshot === null) return Object.freeze(assertControlledContractSemanticProjectionBound({
    ...(workspaceRepo === null ? {} : { workspaceRepo }),
    ...result
  }, CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes,
  { projection_class: `${family}_assessment_recovery_transport` }));
  const assessOperation = family === "proof"
    ? "workspace_controlled_contract_assess"
    : "workspace_controlled_contract_integration_test_design_assess";
  const prospective = {
    ...(workspaceRepo === null ? {} : { workspaceRepo }),
    ...result,
    assessment_identity: ASSESSMENT_IDENTITY_PLACEHOLDER
  };
  assertControlledContractSemanticProjectionBound(
    prospective,
    CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes,
    { projection_class: `${family}_assessment_summary_transport` }
  );
  const identity = snapshots.put({
    ...snapshot,
    sourceIdentity: snapshot.source_identity,
    assessOperation
  });
  const materialized = {
    ...(workspaceRepo === null ? {} : { workspaceRepo }),
    ...result,
    assessment_identity: identity
  };
  return Object.freeze(assertControlledContractSemanticProjectionBound(
    materialized,
    CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes,
    { projection_class: `${family}_assessment_summary_transport` }
  ));
}

function assessmentSummaryAllowance(family, workspaceRepo = null) {
  return controlledContractAssessmentSummaryAllowance({
    ...(family === "proof" ? { workspaceRepo } : {}),
    assessment_identity: ASSESSMENT_IDENTITY_PLACEHOLDER
  });
}

export function materializeControlledContractProjectionSpills({
  result,
  jsonContent,
  limit,
  prefix = {}
}) {
  const spills = getControlledContractProjectionSpills(result);
  if (spills.length > 0) {
    throw new Error(
      "controlled-contract semantic projection requires a spill and cannot be returned safely"
    );
  }
  const bounded = { ...prefix, ...result };
  if (prettyJsonBytes(bounded) > limit) {
    throw new Error("bounded controlled-contract projection exceeds its final production byte limit");
  }
  return bounded;
}

export function materializeIntegrationPrefixCaptureAuthoringReceipt({
  result,
  jsonContent
}) {
  if (prettyJsonBytes(result) <= INTEGRATION_PREFIX_RECEIPT_BYTES) {
    return jsonContent(result);
  }
  throw new Error("controlled-contract integration-prefix receipt exceeds its semantic bound");
}

const COVERAGE_DESCRIBE_PROJECTION_VERSION =
  "controlled-contract-coverage-authoring-page.v3";
const COVERAGE_AUTHORING_SLOT_COUNT = 39;
const COVERAGE_DESCRIBE_DIAGNOSTIC_LIMIT = 8;
const COVERAGE_ROW_SLOT_PATTERN = /^ccrs_[0-9a-f]{64}$/u;

function freezeJson(value) {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) freezeJson(entry);
  }
  return Object.freeze(value);
}

function coverageAuthoringBinding(result, family) {
  return Object.freeze({
    family,
    unit: result.unit.address,
    focus: result.unit.focus ?? result.unit.controlled_focus ?? null,
    unit_digest: family === "obligation"
      ? result.unit.selected_unit_digest : result.unit.digest,
    authoring_identity: result.authoring_identity,
    criterion_identity_digest: result.criterion_identities.digest,
    source_identity: structuredClone(result.source_identity),
    carrier_identity: family === "acceptance"
      ? structuredClone(result.carrier_identity) : null,
    state: result.status,
    currentness: structuredClone(result.currentness),
    skeleton_version: COVERAGE_DESCRIBE_PROJECTION_VERSION
  });
}

function coverageAuthoringSessionInput(result, completePopulation, family) {
  const criteria = completePopulation[4]?.value;
  if (!Array.isArray(criteria) || criteria.length === 0 ||
      criteria.some(({ identity, text }) =>
        typeof identity !== "string" || typeof text !== "string")) {
    throw new Error("coverage authoring skeleton cannot mint complete row identities");
  }
  const criteriaWithText = criteria.map(({ identity, text }) => ({ identity, text }));
  const criterionRelationships = result.authoring_applicability.criterion_relationships;
  if (criterionRelationships.some((relationship) =>
    !criteriaWithText.some(({ identity }) => identity === relationship.criterion_identity) ||
    relationship.criterion_identity_digest !== result.criterion_identities.digest ||
    !/^\/acceptance\/criteria\/\d+$/u.test(relationship.source_locator ?? ""))) {
    throw new Error("coverage authoring applicability is not current for its criterion");
  }
  return {
    family,
    binding: coverageAuthoringBinding(result, family),
    criteria: criteriaWithText,
    applicability: {
      ...structuredClone(result.authoring_applicability),
      criterion_relationships: structuredClone(criterionRelationships)
    },
    requiredAuthoredFields: family === "obligation"
      ? ["obligation_id", "statement", "controlled_contract_node_ids", "mechanism", "proof"]
      : ["node_ids", "axes"]
  };
}

function selectCoverageAction(result) {
  const family = result.schema_version.includes("obligation")
    ? "obligation" : "acceptance";
  return coverageAuthoringActionProjection({
    family,
    status: result.status,
    nextCalls: result.next_calls,
    criterionCount: result.criterion_identities.identities.length
  });
}

function publicCoverageDiagnostic(diagnostic) {
  const projected = { code: diagnostic.code };
  for (const field of ["field", "reference_id", "byte_limit", "omitted"]) {
    if (diagnostic[field] !== undefined) projected[field] = diagnostic[field];
  }
  if (Array.isArray(diagnostic.reference_ids)) {
    projected.reference_ids = [...diagnostic.reference_ids];
  }
  return projected;
}

function choiceContinuations(populations, contextContinuations) {
  return contextContinuations.filter(({ population }) => populations.includes(population))
    .map(({ population }) => population);
}

function coverageFieldContract(family, completePopulation, contextContinuations) {
  const nodeChoices = choiceContinuations(["contract_nodes"], contextContinuations);
  return family === "obligation" ? {
    obligation_id: { type: "controlled_obligation_identity", authored_by: "caller" },
    statement: { type: "nonempty_statement", authored_by: "caller" },
    controlled_contract_node_ids: {
      type: "current_contract_node_identity_array",
      choices_ref: "shared_context.contract_nodes",
      omitted_choices_continuation_populations: nodeChoices
    },
    mechanism: {
      type: "controlled_mechanism",
      choices_ref: "shared_context.proof_choices.mechanisms",
      omitted_choices_continuation_populations: choiceContinuations(
        ["mechanisms"], contextContinuations
      )
    },
    proof: {
      type: "exactly_one_gap_or_admitted_pack_component",
      choices_ref: "shared_context.proof_choices",
      omitted_choices_continuation_populations: choiceContinuations([
        "selected_packs", "selected_pack_requested_intents",
        "selected_pack_selectors", "admitted_pack_components", "gap_alternatives"
      ], contextContinuations)
    }
  } : {
    node_ids: {
      type: "current_contract_node_identity_array",
      choices_ref: "shared_context.contract_nodes",
      omitted_choices_continuation_populations: nodeChoices
    },
    axes: {
      type: "complete_six_axis_state_map",
      allowed_values: structuredClone(completePopulation[38]?.allowed_alternatives ?? {})
    }
  };
}

function publicCoveragePack(pack) {
  return Object.fromEntries([
    "pack_id", "profile_id", "profile_version", "requested_intents",
    "selection_status", "selectors", "guarantee", "member_accounting"
  ].filter((field) => pack?.[field] !== undefined).map((field) => [
    field, structuredClone(pack[field])
  ]));
}

function coverageContractNodeChoices(completePopulation) {
  const nodes = completePopulation[6]?.value ?? [];
  const mandatoryIds = [];
  const optionalIds = [];
  for (const node of nodes) {
    if (typeof node?.id !== "string" || typeof node?.mandatory !== "boolean" ||
        !sameJson(Object.keys(node).sort(), ["id", "mandatory"])) {
      throw new Error("coverage contract node normalization is not lossless");
    }
    (node.mandatory === true ? mandatoryIds : optionalIds).push(node.id);
  }
  return {
    total: nodes.length,
    returned: nodes.length,
    omitted: 0,
    mandatory_ids: mandatoryIds,
    optional_ids: optionalIds
  };
}

function derivePackMappingItems(selectedPacks) {
  return selectedPacks.flatMap((pack) =>
    (pack.requested_intents ?? []).flatMap((requestedIntent) =>
      (pack.selectors ?? []).map((selector) => ({
        kind: "pack_mapping",
        pack_id: pack.pack_id,
        requested_intent: requestedIntent,
        profile_id: pack.profile_id,
        profile_version: pack.profile_version,
        selector: {
          kind: selector.kind,
          component_id: selector.component_id
        },
        evaluation_stage: selector.evaluation_stage
      }))));
}

function coveragePackMappingItems(completePopulation, selectedPacks, family) {
  const derived = derivePackMappingItems(selectedPacks);
  if (family === "acceptance") return derived;
  const components = completePopulation[33]?.allowed_alternatives ?? [];
  if (!sameJson(components, derived)) {
    throw new Error("coverage pack mapping normalization is not lossless");
  }
  return components;
}

function coveragePackMappingChoices(components) {
  return {
    total: components.length,
    derivation: "selected_pack_requested_intent_selector_cross_product",
    selected_packs_ref: "shared_context.proof_choices.selected_packs",
    field_sources: {
      kind: { constant: "pack_mapping" },
      pack_id: { source: "selected_packs[].pack_id" },
      requested_intent: { source: "selected_packs[].requested_intents[]" },
      profile_id: { source: "selected_packs[].profile_id" },
      profile_version: { source: "selected_packs[].profile_version" },
      selector: {
        source: "selected_packs[].selectors[]",
        fields: ["kind", "component_id"]
      },
      evaluation_stage: {
        source: "selected_packs[].selectors[].evaluation_stage"
      }
    }
  };
}

function populationAccounting(total, returned) {
  return { total, returned, omitted: total - returned };
}

function proofMatchesPack(proof, pack) {
  return proof?.kind === "pack_mapping" && proof.pack_id === pack.pack_id &&
    proof.profile_id === pack.profile_id &&
    proof.profile_version === pack.profile_version;
}

function projectPackForProof(pack, proofs) {
  const matchingProofs = proofs.filter((proof) => proofMatchesPack(proof, pack));
  if (matchingProofs.length === 0) return null;
  const components = derivePackMappingItems([pack]);
  const returnedComponents = components.filter((component) =>
    matchingProofs.some((proof) => sameJson(component, proof)));
  const requestedIntents = [...new Set(matchingProofs.map(
    ({ requested_intent: requestedIntent }) => requestedIntent
  ))];
  const selectors = (pack.selectors ?? []).filter((selector) =>
    matchingProofs.some((proof) => proof.selector?.kind === selector.kind &&
      proof.selector?.component_id === selector.component_id &&
      proof.evaluation_stage === selector.evaluation_stage));
  return publicCoveragePack({
    ...pack,
    requested_intents: requestedIntents,
    selectors,
    member_accounting: {
      requested_intents: populationAccounting(
        pack.requested_intents?.length ?? 0, requestedIntents.length
      ),
      selectors: populationAccounting(pack.selectors?.length ?? 0, selectors.length),
      admitted_components: populationAccounting(
        components.length, returnedComponents.length
      )
    }
  });
}

function completeCoveragePack(pack) {
  const requestedIntents = pack.requested_intents?.length ?? 0;
  const selectors = pack.selectors?.length ?? 0;
  const components = derivePackMappingItems([pack]).length;
  return publicCoveragePack({
    ...pack,
    member_accounting: {
      requested_intents: populationAccounting(requestedIntents, requestedIntents),
      selectors: populationAccounting(selectors, selectors),
      admitted_components: populationAccounting(components, components)
    }
  });
}

function packRequestedIntentItems(packs) {
  return packs.flatMap((pack) => (pack.requested_intents ?? []).map(
    (requestedIntent) => ({
      pack_id: pack.pack_id,
      profile_id: pack.profile_id,
      profile_version: pack.profile_version,
      requested_intent: requestedIntent
    })
  ));
}

function packSelectorItems(packs) {
  return packs.flatMap((pack) => (pack.selectors ?? []).map((selector) => ({
    pack_id: pack.pack_id,
    profile_id: pack.profile_id,
    profile_version: pack.profile_version,
    selector: structuredClone(selector)
  })));
}

function contextContinuation({ family, baseArguments, rowSlotIdentity, population }) {
  return {
    tool: `workspace_controlled_contract_${family}_coverage_describe`,
    arguments: {
      ...structuredClone(baseArguments),
      selector: {
        kind: "authoring_context",
        row_slot_identity: rowSlotIdentity,
        population,
        offset: 0
      }
    }
  };
}

function coverageSharedContext({
  result,
  completePopulation,
  family,
  pageRows,
  exactSelection,
  baseArguments
}) {
  const allPacks = completePopulation[8]?.value ?? [];
  const selectedPacks = allPacks.map(completeCoveragePack);
  const allContractNodes = coverageContractNodeChoices(completePopulation);
  const allPackMappings = coveragePackMappingItems(
    completePopulation, selectedPacks, family
  );
  const allRequestedIntents = packRequestedIntentItems(selectedPacks);
  const allSelectors = packSelectorItems(selectedPacks);
  const allMechanisms = family === "obligation"
    ? structuredClone(completePopulation[31]?.allowed_alternatives ?? []) : [];
  const allGapAlternatives = family === "obligation"
    ? structuredClone(completePopulation[32]?.allowed_alternatives ?? []) : [];
  const relationships = pageRows.flatMap(
    ({ applicability }) => applicability.owner_produced_relationships
  );
  const linkedNodeIds = new Set(relationships.flatMap(
    ({ controlled_contract_node_ids: ids }) => ids ?? []
  ));
  const linkedProofs = relationships.map(({ proof }) => proof).filter(Boolean);
  const returnedContractNodeCount = exactSelection
    ? [...allContractNodes.mandatory_ids, ...allContractNodes.optional_ids]
      .filter((id) => linkedNodeIds.has(id)).length
    : allContractNodes.total;
  const returnedContractNodes = exactSelection ? {
    total: allContractNodes.total,
    returned: returnedContractNodeCount,
    omitted: allContractNodes.total - returnedContractNodeCount,
    mandatory_ids: allContractNodes.mandatory_ids.filter((id) => linkedNodeIds.has(id)),
    optional_ids: allContractNodes.optional_ids.filter((id) => linkedNodeIds.has(id))
  } : allContractNodes;
  const returnedPacks = exactSelection
    ? allPacks.map((pack) => projectPackForProof(pack, linkedProofs)).filter(Boolean)
    : selectedPacks;
  const returnedPackMappings = exactSelection
    ? allPackMappings.filter((choice) => linkedProofs.some((proof) =>
      proof.kind === "pack_mapping" && sameJson(choice, proof)))
    : allPackMappings;
  const returnedRequestedIntents = exactSelection
    ? allRequestedIntents.filter((item) => returnedPackMappings.some((mapping) =>
      mapping.pack_id === item.pack_id &&
      mapping.profile_id === item.profile_id &&
      mapping.profile_version === item.profile_version &&
      mapping.requested_intent === item.requested_intent))
    : allRequestedIntents;
  const returnedSelectors = exactSelection
    ? allSelectors.filter((item) => returnedPackMappings.some((mapping) =>
      mapping.pack_id === item.pack_id &&
      mapping.profile_id === item.profile_id &&
      mapping.profile_version === item.profile_version &&
      mapping.selector.kind === item.selector.kind &&
      mapping.selector.component_id === item.selector.component_id &&
      mapping.evaluation_stage === item.selector.evaluation_stage))
    : allSelectors;
  const linkedMechanismKinds = new Set(relationships.map(
    ({ mechanism }) => mechanism?.kind
  ).filter(Boolean));
  const returnedMechanisms = exactSelection
    ? allMechanisms.filter((mechanism) => linkedMechanismKinds.has(mechanism))
    : allMechanisms;
  const linkedGapKinds = new Set(linkedProofs.filter(
    ({ kind }) => kind === "explicit_gap"
  ).map(({ gap_kind: gapKind }) => gapKind));
  const returnedGapAlternatives = exactSelection
    ? allGapAlternatives.filter((gap) => linkedGapKinds.has(gap))
    : allGapAlternatives;
  const accounting = {
    owner_relationships: populationAccounting(
      result.authoring_applicability.criterion_relationships.length,
      relationships.length
    ),
    contract_nodes: populationAccounting(
      allContractNodes.total, returnedContractNodeCount
    ),
    selected_packs: populationAccounting(selectedPacks.length, returnedPacks.length),
    selected_pack_requested_intents: populationAccounting(
      allRequestedIntents.length, returnedRequestedIntents.length
    ),
    selected_pack_selectors: populationAccounting(
      allSelectors.length, returnedSelectors.length
    ),
    admitted_pack_components: populationAccounting(
      allPackMappings.length, returnedPackMappings.length
    ),
    mechanisms: populationAccounting(allMechanisms.length, returnedMechanisms.length),
    gap_alternatives: populationAccounting(
      allGapAlternatives.length, returnedGapAlternatives.length
    )
  };
  const contextContinuations = exactSelection && pageRows.length === 1
    ? ["contract_nodes", "selected_packs", "selected_pack_requested_intents",
        "selected_pack_selectors", "admitted_pack_components", "mechanisms",
        "gap_alternatives"]
      .filter((population) => accounting[population].omitted > 0)
      .map((population) => ({
        population,
        accounting: structuredClone(accounting[population]),
        continuation: contextContinuation({
          family,
          baseArguments,
          rowSlotIdentity: pageRows[0].row_slot_identity,
          population
        })
      }))
    : [];
  return {
    source: {
      authoring_identity: result.authoring_identity,
      criterion_identity_digest: result.criterion_identities.digest,
      source_identity: structuredClone(result.source_identity),
      ...(family === "acceptance"
        ? { carrier_identity: structuredClone(result.carrier_identity) } : {}),
      digests: structuredClone(result.digests ?? {})
    },
    applicability: {
      mode: result.authoring_applicability.mode,
      owner_produced_criterion_relationships:
        result.authoring_applicability.criterion_relationships.length,
      inferred_relationships:
        result.authoring_applicability.inferred_relationship_count,
      caller_selects_mapping: result.authoring_applicability.caller_selects_mapping
    },
    accounting,
    contract_nodes: returnedContractNodes,
    proof_choices: family === "obligation" ? {
      selected_packs: returnedPacks,
      mechanisms: returnedMechanisms,
      gap_alternatives: returnedGapAlternatives,
      admitted_pack_components: coveragePackMappingChoices(returnedPackMappings)
    } : {
      selected_packs: returnedPacks
    },
    field_contract: coverageFieldContract(
      family, completePopulation, contextContinuations
    ),
    context_continuations: contextContinuations
  };
}

function coverageRowPageProjection({
  result,
  completePopulation,
  rows,
  returnedCount,
  baseArguments,
  diagnostics,
  exactSelection = false,
  nextSlotOverride,
  remainingOverride
}) {
  const family = result.schema_version.includes("obligation")
    ? "obligation" : "acceptance";
  const carrierState = result.status.endsWith("_absent") ? "absent"
    : result.status.endsWith("_stale") ? "stale" : "current";
  const pageRows = rows.slice(0, returnedCount);
  const nextSlot = nextSlotOverride === undefined
    ? rows[returnedCount] ?? null : nextSlotOverride;
  const authoringAction = selectCoverageAction(result);
  return {
    schema_version: COVERAGE_DESCRIBE_PROJECTION_VERSION,
    family,
    mode: "authoring_page",
    unit: {
      wk_id: result.unit.wk_id,
      selected_unit: result.unit.selected_unit,
      focus: result.unit.focus ?? result.unit.controlled_focus ?? null,
      address: result.unit.address,
      kind: result.unit.kind
    },
    carrier_state: carrierState,
    currentness: {
      current: result.currentness?.current === true,
      changed_binding_classes: structuredClone(
        result.currentness?.changed_bindings ?? []
      )
    },
    page: {
      total: pageRows[0]?.total ?? 0,
      start_ordinal: pageRows[0]?.ordinal ?? null,
      returned: pageRows.length,
      remaining: remainingOverride ?? rows.length - pageRows.length
    },
    shared_context: coverageSharedContext({
      result,
      completePopulation,
      family,
      pageRows,
      exactSelection,
      baseArguments
    }),
    rows: pageRows.map((slot) => structuredClone(slot)),
    ...(authoringAction === null ? {} : { authoring_action: authoringAction }),
    read_pagination: {
      complete: nextSlot === null,
      continuation: nextSlot === null ? null : {
        tool: `workspace_controlled_contract_${family}_coverage_describe`,
        arguments: {
          ...structuredClone(baseArguments),
          selector: {
            kind: "authoring_row",
            row_slot_identity: nextSlot.row_slot_identity
          }
        }
      }
    },
    diagnostics
  };
}

function coverageContextPopulation(completePopulation, family, population) {
  if (population === "contract_nodes") {
    return (completePopulation[6]?.value ?? []).map((node) => structuredClone(node));
  }
  const selectedPacks = (completePopulation[8]?.value ?? []).map(completeCoveragePack);
  if (population === "selected_packs") return selectedPacks;
  if (population === "selected_pack_requested_intents") {
    return packRequestedIntentItems(selectedPacks);
  }
  if (population === "selected_pack_selectors") return packSelectorItems(selectedPacks);
  if (population === "admitted_pack_components") {
    return coveragePackMappingItems(completePopulation, selectedPacks, family);
  }
  if (population === "mechanisms") {
    if (family === "obligation") {
      return structuredClone(completePopulation[31]?.allowed_alternatives ?? []);
    }
    throw new ControlledContractToolError(
      "coverage_authoring_context_population_not_applicable",
      "coverage context population does not apply to this coverage family",
      { changed: false, family, population }
    );
  }
  if (population === "gap_alternatives") {
    if (family === "obligation") {
      return structuredClone(completePopulation[32]?.allowed_alternatives ?? []);
    }
    throw new ControlledContractToolError(
      "coverage_authoring_context_population_not_applicable",
      "coverage context population does not apply to this coverage family",
      { changed: false, family, population }
    );
  }
  throw new ControlledContractToolError(
    "coverage_describe_selector_invalid",
    "coverage context selector names an unsupported population",
    { changed: false, population }
  );
}

function coverageContextPageProjection({
  result,
  family,
  selected,
  population,
  items,
  offset,
  returnedCount,
  baseArguments,
  diagnostics
}) {
  const returnedItems = items.slice(offset, offset + returnedCount);
  const nextOffset = offset + returnedItems.length;
  const carrierState = result.status.endsWith("_absent") ? "absent"
    : result.status.endsWith("_stale") ? "stale" : "current";
  return {
    schema_version: COVERAGE_DESCRIBE_PROJECTION_VERSION,
    family,
    mode: "authoring_context_page",
    unit: {
      wk_id: result.unit.wk_id,
      selected_unit: result.unit.selected_unit,
      focus: result.unit.focus ?? result.unit.controlled_focus ?? null,
      address: result.unit.address,
      kind: result.unit.kind
    },
    carrier_state: carrierState,
    currentness: {
      current: result.currentness?.current === true,
      changed_binding_classes: structuredClone(
        result.currentness?.changed_bindings ?? []
      )
    },
    criterion: structuredClone(selected.publicSlot.criterion),
    population: {
      kind: population,
      total: items.length,
      offset,
      returned: returnedItems.length,
      omitted: items.length - returnedItems.length,
      items: returnedItems
    },
    read_pagination: {
      complete: nextOffset >= items.length,
      continuation: nextOffset >= items.length ? null : {
        tool: `workspace_controlled_contract_${family}_coverage_describe`,
        arguments: {
          ...structuredClone(baseArguments),
          selector: {
            kind: "authoring_context",
            row_slot_identity: selected.publicSlot.row_slot_identity,
            population,
            offset: nextOffset
          }
        }
      }
    },
    diagnostics
  };
}

export function materializeCoverageAuthoringSkeleton({
  result,
  selector = null,
  baseArguments = {},
  transportByteLimit = activeMcpInlineByteLimit(),
  measureInlineBytes = measureMcpInlineResultBytes,
  authoringSessions = createControlledContractCoverageAuthoringSessions()
}) {
  const skeleton = result?.authoring_skeleton;
  if (!skeleton || !Array.isArray(skeleton.complete_population) ||
      skeleton.complete_population.length !== COVERAGE_AUTHORING_SLOT_COUNT ||
      skeleton.inline_projection?.total !== COVERAGE_AUTHORING_SLOT_COUNT ||
      skeleton.inline_projection.returned + skeleton.inline_projection.omitted !==
        COVERAGE_AUTHORING_SLOT_COUNT) {
    throw new Error("coverage authoring skeleton is not one complete 39-entry projection");
  }
  const completePopulation = skeleton.complete_population;
  const family = result.schema_version.includes("obligation")
    ? "obligation" : "acceptance";
  const sessionInput = coverageAuthoringSessionInput(
    result, completePopulation, family
  );
  let selected;
  if (selector === null) {
    const issued = authoringSessions.issue(sessionInput);
    selected = authoringSessions.resolvePage(issued.row_slot_identity, {
      family,
      binding: sessionInput.binding
    });
  } else {
    if (!["authoring_row", "authoring_context"].includes(selector.kind) ||
        !COVERAGE_ROW_SLOT_PATTERN.test(selector.row_slot_identity ?? "")) {
      throw new ControlledContractToolError(
        "coverage_describe_selector_invalid",
        "coverage describe selector must identify one server-minted authoring row",
        { changed: false }
      );
    }
    selected = authoringSessions.resolve(selector.row_slot_identity, {
      family,
      binding: sessionInput.binding
    });
  }
  const candidateDiagnostics = skeleton.diagnostics
    .filter(({ code }) => ![
      "inline_projection_bound_overflow", "unresolved_semantic_slot"
    ].includes(code))
    .slice(0, COVERAGE_DESCRIBE_DIAGNOSTIC_LIMIT)
    .map(publicCoverageDiagnostic);
  if (selector?.kind === "authoring_context") {
    const items = coverageContextPopulation(
      completePopulation, family, selector.population
    );
    if (!Number.isSafeInteger(selector.offset) || selector.offset < 0 ||
        selector.offset >= items.length) {
      throw new ControlledContractToolError(
        "coverage_describe_selector_invalid",
        "coverage context selector offset is outside the selected population",
        { changed: false, population: selector.population, offset: selector.offset,
          total: items.length }
      );
    }
    for (let returnedCount = items.length - selector.offset;
      returnedCount >= 1; returnedCount -= 1) {
      const projection = coverageContextPageProjection({
        result,
        family,
        selected,
        population: selector.population,
        items,
        offset: selector.offset,
        returnedCount,
        baseArguments,
        diagnostics: candidateDiagnostics
      });
      if (measureInlineBytes(projection) <= transportByteLimit) {
        return freezeJson(projection);
      }
    }
    throw new ControlledContractToolError(
      "coverage_authoring_page_exceeds_transport",
      "one coverage authoring context item exceeds the active transport",
      { changed: false, transport_byte_limit: transportByteLimit,
        population: selector.population }
    );
  }
  const exactSelection = selector?.kind === "authoring_row";
  const candidateRows = exactSelection
    ? [selected.publicSlot] : selected.remainingSlots;
  for (let returnedCount = candidateRows.length;
    returnedCount >= 1; returnedCount -= 1) {
    for (let diagnosticCount = candidateDiagnostics.length;
      diagnosticCount >= 0; diagnosticCount -= 1) {
      const projection = coverageRowPageProjection({
        result,
        completePopulation,
        rows: candidateRows,
        returnedCount,
        baseArguments,
        diagnostics: candidateDiagnostics.slice(0, diagnosticCount),
        exactSelection,
        ...(exactSelection ? {
          nextSlotOverride: selected.nextSlot,
          remainingOverride: selected.publicSlot.total - selected.publicSlot.ordinal
        } : {})
      });
      if (measureInlineBytes(projection) <= transportByteLimit) {
        return freezeJson(projection);
      }
    }
  }
  throw new ControlledContractToolError(
    "coverage_authoring_page_exceeds_transport",
    "one complete coverage authoring row and its shared context exceed the active transport",
    { changed: false, transport_byte_limit: transportByteLimit }
  );
}

function sameJson(left, right) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    ) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function projectProofPackSelectionRepository(context, repo) {
  if (repo === undefined) return context;
  const projected = structuredClone(context);
  for (const candidate of projected.selection.compatible_candidates) {
    for (const call of candidate.inspection_calls) {
      if (call.tool === "workspace_controlled_proof_pack_bindings_inspect") {
        call.arguments.repo = repo;
      }
    }
  }
  return freezeJson(projected);
}

export function materializeProofPackSelectionTaskPage({
  context,
  transportByteLimit = activeMcpInlineByteLimit(),
  measureInlineBytes = measureMcpInlineResultBytes
}) {
  const compatibleCandidates = structuredClone(
    context.selection.compatible_candidates
  );
  const selectionSnapshot = {
    identity: context.source_digests.selection,
    contract_digest: context.source_digests.contract,
    package_digests: {
      catalog: context.source_digests.catalog,
      vocabulary: context.source_digests.vocabulary,
      profiles: context.source_digests.profiles,
      intent_artifact: context.source_digests.intent_artifact
    }
  };
  const candidateIdentities = compatibleCandidates.map((candidate) => ({
      profile_id: candidate.profile_id,
      profile_version: candidate.profile_version,
      requested_intents: [...candidate.requested_intents]
    }));
  const result = {
    schema_version: "controlled-contract-proof-pack-task-result.v1",
    selection_schema_version: context.selection.schema_version,
    selection_snapshot: selectionSnapshot,
    decision: structuredClone(context.selection.decision),
    per_intent_outcomes: structuredClone(context.selection.per_intent_outcomes),
    compatible_candidates: compatibleCandidates,
    authority: context.selection.authority,
    task: {
      wk_id: context.task.wk_id,
      focus: context.task.focus,
      requested_intent_ids: [...context.task.requested_intent_ids]
    },
    candidate_counts: {
      total: context.selection.decision.compatible_candidate_count,
      returned: context.selection.decision.compatible_candidate_count,
      remaining: 0,
      identities: candidateIdentities
    }
  };
  if (measureInlineBytes(result) <= transportByteLimit) return freezeJson(result);
  throw new ControlledContractToolError(
    "proof_pack_selection_summary_exceeds_transport",
    "proof-pack selection decision and exact inspections exceed the active transport",
    { changed: false, transport_byte_limit: transportByteLimit }
  );
}

const CONTROLLED_CONTRACT_ROUTE_METADATA = Object.freeze([
  ["workspace_controlled_vocabulary_query", "sha256:0ed50a7e8c1f3a2b755add214c3bad02368badfe5538603813cc11cd1417451b"],
  ["workspace_controlled_proof_intents_discover", "sha256:9e5ab74f6e017e33da02fc66f376d0f51775d00981e0769bb601bfcdadf94cbd"],
  ["workspace_controlled_proof_packs_select", "sha256:3a81a606b027dbf23e801b036ce925c5992a3fcbf516a7524e0e891e8a44dff3"],
  ["workspace_controlled_proof_pack_describe", "sha256:0de95f800bcc218a2bc261ed9af88c6d1d571f0d6910e6f96e8c7e77d846bc2f"],
  ["workspace_controlled_proof_pack_bindings_inspect", "sha256:decd65d76810233cbe9b4564e71a87c960583701559bf1dc0f0a61b34427e788"],
  ["workspace_controlled_proof_plan_build", "sha256:33b4d40e71ffedafebd866badba4f751e795112f44fd9e50dc0bb94845930870"],
  ["workspace_controlled_contract_assess", "sha256:3488037926fb110d7a6f8bd43089a5d4d910e4e055c4905800e72c90e23a4467"],
  ["workspace_controlled_contract_assessment_query", "sha256:5e516c2460333c9a7e162ef73d5fd30ade73b82c77476db7c63e3c5f0ef8543e"],
  ["workspace_controlled_contract_runtime_prove", "sha256:af8c98d1d5998756808d39254b2543711a31d674735a4e9b6ea03ea6979e3a11"],
  ["workspace_verify_proof", "sha256:f87c93a7f3811a458524d17bcaaeb148e580ff365d8c2b46c53a50387800baa0"],
  ["workspace_controlled_contract_carrier_create", "sha256:fadfe911a1c8998d22c7fd9b689519282c363513783b1aa2161d960f8cc3aa65"],
  ["workspace_controlled_contract_carrier_query", "sha256:55c3e34390e4650f639289738cdbfecb3e1369ff6ad5cdd0a1aca96ef7333807"],
  ["workspace_controlled_contract_carrier_patch", "sha256:98bb42dae133283e80d93928559bf74e0c86b55bb28e6baca2d5b5c06037ced2"],
  ["workspace_controlled_verification_bundle_patch", "sha256:fd27230a08b24853410800421a8d8e355206aced9d17706e6240af6fc4f33d48"],
  ["workspace_controlled_contract_authoring_describe", "sha256:9ffca1ea1d1fe28734f9e9b1f184cdb611c5d87afd7bd71145315c5e33f277d7"],
  ["workspace_controlled_contract_authoring_state", "sha256:9a18dc6346da2ae8e1c296a047e956bd9faabb4e10d024f1db72bb00691112c8"],
  ["workspace_controlled_contract_proof_graph_continue", "sha256:2f7238d0003324da4a22c691dfbf7535667558b6cf1e0e858ec20c61d6d5d637"],
  ["workspace_controlled_proof_authoring_skeleton", "sha256:6c6f26f23fae3a8b510c05b054130a63370700cb553d537c7b8e4571e7932bfb"],
  ["workspace_controlled_common_proof_capture", "sha256:ea607fb3bd144c6db5fe54aaf8ec547ec2db7df77d6955375416207435cc900d"],
  ["workspace_controlled_integration_prefix_capture_author", "sha256:19aa026fa8485ea2ea7b58fe1c5a72c3bd2ea6d6682007519310cd8236800e79"],
  ["workspace_controlled_contract_authoring_continue", "sha256:4406b37bce4b6a4debe3f4ef84b0047ca923fcbe26e54773a6b7b12bd42d5033"],
  ["workspace_controlled_test_proof_authoring_describe", "sha256:c079b6c62d3bace67861e02120c703be88b548089afeb4c35919ced92c582fcb"],
  ["workspace_controlled_test_proof_query", "sha256:400c4da4df9765187dc24327a3fff88dd579424a2b23234eba9518f38364e3ea"],
  ["workspace_controlled_test_proof_patch", "sha256:6026bdd72975c5b28a9f4e73a9493af4fecbc8e9f3bc040a4beaeb30ca3e24a7"],
  ["workspace_controlled_contract_acceptance_coverage_describe", "sha256:806764d8621105eddd5da29e037ec94ed325250c33695f6815f5e32eab3db660"],
  ["workspace_controlled_contract_acceptance_coverage_create", "sha256:b9ce8f8ec9a5bfe63b05c186fcf8b82e1fd37c42f1b11ef6e748afec20c10ab1"],
  ["workspace_controlled_contract_acceptance_coverage_upsert", "sha256:d08b2c31bbddf8067e549aab43f00be0c77c9ebd908c1d17eab112bd96f474ac"],
  ["workspace_controlled_contract_acceptance_coverage_remove", "sha256:c64e9e5201a8d57215f84a297673141cb354651614a1e5ee37d6c92a6659be3e"],
  ["workspace_controlled_contract_acceptance_coverage_query", "sha256:89eb421bf731f0d4f655cc345e4094d77c479076c4327fdbf8e952d43aa05398"],
  ["workspace_controlled_contract_acceptance_coverage_rebase", "sha256:a2f4bd6bda4bfbaef2ed05beeefd7b6f6b01a9e014423340c92951bc8fcd8547"],
  ["workspace_controlled_contract_acceptance_coverage_patch", "sha256:85cf7ae8d651eaeb7a845654a20e44ca4d6078a30209bb7b15fd0db132af860c"],
  ["workspace_controlled_contract_obligation_coverage_describe", "sha256:bc9b14f73a81bac0fb79dfb9afe62a07fcf17b50ca106e6b68649ffd0eb46239"],
  ["workspace_controlled_contract_obligation_coverage_create", "sha256:2604c6c539f90d29eadc45eff26deb92bb7cbe827158f187c104f8b021bc8c6d"],
  ["workspace_controlled_contract_obligation_coverage_upsert", "sha256:4ab5c48f7b864a2b25ab41813473dd39349b09191eafd83b6959add837591ffa"],
  ["workspace_controlled_contract_obligation_coverage_remove", "sha256:8ae822266ecb79f44372cb3352ac5a5a32c16400604c43e0dfd035f6c21e9ea3"],
  ["workspace_controlled_contract_obligation_coverage_query", "sha256:b44141735326ccc41ac3c0eccb57c351ae27d53c705767f1e834f9c5f463cf81"],
  ["workspace_controlled_contract_obligation_coverage_rebase", "sha256:0307f5ba2f70e5dcfb9fd77a2b980c4bbb35f2c788f9ac0d3dfd451a7044ab08"],
  ["workspace_controlled_contract_obligation_coverage_patch", "sha256:5c961c934353335fd5f80ff7bf4487926cdf808f91b2a3445e126a789aefb23a"],
  ["workspace_controlled_contract_integration_test_design_assess", "sha256:3042f81ffa3cd506a93fd556315d90e3114caa102fcf300f61084db9ce012177"],
  ["workspace_controlled_contract_integration_test_design_query", "sha256:67bc604ca08afae87d9c2bebc56f3ea0c7b5152178d03d1c53d7e259bc69d827"],
  ["workspace_controlled_contract_refactor_plan", "sha256:984cdde37faff701dd9e3392fcfe89c2eb54d2143bb3ab85e77b4319149707f0"],
  ["workspace_controlled_contract_refactor_query", "sha256:a32a7abc4d6cee324631aa01444fbadfe26d567a07d87b418b43a5e9dd08473b"],
  ["workspace_controlled_contract_refactor_apply", "sha256:21a43ba0cf362df3dd2cf02692c5c7f2d14643b7f5775b626550793753860156"],
  ["workspace_controlled_contract_private_scope_census", "sha256:33e13bd617580ccd31c676795370d7600eef8be8de026538180ca0813b4d892b"]
].map(([name, discoveryMetadataSha256]) => Object.freeze({
  name,
  discoveryMetadataSha256
})));

function canonicalizeRegistryMetadata(value) {
  if (Array.isArray(value)) return value.map(canonicalizeRegistryMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalizeRegistryMetadata(value[key])
    ]));
  }
  return value;
}

function registryMetadataDigest(value) {
  return `sha256:${createHash("sha256").update(
    JSON.stringify(canonicalizeRegistryMetadata(value))
  ).digest("hex")}`;
}

export function assertControlledContractDiscoveryRegistryParity(discoveryFragment) {
  const rows = Array.isArray(discoveryFragment?.tools) ? discoveryFragment.tools : [];
  if (discoveryFragment?.tool_count !== CONTROLLED_CONTRACT_ROUTE_METADATA.length ||
      rows.length !== CONTROLLED_CONTRACT_ROUTE_METADATA.length) {
    throw new Error("controlled-contract discovery population does not match the authoritative registry");
  }
  for (let index = 0; index < CONTROLLED_CONTRACT_ROUTE_METADATA.length; index += 1) {
    const owner = CONTROLLED_CONTRACT_ROUTE_METADATA[index];
    const row = rows[index];
    if (row?.tool_name !== owner.name) {
      throw new Error(`controlled-contract discovery route order drift at index ${index}: ${owner.name}`);
    }
    if (registryMetadataDigest(row) !== owner.discoveryMetadataSha256) {
      throw new Error(`controlled-contract discovery exact field parity drift: ${owner.name}`);
    }
  }
  return true;
}

export const CONTROLLED_CONTRACT_TOOL_REGISTRY = Object.freeze({
  schema_version: "controlled-contract-route-registry.v1",
  routeMetadata: CONTROLLED_CONTRACT_ROUTE_METADATA,
  materialize: createControlledContractToolRegistry
});

export const CONTROLLED_CONTRACT_MCP_TOOL_NAMES = Object.freeze(
  CONTROLLED_CONTRACT_TOOL_REGISTRY.routeMetadata.map(({ name }) => name)
);

const CONTROLLED_CONTRACT_RUNTIME_HANDLER_OWNER = Symbol(
  "controlled-contract-runtime-handler-owner"
);

export function controlledContractRuntimeHandlerOwner(handler) {
  return handler?.[CONTROLLED_CONTRACT_RUNTIME_HANDLER_OWNER] ?? null;
}

export function createControlledContractToolRegistry({
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  resolveControlledContractGenerationBinding,
  persistControlledContractGeneration,
  resolveLauncherReceipt = null,
  assessIntegrationTestDesign = assessControlledContractIntegrationTestDesignOperation,
  authorIntegrationPrefixCapture = buildProofAuthoringSkeletonOperation,
  continueProofGraph = continueControlledContractProofGraphOperation,
  readAuthoringState = controlledContractAuthoringStateOperation
  , sessionRole = process.env.WIKI_MCP_TOOL_PROFILE ?? null,
  taskCursorCodec = createControlledContractTaskCursorCodec(),
  persistRefactorItemReference = persistControlledContractRefactorItemReference
}) {
  const coverageAuthoringSessions = createControlledContractCoverageAuthoringSessions();
  const refactorPlanSnapshots = new Map();
  const rememberRefactorPlanSnapshot = (resourceIdentity, snapshot, workspace) => {
    refactorPlanSnapshots.delete(resourceIdentity);
    refactorPlanSnapshots.set(resourceIdentity, Object.freeze({ snapshot,
      repositoryIdentity: workspace.dir }));
    while (refactorPlanSnapshots.size > CONTROLLED_CONTRACT_REFACTOR_SNAPSHOT_LIMIT) {
      refactorPlanSnapshots.delete(refactorPlanSnapshots.keys().next().value);
    }
  };
  const refactorPlanSnapshot = async (resourceIdentity, workspace, code) => {
    const retained = refactorPlanSnapshots.get(resourceIdentity);
    if (retained === undefined || retained.repositoryIdentity !== workspace.dir) {
      await controlledContractOperation(async () => {
        throw new ControlledContractToolError(code,
          "refactor plan snapshot is unavailable after restart, eviction, or repository mismatch",
          { changed: false,
            recovery: { operation: "workspace_controlled_contract_refactor_plan" } });
      });
    }
    return retained.snapshot;
  };
  const registryEntries = [];
  const registryNames = new Set();
  const defineControlledContractTool = (name, config, handler) => {
    if (registryNames.has(name)) {
      throw new Error(`controlled-contract registry declares a route more than once: ${name}`);
    }
    registryNames.add(name);
    registryEntries.push({ name, config: Object.freeze(config), handler });
  };

  const wkId = z.string().regex(/^WK-[0-9]{4}$/);
  const focusValue = z.string().regex(
    new RegExp(CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern),
    JSON.stringify({
      cause: "controlled_contract_focus_identity_invalid",
      accepted_form: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form
    })
  ).refine(isControlledContractFocus, JSON.stringify({
    cause: "controlled_contract_focus_identity_invalid",
    accepted_form: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form
  })).describe(CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form);
  const focus = focusValue.optional();
  const acceptanceCoverageUnit = z.string().regex(
    /^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$/
  );
  const coverageDescribeSelector = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("authoring_row"),
      row_slot_identity: z.string().regex(COVERAGE_ROW_SLOT_PATTERN)
    }).strict(),
    z.object({
      kind: z.literal("authoring_context"),
      row_slot_identity: z.string().regex(COVERAGE_ROW_SLOT_PATTERN),
      population: z.enum([
        "contract_nodes", "selected_packs", "admitted_pack_components",
        "selected_pack_requested_intents", "selected_pack_selectors",
        "mechanisms", "gap_alternatives"
      ]),
      offset: z.number().int().nonnegative()
    }).strict()
  ]);
  const acceptanceCoverageOperationIdentity = (unit) => {
    const [wkIdValue, selectedUnitValue = null] = unit.split("#");
    return { wkId: wkIdValue, selectedUnit: selectedUnitValue };
  };
  const commonProofCaptureOperation = createCommonProofCaptureOperation({
    repositories: Object.fromEntries(
      workspaceRepos?.repos instanceof Map ? workspaceRepos.repos : []
    ),
    resolveLauncherReceipt
  });
  const proofIntentQuery = z.string().min(1)
    .describe(PROOF_INTENT_DISCOVERY_QUERY_POLICY.accepted_form);
  const profileId = z.string().min(1).max(256);
  const profileVersion = z.string().min(1).max(64);
  const requestedIntents = z.array(z.string().min(1).max(512)).min(1).max(28);
  const authoringContinuation = z.string().regex(/^(?:sha256:)?[0-9a-f]{64}$/);
  const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable();
  const shaDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
  const acceptanceCoverageCarrierIdentity = z.object({
    carrier_kind: z.literal("controlled-acceptance"),
    wk_id: wkId,
    focus: focusValue.nullable(),
    selected_unit: z.string().regex(/^SLICE-[0-9]{3,}$/).nullable(),
    content_digest: shaDigest.nullable()
  }).strict();
  const acceptanceCoverageSourceIdentity = z.object({
    source_kind: z.literal("obligation-coverage"),
    content_digest: shaDigest
  }).strict();
  const acceptanceCoverageCriterionSelector = z.object({
    kind: z.literal("criterion_identity"),
    criterion_identity: z.string().min(1).max(4096)
  }).strict();
  const acceptanceCoverageQuerySelector = z.union([
    acceptanceCoverageCriterionSelector,
    z.object({
      kind: z.literal("contract_node"),
      node_id: z.string().min(1).max(4096)
    }).strict()
  ]);
  const acceptanceCoverageAxes = z.object({
    authored_contract_coverage: z.enum(ACCEPTANCE_COVERAGE_STATES),
    structural_verification: z.enum(ACCEPTANCE_COVERAGE_STATES),
    selected_pack_guarantee_coverage: z.enum(ACCEPTANCE_COVERAGE_STATES),
    implementation_ownership: z.enum(ACCEPTANCE_COVERAGE_STATES),
    verification_ownership: z.enum(ACCEPTANCE_COVERAGE_STATES),
    scope_feasibility: z.enum(ACCEPTANCE_COVERAGE_STATES)
  }).strict();
  const acceptanceCoverageRow = z.object({
    criterion_identity: z.string().min(1).max(4096),
    node_ids: z.array(z.string().min(1).max(4096)).max(4096),
    axes: acceptanceCoverageAxes
  }).strict();
  const coverageRowSlotIdentity = z.string().regex(COVERAGE_ROW_SLOT_PATTERN);
  const acceptanceCoverageAuthoredRow = z.object({
    row_slot_identity: coverageRowSlotIdentity,
    node_ids: z.array(z.string().min(1).max(4096)).max(4096),
    axes: acceptanceCoverageAxes
  }).strict();
  const acceptanceCoveragePatchOperation = z.union([
    z.object({
      op: z.literal("upsert"),
      criterion_selector: acceptanceCoverageCriterionSelector,
      row: acceptanceCoverageRow
    }).strict(),
    z.object({
      op: z.literal("remove"),
      criterion_selector: acceptanceCoverageCriterionSelector
    }).strict(),
    z.object({
      op: z.literal("upsert"),
      row_slot_identity: coverageRowSlotIdentity,
      row: z.object({
        node_ids: z.array(z.string().min(1).max(4096)).max(4096),
        axes: acceptanceCoverageAxes
      }).strict()
    }).strict()
  ]);
  const rebaseConflictSetIdentity = shaDigest;
  const rebaseCursor = z.string().min(1).max(16384);
  const rebaseDisposition = (rowSchema) => z.union([
    z.object({
      conflict_id: shaDigest,
      disposition: z.enum(["retain", "remove"])
    }).strict(),
    z.object({
      conflict_id: shaDigest,
      disposition: z.literal("replace"),
      row: rowSchema
    }).strict(),
    z.object({
      conflict_id: shaDigest,
      disposition: z.literal("add"),
      row: rowSchema
    }).strict()
  ]);
  const closedRebaseInput = (shape, variants) => z.object({
    mode: z.enum(["attempt", "page", "resolve"]),
    repo: z.string().optional(),
    unit: acceptanceCoverageUnit,
    focus,
    ...shape
  }).strict().superRefine((value, context) => {
    const required = variants[value.mode];
    const variantFields = new Set(Object.values(variants).flat());
    for (const field of required) {
      if (!Object.hasOwn(value, field) || value[field] === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [field],
          message: `${field} is required for ${value.mode} rebase` });
      }
    }
    for (const field of variantFields) {
      if (!required.includes(field) && Object.hasOwn(value, field) &&
          value[field] !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [field],
          message: `${field} is not accepted for ${value.mode} rebase` });
      }
    }
  });
  const obligationCoverageCriterionSelector = z.object({
    kind: z.literal("criterion_identity"),
    criterion_identity: z.string().min(1).max(4096)
  }).strict();
  const obligationCoverageObligationSelector = z.object({
    kind: z.literal("obligation_id"),
    obligation_id: z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/)
  }).strict();
  const obligationCoverageMechanism = z.object({
    owner: z.string().min(1),
    kind: z.enum([
      "code_symbol", "schema", "test", "configuration", "durable_record",
      "tool_operation"
    ]),
    selector: z.string().min(1)
  }).strict();
  const obligationCoverageProof = z.union([
    z.object({
      kind: z.literal("pack_mapping"),
      requested_intent: z.string().min(1),
      selector: z.object({
        kind: z.enum([
          "reference_binding", "claim", "relation", "collection",
          "resolver_fact", "evidence"
        ]),
        component_id: z.string().min(1)
      }).strict(),
      evaluation_stage: z.enum(["pre_dispatch", "post_delivery"])
    }).strict(),
    z.object({
      kind: z.literal("explicit_gap"),
      gap_kind: z.enum([
        "catalog_gap", "mechanism_gap", "implementation_not_delivered",
        "existing_mechanism_unextended", "review_only", "no_proof_required"
      ]),
      reason: z.string().min(1)
    }).strict()
  ]);
  const obligationCoverageRow = z.object({
    obligation_id: z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/),
    statement: z.string().min(1),
    criterion_selector: obligationCoverageCriterionSelector,
    controlled_contract_node_ids: z.array(z.string().min(1)).min(1),
    mechanism: obligationCoverageMechanism,
    proof: obligationCoverageProof
  }).strict();
  const obligationCoverageAuthoredRow = z.object({
    row_slot_identity: coverageRowSlotIdentity,
    obligation_id: z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/),
    statement: z.string().min(1),
    controlled_contract_node_ids: z.array(z.string().min(1)).min(1),
    mechanism: obligationCoverageMechanism,
    proof: obligationCoverageProof
  }).strict();
  const obligationCoveragePatchOperation = z.union([
    z.object({
      op: z.literal("upsert"),
      obligation_selector: obligationCoverageObligationSelector,
      row: obligationCoverageRow
    }).strict(),
    z.object({
      op: z.literal("remove"),
      obligation_selector: obligationCoverageObligationSelector
    }).strict(),
    z.object({
      op: z.literal("upsert"),
      obligation_selector: obligationCoverageObligationSelector,
      row_slot_identity: coverageRowSlotIdentity,
      row: z.object({
        obligation_id: z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/),
        statement: z.string().min(1),
        controlled_contract_node_ids: z.array(z.string().min(1)).min(1),
        mechanism: obligationCoverageMechanism,
        proof: obligationCoverageProof
      }).strict()
    }).strict()
  ]);
  const acceptanceCoverageRebaseInput = closedRebaseInput({
    carrier_identity: acceptanceCoverageCarrierIdentity.optional(),
    source_identity: acceptanceCoverageSourceIdentity.optional(),
    expected_unit_digest: shaDigest.optional(),
    conflict_set_identity: rebaseConflictSetIdentity.optional(),
    cursor: rebaseCursor.optional(),
    dispositions: z.array(rebaseDisposition(acceptanceCoverageRow)).max(4096).optional()
  }, {
    attempt: ["carrier_identity", "source_identity", "expected_unit_digest"],
    page: ["conflict_set_identity", "cursor"],
    resolve: ["conflict_set_identity", "dispositions"]
  });
  const obligationCoverageSourceIdentity = z.object({
    source_kind: z.literal("obligation-coverage"),
    wk_id: wkId,
    controlled_focus: focusValue.nullable(),
    selected_unit: z.string().regex(/^SLICE-[0-9]{3,}$/).nullable(),
    locator_digest: shaDigest,
    content_digest: shaDigest
  }).strict();
  const obligationCoverageQuerySelector = z.union([
    obligationCoverageObligationSelector,
    obligationCoverageCriterionSelector,
    z.object({
      kind: z.literal("contract_node"), node_id: z.string().min(1).max(4096)
    }).strict(),
    z.object({
      kind: z.literal("mechanism"), mechanism: obligationCoverageMechanism
    }).strict(),
    z.object({
      kind: z.literal("proof_kind"),
      proof_kind: z.enum(["pack_mapping", "explicit_gap"])
    }).strict()
  ]);
  const malformedObligationCoverageInput = Symbol(
    "controlled-contract-obligation-coverage-malformed-input"
  );
  const obligationCoverageInputSchema = (schema) => {
    const strictSafeParseAsync = schema.safeParseAsync.bind(schema);
    Object.defineProperty(schema, "safeParseAsync", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: async (input, options) => {
        const parsed = await strictSafeParseAsync(input, options);
        if (parsed.success) return parsed;
        const issues = parsed.error.issues.slice(0, 32).map((issue) => ({
          code: issue.code,
          path: issue.path.map((part) => typeof part === "number" ? part : String(part))
        }));
        return {
          success: true,
          data: {
            [malformedObligationCoverageInput]: {
              issueCount: parsed.error.issues.length,
              issues
            }
          }
        };
      }
    });
    return schema;
  };
  const obligationCoverageRebaseInput = obligationCoverageInputSchema(
    closedRebaseInput({
      expected_authoring_identity: shaDigest.optional(),
      source_identity: obligationCoverageSourceIdentity.optional(),
      conflict_set_identity: rebaseConflictSetIdentity.optional(),
      cursor: rebaseCursor.optional(),
      dispositions: z.array(rebaseDisposition(obligationCoverageRow)).max(4096).optional()
    }, {
      attempt: ["expected_authoring_identity", "source_identity"],
      page: ["conflict_set_identity", "cursor"],
      resolve: ["conflict_set_identity", "dispositions"]
    })
  );
  const integrationTestDesignId = z.string().min(1).max(256);
  const integrationTestDesignText = z.string().min(1).max(1024);
  const integrationTestDesignMemberRef = z.object({
    census_id: integrationTestDesignId,
    member_id: integrationTestDesignId
  }).strict();
  const integrationTestDesignProofFacet = z.object({
    mode: z.enum(["closed_set", "required", "not_applicable"]),
    items: z.array(integrationTestDesignId).max(4096).optional(),
    rationale: integrationTestDesignText.optional()
  }).strict();
  const integrationTestDesignEvidence = z.object(Object.fromEntries([
    "action_id", "boundary_id", "input_id", "dependency_expectation_id",
    "registered_set_id", "returned_set_id", "invoked_set_id", "completed_set_id",
    "failure_injection_id", "expected_result_id", "before_checkpoint_id",
    "after_checkpoint_id", "concurrency_constraint_id", "mutant_case_id",
    "ordinary_discovery_binding_id", "kill_oracle_id", "seam_policy_id"
  ].map((key) => [key, integrationTestDesignId.optional()]))).strict();
  const integrationTestDesignAxis = z.enum(
    CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AXES
  );
  const integrationTestDesignInput = z.object({
    repo: z.string().min(1).optional(),
    unit: acceptanceCoverageUnit,
    focus,
    axis_applicability: z.array(z.object({
      axis: integrationTestDesignAxis,
      status: z.enum([
        "required", "not_applicable", "review_only", "unevaluable", "undetermined"
      ]),
      rationale: integrationTestDesignText
    }).strict()).length(10),
    declared_integration_tests: z.array(z.object({
      test_id: integrationTestDesignId,
      repository_path: integrationTestDesignText,
      classification_source: integrationTestDesignText.optional()
    }).strict()).max(4096),
    integration_scenarios: z.array(z.object({
      scenario_id: integrationTestDesignId,
      test_id: integrationTestDesignId.nullable(),
      candidate_test_reference_ids: z.array(integrationTestDesignId).max(4096).optional(),
      obligation_ids: z.array(integrationTestDesignId).max(4096),
      inputs: z.array(z.object({
        input_id: integrationTestDesignId
      }).strict()).max(4096),
      actions: z.array(z.object({
        action_id: integrationTestDesignId,
        boundary_id: integrationTestDesignId
      }).strict()).max(4096),
      expected_results: z.array(z.object({
        result_id: integrationTestDesignId,
        kind: integrationTestDesignText.optional()
      }).strict()).max(4096),
      coverage: z.array(z.object({
        census_id: integrationTestDesignId,
        member_id: integrationTestDesignId,
        evidence_design: integrationTestDesignEvidence
      }).strict()).max(4096),
      fixture_effects: z.array(z.object({
        state_member_id: integrationTestDesignId,
        effect: z.enum(["create", "delete", "mutate", "observe"])
      }).strict()).max(4096).optional(),
      seams: z.array(z.object({
        authority_member_id: integrationTestDesignId,
        mode: z.enum(["observe", "external_simulation", "fault_injection", "replace_result"])
      }).strict()).max(4096).optional(),
      proof_specification: z.object({
        public_observations: z.array(integrationTestDesignText).min(1).max(4096),
        forbidden_side_effects: integrationTestDesignProofFacet,
        follow_up: integrationTestDesignProofFacet,
        falsifiers: integrationTestDesignProofFacet,
        writable_roots: integrationTestDesignProofFacet
      }).strict().optional()
    }).strict()).max(4096),
    interaction_requirements: z.array(z.object({
      interaction_id: integrationTestDesignId,
      coverage_mode: z.enum(["single_scenario", "collective"]),
      required_population_members: z.array(integrationTestDesignMemberRef).min(2).max(4096)
    }).strict()).max(4096),
    review_questions: z.array(z.object({
      question_id: integrationTestDesignId,
      question: integrationTestDesignText,
      axis: integrationTestDesignAxis.optional(),
      resolution_owner: integrationTestDesignId.optional(),
      related_ids: z.array(integrationTestDesignId).max(4096).optional()
    }).strict()).max(4096)
  }).strict();
  const malformedIntegrationTestDesignInput = Symbol(
    "controlled-contract-integration-test-design-malformed-input"
  );
  const strictIntegrationTestDesignSafeParse =
    integrationTestDesignInput.safeParseAsync.bind(integrationTestDesignInput);
  Object.defineProperty(integrationTestDesignInput, "safeParseAsync", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: async (input, options) => {
      const parsed = await strictIntegrationTestDesignSafeParse(input, options);
      if (parsed.success) return parsed;
      const issues = parsed.error.issues.slice(0, 32).map((issue) => ({
        code: issue.code,
        path: issue.path.map((part) => typeof part === "number" ? part : String(part))
      }));
      const inputKeys = input !== null && typeof input === "object" && !Array.isArray(input)
        ? Object.keys(input) : [];
      return {
        success: true,
        data: {
          [malformedIntegrationTestDesignInput]: {
            issueCount: parsed.error.issues.length,
            issues,
            rejectedKeys: inputKeys.filter((key) =>
              CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS.includes(key)
            )
          }
        }
      };
    }
  });
  const assessmentIdentity = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
  const assessmentSelector = z.object({
    id: z.string().min(1).max(512).optional(),
    code: z.string().min(1).max(256).optional(),
    state: z.string().min(1).max(64).optional(),
    axis: z.string().min(1).max(128).optional()
  }).strict().refine((value) => Object.keys(value).length > 0,
    "selector must contain at least one declared semantic field");

  const assessmentFieldPath = z.array(z.union([
    z.string().min(1).max(512),
    z.number().int().nonnegative()
  ])).min(1).max(32);
  const assessmentQueryInput = (family) => z.object({
    repo: z.string().optional(),
    assessment_identity: assessmentIdentity.optional(),
    collection: z.enum(
      CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS[family]
        .map(({ collection }) => collection)
    ).optional(),
    selector: assessmentSelector.optional(),
    field_path: assessmentFieldPath.optional(),
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().max(8192).optional(),
    cursor: z.string().min(1).max(8192).optional()
  }).strict().superRefine((value, context) => {
    const cursorMode = value.cursor !== undefined;
    if (cursorMode && [value.assessment_identity, value.collection, value.selector,
      value.field_path, value.offset, value.length].some((item) => item !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom,
        message: "cursor mode accepts no identity, collection, selector, field, or range" });
    }
    if (!cursorMode && (value.assessment_identity === undefined ||
        value.collection === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom,
        message: "identity mode requires assessment_identity and collection" });
    }
    if (value.field_path !== undefined &&
        (value.selector?.id === undefined || Object.keys(value.selector).length !== 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom,
        message: "field projection requires an exact id-only selector" });
    }
    if ((value.offset === undefined) !== (value.length === undefined) ||
        value.offset !== undefined && value.field_path === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom,
        message: "scalar ranges require field_path plus offset and length" });
    }
  });
  const carrierKind = z.enum([
    "contract",
    "evaluation_input",
    "proof_plan_request",
    "proof_plan"
  ]);
  const authorableCarrierKind = z.enum(["contract", "evaluation_input", "proof_plan_request"]);
  const patchOperation = z.object({
    op: z.enum(["upsert", "remove"]),
    target: z.enum([
      "references", "propositions", "claims", "relations", "collections", "residue",
      "annotations", "reference_bindings", "number_bindings", "claim_pattern_bindings",
      "resolver_facts", "delivered_evidence", "evaluation_stage", "requested_intents", "selected_packs"
    ]),
    id: z.string().min(1).max(4096).optional(),
    value: z.unknown().optional()
  }).strict();
  const testProofPatchOperation = z.object({
    op: z.literal("replace"),
    verification_id: z.string().min(1).max(512),
    binding: z.unknown()
  }).strict();
  const bundlePopulation = z.array(z.record(z.unknown()));

  const bundlePopulationFields = new Set(
    VERIFICATION_BUNDLE_VOCABULARY.populations.map(({ population }) => population));
  const verificationBundle = z.object(Object.fromEntries(
    VERIFICATION_BUNDLE_VOCABULARY.required_fields.map((field) => {
      if (field === "schema_version") return [field,
        z.literal(VERIFICATION_BUNDLE_VOCABULARY.schema_version)];
      if (field === "verification_id") return [field, z.string().min(1).max(512)];
      if (field === "test_proof") return [field, z.record(z.unknown())];
      if (bundlePopulationFields.has(field)) return [field, bundlePopulation];
      throw new Error(
        `controlled-contract verification-bundle field ${field} has no derived input shape`
      );
    })
  )).strict();
  const verificationBundleOperation = z.object({
    op: z.enum(["upsert", "remove"]),
    verification_id: z.string().min(1).max(512),
    bundle: verificationBundle
  }).strict();
  const authoringCarrierTargets = Object.entries(CARRIER_TARGETS);
  const authoringCarrierTargetMapping = authoringCarrierTargets
    .map(([carrierKindName, targets]) =>
      `${carrierKindName}: ${Object.keys(targets).join(", ")}`)
    .join("; ");
  const carrierQueryTarget = z.union([
    z.enum(CONTROLLED_CONTRACT_CARRIER_QUERY_TARGETS),
    z.string().min(1).max(128).describe(
      "Non-enumerated values reach the registry-derived bounded invalid-target recovery."
    )
  ]).describe(
    `Carrier-specific target vocabulary: ${authoringCarrierTargetMapping}.`
  );
  const authoringDescribeInputSchema = z.object({
    carrier_kind: z.enum(authoringCarrierTargets.map(([carrierKindName]) => carrierKindName))
      .describe("Required package-backed authoring carrier kind."),
    target: z.union([
      ...authoringCarrierTargets.map(([carrierKindName, targets]) =>
        z.enum(Object.keys(targets)).describe(`${carrierKindName} targets`)),
      z.string().min(1).max(4096).describe(
        "Non-enumerated values reach the bounded typed invalid-target recovery path only."
      )
    ]).optional().describe(
      "Omit target for the root carrier template; select one carrier-specific mutable target " +
      `for item detail. Carrier-specific targets: ${authoringCarrierTargetMapping}.`
    )
  }).strict();

  const materializeProjectionSpills = (result, options) =>
    materializeControlledContractProjectionSpills({ result, jsonContent, ...options });

  const respond = async (args, callback) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await callback(workspace);
      return jsonContent({ workspaceRepo: workspace.repo, ...result });
    } catch (error) {
      return errorContent(error);
    }
  };
  const respondBounded = async (args, callback) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      return jsonContent(await callback(workspace));
    } catch (error) {
      return errorContent(error);
    }
  };
  const materializeRefactorPage = (page) => {
    const projected = { ...page,
      items: (page.items ?? []).map((item) => {
        if (Buffer.byteLength(JSON.stringify(item), "utf8") <= 16 * 1024) return item;
        return { kind: item.kind, stable_id: item.stable_id,
          value: persistRefactorItemReference({
            resourceKind: page.resource_kind,
            itemIdentity: item.stable_id,
            item: item.value
          }) };
      }),
      cursor: page.next_cursor_binding === null ? null
        : taskCursorCodec.issue(page.next_cursor_binding)
    };
    delete projected.next_cursor_binding;
    return Object.freeze(projected);
  };
  const semanticRefactorCursorPayload = (authenticated) => {
    const { cursor_version: _cursorVersion, expires_at: _expiresAt,
      ...semanticBinding } = authenticated;
    return Object.freeze(semanticBinding);
  };
  const projectDescribeForRole = (result, rebaseTool, patchTool) => {
    const current = result.status === "carrier_present_current" ||
      result.status === "source_present_current";
    const withPatch = !current ? result : (() => {
      const focus = result.unit.focus ?? result.unit.controlled_focus ?? null;
      const patchArguments = patchTool.endsWith("_acceptance_coverage_patch") ? {
        unit: result.unit.address,
        ...(focus === null ? {} : { focus }),
        carrier_identity: result.carrier_identity,
        source_identity: result.source_identity,
        expected_unit_digest: result.unit.digest,
        expected_authoring_identity: result.authoring_identity,
        expected_content_digest: result.carrier_identity.content_digest
      } : {
        unit: result.unit.address,
        ...(focus === null ? {} : { focus }),
        source_identity: result.source_identity,
        expected_authoring_identity: result.authoring_identity,
        expected_content_digest: result.source_identity.content_digest
      };
      return {
        ...result,
        supported_next_calls: Object.freeze([...new Set([
          ...result.supported_next_calls, patchTool
        ])]),
        next_calls: Object.freeze([...result.next_calls, Object.freeze({
          tool: patchTool,
          fixed_arguments: Object.freeze(patchArguments),
          required_authored_fields: Object.freeze(["operations"])
        })])
      };
    })();
    const projected = projectControlledContractCoverageDescribeForRole(withPatch, {
      sessionRole,
      shouldExposeTool
    });
    if (projected.next_calls.length > 0 ||
        sessionRole === null || shouldExposeTool(sessionRole, rebaseTool)) return projected;
    const describeTool = rebaseTool.replace(/_rebase$/u, "_describe");
    const focus = result.unit.focus ?? result.unit.controlled_focus ?? null;
    return {
      ...projected,
      supported_next_calls: Object.freeze([...new Set([
        ...projected.supported_next_calls, describeTool
      ])]),
      next_calls: Object.freeze([Object.freeze({
        tool: describeTool,
        arguments: Object.freeze({
          unit: result.unit.address,
          ...(focus === null ? {} : { focus })
        })
      })])
    };
  };
  const respondObligationCoverage = async (operation, args, callback) => {
    try {
      const malformed = args?.[malformedObligationCoverageInput];
      if (malformed) {
        await refuseMalformedControlledContractObligationCoverageRequest({
          operation,
          issueCount: malformed.issueCount,
          issues: malformed.issues
        });
      }
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      return jsonContent(await callback(workspace));
    } catch (error) {
      return errorContent(error);
    }
  };
  const respondIntegrationTestDesign = async (args) => {
    try {
      const malformed = args?.[malformedIntegrationTestDesignInput];
      if (malformed) {
        await refuseMalformedControlledContractIntegrationTestDesignRequest({
          issueCount: malformed.issueCount,
          issues: malformed.issues,
          rejectedKeys: malformed.rejectedKeys
        });
      }
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await assessIntegrationTestDesign({
        repoRoot: workspace.dir,
        ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        axisApplicability: args.axis_applicability,
        declaredIntegrationTests: args.declared_integration_tests,
        integrationScenarios: args.integration_scenarios,
        interactionRequirements: args.interaction_requirements,
        reviewQuestions: args.review_questions,
        summaryByteAllowance: assessmentSummaryAllowance("integration_test_design")
      });
      const snapshot = consumeControlledContractIntegrationAssessmentSnapshot(result);
      return jsonContent(materializeControlledContractAssessmentResponse({
        result, snapshot, family: "integration_test_design"
      }));
    } catch (error) {
      return errorContent(error);
    }
  };
  const respondCarrierQuery = async (args, callback) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await callback(workspace);
      const limit = result.selection === "index" ? QUERY_INDEX_BYTES : QUERY_SELECTED_BYTES;
      return jsonContent(materializeProjectionSpills(result, { limit }));
    } catch (error) { return errorContent(error); }
  };
  const respondProjection = async (args, callback, {
    limit,
    includeWorkspace = false,
    resolveWorkspace = true
  }) => {
    try {
      const workspace = resolveWorkspace
        ? resolveWorkspaceRepo(workspaceRepos, args.repo)
        : null;
      const result = await callback(workspace);
      const prefix = includeWorkspace ? { workspaceRepo: workspace.repo } : {};
      return jsonContent(materializeProjectionSpills(result, { limit, prefix }));
    } catch (error) { return errorContent(error); }
  };

  defineControlledContractTool(
    "workspace_controlled_vocabulary_query",
    {
      description:
        "Query the package-owned controlled vocabulary by bounded text and controlled term kinds. Advisory authoring output only; no caller catalog or package root is accepted.",
      inputSchema: z.object({
        text: z.string().max(4096),
        kinds: z.array(z.enum([
          "operator",
          "type_term",
          "applicability_mode",
          "value_kind"
        ])).max(4).optional()
      }).strict()
    },
    async (args) => {
      try {
        return jsonContent(await queryControlledVocabularyOperation({
          text: args.text,
          kinds: args.kinds
        }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_proof_intents_discover",
    {
      description:
        `List or search the package-owned controlled proof-intent catalog. Query size is measured by the package as UTF-8 bytes with a ${PROOF_INTENT_DISCOVERY_QUERY_POLICY.maximum_bytes}-byte maximum. The optional limit applies to both modes and is capped at 28 on this MCP surface; omitting query and limit returns the complete catalog under the package byte ceiling. Results report complete catalog, evaluated, match, returned, omitted, truncation, and limit facts. Discovery is non-authoritative and performs no selection or admission.`,
      inputSchema: z.object({
        query: proofIntentQuery.optional(),
        limit: z.number().int().positive().max(28).optional()
      }).strict()
    },
    async (args) => {
      try {
        return jsonContent(await discoverControlledProofIntentsOperation(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_proof_packs_select",
    {
      description:
        "Select proof packs for intents. Returns the package-owned v2 decision, exact compatible candidates, selection snapshot, and callable candidate inspections without candidate detail.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        requested_intents: requestedIntents
      }).strict()
    },
    (args) => respondBounded(args, async (workspace) => {
      const context = await selectProofPacksOperation({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        requestedIntents: args.requested_intents
      });
      return materializeProofPackSelectionTaskPage({
        context: projectProofPackSelectionRepository(context, args.repo)
      });
    })
  );

  defineControlledContractTool(
    "workspace_controlled_proof_pack_describe",
    {
      description:
        "Describe one exact package-owned proof pack for authoring by profile ID, version, and optional controlled intents. Accepts no profile path, module, catalog, or package root.",
      inputSchema: z.object({
        wk_id: wkId.optional(),
        focus,
        profile_id: profileId,
        profile_version: profileVersion,
        requested_intents: requestedIntents.optional(),
        detail_sections: z.array(z.string().min(1).max(128)).max(16).optional(),
        detail_selectors: z.array(z.string().min(1).max(512)).max(64).optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondProjection(args, () => describeProofPackOperation({
          profileId: args.profile_id,
          profileVersion: args.profile_version,
          requestedIntents: args.requested_intents,
          sections: args.detail_sections, selectors: args.detail_selectors, cursor: args.cursor
        }), { limit: args.detail_sections?.length || args.detail_selectors?.length || args.cursor
        ? QUERY_SELECTED_BYTES : QUERY_INDEX_BYTES, resolveWorkspace: false })
  );

  defineControlledContractTool(
    "workspace_controlled_proof_pack_bindings_inspect",
    {
      description:
        "Inspect compact or selector-aware paged binding assistance for one exact proof pack. Omit evaluation_focus for no input; null or a canonical slug resolves the request-bound or server-derived evaluation input for that exact profile identity.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        evaluation_focus: focusValue.nullable().optional(),
        profile_id: profileId,
        profile_version: profileVersion,
        requested_intents: requestedIntents.optional(),
        roles: z.array(z.string().min(1).max(512)).max(64).optional(),
        statuses: z.array(z.string().min(1).max(64)).max(8).optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondProjection(args, (workspace) => inspectProofPackBindingsOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      evaluationFocus: args.evaluation_focus,
      profileId: args.profile_id,
      profileVersion: args.profile_version,
      requestedIntents: args.requested_intents, roles: args.roles,
      statuses: args.statuses, cursor: args.cursor, workspaceRepo: workspace.repo
    }), { limit: args.roles?.length || args.statuses?.length || args.cursor
        ? QUERY_SELECTED_BYTES : QUERY_INDEX_BYTES, includeWorkspace: true })
  );

  defineControlledContractTool(
    "workspace_controlled_proof_plan_build",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Compile the canonical proof-plan request and evaluation inputs for one WK carrier through the package API, then CAS-write only the deterministic proof-plan carrier. Compilation validates all supplied bindings without enumerating the agent-facing candidate projection.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        expected_content_digest: digest
      }).strict()
    },
    (args) => respond(args, (workspace) => buildProofPlanOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      expectedContentDigest: args.expected_content_digest
    }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_assess",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Assess a canonical contract and proof plan. Returns a bounded non-authoritative summary with exact counts, omissions, and assessment_identity; use workspace_controlled_contract_assessment_query for typed continuation.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await assessControlledContractOperation({
          repoRoot: workspace.dir,
          wkId: args.wk_id,
          focus: args.focus ?? null,
          summaryByteAllowance: assessmentSummaryAllowance("proof", workspace.repo)
        });
        const snapshot = consumeControlledContractAssessmentSnapshot(result);
        return jsonContent(materializeControlledContractAssessmentResponse({
          result, snapshot, family: "proof", workspaceRepo: workspace.repo
        }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_contract_assessment_query",
    {
      description: "Query task-relevant proof-assessment rows from a live snapshot. Cursors continue rows and typed fields; oversized scalars use offset/length ranges with exact total. Identity/currentness bind results and grant no raw or lifecycle authority.",
      inputSchema: assessmentQueryInput("proof")
    },
    async (args) => {
      try {
        resolveWorkspaceRepo(workspaceRepos, args.repo);
        return jsonContent(await controlledContractAssessmentSnapshots.query({
          family: "proof",
          identity: args.assessment_identity,
          collection: args.collection,
          selector: args.selector ?? null,
          cursor: args.cursor ?? null,
          fieldPath: args.field_path ?? null,
          offset: args.offset ?? null,
          length: args.length ?? null
        }));
      } catch (error) { return errorContent(error); }
    }
  );

  registerControlledContractRuntimeProofTool({
    registerTool: defineControlledContractTool,
    workspaceRepos, z, jsonContent, errorContent, resolveWorkspaceRepo,
    focusSchema: focus
  });

  registerVerifyProofTool({
    registerTool: defineControlledContractTool,
    workspaceRepos, z, jsonContent, errorContent, resolveWorkspaceRepo
  });

  defineControlledContractTool(
    "workspace_controlled_contract_carrier_create",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Create one absent canonical contract, exact-pack evaluation-input, or proof-plan-request carrier after complete package validation. Exact profile identity is accepted only for evaluation inputs; the server resolves the basename. Returns only a compact digest receipt.",
      inputSchema: z.object({
        repo: z.string().optional(), wk_id: wkId, focus,
        carrier_kind: authorableCarrierKind,
        profile_id: profileId.optional(), profile_version: profileVersion.optional(),

        expected_content_digest: z.null().optional(),
        content: z.record(z.unknown())
      }).strict()
    },
    (args) => respondBounded(args, (workspace) => createControlledContractCarrierOperation({
      repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
      carrierKind: args.carrier_kind, expectedContentDigest: args.expected_content_digest ?? null,
      profileId: args.profile_id, profileVersion: args.profile_version,
      content: args.content
    }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_carrier_query",
    {
      description: `Return a byte-bounded canonical-carrier index or selected contract nodes, exact-pack evaluation bindings, intents, and packs by stable ID or role; never returns a complete carrier implicitly. Index mode applies target, filter, and cursor. When selectors is nonempty, selected mode takes precedence and ignores target, filter, and cursor. Carrier-specific targets: ${authoringCarrierTargetMapping}.`,
      inputSchema: z.object({
        repo: z.string().optional(), wk_id: wkId, focus,
        carrier_kind: carrierKind,
        profile_id: profileId.optional(), profile_version: profileVersion.optional(),
        selectors: z.array(z.string().min(1).max(4096)).min(1).max(64).optional(),
        target: carrierQueryTarget.optional(),
        filter: z.string().min(1).max(4096).optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondCarrierQuery(args, (workspace) => queryControlledContractCarrierOperation({
      repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
      carrierKind: args.carrier_kind, selectors: args.selectors,
      profileId: args.profile_id, profileVersion: args.profile_version,
      target: args.target, filter: args.filter, cursor: args.cursor
    }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_carrier_patch",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Apply up to 64 bounded typed domain upserts/removals to one existing canonical authoring carrier, including one exact-pack evaluation input, validate the prospective carrier through the package, and perform one digest-CAS write.",
      inputSchema: z.object({
        repo: z.string().optional(), wk_id: wkId, focus,
        carrier_kind: authorableCarrierKind,
        profile_id: profileId.optional(), profile_version: profileVersion.optional(),
        expected_content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        operations: z.array(patchOperation).min(1).max(64)
      }).strict()
    },
    (args) => respondBounded(args, (workspace) => patchControlledContractCarrierOperation({
      repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
      carrierKind: args.carrier_kind, expectedContentDigest: args.expected_content_digest,
      profileId: args.profile_id, profileVersion: args.profile_version,
      operations: args.operations
    }))
  );

  defineControlledContractTool(
    "workspace_controlled_verification_bundle_patch",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Atomically upsert or remove up to 64 complete package-validated controlled-contract-verification-bundle.v1 values in one canonical same-WK stable-v1 carrier. The route resolves path and authority server-side and performs at most one digest-CAS write.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        expected_content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        operations: z.array(verificationBundleOperation).min(1).max(64)
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      patchControlledContractVerificationBundleOperation({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        expectedContentDigest: args.expected_content_digest,
        operations: args.operations
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_authoring_describe",
    {
      description: "Describe one package-backed controlled-contract authoring carrier. Omit target for root structural detail, or select one carrier-specific target exposed by the live schema for mutable item detail.",
      inputSchema: authoringDescribeInputSchema
    },
    async (args) => {
      try { return jsonContent(await describeControlledContractAuthoringOperation({
        carrierKind: args.carrier_kind, target: args.target
      })); } catch (error) { return errorContent(error); }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_contract_authoring_state",
    {
      description: "Return the compact task-directed authoring stage for canonical same-WK carriers, with selected identities, unresolved identities/counts, and exactly one executable next_calls list or stop_condition. Complete carriers, skeletons, and candidate populations remain server-side.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        continuation: authoringContinuation.optional()
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      readAuthoringState({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        continuation: args.continuation
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_proof_graph_continue",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Publish the server-held controlled-contract proof-graph proposal through one server-issued continuation. Orchestrator/operator only; the strict input accepts no proposal, path, root, basename, ref, SHA, policy, authority, environment, or persistence carrier.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        continuation: authoringContinuation
      }).strict()
    },
    (args) => respondBounded(args, (workspace) => continueProofGraph({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      continuation: args.continuation
    }))
  );

  defineControlledContractTool(
    "workspace_controlled_proof_authoring_skeleton",
    {
      description: "Generate a package-owned evaluation-input and composed proof-plan-request skeleton from one explicit selected pack, explicit intents, and caller-chosen bindings. The projected request composes the canonical selected-pack population instead of replacing it, and the server resolves the canonical contract and every exact evaluation-input basename. Supplying the optional proposal_draft alongside requested_intents and exactly one of bindings or evaluation_input issues a server continuation; the draft carries only caller-authored carrier operations. The exact source declaration is server-owned and derived from authenticated canonical state; callers cannot supply or override it. Every result names its one next action, and controlled_contract_authoring_continuation_tampered stays reserved for continuation-identity conflicts this route mints server-side.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        selected_pack: z.object({
          profile_id: profileId,
          profile_version: profileVersion
        }).strict(),
        requested_intents: requestedIntents,
        bindings: z.record(z.unknown()).optional(),
        evaluation_input: z.record(z.unknown()).optional(),

        proposal_draft: z.object({
          carrier_operations: z.array(z.record(z.unknown())).max(64).optional()
        }).strict().optional().describe(
          "Optional issuance modifier carrying exactly caller-authored " +
          "carrier_operations. When present it accompanies requested_intents " +
          "and exactly one of bindings or evaluation_input; it is never an " +
          "alternative to them. The exact source declaration is server-owned " +
          "and derived from authenticated canonical state; callers cannot " +
          "supply or override it. An empty draft refuses with " +
          "controlled_contract_proposal_draft_partial."
        )
      }).strict()
    },

    (args) => respondBounded(args, (workspace) =>
      buildProofAuthoringSkeletonOperation({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        selectedPack: args.selected_pack,
        requestedIntents: args.requested_intents,
        bindings: args.bindings,
        evaluationInput: args.evaluation_input,
        proposalDraft: args.proposal_draft
      }))
  );

  registerCommonProofCaptureTools({
    registerTool: defineControlledContractTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    operation: commonProofCaptureOperation,
    focusSchema: focus
  });

  defineControlledContractTool(
    "workspace_controlled_integration_prefix_capture_author",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Author and atomically publish the complete canonical integration-prefix capture for one WK through the wiki-core controlled authoring operation. The server resolves repository, carriers, graph inputs, paths, digests, and authority; the receipt is bounded to 8192 bytes.",
      inputSchema: z.object({
        wk_id: wkId,
        focus,
        profile_id: z.literal(INTEGRATION_PREFIX_PROFILE_ID).optional(),
        profile_version: z.literal(INTEGRATION_PREFIX_PROFILE_VERSION).optional()
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos);
        const result = await authorIntegrationPrefixCapture({
          repoRoot: workspace.dir,
          wkId: args.wk_id,
          focus: args.focus ?? null
        });
        return materializeIntegrationPrefixCaptureAuthoringReceipt({
          result,
          jsonContent
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_contract_authoring_continue",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Continue task-directed authoring with one server-issued continuation identity. The server rejects stale, cross-WK, cross-focus, tampered, unknown, or conflicting state before performing at most one canonical expected-absence CAS write.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        continuation: authoringContinuation,
        expected_stage: z.enum(["evaluation_input_ready", "proof_plan_request_ready"]).optional()
      }).strict()
    },
    (args) => respondProjection(args, (workspace) =>
      continueControlledContractAuthoringOperation({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        continuation: args.continuation,
        expectedStage: args.expected_stage
      }), { limit: QUERY_INDEX_BYTES, includeWorkspace: false })
  );

  defineControlledContractTool(
    "workspace_controlled_test_proof_authoring_describe",
    {
      description: "Return the package-derived stable-v1 test-proof binding contract, provider-registry identity, compatibility rules, and authoring limits. The adapter defines no test-proof fields or validation semantics.",
      inputSchema: z.object({}).strict()
    },
    async () => {
      try { return jsonContent(await describeControlledContractTestProofAuthoring()); }
      catch (error) { return errorContent(error); }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_test_proof_query",
    {
      description: "Select up to 64 package-validated stable-v1 test-proof bindings from one canonical same-WK carrier by exact controlled verification identity.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        verification_ids: z.array(z.string().min(1).max(512)).min(1).max(64)
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      queryControlledContractTestProofBindings({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        verificationIds: args.verification_ids
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_test_proof_patch",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Apply package-validated test-proof bindings to one canonical stable-v1 same-WK carrier and persist only through digest CAS. Mixed, partial, experimental, invalid, and stale inputs refuse before effects.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        expected_content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        operations: z.array(testProofPatchOperation).min(1).max(64)
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      patchControlledContractTestProofBindings({
        repoRoot: workspace.dir,
        wkId: args.wk_id,
        focus: args.focus ?? null,
        expectedContentDigest: args.expected_content_digest,
        operations: args.operations
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_describe",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Describe acceptance coverage for authoring. Returns transport-sized task-complete row batches, owner-produced applicability, exact accounting, one typed authoring_action for atomic initial create or existing-carrier mutation/recovery, and separate read_pagination. Server binding protects integrity, not secrecy or authority.",
      inputSchema: z.object({ repo: z.string().optional(), unit: acceptanceCoverageUnit,
        focus, selector: coverageDescribeSelector.optional() }).strict()
    },
    (args) => respondBounded(args, async (workspace) => {
      const described = projectDescribeForRole(
        await describeControlledContractAcceptanceCoverageOperation({
          repoRoot: workspace.dir,
          ...acceptanceCoverageOperationIdentity(args.unit),
          focus: args.focus ?? null
        }),
        "workspace_controlled_contract_acceptance_coverage_rebase",
        "workspace_controlled_contract_acceptance_coverage_patch"
      );
      return controlledContractOperation(() => materializeCoverageAuthoringSkeleton({
        result: described,
        selector: args.selector ?? null,
        baseArguments: {
          ...(args.repo === undefined ? {} : { repo: args.repo }),
          unit: args.unit,
          ...(args.focus === undefined ? {} : { focus: args.focus })
        },
        authoringSessions: coverageAuthoringSessions
      }));
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_create",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description: "Create absent acceptance coverage from returned one-use row identities and caller-authored fields; the server injects current criterion identities and grants no authority.",
      inputSchema: z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        carrier_identity: acceptanceCoverageCarrierIdentity,
        source_identity: acceptanceCoverageSourceIdentity,
        expected_unit_digest: shaDigest,
        expected_content_digest: z.null(),
        rows: z.array(acceptanceCoverageRow).optional(),
        authored_rows: z.array(acceptanceCoverageAuthoredRow).min(1).optional()
      }).strict().superRefine((value, context) => {
        if ((value.rows === undefined) === (value.authored_rows === undefined)) {
          context.addIssue({ code: z.ZodIssueCode.custom,
            message: "exactly one of rows or authored_rows is required" });
        }
      })
    },
    (args) => respondBounded(args, async (workspace) => {
      let rows = args.rows;
      let resolvedRows = null;
      if (args.authored_rows !== undefined) {
        for (const { row_slot_identity: identity } of args.authored_rows) {
          coverageAuthoringSessions.assertRequest(identity, {
            family: "acceptance", unit: args.unit, focus: args.focus ?? null
          });
        }
        const described = await describeControlledContractAcceptanceCoverageOperation({
          repoRoot: workspace.dir,
          ...acceptanceCoverageOperationIdentity(args.unit),
          focus: args.focus ?? null
        });
        const completePopulation = described.authoring_skeleton.complete_population;
        const sessionInput = coverageAuthoringSessionInput(
          described, completePopulation, "acceptance"
        );
        resolvedRows = coverageAuthoringSessions.resolveComplete(
          args.authored_rows.map(({ row_slot_identity: identity }) => identity),
          { family: "acceptance", binding: sessionInput.binding }
        );
        rows = args.authored_rows.map((row, index) => ({
          criterion_identity: resolvedRows[index].criterionIdentity,
          node_ids: row.node_ids,
          axes: row.axes
        }));
      }
      const result = await createControlledContractAcceptanceCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        carrierIdentity: args.carrier_identity, sourceIdentity: args.source_identity,
        expectedUnitDigest: args.expected_unit_digest,
        expectedContentDigest: args.expected_content_digest, rows
      });
      if (resolvedRows !== null) coverageAuthoringSessions.consume(resolvedRows);
      return result;
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_upsert",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Digest-CAS upsert one mapping row selected by a current typed criterion identity; stale or invalid inputs preserve the carrier and grant no authority.",
      inputSchema: z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        carrier_identity: acceptanceCoverageCarrierIdentity,
        source_identity: acceptanceCoverageSourceIdentity,
        expected_content_digest: shaDigest,
        criterion_selector: acceptanceCoverageCriterionSelector,
        row: acceptanceCoverageRow
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      upsertControlledContractAcceptanceCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        carrierIdentity: args.carrier_identity, sourceIdentity: args.source_identity,
        expectedContentDigest: args.expected_content_digest,
        criterionSelector: args.criterion_selector, row: args.row
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_remove",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Digest-CAS remove one mapping row selected by a current typed criterion identity; stale or invalid inputs preserve the carrier and grant no authority.",
      inputSchema: z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        carrier_identity: acceptanceCoverageCarrierIdentity,
        source_identity: acceptanceCoverageSourceIdentity,
        expected_content_digest: shaDigest,
        criterion_selector: acceptanceCoverageCriterionSelector
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      removeControlledContractAcceptanceCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        carrierIdentity: args.carrier_identity, sourceIdentity: args.source_identity,
        expectedContentDigest: args.expected_content_digest,
        criterionSelector: args.criterion_selector
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_query",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Read the bounded gap-first acceptance-coverage projection by a typed criterion/node selector or digest-bound continuation; the result is non-authoritative.",
      inputSchema: z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        selector: acceptanceCoverageQuerySelector.optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      queryControlledContractAcceptanceCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        selector: args.selector, cursor: args.cursor
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_rebase",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description: "Semantically rebase one stale acceptance mapping through an exact-identity attempt, bounded mutation-consistent conflict pages, or one complete atomic disposition set. Accepts no raw carrier, path, policy, or authority payload.",
      inputSchema: acceptanceCoverageRebaseInput
    },
    (args) => respondBounded(args, (workspace) =>
      rebaseControlledContractAcceptanceCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null, mode: args.mode,
        ...(args.mode === "attempt" ? {
          carrierIdentity: args.carrier_identity,
          sourceIdentity: args.source_identity,
          expectedUnitDigest: args.expected_unit_digest
        } : args.mode === "page" ? {
          conflictSetIdentity: args.conflict_set_identity,
          cursor: args.cursor
        } : {
          conflictSetIdentity: args.conflict_set_identity,
          dispositions: args.dispositions
        })
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_acceptance_coverage_patch",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Atomically apply one or more typed operations to the current acceptance-coverage carrier using the complete describe-emitted identity. No raw carrier, path, policy, or authority payload is accepted.",
      inputSchema: z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        carrier_identity: acceptanceCoverageCarrierIdentity,
        source_identity: acceptanceCoverageSourceIdentity,
        expected_unit_digest: shaDigest,
        expected_authoring_identity: shaDigest,
        expected_content_digest: shaDigest,
        operations: z.array(acceptanceCoveragePatchOperation).min(1)
      }).strict()
    },
    (args) => respondBounded(args, async (workspace) => {
      const tokenOperations = args.operations.filter((operation) =>
        operation.row_slot_identity !== undefined
      );
      for (const { row_slot_identity: identity } of tokenOperations) {
        coverageAuthoringSessions.assertRequest(identity, {
          family: "acceptance", unit: args.unit, focus: args.focus ?? null
        });
      }
      let resolvedSlots = [];
      if (tokenOperations.length > 0) {
        const described = await describeControlledContractAcceptanceCoverageOperation({
          repoRoot: workspace.dir,
          ...acceptanceCoverageOperationIdentity(args.unit),
          focus: args.focus ?? null
        });
        const sessionInput = coverageAuthoringSessionInput(
          described, described.authoring_skeleton.complete_population, "acceptance"
        );
        resolvedSlots = tokenOperations.map(({ row_slot_identity: identity }) =>
          coverageAuthoringSessions.resolve(identity, {
            family: "acceptance", binding: sessionInput.binding
          })
        );
        coverageAuthoringSessions.assertDistinct(resolvedSlots);
      }
      let tokenIndex = 0;
      const operations = args.operations.map((operation) => {
        if (operation.row_slot_identity === undefined) return {
          op: operation.op,
          criterionSelector: operation.criterion_selector,
          ...(operation.op === "upsert" ? { row: operation.row } : {})
        };
        const resolved = resolvedSlots[tokenIndex++];
        return {
          op: "upsert",
          criterionSelector: {
            kind: "criterion_identity",
            criterion_identity: resolved.criterionIdentity
          },
          row: {
            criterion_identity: resolved.criterionIdentity,
            node_ids: operation.row.node_ids,
            axes: operation.row.axes
          }
        };
      });
      const result = await patchControlledContractAcceptanceCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        carrierIdentity: args.carrier_identity,
        sourceIdentity: args.source_identity,
        expectedUnitDigest: args.expected_unit_digest,
        expectedAuthoringIdentity: args.expected_authoring_identity,
        expectedContentDigest: args.expected_content_digest,
        operations
      });
      for (const resolved of resolvedSlots) coverageAuthoringSessions.consume([resolved]);
      return result;
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_describe",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Describe obligation coverage for authoring. Returns transport-sized task-complete row batches, owner-produced applicability, exact accounting, one typed authoring_action for atomic initial create or existing-source mutation/recovery, and separate read_pagination. Server binding protects integrity, not secrecy or authority.",
      inputSchema: obligationCoverageInputSchema(z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        selector: coverageDescribeSelector.optional()
      }).strict())
    },
    (args) => respondObligationCoverage("describe", args, async (workspace) => {
      const described = projectDescribeForRole(
        await describeControlledContractObligationCoverageOperation({
          repoRoot: workspace.dir,
          ...acceptanceCoverageOperationIdentity(args.unit),
          focus: args.focus ?? null
        }),
        "workspace_controlled_contract_obligation_coverage_rebase",
        "workspace_controlled_contract_obligation_coverage_patch"
      );
      return controlledContractOperation(() => materializeCoverageAuthoringSkeleton({
        result: described,
        selector: args.selector ?? null,
        baseArguments: {
          ...(args.repo === undefined ? {} : { repo: args.repo }),
          unit: args.unit,
          ...(args.focus === undefined ? {} : { focus: args.focus })
        },
        authoringSessions: coverageAuthoringSessions
      }));
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_create",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description: "Create absent obligation coverage from returned one-use row identities and caller-authored fields; the server injects current criterion identities and accepts no paths or authority claims.",
      inputSchema: obligationCoverageInputSchema(z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        expected_authoring_identity: shaDigest,
        expected_content_digest: z.null(),
        rows: z.array(obligationCoverageRow).max(4097).optional(),
        authored_rows: z.array(obligationCoverageAuthoredRow).min(1).max(4097).optional()
      }).strict())
    },
    (args) => respondObligationCoverage("create", args, async (workspace) => {
      if ((args.rows === undefined) === (args.authored_rows === undefined)) {
        await refuseMalformedControlledContractObligationCoverageRequest({
          operation: "create",
          issueCount: 1,
          issues: [{ code: "custom", path: ["rows", "authored_rows"] }]
        });
      }
      let rows = args.rows;
      let resolvedRows = null;
      if (args.authored_rows !== undefined) {
        for (const { row_slot_identity: identity } of args.authored_rows) {
          coverageAuthoringSessions.assertRequest(identity, {
            family: "obligation", unit: args.unit, focus: args.focus ?? null
          });
        }
        const described = await describeControlledContractObligationCoverageOperation({
          repoRoot: workspace.dir,
          ...acceptanceCoverageOperationIdentity(args.unit),
          focus: args.focus ?? null
        });
        const completePopulation = described.authoring_skeleton.complete_population;
        const sessionInput = coverageAuthoringSessionInput(
          described, completePopulation, "obligation"
        );
        resolvedRows = coverageAuthoringSessions.resolveComplete(
          args.authored_rows.map(({ row_slot_identity: identity }) => identity),
          { family: "obligation", binding: sessionInput.binding }
        );
        rows = args.authored_rows.map((row, index) => ({
          obligation_id: row.obligation_id,
          statement: row.statement,
          criterion_selector: {
            kind: "criterion_identity",
            criterion_identity: resolvedRows[index].criterionIdentity
          },
          controlled_contract_node_ids: row.controlled_contract_node_ids,
          mechanism: row.mechanism,
          proof: row.proof
        }));
      }
      const result = await createControlledContractObligationCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        expectedAuthoringIdentity: args.expected_authoring_identity,
        expectedContentDigest: args.expected_content_digest,
        rows
      });
      if (resolvedRows !== null) coverageAuthoringSessions.consume(resolvedRows);
      return result;
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_upsert",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Digest-CAS upsert one typed authored obligation in the current server-resolved source; all canonical and pack identities are resolved server-side.",
      inputSchema: obligationCoverageInputSchema(z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        expected_content_digest: shaDigest,
        obligation_selector: obligationCoverageObligationSelector,
        row: obligationCoverageRow
      }).strict())
    },
    (args) => respondObligationCoverage("upsert", args, (workspace) =>
      upsertControlledContractObligationCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        expectedContentDigest: args.expected_content_digest,
        obligationSelector: args.obligation_selector,
        row: args.row
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_remove",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Digest-CAS remove one typed selected obligation while preserving criterion completeness and current canonical state.",
      inputSchema: obligationCoverageInputSchema(z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        expected_content_digest: shaDigest,
        obligation_selector: obligationCoverageObligationSelector
      }).strict())
    },
    (args) => respondObligationCoverage("remove", args, (workspace) =>
      removeControlledContractObligationCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        expectedContentDigest: args.expected_content_digest,
        obligationSelector: args.obligation_selector
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_query",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Read obligation coverage through deterministic gap-first typed selection and digest-bound pagination. A result that cannot fit refuses without spilling.",
      inputSchema: obligationCoverageInputSchema(z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        selector: obligationCoverageQuerySelector.optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict())
    },
    (args) => respondObligationCoverage("query", args, (workspace) =>
      queryControlledContractObligationCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null, selector: args.selector, cursor: args.cursor
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_rebase",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description: "Semantically rebase one stale obligation source through an exact server identity, bounded mutation-consistent conflict pages, or one complete atomic disposition set. Accepts no raw carrier, path, policy, or authority payload.",
      inputSchema: obligationCoverageRebaseInput
    },
    (args) => respondObligationCoverage("rebase", args, (workspace) =>
      rebaseControlledContractObligationCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null, mode: args.mode,
        ...(args.mode === "attempt" ? {
          expectedAuthoringIdentity: args.expected_authoring_identity,
          sourceIdentity: args.source_identity
        } : args.mode === "page" ? {
          conflictSetIdentity: args.conflict_set_identity,
          cursor: args.cursor
        } : {
          conflictSetIdentity: args.conflict_set_identity,
          dispositions: args.dispositions
        })
      }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_obligation_coverage_patch",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ITEM_UPSERT,
      description: "Atomically apply one or more typed operations to the current canonical obligation source using the complete describe-emitted identity. No raw carrier, path, policy, or authority payload is accepted.",
      inputSchema: obligationCoverageInputSchema(z.object({
        repo: z.string().optional(), unit: acceptanceCoverageUnit, focus,
        source_identity: obligationCoverageSourceIdentity,
        expected_authoring_identity: shaDigest,
        expected_content_digest: shaDigest,
        operations: z.array(obligationCoveragePatchOperation).min(1)
      }).strict())
    },
    (args) => respondObligationCoverage("patch", args, async (workspace) => {
      const tokenOperations = args.operations.filter((operation) =>
        operation.row_slot_identity !== undefined
      );
      for (const { row_slot_identity: identity } of tokenOperations) {
        coverageAuthoringSessions.assertRequest(identity, {
          family: "obligation", unit: args.unit, focus: args.focus ?? null
        });
      }
      let resolvedSlots = [];
      if (tokenOperations.length > 0) {
        const described = await describeControlledContractObligationCoverageOperation({
          repoRoot: workspace.dir,
          ...acceptanceCoverageOperationIdentity(args.unit),
          focus: args.focus ?? null
        });
        const sessionInput = coverageAuthoringSessionInput(
          described, described.authoring_skeleton.complete_population, "obligation"
        );
        resolvedSlots = tokenOperations.map(({ row_slot_identity: identity }) =>
          coverageAuthoringSessions.resolve(identity, {
            family: "obligation", binding: sessionInput.binding
          })
        );
        coverageAuthoringSessions.assertDistinct(resolvedSlots);
      }
      let tokenIndex = 0;
      const operations = args.operations.map((operation) => {
        if (operation.row_slot_identity === undefined) return {
          op: operation.op,
          obligationSelector: operation.obligation_selector,
          ...(operation.op === "upsert" ? { row: operation.row } : {})
        };
        const resolved = resolvedSlots[tokenIndex++];
        return {
          op: "upsert",
          obligationSelector: operation.obligation_selector,
          row: {
            ...operation.row,
            criterion_selector: {
              kind: "criterion_identity",
              criterion_identity: resolved.criterionIdentity
            }
          }
        };
      });
      const result = await patchControlledContractObligationCoverageOperation({
        repoRoot: workspace.dir, ...acceptanceCoverageOperationIdentity(args.unit),
        focus: args.focus ?? null,
        sourceIdentity: args.source_identity,
        expectedAuthoringIdentity: args.expected_authoring_identity,
        expectedContentDigest: args.expected_content_digest,
        operations
      });
      for (const resolved of resolvedSlots) coverageAuthoringSessions.consume([resolved]);
      return result;
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_integration_test_design_assess",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Assess authored integration-test design against canonical sources. One final-envelope owner returns a bounded non-authoritative task-relevant summary, exact counts, omissions, and assessment_identity; use the typed assessment query for continuation.",
      inputSchema: integrationTestDesignInput,
      requestKeyCensus: {
        accepted: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_PUBLIC_REQUEST_KEYS,
        refusedAuthorityBearing:
          CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS
      }
    },
    respondIntegrationTestDesign
  );

  defineControlledContractTool(
    "workspace_controlled_contract_integration_test_design_query",
    {
      description: "Query one task-relevant integration-design collection. Cursors continue rows and typed fields; oversized scalars use offset/length ranges with exact total. No raw joins, spill, persistence, or authority.",
      inputSchema: assessmentQueryInput("integration_test_design")
    },
    async (args) => {
      try {
        resolveWorkspaceRepo(workspaceRepos, args.repo);
        return jsonContent(await controlledContractAssessmentSnapshots.query({
          family: "integration_test_design",
          identity: args.assessment_identity,
          collection: args.collection,
          selector: args.selector ?? null,
          cursor: args.cursor ?? null,
          fieldPath: args.field_path ?? null,
          offset: args.offset ?? null,
          length: args.length ?? null
        }));
      } catch (error) { return errorContent(error); }
    }
  );

  defineControlledContractTool(
    "workspace_controlled_contract_refactor_plan",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Build or finalize one generation-bound controlled-contract refactor plan. Initial planning is read-only; finalization validates complete coverage dispositions and releases only the unchanged opaque apply continuation.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId.optional(),
        focus,
        expected_generation: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        expected_manifest_digest: shaDigest.optional(),
        mode: z.union([
          z.object({ kind: z.literal("rename_identity"),
            old_identity: z.string().min(1).max(4096),
            new_identity: z.string().min(1).max(4096),
            old_node: z.record(z.string(), z.unknown()).optional(),
            new_node: z.record(z.string(), z.unknown()).optional() }).strict(),
          z.object({ kind: z.literal("replace_subgraph"),
            correspondence: z.array(z.object({
              old_identity: z.string().min(1).max(4096).nullable(),
              new_identities: z.array(z.string().min(1).max(4096)).max(4096)
            }).strict()).min(1).max(4096),
            reason: z.string().min(1).max(16384),
            carrier_operations: z.array(z.object({
              carrier_kind: z.enum(["contract", "evaluation_input",
                "proof_plan_request", "obligation_coverage", "acceptance_coverage"]),
              operations: z.array(z.object({ op: z.enum(["upsert", "remove"]),
                target: z.string().min(1).max(256), id: z.string().min(1).max(4096),
                value: z.unknown().optional() }).strict()).min(1).max(4096)
            }).strict()).max(64).optional()
          }).strict()
        ]).optional(),
        plan_identity: shaDigest.optional(),
        conflict_set_identity: shaDigest.optional(),
        obligation_dispositions:
          z.array(z.record(z.string(), z.unknown())).max(4096).optional(),
        acceptance_dispositions:
          z.array(z.record(z.string(), z.unknown())).max(4096).optional()
      }).strict().superRefine((value, context) => {
        const initialFields = ["wk_id", "focus", "expected_generation",
          "expected_manifest_digest", "mode"];
        const finalFields = ["plan_identity", "conflict_set_identity",
          "obligation_dispositions", "acceptance_dispositions"];
        const hasInitial = initialFields.some((field) => value[field] !== undefined);
        const hasFinal = finalFields.some((field) => value[field] !== undefined);
        if (hasInitial === hasFinal) {
          context.addIssue({ code: z.ZodIssueCode.custom,
            message: "exactly one initial-plan or disposition-finalization form is required" });
          return;
        }
        const required = hasInitial ? ["wk_id", "mode"] : finalFields;
        for (const field of required) {
          if (value[field] === undefined) context.addIssue({
            code: z.ZodIssueCode.custom, path: [field],
            message: `${field} is required for the selected refactor-plan form`
          });
        }
        if (hasInitial &&
            (value.expected_generation === undefined) ===
              (value.expected_manifest_digest === undefined)) {
          context.addIssue({ code: z.ZodIssueCode.custom,
            message: "initial planning requires exactly one currentness precondition" });
        }
      })
    },
    (args) => respondBounded(args, async (workspace) => {
      assertRefactorSemanticPayloadBounds(args);
      if (args.plan_identity !== undefined) {
        const snapshot = await refactorPlanSnapshot(args.plan_identity, workspace,
          "controlled_contract_refactor_plan_stale");
        return finalizeControlledContractRefactorPlanOperation({
          repoRoot: workspace.dir, wkId: snapshot.binding.wk_id,
          focus: snapshot.binding.focus, planIdentity: args.plan_identity,
          conflictSetIdentity: args.conflict_set_identity,
          obligationDispositions: args.obligation_dispositions,
          acceptanceDispositions: args.acceptance_dispositions
        }, { snapshot });
      }
      const page = await buildControlledContractRefactorPlanOperation({
        repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
        expectedGeneration: args.expected_generation,
        expectedManifestDigest: args.expected_manifest_digest,
        mode: args.mode
      });
      const snapshot = consumeControlledContractRefactorPlanSnapshot(page);
      rememberRefactorPlanSnapshot(page.resource_identity, snapshot, workspace);
      return materializeRefactorPage(page);
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_refactor_query",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Read one lossless bounded semantic page from an exact refactor plan or immutable receipt. Cursors are authenticated by the existing task-cursor owner.",
      inputSchema: z.object({ repo: z.string().optional(),
        resource_identity: shaDigest, resource_kind: z.enum(["plan", "receipt"]),
        selector: z.object({ kind: z.enum(["affected_identity", "carrier",
          "closure_edge", "correspondence", "coverage_conflict",
          "derived_invalidation", "proof_gap", "carrier_change",
          "coverage_change"]), stable_id: z.string().min(1).max(4096).nullable()
        }).strict().optional(),
        cursor: z.string().min(1).max(16384).optional()
      }).strict()
    },
    (args) => respondBounded(args, async (workspace) => {
      const authenticated = args.cursor === undefined ? null
        : semanticRefactorCursorPayload(taskCursorCodec.read(args.cursor));
      if (args.resource_kind === "plan") {
        const snapshot = await refactorPlanSnapshot(args.resource_identity, workspace,
          "controlled_contract_refactor_resource_unknown");
        const payload = authenticated ?? semanticRefactorCursorPayload(
          taskCursorCodec.read(taskCursorCodec.issue({
            resource_kind: "plan", resource_identity: args.resource_identity,
            snapshot_digest: snapshot.binding.snapshot_digest,
            selector: args.selector ?? null, offset: 0,
            page_size: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items
          }))
        );
        return materializeRefactorPage(await queryControlledContractRefactorPlan({
          resourceIdentity: args.resource_identity, selector: args.selector ?? null,
          authenticatedCursorPayload: payload
        }, { snapshot }));
      }
      return materializeRefactorPage(await queryControlledContractRefactorReceipt({
        repoRoot: workspace.dir, resourceIdentity: args.resource_identity,
        selector: args.selector ?? null, authenticatedCursorPayload: authenticated
      }));
    })
  );

  defineControlledContractTool(
    "workspace_controlled_contract_refactor_apply",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description: "Apply one complete generation-bound refactor through its opaque continuation and return the immutable publication receipt identity.",
      inputSchema: z.object({ repo: z.string().optional(),
        continuation: authoringContinuation }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      applyControlledContractRefactorOperation({ repoRoot: workspace.dir,
        continuation: args.continuation }))
  );

  defineControlledContractTool(
    "workspace_controlled_contract_private_scope_census",
    {
      description: "Return a deterministic bounded read-only census of canonical nonterminal WK and slice scope entries intersecting the controlled-contract private path. Facts are possible CCE input and are never local policy refusal authority.",
      inputSchema: z.object({
        repo: z.string().optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondBounded(args, (workspace) =>
      queryControlledContractPrivateScopeCensusOperation({
        repoRoot: workspace.dir,
        cursor: args.cursor ?? null
      }))
  );

  const materializedNames = registryEntries.map(({ name }) => name);
  if (materializedNames.length !== CONTROLLED_CONTRACT_ROUTE_METADATA.length ||
      materializedNames.some((name, index) =>
        name !== CONTROLLED_CONTRACT_ROUTE_METADATA[index].name)) {
    throw new Error("controlled-contract materialized registry does not match its authoritative route order");
  }
  return Object.freeze(registryEntries.map((entry, index) => Object.freeze({
    ...entry,
    discoveryMetadataSha256:
      CONTROLLED_CONTRACT_ROUTE_METADATA[index].discoveryMetadataSha256
  })));
}

export function assertControlledContractRuntimeRegistryParity(registry, registrations) {
  const runtime = Array.isArray(registrations) ? registrations : [];
  if (runtime.length !== registry.length) {
    throw new Error("controlled-contract runtime population does not match the authoritative registry");
  }
  for (let index = 0; index < registry.length; index += 1) {
    const owner = registry[index];
    const registered = runtime[index];
    if (registered?.name !== owner.name || registered?.config !== owner.config) {
      throw new Error(`controlled-contract runtime metadata drift: ${owner.name}`);
    }
    if (controlledContractRuntimeHandlerOwner(registered?.handler) !== owner.handler) {
      throw new Error(`controlled-contract runtime handler drift: ${owner.name}`);
    }
  }
  return true;
}

export function registerControlledContractTools(options) {
  const registry = CONTROLLED_CONTRACT_TOOL_REGISTRY.materialize(options);
  const registrations = registry.map((entry) => {
    const handler = async (args) => {
      try {
        return assertNoControlledContractRawResponse(await entry.handler(args), {
          toolName: entry.name
        });
      } catch (error) {
        return assertNoControlledContractRawResponse(options.errorContent(error), {
          toolName: entry.name
        });
      }
    };
    Object.defineProperty(handler, CONTROLLED_CONTRACT_RUNTIME_HANDLER_OWNER, {
      value: entry.handler
    });
    return Object.freeze({ name: entry.name, config: entry.config, handler });
  });
  assertControlledContractRuntimeRegistryParity(registry, registrations);
  for (const { name, config, handler } of registrations) {
    options.registerTool(name, config, handler);
  }
  return registry;
}
