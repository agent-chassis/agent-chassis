import { createHash } from "node:crypto";

import {
  ControlledContractToolError,
  assertControlledContractOperationInput,
  resolveCanonicalControlledContractCarrierSet
} from "../../lib/controlled-contract-tools.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import {
  readAcceptanceCoverageCarrier,
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
} from "./acceptance-coverage-facts.mjs";
import {
  finalizeControlledContractRefactorCoverageRebases,
  planControlledContractRefactorCoverageRebases
} from "./acceptance-coverage-operations.mjs";
import { rememberControlledContractRefactorContinuation } from
  "../../lib/controlled-contract-authoring-continuations.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import { CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS } from
  "./semantic-projection-bounds.mjs";

const REFACTOR_PLAN_SCHEMA_VERSION = "controlled-contract-refactor-plan.v1";
const REFACTOR_PLAN_PAGE_SCHEMA_VERSION = "controlled-contract-refactor-plan-page.v1";
const REFACTOR_RESOURCE_KIND = "plan";
const REFACTOR_SELECTORS = Object.freeze([
  "affected_identity", "carrier", "closure_edge", "correspondence",
  "coverage_conflict", "derived_invalidation", "proof_gap"
]);
const PLAN_SNAPSHOTS = new WeakMap();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}
function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}
function compare(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}
function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false,
    limb: "mechanical_failure",
    owner: "workspace_controlled_contract_refactor_plan",
    ...details
  });
}
function exactObject(value, keys, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("controlled_contract_refactor_request_invalid",
      `${name} is not one closed refactor object`, { field: name });
  }
}

function generationIdentity(canonicalSet) {
  return typeof canonicalSet.generation === "string" ? canonicalSet.generation
    : canonicalSet.generation?.id ?? null;
}

function currentnessPrecondition(snapshot) {
  if (snapshot.generation !== null) return { expected_generation: snapshot.generation };
  return { expected_manifest_digest: snapshot.manifestDigest };
}

export async function resolveControlledContractRefactorSnapshot(input) {
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
    repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null
  });
  const carriers = canonicalSet.members.map((member) => ({
    carrier_kind: member.carrier_kind,
    filename: member.filename,
    content_digest: member.content_digest,
    generation_id: generationIdentity(canonicalSet),
    content: structuredClone(member.content)
  }));
  let obligationFacts = null;
  try {
    obligationFacts = await resolveObligationCoverageFacts({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      selectedUnit: null
    });
  } catch (error) {
    if (!["obligation_coverage_source_not_found",
      "controlled_contract_carrier_not_found"].includes(error?.code)) throw error;
  }
  if (obligationFacts?.source?.content !== undefined) carriers.push({
    carrier_kind: "obligation_coverage",
    content_digest: obligationFacts.source.content_digest,
    generation_id: generationIdentity(canonicalSet),
    content: structuredClone(obligationFacts.source.content)
  });
  let acceptanceFacts = null;
  try {
    acceptanceFacts = await resolveAcceptanceCoverageFacts({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      selectedUnit: null
    }, { requireCarrier: false });
  } catch (error) {
    if (!["acceptance_coverage_source_not_found",
      "controlled_contract_carrier_not_found"].includes(error?.code)) throw error;
  }
  const acceptanceCarrier = acceptanceFacts?.carrier ??
    await readAcceptanceCoverageCarrier({ repoRoot: input.repoRoot,
      wkId: input.wkId, focus: input.focus ?? null, selectedUnit: null });
  if (acceptanceCarrier !== null) carriers.push({
    carrier_kind: "acceptance_coverage",
    content_digest: acceptanceCarrier.content_digest,
    generation_id: generationIdentity(canonicalSet),
    content: structuredClone(acceptanceCarrier.content)
  });
  return Object.freeze({
    canonicalSet,
    generation: generationIdentity(canonicalSet),
    manifestDigest: canonicalSet.manifest_content_digest ?? null,
    liveCarriers: Object.freeze(carriers),
    obligationFacts,
    acceptanceFacts,
    acceptanceCarrier,
    resolveCurrent: async () => {
      const current = await resolveCanonicalControlledContractCarrierSet({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null
      });
      return Object.freeze({ generation: generationIdentity(current),
        manifestDigest: current.manifest_content_digest ?? null });
    }
  });
}

