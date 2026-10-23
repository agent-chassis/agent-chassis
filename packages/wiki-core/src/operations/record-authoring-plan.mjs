import { prepareRetainedGraphEvidence } from "./work-records-graph-impact.mjs";

import { RECORD_AUTHORING_SLICE_CONTEXT, sliceContractMemberPlacementDiagnostics, validateRecordAuthoringChanges,
  WORK_ITEM_ORDINARY_MEMBERS, WORK_ITEM_SLICE_CONTRACT_MEMBERS } from "../lib/record-authoring-schema.mjs";
import { RECORD_AUTHORING_EXCEPTION_CODES, RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE,
  describeRecordAuthoringException, validateRecordAuthoringException } from "../lib/record-authoring-exception.mjs";
import { CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_MAX_BYTES, normalizeControlledAcceptanceOptOutRationale } from
  "../lib/work-record-proof-posture.mjs";
import { reject, setScalar, setSection } from "../lib/kind-record-edit.mjs";
import { guardWorkRecordReadySlicePersistedDiff, planWorkRecordReadySlice } from
  "../lib/work-record-ready-slice-contract.mjs";
import { applyWorkRecordContractEdit, assignWorkRecordToInitiative,
  validateWorkRecordProseDestination, WORK_RECORD_EDIT_FIELD_REGISTRY } from "../lib/work-record-contract-edit-operations.mjs";
import { cloneJson, finalizeEdit, jsonEqual } from "../lib/work-record-contract-edit-shared.mjs";
import { acceptanceCriterionInventory } from "./controlled-contract/acceptance-criterion-coverage.mjs";
import { projectRequirementMutationFailure } from './controlled-contract/proof-authoring-case-diagnosis.mjs';
import { requireRequirementAuthoringOperation } from "./controlled-contract/proof-authoring-contract-inputs.mjs";
import { resolveRecordAuthoringSelections } from './record-authoring-public-selections.mjs';
import { resolveRecordAuthoringLocalClaims } from './record-authoring-local-selections.mjs';
import { projectAuthoredRequirements, requirementDescriptionEntities } from './controlled-contract/contract-requirement-projection.mjs';
import { prepareRequirementDescriptionSources } from './controlled-contract/contract-requirement-description-sources.mjs';
import { controlledContractIdentityScope } from './controlled-contract/contract-requirement-identity.mjs';
import { recordAuthoringAvailability, recordAuthoringOperationDiagnostic, requirementAuthoringAvailabilityDiagnostics } from "../lib/record-authoring-availability.mjs";
import { prepareProofAuthoringMutation } from "./controlled-contract/proof-authoring-preparation.mjs";
import { reconcileProofAuthoringCandidate } from './controlled-contract/proof-authoring-candidate-reconciliation.mjs';
import { prospectiveProofAuthoringSource } from "./controlled-contract/proof-authoring-targets.mjs";
import { ControlledContractToolError, controlledContractContentDigest } from "../lib/controlled-contract-tools.mjs";
import { planWorkRecordDispositions } from "./work-record-dispositions.mjs";
import { planWorkRecordEntryUpsert, validateWorkRecordEntryUpsertInput } from "./work-record-entries.mjs";
import { resolveProseCarrier, inspectInitiativeAssignmentTarget } from "./work-record-contract-edit.mjs";
import { assertBirthProofAuthoringSource } from './controlled-contract/saved-proof-source.mjs';
import { planWorkRecordTaskEdit, validateClosurePatch } from "./work-records-edits.mjs";

class PlanRefusal extends Error {
  constructor(diagnostics) { super(diagnostics[0].message); this.diagnostics = diagnostics; }
}
const diagnostic = (code, path, message) => ({ code, severity: "error", path, message });
const refuse = (code, path, message) => { throw new PlanRefusal([diagnostic(code, path, message)]); };

