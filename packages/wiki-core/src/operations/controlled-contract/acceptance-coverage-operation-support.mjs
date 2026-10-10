

import { proofAuthoringCarrierContent as obligationCoverageCarrierContent } from './proof-authoring-source.mjs';
import { queryControlledContractObligationCoverageOperation } from
  "./obligation-coverage-query.mjs";
import {
  ControlledContractToolError,
  assertControlledContractOperationInput,
  deriveCanonicalControlledContractAuthoringState
} from "../../lib/controlled-contract-tools.mjs";
import { projectAcceptanceCoverage } from
  "../../lib/controlled-contract-acceptance-coverage.mjs";
import {
  OBLIGATION_COVERAGE_MAX_BYTES,
  OBLIGATION_COVERAGE_MAX_ROWS,
  acceptanceCoverageUnitDigest,
  exactObject,
  obligationCoverageSourceLocatorDigest
} from "./acceptance-coverage-facts.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import {
  attachOwnerProducedRecovery,
  coverageSelectorRecovery
} from "./coverage-recovery-guidance.mjs";

export function acceptanceCoverageOperationInput(input, fields) {
  return assertControlledContractOperationInput(input, [
    "repoRoot", "wkId", "focus", "selectedUnit", ...fields
  ]);
}

export function acceptanceCoverageResolutionInput(input) {
  return {
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null,
    selectedUnit: input.selectedUnit ?? null
  };
}

export function coverageFamilyContinuationCalls(input, family, operation = "query") {
  if (family !== "obligation") return Object.freeze([]);
  return Object.freeze([Object.freeze({
    tool: "workspace_controlled_contract_obligation_coverage_query",
    arguments: Object.freeze({
      unit: input.selectedUnit === undefined || input.selectedUnit === null
        ? input.wkId : `${input.wkId}#${input.selectedUnit}`,
      ...(input.focus === undefined || input.focus === null
        ? {} : { focus: input.focus })
    })
  })]);
}