function assertExpectedCurrent(input, snapshot) {
  const hasGeneration = typeof input.expectedGeneration === "string";
  const hasDigest = typeof input.expectedManifestDigest === "string";
  if (hasGeneration === hasDigest) fail(
    "controlled_contract_refactor_currentness_precondition_invalid",
    "plan requires exactly one current generation or manifest-digest precondition",
    { expected_generation: input.expectedGeneration ?? null,
      expected_manifest_digest: input.expectedManifestDigest ?? null,
      would_break: "one exact current source snapshot could not be selected" });
  if ((hasGeneration && input.expectedGeneration !== snapshot.generation) ||
      (hasDigest && input.expectedManifestDigest !== snapshot.manifestDigest)) fail(
    "controlled_contract_refactor_plan_stale",
    "the requested currentness precondition no longer selects the canonical source",
    { actual_generation: snapshot.generation,
      actual_manifest_digest: snapshot.manifestDigest,
      recovery: { operation: "workspace_controlled_contract_refactor_plan",
        arguments: { wk_id: input.wkId, focus: input.focus ?? null,
          ...currentnessPrecondition(snapshot) } },
      would_break: "plan pages from different generations could be stitched" });
}

function publicCoveragePlan(plan) {
  if (plan === null) return null;
  return Object.freeze({ family: plan.family,
    conflict_set_identity: plan.conflictSetIdentity,
    currentness_digest: plan.currentnessDigest,
    conflict_digest: plan.conflictDigest,
    conflict_count: plan.entries.length,
    conflicts: Object.freeze(plan.entries.map(({ public: row }) => structuredClone(row))) });
}

function coveragePlans(snapshot, mode, injected) {
  if (injected !== undefined) return injected;
  return planControlledContractRefactorCoverageRebases({ mode,
    obligationFacts: snapshot.obligationFacts,
    acceptanceFacts: snapshot.acceptanceFacts });
}

function semanticItems(packageResult, plans) {
  const rows = [];
  for (const identity of packageResult.affected_identities) rows.push({
    kind: "affected_identity", stable_id: identity, value: identity
  });
  for (const row of packageResult.correspondence) rows.push({
    kind: "correspondence", stable_id: digest(row), value: structuredClone(row)
  });
  for (const row of packageResult.closure) rows.push({
    kind: "closure_edge", stable_id: digest(row), value: structuredClone(row)
  });
  for (const row of packageResult.carriers) rows.push({
    kind: "carrier", stable_id: row.carrier_kind, value: structuredClone(row)
  });
  for (const row of packageResult.proof_gaps) rows.push({
    kind: "proof_gap", stable_id: digest(row), value: structuredClone(row)
  });
  for (const row of packageResult.invalidated_derived) rows.push({
    kind: "derived_invalidation", stable_id: digest(row), value: structuredClone(row)
  });
  for (const [family, plan] of Object.entries(plans)) {
    for (const entry of plan?.entries ?? []) rows.push({
      kind: "coverage_conflict", stable_id: entry.public.conflict_id,
      value: { family, ...structuredClone(entry.public) }
    });
  }
  return Object.freeze(rows.sort((left, right) =>
    compare(`${left.kind}\0${left.stable_id}`, `${right.kind}\0${right.stable_id}`)));
}

function renameCoverageProspective(packageResult) {
  const item = (kind, family) => {
    const carrier = packageResult.carriers.find(({ carrier_kind: carrierKind }) =>
      carrierKind === kind);
    return carrier === undefined ? null : Object.freeze({ family,
      content: structuredClone(carrier.content),
      source_content_digest: carrier.source_content_digest,
      prospective_content_digest: carrier.prospective_content_digest });
  };
  return Object.freeze({ obligation: item("obligation_coverage", "obligation"),
    acceptance: item("acceptance_coverage", "acceptance") });
}