function applied(plan, path, readdress = null) {
  if (plan.ok) return plan;
  throw new PlanRefusal(plan.diagnostics.map((entry) => {
    const mapped = readdress?.(entry);
    if (mapped) return { ...entry, severity: 'error', ...mapped,
      message: mapped.message ?? (entry.path ? entry.message.replaceAll(entry.path, mapped.path) : entry.message) };
    const ownerRoot = /^(?:edit\.value)(?:[.\[]|$)/u.test(entry.path ?? "") ? "edit.value"
      : entry.path?.startsWith("slice.") ? "slice" : null;
    const addressed = ownerRoot === null ? path : `${path}${entry.path.slice(ownerRoot.length)}`;
    return { ...entry, severity: "error", path: addressed,
      ...(ownerRoot === null ? { owner_path: entry.path ?? null } : {}),
      message: ownerRoot === null ? entry.message : entry.message.replaceAll(entry.path, addressed) };
  }));
}

const selectUnit = (record, sliceId) => sliceId === null ? record
  : record.slices.find((slice) => slice.id === sliceId);

function allocator(prefix, used) {
  const taken = new Set(used);
  let ordinal = [...taken].reduce((highest, id) => {
    const match = new RegExp(`^${prefix}-([0-9]+)$`, "u").exec(id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return () => {
    let id;
    do { ordinal += 1; id = `${prefix}-${String(ordinal).padStart(3, "0")}`; } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

function labelNamespace() {
  const labels = new Map();
  return {
    declare(key, type, path) {
      if (key === undefined) return;
      if (labels.has(key)) refuse("record_authoring_label_duplicate", path,
        `${path} declares label '${key}', which ${labels.get(key).path} already declares`);
      labels.set(key, { type, path, value: null });
    },
    bind(key, value) { if (key !== undefined) labels.get(key).value = value; },
    resolve(reference, types, path) {
      if (typeof reference !== "string" || !reference.startsWith("$")) return reference;
      const found = labels.get(reference.slice(1));
      if (found === undefined) refuse("record_authoring_label_unknown", path,
        `${path} references ${reference}, which no row in this request declares`);
      if (!types.includes(found.type)) refuse("record_authoring_label_wrong_type", path,
        `${path} needs a ${types.join(" or ")} but ${reference} labels a ${found.type}`);
      return found.value;
    },
    bindings() {
      const bound = {};
      for (const [key, { type, value }] of labels) (bound[type] ??= {})[key] = value;
      return bound;
    }
  };
}

async function planOrdinaryMembers({ captured, record, sliceId, changes, repository }) {
  const changed = [];
  let current = record;
  const step = (plan, path, readdress) => {
    const result = applied(plan, path, readdress);
    current = result.updatedRecord;
    changed.push(...result.changedFields);
  };
  for (const { member, field } of WORK_ITEM_ORDINARY_MEMBERS) {
    if (!Object.hasOwn(changes, member)) continue;
    const entry = WORK_RECORD_EDIT_FIELD_REGISTRY.find((candidate) => candidate.field === field);
    let value = changes[member];
    if (entry.kind === "scalar" && value !== null && typeof value === "object") {

      const resolved = await resolveProseCarrier({ content: value, path: `changes.${member}`, field,
        scope: sliceId === null ? "record" : "slice", repository, dir: captured.repoRoot });
      if (!resolved.ok) throw new PlanRefusal([{ ...resolved.diagnostic, severity: "error",
        owner_path: resolved.diagnostic.path ?? null, path: `changes.${member}` }]);
      value = resolved.value;
    }
    step(applyWorkRecordContractEdit(current, { operation: "edit_work_record", sliceId, repository,
      edit: { kind: entry.kind, field, action: "replace", value } }), `changes.${member}`);
  }
  if (Object.hasOwn(changes, "initiative")) {
    if (sliceId !== null) refuse("record_authoring_member_not_applicable", "changes.initiative",
      "changes.initiative applies to the work record, not to a slice unit");
    step(assignWorkRecordToInitiative(current, { initiative: changes.initiative }), "changes.initiative");
  }
  const contract = WORK_ITEM_SLICE_CONTRACT_MEMBERS.filter((member) => Object.hasOwn(changes, member));
  if (contract.length > 0) {

    if (sliceId === null) throw new PlanRefusal(sliceContractMemberPlacementDiagnostics(contract));
    const stored = selectUnit(current, sliceId);
    const intent = { ...stored.dispatch_intent,
      ...(Object.hasOwn(changes, "target_unit") ? { target_unit: changes.target_unit } : {}),
      ...(Object.hasOwn(changes, "agent_role") ? { intended_agent_role: changes.agent_role } : {}) };
    step(applyWorkRecordContractEdit(current, { operation: "upsert_slice", slice: { id: sliceId,
      ...(Object.hasOwn(changes, "work_kind") ? { work_kind: changes.work_kind } : {}),
      ...(jsonEqual(intent, stored.dispatch_intent) ? {} : { dispatch_intent: intent }),
      ...Object.fromEntries(["expected_edit_targets", "expected_changed_line_budget", "regression_tests"]
        .filter((member) => Object.hasOwn(changes, member)).map((member) => [member, changes[member]])) } }),
    `changes.${contract[0]}`, entry => {
      const native = (entry.path ?? '').replace(/^slice\./u, '').replace(/^slices\[[^\]]+\]\./u, '');
      const field = native.replace(/^dispatch_intent\.intended_agent_role/u, 'agent_role')
        .replace(/^dispatch_intent\.target_unit/u, 'target_unit');
      const member = field.split(/[.\[]/u)[0];
      const message = entry.message.replaceAll('dispatch_intent.intended_agent_role', 'agent_role')
        .replaceAll('dispatch_intent.target_unit', 'target_unit');
      return Object.hasOwn(changes, member) ? { path: `changes.${field}`, message }
        : { path: `changes.${contract[0]}`, subject: { unit: `${record.id}#${sliceId}`, field },
          message, attribution: 'saved_unit_constraint', constraint: { rule: message } };
    });
  }
  return { record: current, changed };
}

function planSlices({ captured, record, sliceId, changes, labels }) {
  const changed = [];
  let current = record;
  const removed = changes.remove?.slices ?? [];
  const authored = changes.slices ?? [];
  if (removed.length + authored.length > 0 && sliceId !== null) {
    refuse("record_authoring_member_not_applicable", authored.length > 0 ? "changes.slices" : "changes.remove.slices",
      "slices are defined and removed on the work record; select the record unit");
  }
  removed.forEach((id, index) => {
    const source = captured.sources.find((entry) => entry.selectedUnit === id)?.source;
    if (current.slices.some((slice) => slice.id === id) && (source?.content.obligations.length ?? 0) > 0) {
      refuse("record_authoring_slice_obligations_present", `changes.remove.slices[${index}]`,
        `${id} has captured obligations; select that slice unit and remove its obligations first`);
    }
    const result = applied(applyWorkRecordContractEdit(current, { operation: "delete_slice", sliceId: id }),
      `changes.remove.slices[${index}]`);
    current = result.updatedRecord;
    changed.push(...result.changedFields);
  });
  authored.forEach(({ key, id, ...body }, index) => {
    if (Object.hasOwn(body.sections ?? {}, "dispositions")) {
      refuse("record_authoring_disposition_source_required", `changes.slices[${index}].sections.dispositions`,
        "select the slice as the unit and author through typed changes.dispositions using authenticated captured material");
    }

    const persisted = captured.record.slices.find((slice) => slice.id === id);
    const entries = body.sections?.entries;
    for (const [entryIndex, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      const prior = persisted?.sections?.entries?.find((value) => value.id === entry?.id);
      for (const [versionIndex, version] of (Array.isArray(entry?.versions) ? entry.versions : []).entries()) {
        const sources = version?.provenance?.sources;
        const claimsSource = Array.isArray(sources) && sources.some((source) => source !== null &&
          typeof source === "object" && (Object.hasOwn(source, "source_kind") ||
            typeof source.kind === "string" && source.kind !== "supplied_text"));
        if (!claimsSource) continue;
        const stored = prior?.versions.find((value) => value.id === version.id);
        if (stored !== undefined && jsonEqual(stored, version)) continue;
        refuse("record_authoring_entry_source_required",
          `changes.slices[${index}].sections.entries[${entryIndex}].versions[${versionIndex}].provenance`,
          "select the slice as the unit and use typed changes.entries to capture the source through the existing entry owner");
      }
    }
    const before = new Set(current.slices.map((slice) => slice.id));
    if (id !== undefined && !before.has(id)) refuse("record_authoring_row_unknown", `changes.slices[${index}].id`,
      `changes.slices[${index}].id names ${id}, which this record does not have; a new slice carries key`);
    const result = applied(applyWorkRecordContractEdit(current, { operation: "upsert_slice",
      slice: { ...body, ...(id === undefined ? {} : { id }) } }), `changes.slices[${index}]`, entry => {
        const native = entry.path ?? '';
        const selectedIndex = id === undefined ? current.slices.length : current.slices.findIndex(row => row.id === id);
        const prefix = `slices[${selectedIndex}]`;
        return native === prefix || native.startsWith(`${prefix}.`)
          ? { path: `changes.slices[${index}]${native.slice(prefix.length)}` } : null;
      });
    current = result.updatedRecord;
    changed.push(...result.changedFields);
    labels.bind(key, current.slices.find((slice) => !before.has(slice.id))?.id ?? id);
  });
  return { record: current, changed };
}

async function planReadySlices({ captured, record, sliceId, changes, labels, repository, now }) {
  const rows = changes.ready_slices ?? [];
  if (rows.length > 0 && sliceId !== null) refuse("record_authoring_member_not_applicable", "changes.ready_slices",
    "slices are shaped on the work record; select the record unit");
  const changed = [];
  const shaped = [];
  let current = record;
  for (const [index, { key, id, ...fields }] of rows.entries()) {
    const path = `changes.ready_slices[${index}]`;

    const ownerRefusal = (...entries) => { throw new PlanRefusal(entries.map((entry) => {
      const addressed = entry.path ? `${path}.${entry.path}` : path;
      return { ...entry, severity: "error", path: addressed,
        message: entry.path ? entry.message.replaceAll(entry.path, addressed) : entry.message };
    })); };
    const request = { unit: captured.wkId, ...(id === undefined ? {} : { slice_id: id }), ...fields };
    for (const field of ["summary", "why_it_matters", "agent_notes"]) {
      if (typeof request[field] === "string") {
        const destination = validateWorkRecordProseDestination({ field: `sections.${field}`,
          scope: "slice", value: request[field], path: field });
        if (!destination.ok) ownerRefusal(destination.diagnostic);
        request[field] = destination.value;
        continue;
      }
      if (request[field] === null || typeof request[field] !== "object") continue;
      const resolved = await resolveProseCarrier({ content: request[field], path: field,
        field: `sections.${field}`, scope: "slice", repository, dir: captured.repoRoot });
      if (!resolved.ok) ownerRefusal(resolved.diagnostic);
      request[field] = resolved.value;
    }
    const plan = planWorkRecordReadySlice(current, request, { repository });
    if (!plan.ok) ownerRefusal(...plan.diagnostics);
    labels.bind(key, plan.selectedUnit.slice_id);
    shaped.push({ slice_id: plan.selectedUnit.slice_id, created: plan.create, shaping_mode: plan.shapingMode,
      changed: plan.changedFields.length > 0 });
    if (plan.changedFields.length === 0) continue;
    const guard = guardWorkRecordReadySlicePersistedDiff(current, { ...plan.updatedRecord, updated: now() },
      { allowedPrefixes: plan.allowedPersistedPrefixes });
    if (!guard.ok) ownerRefusal(guard.diagnostic);
    current = guard.normalizedCandidate;
    changed.push(...plan.changedFields, "updated");
  }
  return { record: current, changed, ready_slices: shaped };
}

function planCriteria({ pkg, record, sliceId, changes, labels }) {
  const rows = changes.criteria ?? [];
  const removed = changes.remove?.criteria ?? [];
  if (rows.length + removed.length === 0) return { record, changed: [], moved: [] };
  const unit = selectUnit(record, sliceId);
  const before = acceptanceCriterionInventory(pkg, unit);
  const position = (identity, path) => {
    const found = before.find((entry) => entry.identity === identity);
    if (found === undefined) refuse("record_authoring_row_unknown", path,
      `${path} selects a saved criterion unavailable in the prospective unit`);
    return found.position;
  };
  const criteria = cloneJson(unit.acceptance.criteria);
  const appended = [];
  const submitted = new Map();
  rows.forEach((row, index) => {
    if (row.id === undefined) { const at = criteria.push(row.text) - 1; appended.push({ key: row.key, at }); submitted.set(at, index); return; }
    const at = position(row.id, `changes.criteria[${index}].target`);
    criteria[at] = typeof criteria[at] === "string" ? row.text : { ...criteria[at], text: row.text };
    submitted.set(at, index);
  });
  const dropped = new Set(removed.map((identity, index) => position(identity, `changes.remove.criteria[${index}]`)));
  const kept = criteria.map((entry, at) => ({ entry, at })).filter(({ at }) => !dropped.has(at));
  const plan = applied(applyWorkRecordContractEdit(record, { operation: "edit_work_record", sliceId,
    edit: { kind: "list", field: "acceptance.criteria", action: "replace", value: kept.map(({ entry }) => entry) } }),
  rows.length > 0 ? "changes.criteria" : "changes.remove.criteria", entry => {
    const match = /^edit\.value\[([0-9]+)\](.*)$/u.exec(entry.path ?? '');
    if (!match) return null;
    const original = kept[Number(match[1])]?.at, index = submitted.get(original);
    if (index !== undefined) return { path: `changes.criteria[${index}].text` };
    const criterion = criteria[original];
    const selection = { kind: 'criterion', match: typeof criterion === 'string' ? { text: criterion }
      : criterion?.typed_identity ? { typed_identity: criterion.typed_identity } : { text: criterion?.text } };
    return { path: rows.length ? 'changes.criteria' : 'changes.remove.criteria',
      subject: selection, attribution: 'retained_saved_criterion', constraint: { rule: entry.message } };
  });
  const after = acceptanceCriterionInventory(pkg, selectUnit(plan.updatedRecord, sliceId));
  for (const { key, at } of appended) labels.bind(key, after[kept.findIndex((entry) => entry.at === at)].identity);

  const moved = kept.flatMap(({ at }, index) => at < before.length && before[at].identity !== after[index].identity
    ? [{ prior: before[at].identity, current: after[index].identity }] : []);
  return { record: plan.updatedRecord, changed: plan.changedFields, moved };
}

function planLifecycle({ record, sliceId, changes, now }) {
  if (!Object.hasOwn(changes, "status") && !Object.hasOwn(changes, "closure")) return { record, changed: [] };
  const clone = cloneJson(record);
  const target = selectUnit(clone, sliceId);
  const prefix = sliceId === null ? "" : `slices[${sliceId}].`;
  const changed = [];
  if (Object.hasOwn(changes, "closure")) {
    const { issue } = validateClosurePatch(changes.closure);
    if (issue) refuse(issue.code, `changes.${issue.path}`, issue.message);
    const stored = target.sections?.closure ?? {};
    const next = { ...stored, ...cloneJson(changes.closure) };
    const keys = Object.keys(changes.closure).filter((key) => !jsonEqual(stored[key], next[key]));
    if (keys.length > 0) {
      target.sections = { ...target.sections, closure: next };
      changed.push(...keys.map((key) => `${prefix}sections.closure.${key}`));
    }
  }
  if (Object.hasOwn(changes, "status") && target.status !== changes.status) {
    target.status = changes.status;
    changed.push(`${prefix}status`);
  }
  if (changed.length === 0) return { record, changed };
  clone.updated = now();
  return { record: applied(finalizeEdit(clone, changed), Object.hasOwn(changes, "status")
    ? "changes.status" : "changes.closure").updatedRecord, changed: [...changed, "updated"] };
}

function planTasks({ record, sliceId, changes, now }) {
  const unit = sliceId === null ? { kind: "work_item", slice_id: null } : { kind: "slice", slice_id: sliceId };
  const changed = [];
  let current = record;
  (changes.tasks ?? []).forEach((edit, index) => {
    const path = `changes.tasks[${index}]`;
    const planned = planWorkRecordTaskEdit(current, unit, edit);
    if (planned.kind === "refusal") refuse(planned.code, planned.fieldPath === 'tasks' ? path : `${path}.${planned.fieldPath}`, planned.message);
    if (planned.kind === "selector_issue") refuse(planned.issue.code,
      ['text', 'index'].includes(planned.issue.path) ? `${path}.${planned.issue.path}` : path, planned.issue.message);
    if (planned.kind === "no_op") return;
    current = applied(finalizeEdit({ ...planned.updatedRecord, updated: now() }, [planned.changedField]), path)
      .updatedRecord;
    changed.push(planned.changedField, "updated");
  });
  return { record: current, changed };
}

async function planEntries({ captured, record, sliceId, changes, labels, repository, now, resolveExternalReference,
  externalCaptures }) {
  const changed = [];
  const versions = [];
  let current = record;

  const capturing = typeof resolveExternalReference !== "function" ? null : async (request) => {
    const resolved = await resolveExternalReference(request);
    if (resolved?.ok === true) externalCaptures.push({ request, text: resolved.text,
      provenance: JSON.stringify(resolved.provenance) });
    return resolved;
  };
  for (const [index, { key, id, ...entry }] of (changes.entries ?? []).entries()) {
    const path = `changes.entries[${index}]`;
    const refusedBy = (result) => { throw new PlanRefusal(result.diagnostics.map((item) => ({ ...item,
      severity: "error", owner_path: item.path ?? null, path: item.path ? `${path}.${item.path}` : path }))); };
    const invalid = validateWorkRecordEntryUpsertInput({ entryId: id, ...entry });
    if (invalid) refusedBy(invalid);
    const planned = await planWorkRecordEntryUpsert({ record: current, sourceDigest: captured.recordSourceDigest,
      parsed: { id: captured.wkId, slice: sliceId, address: sliceId === null ? captured.wkId : `${captured.wkId}#${sliceId}` },
      repository, dir: captured.repoRoot, entryId: id, ...entry, resolveExternalReference: capturing, now });
    if (planned.result?.no_op === true) {
      versions.push({ entry_id: planned.result.entry_id, version_id: planned.result.version_id, appended: false });
      continue;
    }
    if (planned.result) refusedBy(planned.result);
    current = planned.record;
    labels.bind(key, planned.targetEntry.id);
    versions.push({ entry_id: planned.targetEntry.id, version_id: planned.versionValue.id, appended: true });
    changed.push(`${sliceId === null ? "" : `slices[${sliceId}].`}sections.entries[${planned.targetEntry.id}]`, "updated");
  }
  return { record: current, changed, entries: versions };
}

function planDispositions({ record, sliceId, changes, labels }) {
  if (changes.dispositions === undefined) return { record, changed: [] };
  const planned = planWorkRecordDispositions({ record, sliceId, rows: changes.dispositions,
    resolveEntry: (reference, path) => labels.resolve(reference, ["entry"], path),
    bind: (key, id) => labels.bind(key, id) });
  if (!planned.ok) throw new PlanRefusal(planned.diagnostics);
  return { record: planned.record, changed: planned.changedFields };
}

async function semanticInput({ pkg, captured, record, changes, labels, selected, moved, requirementAuthoring }) {
  const retire = selected.retireClaimIds;
  const removeRows = selected.removeRowIds;

  let contractRequirements;
  let batch = null;
  if (changes.requirements !== undefined || retire.length > 0 || removeRows.length > 0) {
    try {
      batch = requireRequirementAuthoringOperation(requirementAuthoring, "prepareBatch")({ pkg, initial: { ...captured, record }, batch: selected.batch ?? {},
        removeRowIds: removeRows ?? [], retireClaimIds: retire ?? [], sourceText: record.sections?.user_requirements ?? null,
        selectionContext: selected.selectionContext });
    } catch (error) {
      await projectRequirementMutationFailure(error, captured, { captured, changes, rows: [], selections: selected });
      throw error;
    }
    contractRequirements = batch.answer;
    for (const row of batch.rows) {
      const key = row.key ?? changes.requirements.requirements?.[row.index].replacement_key;
      labels.bind(key, Object.freeze({ row_id: row.row_id, state: row.state, constraint_ids: row.constraint_ids, claim_ids: row.claim_ids }));
      labels.bind(row.verification_key, row.verification_claim_id);
    }
    for (const row of batch.collections) labels.bind(row.key, row.collection_row_id);
  }
  const localClaims = await resolveRecordAuthoringLocalClaims({ pkg, captured, record, unit: selectUnit(record, captured.selectedUnit),
    changes, batch, selections: selected, requirementAuthoring });

  const claimsOf = (entry, path) => {
    if (entry?.kind === 'claim' && typeof entry.requirement === 'string') {
      if (!localClaims.has(entry)) refuse('selection_unavailable', path,
        'The request-local assertion has no established prepared binding; no association was selected.');
      return [localClaims.get(entry)];
    }
    const resolved = labels.resolve(entry, ["requirement", "verification"], path);
    if (resolved === null || typeof resolved !== "object") return [resolved];
    if (resolved.claim_ids.length === 0) refuse("controlled_contract_requirement_association_population_empty", path,
      `${path} names ${entry}, a requirement row that emits no claim (${resolved.state === "complete" ? "a closed membership has no native claim" : "the row is incomplete"}); ` +
      "omit it from claims, or complete the row in this request");
    return resolved.claim_ids;
  };
  const nextObligation = allocator("OBL", captured.sources.flatMap((entry) =>
    (entry.source?.content.obligations ?? []).map((row) => row.obligation_id)));
  const nextCase = allocator("case", captured.cases.map((definition) => definition.case_id));
  const known = new Set(captured.rows.map((row) => row.obligation_id));
  const obligations = changes.obligations === undefined ? undefined : selected.obligations.map((row, index) => {
    const path = `changes.obligations[${index}]`;
    if (row.id !== undefined && !known.has(row.id)) refuse("record_authoring_row_unknown", `${path}.id`,
      `${path}.id names ${row.id}, which the selected unit does not have; a new obligation carries key`);
    const { key, id, criteria, claims, proof, case: authored, ...rest } = row;
    const obligationId = id ?? nextObligation();
    labels.bind(key, obligationId);
    const authoredCase = authored === undefined ? undefined : (({ key: caseKey, id: caseId, verification, ...body }) => {
      const allocated = caseKey === undefined ? caseId : nextCase();
      labels.bind(caseKey, allocated);
      return { ...(allocated === undefined ? {} : { case_id: allocated }),
        ...(verification === undefined ? {} : {
          verification_id: labels.resolve(verification, ["verification"], `${path}.case.verification`) }),
        ...body };
    })(authored);
    return { obligation_id: obligationId, ...rest,
      ...(criteria === undefined ? {} : { acceptance_criteria: criteria.map((entry, at) => {
        if (selected.removedCriteria.includes(entry)) throw new ControlledContractToolError(
          "record_authoring_criterion_removed", "This obligation selects a criterion removed by the same save.",
          { changed: false, field: `${path}.criteria[${at}]`, target: changes.obligations[index].criteria[at],
            correction: "Explicitly omit this association or preserve the selected criterion; no change was saved." });
        return typeof entry === "string" && entry.startsWith("$") ? labels.resolve(entry, ["criterion"], `${path}.criteria[${at}]`)
          : moved.find(change => change.prior === entry)?.current ?? entry;
      }) }),
      ...(claims === undefined ? {} : { controlled_contract_node_ids: [...new Set(claims.flatMap((entry, at) =>
        claimsOf(entry, `${path}.claims[${at}]`)))] }),
      ...(proof?.name === undefined ? {} : { proof_name: proof.name }),
      ...(proof?.parameters === undefined ? {} : { parameters: proof.parameters }),
      ...(proof?.clear_parameters === undefined ? {} : { clear_parameters: proof.clear_parameters }),
      ...(proof?.refresh === undefined ? {} : { refresh_proof_version: proof.refresh }),
      ...(authoredCase === undefined ? {} : { case: authoredCase }) };
  });
  return { batch, input: { ...(contractRequirements === undefined ? {} : { contractRequirements }),
    ...(obligations === undefined ? {} : { obligations }),
    ...(changes.controlled_acceptance === undefined ? {} : { controlledAcceptance: changes.controlled_acceptance }) } };
}

function declareLabels(changes, labels) {
  (changes.slices ?? []).forEach((row, index) => labels.declare(row.key, "slice", `changes.slices[${index}].key`));
  (changes.ready_slices ?? []).forEach((row, index) =>
    labels.declare(row.key, "slice", `changes.ready_slices[${index}].key`));
  (changes.criteria ?? []).forEach((row, index) => labels.declare(row.key, "criterion", `changes.criteria[${index}].key`));
  (changes.entries ?? []).forEach((row, index) => labels.declare(row.key, "entry", `changes.entries[${index}].key`));
  (changes.dispositions ?? []).forEach((row, index) =>
    labels.declare(row.key, "disposition", `changes.dispositions[${index}].key`));
  (changes.requirements?.requirements ?? []).forEach((row, index) => {
    labels.declare(row.key, "requirement", `changes.requirements.requirements[${index}].key`);
    labels.declare(row.replacement_key, 'requirement', `changes.requirements.requirements[${index}].replacement_key`);
    labels.declare(row.verification?.key, "verification", `changes.requirements.requirements[${index}].verification.key`);
  });
  (changes.requirements?.collections ?? []).forEach((row, index) =>
    labels.declare(row.key, "requirement_collection", `changes.requirements.collections[${index}].key`));
  (changes.obligations ?? []).forEach((row, index) => {
    labels.declare(row.key, "obligation", `changes.obligations[${index}].key`);
    labels.declare(row.case?.key, "case", `changes.obligations[${index}].case.key`);
  });
}

function settleChainedCandidate({ pkg, captured, prepared, preparation }) {
  const candidate = preparation.candidate;
  reconcileProofAuthoringCandidate({ pkg, captured, candidate });
  candidate.saved = prepared.reduce((total, step) => total + step.candidate.saved, 0);
  candidate.unchanged = prepared.reduce((total, step) => total + step.candidate.unchanged, 0);
  const checks = prepared.map((step) => step.assertDefinitions);
  preparation.assertDefinitions = async () => { for (const check of checks) await check(); };
}

function exceptionReceipt({ exception, captured, candidate }) {
  const { kind, action, subject } = exception;
  const described = describeRecordAuthoringException(kind);
  const affected = kind === "proof" ? ((row) => ({ obligation_id: row.obligation_id, statement: row.statement ?? null,
    claims: [...(row.controlled_contract_node_ids ?? [])],
    criteria: (row.acceptance_criteria ?? []).map((entry) => entry.identity),
    proof_selected: row.selection !== undefined, case_id: row.case_id ?? null }))(
    candidate.content.obligations.find((row) => row.obligation_id === subject))
    : kind === "grammar" ? ((entry) => {
      const { grammar_exception: _exception, ...meaning } = typeof entry === "string" ? { text: entry } : entry;
      return { ...meaning, specification: "incomplete", compiled: false };
    })(candidate.canonicalContract.authored_requirements.unresolved[exception.selectedUnresolved.internal.unresolved_index])
      : { unit: captured.wkId, disposition: action === "apply" ? "opted_out" : "required" };
  return Object.freeze({ kind, action, subject, affected,
    ...(action === "apply" ? { rationale: exception.rationale, ...RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE,
      consequence: described.consequence, ...(kind === "grammar" ? { enforcement: described.enforcement } : {}) }
      : { consequence: described.withdraw }) });
}

async function prepareWorkItemChange({ capturedSource: captured, changes, owners, exception = null }) {
  const { pkg, now, repository = null, resolveExternalReference = null, requirementAuthoring } = owners;
  const sliceId = captured.selectedUnit;
  const labels = labelNamespace();
  declareLabels(changes, labels);
  let record = captured.record;
  const selected = await resolveRecordAuthoringSelections({ captured, changes, exception });
  exception = selected.exception;
  const criterionChanges = { ...changes, criteria: selected.criteria,
    remove: { ...changes.remove, criteria: selected.removedCriteria } };
  const changed = [];
  let moved = [];
  let entries = [];
  let readySlices = [];
  const externalCaptures = [];
  for (const stage of [planSlices, planReadySlices, planOrdinaryMembers, planCriteria, planTasks, planEntries,
    planDispositions, planLifecycle]) {
    const result = await stage({ pkg, captured, record, sliceId, changes: stage === planCriteria ? criterionChanges : changes, labels, repository, now,
      resolveExternalReference, externalCaptures });
    record = result.record;
    changed.push(...result.changed);
    moved = result.moved ?? moved;
    entries = result.entries ?? entries;
    readySlices = result.ready_slices ?? readySlices;
  }

  const sources = [null, ...record.slices.map((slice) => slice.id)].map((id) =>
    captured.sources.find((entry) => entry.selectedUnit === id) ?? { selectedUnit: id, source: null });

  const removals = changes.remove?.obligations ?? [];
  const seen = new Set();
  removals.forEach(({ id }, index) => {
    if (seen.has(id)) refuse("record_authoring_row_duplicate", `changes.remove.obligations[${index}].id`,
      `changes.remove.obligations[${index}].id removes ${id} twice in one save`);
    seen.add(id);
  });

  const semantic = exception === null ? await semanticInput({ pkg, captured, record, changes, labels, selected, moved, requirementAuthoring })
    : { batch: null, input: { exception } };
  const steps = [...removals.map((removal) => ({ remove: true,
    input: { obligationId: removal.id, removalScope: removal.scope } })),
  { remove: false, input: changes.refresh_proofs === true ? { refreshProofs: true } : semantic.input }];
  let stepInitial = { ...captured, record, unit: selectUnit(record, sliceId), sources };
  let preparation;
  const prepared = [];
  for (const step of steps) {
    preparation = await prepareProofAuthoringMutation({ pkg, ...step, now, requirementAuthoring, initial: stepInitial,
      authoringContext: { captured, changes, rows: semantic.batch?.rows ?? [], selections: selected,
        submittedObligations: (semantic.input.obligations ?? []).map((row, index) => ({ index, obligation_id: row.obligation_id })) } });
    prepared.push(preparation);
    stepInitial = { ...prospectiveProofAuthoringSource(stepInitial, preparation.candidate),

      recordSourceDigest: captured.recordSourceDigest,
      rows: preparation.candidate.content?.obligations ?? [] };
  }
  if (prepared.length > 1) settleChainedCandidate({ pkg, captured, prepared, preparation });

  if (!jsonEqual(captured.record.proof_posture, preparation.candidate.record.proof_posture)) changed.push('proof_posture');

  if (externalCaptures.length > 0) {
    const assertDefinitions = preparation.assertDefinitions;
    let confirmed = false;
    preparation.assertDefinitions = async () => {
      await assertDefinitions();
      if (confirmed) return;
      for (const capture of externalCaptures) {
        const current = await resolveExternalReference(capture.request);
        if (current?.ok !== true || current.text !== capture.text ||
            JSON.stringify(current.provenance) !== capture.provenance) {
          throw Object.assign(new Error("a captured external reference source changed before publication"),
            { code: "work_record_external_reference_changed", details: { changed: false } });
        }
      }
      confirmed = true;
    };
  }
  if (changes.retained_graph_evidence !== undefined) {
    const resolve = owners.resolveRetainedGraphEvidence;
    if (typeof resolve !== "function") refuse("save_record_graph_source_unavailable",
      "changes.retained_graph_evidence", "The retained graph evidence producing owner is unavailable");
    const source = changes.retained_graph_evidence;
    const retained = await resolve(source);

    if (typeof retained?.evidence?.sha256 !== "string") refuse("save_record_graph_source_unavailable",
      "changes.retained_graph_evidence", "The retained graph evidence producing owner resolved no digest");
    const graph = await prepareRetainedGraphEvidence({ dir: captured.repoRoot,
      unitAddress: sliceId === null ? captured.wkId : `${captured.wkId}#${sliceId}`,
      priorRecord: captured.record, record: preparation.candidate.record,
      graphImpact: retained.answer, source: { ref_id: source.ref_id, sha256: retained.evidence.sha256 },
      capturedSource: captured });
    if (!graph.ok) throw new PlanRefusal(graph.diagnostics);
    preparation.candidate.record = graph.record;
    preparation.graphEvidenceContribution = graph.contribution;
    if (graph.no_op !== true) changed.push("derived_evidence");
    const capturedRetained = JSON.stringify(retained);
    const assertDefinitions = preparation.assertDefinitions;
    preparation.assertDefinitions = async () => {
      await assertDefinitions();
      if (JSON.stringify(await resolve(source)) !== capturedRetained) throw Object.assign(
        new Error("Retained graph source changed before publication"),
        { code: "work_record_graph_source_changed", details: { changed: false } });
    };
  }

  const compiled = preparation.contractInputs.requirementCompilation?.compiled ?? [];
  for (const row of semantic.batch?.rows ?? []) {
    const claimIds = [...new Set(row.requirement_indexes.map((index) => compiled[index]?.claim_id))];
    if (JSON.stringify(claimIds) !== JSON.stringify(row.claim_ids) ||
        (row.verification_claim_id !== undefined && compiled[row.requirement_indexes[0]]?.verification_claim_id !== row.verification_claim_id)) {
      throw new Error(`requirement row ${row.row_id} resolved differently across compilation passes`);
    }
  }
  if (semantic.batch !== null || prepared.some(step => step.contractInputs.contractChanged)) {
    const contract = preparation.contractInputs.contract;
    const descriptions = await prepareRequirementDescriptionSources({ repoRoot: captured.repoRoot,
      repository: repository ?? captured.record.repo, owner: controlledContractIdentityScope(captured.wkId, captured.focus),
      entities: requirementDescriptionEntities(contract, { unit: controlledContractIdentityScope(captured.wkId, captured.focus),
        previousContract: captured.contract?.content ?? null }) });
    preparation.requirementDescriptions = projectAuthoredRequirements(contract, { wkId: captured.wkId, focus: captured.focus,
      sourceText: record.sections?.user_requirements ?? null, sourceDescriptions: descriptions.descriptions,
      sourceGeneration: descriptions.source_generation });
    const assertDefinitions = preparation.assertDefinitions;
    preparation.assertDefinitions = async () => {
      await assertDefinitions();
      await descriptions.assertDefinitions();
    };
  }
  return { ok: true, record: preparation.candidate.record, preparation, bindings: labels.bindings(),
    requirement_rows: semantic.batch === null ? null : Object.freeze({
      rows: semantic.batch.rows.map(({ requirement_indexes: _indexes, index: _index, ...row }) => row),
      collections: semantic.batch.collections.map(({ index: _index, ...row }) => row),
      removed_row_ids: semantic.batch.removed_row_ids, removed_collection_row_ids: semantic.batch.removed_collection_row_ids,
      retired_claim_ids: semantic.batch.retire_claim_ids }),
    criterion_identity_changes: moved, entries, ready_slices: readySlices,
    ...(exception === null ? {} : { exception: exceptionReceipt({ exception, captured, candidate: preparation.candidate }) }),
    changed_fields: [...new Set(changed)],
    affected_units: preparation.candidate.sourceChanges.map((entry) => entry.selectedUnit),
    diagnostics: [] };
}

export function planKindRecordAuthoringChange({ record, changes, actor, now, context = "existing" }) {
  const invalid = validateRecordAuthoringChanges(record.record_kind, context, changes);
  if (invalid.length > 0) return { ok: false, updatedRecord: null, changedFields: [], diagnostics: [...invalid] };
  const provenance = { actor, now };
  let current = record;
  const changed = [];
  try {
    const step = (plan, path) => {
      const result = applied(plan, path);
      current = result.updatedRecord;
      changed.push(...result.changedFields);
    };
    for (const [field, value] of Object.entries(changes)) {
      if (field === "sections" || field === "status" || jsonEqual(current[field], value)) continue;
      step(setScalar({ record: current, field, value, ...provenance }), `changes.${field}`);
    }
    for (const [section, value] of Object.entries(changes.sections ?? {})) {
      if (jsonEqual(current.sections?.[section], value)) continue;
      step(setSection({ record: current, section, value, ...provenance }), `changes.sections.${section}`);
    }
    if (changes.status === "rejected" && current.status !== "rejected") {
      step(reject({ record: current, ...provenance }), "changes.status");
    }
  } catch (error) {
    if (!(error instanceof PlanRefusal)) throw error;
    return { ok: false, updatedRecord: null, changedFields: [], diagnostics: error.diagnostics };
  }
  return { ok: true, updatedRecord: current, changedFields: [...new Set(changed)], diagnostics: [] };
}

export async function inspectRecordAuthoringInitiative({ repoRoot, changes }) {
  if (typeof changes?.initiative !== 'string' || !/^IN-[0-9]{4}$/u.test(changes.initiative)) return [];
  const assignable = await inspectInitiativeAssignmentTarget({ targetDir: repoRoot, initiative: changes.initiative });
  return assignable.ok ? [] : assignable.diagnostics.map(entry => ({ ...entry,
    owner_path: entry.path ?? null, path: 'changes.initiative', correction: assignable.nextAction }));
}

export async function prepareRecordAuthoringException({ capturedSource, exception, owners }) {
  if (capturedSource.record.record_kind !== "work_item") return { ok: false, diagnostics: [diagnostic(
    RECORD_AUTHORING_EXCEPTION_CODES.UNIT_UNSUPPORTED, "unit",
    "an exception is recorded on a work item or one of its slices; this unit has no proof, grammar or controlled-acceptance exception")] };
  const invalid = validateRecordAuthoringException(exception);
  if (invalid.length > 0) return { ok: false, diagnostics: [...invalid] };
  if (exception.action === "apply" && normalizeControlledAcceptanceOptOutRationale(exception.rationale) === null) {
    return { ok: false, diagnostics: [diagnostic(RECORD_AUTHORING_EXCEPTION_CODES.INVALID, "exception.rationale",
      `exception.rationale must be trimmed, nonempty and at most ${CONTROLLED_ACCEPTANCE_OPT_OUT_RATIONALE_MAX_BYTES} UTF-8 bytes`)] };
  }
  if (exception.kind === "grammar" && !recordAuthoringAvailability(owners.registeredTier).grammar_exception) {
    return { ok: false, diagnostics: [recordAuthoringOperationDiagnostic("exception", "grammar_exception", "exception")] };
  }
  try {
    return await prepareWorkItemChange({ capturedSource, changes: {}, owners, exception });
  } catch (error) {
    if (!(error instanceof PlanRefusal)) throw error;
    return { ok: false, diagnostics: error.diagnostics };
  }
}

export async function prepareRecordAuthoringChange({ capturedSource, changes, context = "existing", owners }) {
  if (context === 'birth') await assertBirthProofAuthoringSource(capturedSource);
  const kind = capturedSource.record.record_kind;
  if (kind !== "work_item") {
    const plan = planKindRecordAuthoringChange({ record: capturedSource.record, changes, context,
      actor: owners.actor, now: owners.now() });
    return plan.ok ? { ok: true, record: plan.updatedRecord, preparation: null, bindings: {},
      criterion_identity_changes: [], entries: [], changed_fields: plan.changedFields, affected_units: [], diagnostics: [] }
      : { ok: false, diagnostics: plan.diagnostics };
  }

  const applicability = context === "existing" && (capturedSource.selectedUnit ?? null) !== null
    ? RECORD_AUTHORING_SLICE_CONTEXT : context;
  const invalid = validateRecordAuthoringChanges(kind, applicability, changes);
  if (invalid.length > 0) return { ok: false, diagnostics: [...invalid] };
  const tierRefusals = requirementAuthoringAvailabilityDiagnostics(changes, owners.registeredTier);
  if (tierRefusals.length > 0) return { ok: false, diagnostics: tierRefusals };
  if (context === 'birth') {
    const diagnostics = await inspectRecordAuthoringInitiative({ repoRoot: capturedSource.repoRoot, changes });
    if (diagnostics.length) return { ok: false, diagnostics };
  }
  try {
    return await prepareWorkItemChange({ capturedSource, changes, owners });
  } catch (error) {
    if (!(error instanceof PlanRefusal)) throw error;
    return { ok: false, diagnostics: error.diagnostics };
  }
}