export function coverageAuthoringMutation(nextCalls, family, absent, resolved) {
  const operation = family === "obligation"
    ? "workspace_controlled_contract_obligation_coverage_upsert"
    : "acceptance_coverage_authoring";
  const call = nextCalls.find(({ tool }) => tool === operation);
  return {
    operation,
    fixedArguments: structuredClone(call?.fixed_arguments ?? {
      unit: resolved.selectedUnit === null
        ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`,
      ...(resolved.focus === null ? {} : { focus: resolved.focus })
    }),
    receiptFedDigestFields: absent ? [] : [
      "expected_content_digest",
      ...(family === "acceptance"
        ? ["carrier_identity.content_digest", "source_identity.content_digest"]
        : [])
    ]
  };
}

export async function ownerProducedCoverageRecovery(input, error, {
  acceptance = false
} = {}) {
  let ownerState = null;
  let upstreamDescribe = null;
  try {
    ownerState = await deriveCanonicalControlledContractAuthoringState({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      continuation: null,
      request: {
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null
          ? {} : { focus: input.focus })
      }
    });
  } catch {

  }
  if (acceptance && (ownerState?.next_calls?.length ?? 0) === 0) {
    try {
      upstreamDescribe = await queryControlledContractObligationCoverageOperation(input);
    } catch {

    }
  }
  throw attachOwnerProducedRecovery(error, { input, ownerState, upstreamDescribe });
}

export const ACCEPTANCE_COVERAGE_NON_AUTHORITY = Object.freeze({
  authoritative: false,
  authors_mappings_only: true,
  grants: Object.freeze([])
});

export function acceptanceCoverageCarrierIdentity(resolved) {
  return Object.freeze({
    carrier_kind: "controlled-acceptance",
    wk_id: resolved.wkId,
    focus: resolved.focus,
    selected_unit: resolved.selectedUnit,
    content_digest: resolved.carrier?.content_digest ?? null
  });
}

const ACCEPTANCE_COVERAGE_OPERATION_CURSOR_VERSION =
  "wiki-core-acceptance-coverage-operation-cursor.v1";
const ACCEPTANCE_COVERAGE_PROJECTION_CURSOR_VERSION =
  "acceptance-coverage-projection-cursor.v1";

function validateAcceptanceCoverageProjectionCursor(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error("embedded projection cursor encoding is invalid");
    }
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) {
      throw new Error("embedded projection cursor encoding is not canonical base64url");
    }
    const value = JSON.parse(decoded.toString("utf8"));
    const keys = [
      "version", "criterion_identity_digest", "projection_digest", "selector",
      "offset"
    ];
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !keys.includes(key)) ||
        value.version !== ACCEPTANCE_COVERAGE_PROJECTION_CURSOR_VERSION ||
        !/^[0-9a-f]{64}$/u.test(value.criterion_identity_digest) ||
        !/^[0-9a-f]{64}$/u.test(value.projection_digest) ||
        !Number.isSafeInteger(value.offset) || value.offset < 0) {
      throw new Error("embedded projection cursor fields are invalid");
    }
    if (value.selector !== null) {
      const selectorKeys = ["criterion_identity", "node_id"];
      if (typeof value.selector !== "object" || Array.isArray(value.selector) ||
          Object.keys(value.selector).length !== 1 ||
          Object.keys(value.selector).some((key) => !selectorKeys.includes(key)) ||
          typeof value.selector[Object.keys(value.selector)[0]] !== "string" ||
          value.selector[Object.keys(value.selector)[0]].length === 0) {
        throw new Error("embedded projection cursor selector is invalid");
      }
    }
    return cursor;
  } catch (error) {
    throw new ControlledContractToolError(
      "acceptance_coverage_cursor_invalid",
      "continuation contains an invalid package projection cursor",
      { changed: false, cause: error.message }
    );
  }
}

export function decodeAcceptanceCoverageOperationCursor(cursor, joinedDigest) {
  if (cursor === undefined) return undefined;
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error("continuation encoding is invalid");
    }
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) {
      throw new Error("continuation encoding is not canonical base64url");
    }
    const value = JSON.parse(decoded.toString("utf8"));
    if (value?.version === ACCEPTANCE_COVERAGE_PROJECTION_CURSOR_VERSION) {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_wrong_layer",
        "package projection continuation cannot be used at the public operation layer",
        { changed: false }
      );
    }
    const keys = ["version", "joined_source_digest", "projection_cursor"];
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !keys.includes(key))) {
      throw new Error("continuation fields are invalid");
    }
    if (value.version !== ACCEPTANCE_COVERAGE_OPERATION_CURSOR_VERSION ||
        typeof value.joined_source_digest !== "string" ||
        typeof value.projection_cursor !== "string" ||
        value.projection_cursor.length === 0) throw new Error(
      "continuation identity is invalid"
    );
    if (value.joined_source_digest !== joinedDigest) {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_stale",
        "continuation belongs to different joined canonical sources"
      );
    }
    return validateAcceptanceCoverageProjectionCursor(value.projection_cursor);
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    throw new ControlledContractToolError(
      "acceptance_coverage_cursor_invalid", "continuation is malformed",
      { cause: error.message }
    );
  }
}

export function encodeAcceptanceCoverageOperationCursor(projectionCursor, joinedDigest) {
  return Buffer.from(JSON.stringify({
    version: ACCEPTANCE_COVERAGE_OPERATION_CURSOR_VERSION,
    joined_source_digest: joinedDigest,
    projection_cursor: projectionCursor
  }), "utf8").toString("base64url");
}

export function publicAcceptanceCoverageSelector(selector) {
  if (selector === undefined) return undefined;
  if (Object.hasOwn(selector, "criterionIdentity")) return Object.freeze({
    kind: "criterion_identity",
    criterion_identity: selector.criterionIdentity
  });
  return Object.freeze({ kind: "contract_node", node_id: selector.nodeId });
}

export function projectPublicAcceptanceCoverage(input) {
  try {
    return projectAcceptanceCoverage(input);
  } catch (error) {
    if (error?.code === "acceptance_coverage_projection_cursor_stale") {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_invalid",
        "continuation contains tampered package projection currentness",
        { changed: false, cause: error.message }
      );
    }
    if (error?.code !== "acceptance_coverage_projection_cursor_invalid") throw error;
    if (error.message === "cursor offset is outside the selected population") {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_exhausted",
        "continuation offset is at or beyond the current selected population",
        { changed: false }
      );
    }
    throw new ControlledContractToolError(
      "acceptance_coverage_cursor_invalid",
      "continuation contains an invalid package projection cursor",
      { changed: false, cause: error.message }
    );
  }
}

function obligationCoverageCriterion(selector, resolved, name = "criterionSelector") {
  exactObject(selector, ["kind", "criterion_identity"], name);
  if (selector.kind !== "criterion_identity" ||
      typeof selector.criterion_identity !== "string") {
    throw new ControlledContractToolError(
      "obligation_coverage_criterion_selector_invalid",
      "criterion selector must be one describe-emitted criterion identity",
      { changed: false, selector_kind: selector?.kind ?? null,
        next_calls: coverageSelectorRecovery({ family: "obligation", input: resolved }) }
    );
  }
  const criterion = resolved.criteria.find(
    ({ identity }) => identity === selector.criterion_identity
  );
  if (!criterion) throw new ControlledContractToolError(
    "obligation_coverage_criterion_selector_invalid",
    "criterion selector does not identify a current selected-unit criterion",
    { changed: false, selector_kind: selector.kind,
      next_calls: coverageSelectorRecovery({ family: "obligation", input: resolved }) }
  );
  return criterion;
}

function obligationCoverageMutationSelector(selector, recoveryInput) {
  exactObject(selector, ["kind", "obligation_id"], "obligationSelector");
  if (selector.kind !== "obligation_id" ||
      typeof selector.obligation_id !== "string" ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u.test(selector.obligation_id)) {
    throw new ControlledContractToolError(
      "obligation_coverage_obligation_selector_invalid",
      "mutation selector must identify one stable obligation ID",
      { changed: false, selector_kind: selector?.kind ?? null,
        next_calls: coverageSelectorRecovery({
          family: "obligation", input: recoveryInput
        }) }
    );
  }
  return selector.obligation_id;
}

function obligationCoverageMechanism(mechanism, pkg, name) {
  exactObject(mechanism, ["owner", "kind", "selector"], name);
  if (typeof mechanism.owner !== "string" || mechanism.owner.length === 0 ||
      !pkg.OBLIGATION_COVERAGE_MECHANISM_KINDS.includes(mechanism.kind) ||
      typeof mechanism.selector !== "string" || mechanism.selector.length === 0) {
    throw new ControlledContractToolError(
      "obligation_coverage_mechanism_invalid",
      `${name} must use the package-owned typed mechanism vocabulary`,
      { changed: false }
    );
  }
  return structuredClone(mechanism);
}

function obligationCoverageProof(proof, resolved, pkg, name) {
  if (proof?.kind === "explicit_gap") {
    exactObject(proof, ["kind", "gap_kind", "reason"], name);
    if (!pkg.OBLIGATION_COVERAGE_GAP_KINDS.includes(proof.gap_kind) ||
        typeof proof.reason !== "string" || proof.reason.length === 0) {
      throw new ControlledContractToolError(
        "obligation_coverage_gap_invalid",
        `${name} must use the package-owned explicit-gap vocabulary`,
        { changed: false }
      );
    }
    return structuredClone(proof);
  }
  exactObject(proof, ["kind", "requested_intent", "selector"], name);
  exactObject(proof.selector, ["kind", "component_id"], `${name}.selector`);
  if (proof.kind !== "pack_mapping" ||
      typeof proof.requested_intent !== "string" ||
      typeof proof.selector.kind !== "string" ||
      typeof proof.selector.component_id !== "string") {
    throw new ControlledContractToolError(
      "obligation_coverage_pack_mapping_invalid",
      `${name} must select one exact server-admitted pack component`,
      { changed: false }
    );
  }
  const matches = resolved.selectedPacks.filter((pack) =>
    pack.requested_intents.includes(proof.requested_intent) &&
    pack.selectors.some((selector) =>
      selector.kind === proof.selector.kind &&
      selector.component_id === proof.selector.component_id
    ));
  if (matches.length !== 1) throw new ControlledContractToolError(
    "obligation_coverage_pack_mapping_invalid",
    "pack mapping does not resolve to exactly one selected proof-plan pack",
    { changed: false, matching_pack_count: matches.length }
  );
  const [pack] = matches;
  return {
    kind: "pack_mapping",
    pack_id: pack.pack_id,
    requested_intent: proof.requested_intent,
    profile_id: pack.profile_id,
    profile_version: pack.profile_version,
    selector: structuredClone(proof.selector),

  };
}

export async function materializeObligationCoverageRow(row, resolved, name = "row") {
  exactObject(row, [
    "obligation_id", "statement", "criterion_selector",
    "controlled_contract_node_ids", "mechanism", "proof"
  ], name);
  if (typeof row.obligation_id !== "string" ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u.test(row.obligation_id)) {
    throw new ControlledContractToolError(
      "obligation_coverage_obligation_id_invalid",
      `${name}.obligation_id must be a stable obligation identity`,
      { changed: false }
    );
  }
  if (typeof row.statement !== "string" || row.statement.length === 0 ||
      row.statement !== row.statement.trim() || /[\r\n]/u.test(row.statement)) {
    throw new ControlledContractToolError(
      "obligation_coverage_statement_not_atomic",
      `${name}.statement must be one trimmed atomic statement`,
      { changed: false, obligation_id: row.obligation_id }
    );
  }
  const criterion = obligationCoverageCriterion(
    row.criterion_selector, resolved, `${name}.criterion_selector`
  );
  if (!Array.isArray(row.controlled_contract_node_ids) ||
      row.controlled_contract_node_ids.length === 0 ||
      new Set(row.controlled_contract_node_ids).size !==
        row.controlled_contract_node_ids.length ||
      row.controlled_contract_node_ids.some((id) =>
        typeof id !== "string" ||
        !resolved.contractNodes.some((node) => node.id === id))) {
    throw new ControlledContractToolError(
      "obligation_coverage_contract_node_invalid",
      `${name}.controlled_contract_node_ids must be exact current contract nodes`,
      { changed: false, obligation_id: row.obligation_id }
    );
  }
  const pkg = await loadControlledContractPackage();
  const sourceLocatorDigest = obligationCoverageSourceLocatorDigest({
    criterion: criterion.criterion,
    criterionIdentity: criterion.identity,
    criterionSetDigest: resolved.criterionIdentities.digest,
    obligationId: row.obligation_id,
    sourceLocator: criterion.source_locator,
    statement: row.statement
  });
  return {
    obligation_id: row.obligation_id,
    source_locator: criterion.source_locator,
    source_locator_digest: sourceLocatorDigest,
    statement: row.statement,
    controlled_contract_node_ids: structuredClone(row.controlled_contract_node_ids),
    mechanism: obligationCoverageMechanism(row.mechanism, pkg, `${name}.mechanism`),
    proof: obligationCoverageProof(row.proof, resolved, pkg, `${name}.proof`)
  };
}

export async function validateObligationCoverageContent(resolved, rows) {
  if (rows.length > OBLIGATION_COVERAGE_MAX_ROWS) throw new ControlledContractToolError(
    "obligation_coverage_carrier_oversize",
    "obligation-coverage source exceeds its complete-authoring bounds",
    { changed: false, bound: "rows", maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS,
      maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES, row_count: rows.length,
      byte_length: null }
  );
  const content = obligationCoverageCarrierContent(resolved, rows);
  const pkg = await loadControlledContractPackage();
  const validation = pkg.validateObligationCoverageDraft(content);
  if (!validation.valid) {
    const diagnostic = validation.diagnostics[0];
    throw new ControlledContractToolError(
      diagnostic?.code ?? "obligation_coverage_row_invalid",
      "authored rows do not form one valid canonical obligation source",
      { changed: false, schema_errors: validation.schema_errors,
        diagnostics: validation.diagnostics }
    );
  }
  const bytes = Buffer.from(`${JSON.stringify(validation.carrier, null, 2)}\n`, "utf8");
  if (bytes.byteLength > OBLIGATION_COVERAGE_MAX_BYTES) {
    throw new ControlledContractToolError(
      "obligation_coverage_carrier_oversize",
      "obligation-coverage source exceeds its complete-authoring bounds",
      { changed: false, bound: "bytes", maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS,
        maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES, row_count: rows.length,
        byte_length: bytes.byteLength }
    );
  }
  return Object.freeze({ content: validation.carrier, bytes });
}

export function assertAcceptanceRebaseAttemptIdentity(input, resolved) {
  exactObject(input.carrierIdentity,
    ["carrier_kind", "wk_id", "focus", "selected_unit", "content_digest"],
    "carrierIdentity");
  exactObject(input.sourceIdentity, ["source_kind", "content_digest"], "sourceIdentity");
  const currentCarrier = acceptanceCoverageCarrierIdentity(resolved);
  const currentSource = {
    source_kind: resolved.source.source_kind,
    content_digest: resolved.source.content_digest
  };
  if (JSON.stringify(input.carrierIdentity) !== JSON.stringify(currentCarrier) ||
      JSON.stringify(input.sourceIdentity) !== JSON.stringify(currentSource) ||
      input.expectedUnitDigest !== acceptanceCoverageUnitDigest(resolved)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_rebase_stale",
      "stale describe identity no longer matches server-resolved mapping facts",
      { changed: false, fresh_describe_required: true }
    );
  }
}