function snapshotBinding(input, snapshot, packageResult, plans) {
  const coverage = {
    obligation: publicCoveragePlan(plans.obligation),
    acceptance: publicCoveragePlan(plans.acceptance)
  };
  const body = { schema_version: REFACTOR_PLAN_SCHEMA_VERSION,
    wk_id: input.wkId, focus: input.focus ?? null,
    generation: snapshot.generation, manifest_digest: snapshot.manifestDigest,
    package_result_digest: packageResult.result_digest,
    package_schema_version: packageResult.schema_version,
    mode: packageResult.mode, correspondence: packageResult.correspondence,
    reason: packageResult.reason, coverage };
  return Object.freeze({ ...body, snapshot_digest: digest(body) });
}

function normalizeSelector(selector) {
  if (selector === null || selector === undefined) return null;
  exactObject(selector, ["kind", "stable_id"], "selector");
  if (!REFACTOR_SELECTORS.includes(selector.kind) ||
      (selector.stable_id !== null && (typeof selector.stable_id !== "string" ||
       selector.stable_id.length === 0))) fail(
    "controlled_contract_refactor_selector_invalid",
    "selector must use one supported semantic kind and optional stable identity",
    { selector: structuredClone(selector) });
  return Object.freeze(structuredClone(selector));
}

function selectedItems(snapshot, selector) {
  if (selector === null) return snapshot.items;
  return snapshot.items.filter((item) => item.kind === selector.kind &&
    (selector.stable_id === null || item.stable_id === selector.stable_id));
}

function assertCursorBinding(snapshot, payload, selector) {
  exactObject(payload, ["resource_kind", "resource_identity", "snapshot_digest",
    "selector", "offset", "page_size"], "authenticatedCursorPayload");
  if (payload.resource_kind !== REFACTOR_RESOURCE_KIND ||
      payload.resource_identity !== snapshot.resourceIdentity ||
      payload.snapshot_digest !== snapshot.binding.snapshot_digest ||
      JSON.stringify(payload.selector) !== JSON.stringify(selector) ||
      !Number.isSafeInteger(payload.offset) || payload.offset < 0 ||
      !Number.isSafeInteger(payload.page_size) || payload.page_size < 1 ||
      payload.page_size > CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items) fail(
    "controlled_contract_refactor_cursor_stale",
    "authenticated cursor payload does not bind this exact plan snapshot",
    { recovery: snapshot.replanCall,
      would_break: "pages from different resources or snapshots could be stitched" });
}

function planPage(snapshot, { selector = null, offset = 0,
  pageSize = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items } = {}) {
  const normalizedSelector = normalizeSelector(selector);
  const items = selectedItems(snapshot, normalizedSelector);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) fail(
    "controlled_contract_refactor_cursor_stale", "plan page offset is invalid",
    { offset, complete_count: items.length, recovery: snapshot.replanCall });
  const returned = items.slice(offset, offset + pageSize);
  const remaining = items.length - offset - returned.length;
  const cursorBinding = remaining > 0 ? Object.freeze({
    resource_kind: REFACTOR_RESOURCE_KIND,
    resource_identity: snapshot.resourceIdentity,
    snapshot_digest: snapshot.binding.snapshot_digest,
    selector: normalizedSelector,
    offset: offset + returned.length,
    page_size: pageSize
  }) : null;
  const conflicts = (snapshot.plans.obligation?.entries.length ?? 0) +
    (snapshot.plans.acceptance?.entries.length ?? 0);
  let finalAction = null;
  if (remaining === 0 && normalizedSelector === null) {
    finalAction = conflicts > 0 && snapshot.finalized !== true
      ? { operation: "workspace_controlled_contract_refactor_plan",
          arguments: { plan_identity: snapshot.resourceIdentity,
            conflict_set_identity: snapshot.conflictSetIdentity,
            obligation_dispositions: [], acceptance_dispositions: [] },
          author_semantics: ["obligation_dispositions", "acceptance_dispositions"] }
      : { operation: "workspace_controlled_contract_refactor_apply",
          arguments: { continuation: snapshot.applyContinuation } };
  }
  return Object.freeze({
    schema_version: REFACTOR_PLAN_PAGE_SCHEMA_VERSION,
    resource_kind: REFACTOR_RESOURCE_KIND,
    resource_identity: snapshot.resourceIdentity,
    snapshot_digest: snapshot.binding.snapshot_digest,
    source: Object.freeze({ wk_id: snapshot.binding.wk_id,
      focus: snapshot.binding.focus, generation: snapshot.binding.generation,
      manifest_digest: snapshot.binding.manifest_digest }),
    mode: snapshot.binding.mode,
    selector: normalizedSelector,
    counts: Object.freeze({ complete: items.length, returned: returned.length,
      omitted: items.length - returned.length, remaining }),
    items: Object.freeze(structuredClone(returned)),
    next_cursor_binding: cursorBinding,
    final_action: finalAction,
    authority: Object.freeze({ authoritative: false, read_only: true,
      grants: Object.freeze([]) })
  });
}

function makeSnapshot(input, source, packageResult, plans, options = {}) {
  const binding = snapshotBinding(input, source, packageResult, plans);
  const items = semanticItems(packageResult, plans);
  const conflictSetIdentity = digest({
    obligation: plans.obligation?.conflictSetIdentity ?? null,
    acceptance: plans.acceptance?.conflictSetIdentity ?? null,
    snapshot_digest: binding.snapshot_digest
  });
  return {
    resourceIdentity: digest({ binding, items }), binding, items, plans,
    packageResult, source, conflictSetIdentity,
    applyContinuation: options.applyContinuation ?? null,
    finalized: options.finalized === true,
    replanCall: { operation: "workspace_controlled_contract_refactor_plan",
      arguments: { wk_id: input.wkId, focus: input.focus ?? null,
        ...currentnessPrecondition(source),
        mode: structuredClone(input.mode) } }
  };
}

export function consumeControlledContractRefactorPlanSnapshot(result) {
  const value = result && typeof result === "object" ? PLAN_SNAPSHOTS.get(result) ?? null : null;
  if (value !== null) PLAN_SNAPSHOTS.delete(result);
  return value;
}

export async function buildControlledContractRefactorPlanOperation(input, {
  resolveSnapshot = resolveControlledContractRefactorSnapshot,
  resolvedSnapshot = null,
  coveragePlanSet,
  applyContinuation = null,
  issueApplyContinuation = defaultIssueApplyContinuation
} = {}) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "wkId", "focus",
      "expectedGeneration", "expectedManifestDigest", "mode"]);
    const source = resolvedSnapshot ?? await resolveSnapshot(input);
    assertExpectedCurrent(input, source);
    const pkg = await loadControlledContractPackage();
    if (typeof pkg.buildControlledContractRefactorClosure !== "function") fail(
      "controlled_contract_refactor_package_incompatible",
      "loaded controlled-contract package has no stable refactor primitive",
      { would_break: "plan and assessment could select different classifiers" });
    const preliminaryPlans = coveragePlans(source, input.mode, coveragePlanSet);
    const packageResult = pkg.buildControlledContractRefactorClosure({
      live_carriers: source.liveCarriers, mode: structuredClone(input.mode)
    });
    const snapshot = makeSnapshot(input, source, packageResult, preliminaryPlans,
      { applyContinuation });
    const conflictCount = (preliminaryPlans.obligation?.entries.length ?? 0) +
      (preliminaryPlans.acceptance?.entries.length ?? 0);
    if (conflictCount === 0 && snapshot.applyContinuation === null) {
      const coverage = packageResult.mode === "rename_identity"
        ? renameCoverageProspective(packageResult)
        : await finalizeControlledContractRefactorCoverageRebases({
            plans: preliminaryPlans, obligationDispositions: [],
            acceptanceDispositions: [], input
          });
      const issued = await issueApplyContinuation({ input, snapshot, coverage });
      snapshot.applyContinuation = typeof issued === "string" ? issued : issued.identity;
      snapshot.finalized = true;
    }
    const result = planPage(snapshot);
    PLAN_SNAPSHOTS.set(result, Object.freeze(snapshot));
    return result;
  });
}

export async function queryControlledContractRefactorPlan(input, {
  snapshot,
  resolveCurrent = snapshot?.source?.resolveCurrent
} = {}) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["resourceIdentity", "selector",
      "authenticatedCursorPayload"]);
    if (!snapshot || input.resourceIdentity !== snapshot.resourceIdentity) fail(
      "controlled_contract_refactor_resource_unknown",
      "plan resource identity is unknown or cross-resource",
      { resource_identity: input.resourceIdentity });
    const selector = normalizeSelector(input.selector ?? null);
    const payload = input.authenticatedCursorPayload;
    assertCursorBinding(snapshot, payload, selector);
    if (typeof resolveCurrent === "function") {
      const current = await resolveCurrent();
      if (current.generation !== snapshot.source.generation ||
          current.manifestDigest !== snapshot.source.manifestDigest) fail(
        "controlled_contract_refactor_plan_stale",
        "plan source changed after the snapshot was issued",
        { recovery: snapshot.replanCall,
          would_break: "query would return detail for a no-longer-current plan" });
    }
    return planPage(snapshot, { selector, offset: payload.offset,
      pageSize: payload.page_size });
  });
}

async function defaultIssueApplyContinuation({ input, snapshot, coverage }) {
  const pkg = await loadControlledContractPackage();
  const contract = snapshot.packageResult.carriers.find(
    ({ carrier_kind: kind }) => kind === "contract");
  return rememberControlledContractRefactorContinuation({
    repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
    contractContentDigest: contract?.source_content_digest ??
      snapshot.source.manifestDigest,
    packageGeneration: pkg.PACKAGE_VERSION ?? snapshot.packageResult.schema_version,
    source: { generation: snapshot.source.generation,
      manifest_digest: snapshot.source.manifestDigest },
    planIdentity: snapshot.resourceIdentity,
    snapshotDigest: snapshot.binding.snapshot_digest,
    packageResult: snapshot.packageResult,
    coverage,
    sourceLease: { generation: snapshot.source.generation,
      manifest_digest: snapshot.source.manifestDigest }
  });
}

export async function finalizeControlledContractRefactorPlanOperation(input, {
  snapshot,
  resolveCurrent = snapshot?.source?.resolveCurrent,
  issueApplyContinuation = defaultIssueApplyContinuation
} = {}) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "wkId", "focus",
      "planIdentity", "conflictSetIdentity", "obligationDispositions",
      "acceptanceDispositions"]);
    if (!snapshot || input.planIdentity !== snapshot.resourceIdentity ||
        input.conflictSetIdentity !== snapshot.conflictSetIdentity ||
        input.wkId !== snapshot.binding.wk_id ||
        (input.focus ?? null) !== snapshot.binding.focus) fail(
      "controlled_contract_refactor_plan_stale",
      "finalization does not bind the exact server-issued plan and conflict set",
      { recovery: snapshot?.replanCall ?? null,
        would_break: "coverage dispositions could settle against another plan" });
    if (typeof resolveCurrent === "function") {
      const current = await resolveCurrent();
      if (current.generation !== snapshot.source.generation ||
          current.manifestDigest !== snapshot.source.manifestDigest) fail(
        "controlled_contract_refactor_plan_stale",
        "plan source changed before disposition finalization",
        { recovery: snapshot.replanCall,
          would_break: "coverage prospective bytes could bind stale sources" });
    }
    const coverage = await finalizeControlledContractRefactorCoverageRebases({
      plans: snapshot.plans,
      obligationDispositions: input.obligationDispositions,
      acceptanceDispositions: input.acceptanceDispositions,
      input
    });
    const continuationRecord = await issueApplyContinuation({ input, snapshot, coverage });
    const continuation = typeof continuationRecord === "string"
      ? continuationRecord : continuationRecord.identity;
    snapshot.finalized = true;
    snapshot.applyContinuation = continuation;
    return Object.freeze({
      schema_version: REFACTOR_PLAN_PAGE_SCHEMA_VERSION,
      resource_kind: REFACTOR_RESOURCE_KIND,
      resource_identity: snapshot.resourceIdentity,
      snapshot_digest: snapshot.binding.snapshot_digest,
      conflict_set_identity: snapshot.conflictSetIdentity,
      status: "finalized",
      counts: Object.freeze({ obligation_dispositions:
        input.obligationDispositions.length, acceptance_dispositions:
        input.acceptanceDispositions.length }),
      final_action: Object.freeze({
        operation: "workspace_controlled_contract_refactor_apply",
        arguments: Object.freeze({ continuation })
      }),
      authority: Object.freeze({ authoritative: false, grants: Object.freeze([]) })
    });
  });
}

export function projectCrossCarrierIntegrityAxis(packageResult, {
  currentGeneration = null
} = {}) {
  const integrity = packageResult.integrity ?? {};
  const dangling = structuredClone(integrity.dangling_live_nodes ?? []);
  const orphanProofs = structuredClone(integrity.orphan_verification_bindings ?? []);
  const absentCoverage = structuredClone(integrity.absent_node_coverage_mappings ?? []);
  const staleDerived = structuredClone(integrity.stale_derived_carriers ?? []);
  const generationConflicts = structuredClone(
    integrity.generation_identity_conflicts ?? []);
  const finding = (kind, row) => {
    const value = {
      kind,
      identity: row.identity ?? null,
      carrier_kind: row.carrier_kind ?? null,
      pointer: row.pointer ?? null,
      field: row.field ?? null,
      content_digest: row.content_digest ?? null,
      generation_id: row.generation_id ?? null,
      expected_generation: kind === "generation_identity_conflict"
        ? currentGeneration : null
    };
    return Object.freeze({ integrity_finding_id: digest(value), ...value });
  };
  const findings = [
    ...dangling.map((row) => finding("dangling_live_node", row)),
    ...orphanProofs.map((row) => finding("orphan_verification_binding", row)),
    ...absentCoverage.map((row) => finding("absent_node_coverage_mapping", row)),
    ...staleDerived.map((row) => finding("stale_derived_carrier", row)),
    ...generationConflicts.map((row) => finding("generation_identity_conflict", row))
  ].sort((left, right) => compare(left.integrity_finding_id,
    right.integrity_finding_id));
  return Object.freeze({
    axis: "cross_carrier_integrity",
    state: findings.length === 0 ? "pass" : "incomplete",
    package_result_digest: packageResult.result_digest,
    counts: Object.freeze({ dangling_live_nodes: dangling.length,
      orphan_verification_bindings: orphanProofs.length,
      absent_node_coverage_mappings: absentCoverage.length,
      stale_derived_carriers: staleDerived.length,
      generation_identity_conflicts: generationConflicts.length,
      complete: findings.length }),
    findings: Object.freeze(findings),
    authority: Object.freeze({ authoritative: false, read_only: true,
      grants: Object.freeze([]) })
  });
}

export { REFACTOR_PLAN_PAGE_SCHEMA_VERSION, REFACTOR_PLAN_SCHEMA_VERSION,
  REFACTOR_RESOURCE_KIND, REFACTOR_SELECTORS, planPage as projectControlledContractRefactorPlanPage };
