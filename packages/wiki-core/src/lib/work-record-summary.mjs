import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";
import {
  TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES,
  calculateSliceAgentNotesBytes,
  shouldSuppressTrackerSliceDetail
} from "./work-record-projection-helpers.mjs";

export const WORK_RECORD_SUMMARY_SCHEMA_VERSION = "work-record-summary.v1";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
    : [];
}

function summarizeAcceptance(acceptance) {
  if (!isObject(acceptance)) {
    return { criteria: [], validation: [] };
  }
  return {
    criteria: normalizeStringList(acceptance.criteria),
    validation: normalizeStringList(acceptance.validation)
  };
}

function summarizeDispatchIntent(dispatchIntent) {
  if (!isObject(dispatchIntent)) return null;
  return {
    intended_agent_role: dispatchIntent.intended_agent_role ?? null,
    target_unit: dispatchIntent.target_unit ?? null,
    requires_graph_impact: Boolean(dispatchIntent.requires_graph_impact),
    requires_escalation: Boolean(dispatchIntent.requires_escalation)
  };
}

function sliceAgentNotes(slice) {
  return cloneJson(slice?.sections?.agent_notes ?? null);
}

function summarizeSlice(slice, { includeAgentNotes = false } = {}) {
  if (!isObject(slice)) return null;
  const summary = {
    id: slice.id ?? null,
    title: slice.title ?? null,
    work_kind: slice.work_kind ?? null,
    status: slice.status ?? null,
    priority: slice.priority ?? null,
    owner: slice.owner ?? null,
    agent_notes_bytes: calculateSliceAgentNotesBytes(slice),
    depends_on: normalizeStringList(slice.depends_on),
    write_scope: normalizeStringList(slice.write_scope),
    docs: normalizeStringList(slice.docs),
    repo_paths: normalizeStringList(slice.repo_paths),
    acceptance: summarizeAcceptance(slice.acceptance),
    dispatch_intent: summarizeDispatchIntent(slice.dispatch_intent)
  };
  if (includeAgentNotes) {
    summary.agent_notes = sliceAgentNotes(slice);
  }
  return summary;
}

function summarizeSliceCompact(slice) {
  if (!isObject(slice)) return null;
  const blockers = collectSliceBlockers(slice);
  return {
    id: slice.id ?? null,
    title: slice.title ?? null,
    status: slice.status ?? null,
    work_kind: slice.work_kind ?? null,
    agent_notes_bytes: calculateSliceAgentNotesBytes(slice),
    blockers,
    next_action: summarizeNextAction({
      blockers,
      reviewState: null,
      validation: [],
      status: slice.status ?? null,
      workKind: slice.work_kind ?? null,
      unit: { kind: "slice" }
    })
  };
}

function isClosedStatus(status) {
  return status === "done" || status === "completed" || status === "cancelled";
}

function pickReviewState(record, sliceSummaries) {
  const reviewSlices = sliceSummaries.filter((entry) => entry && entry.work_kind === "review");
  if (reviewSlices.length === 0) {
    return {
      required: false,
      review_slices: [],
      status: null,
      blocked: false
    };
  }
  const allDone = reviewSlices.every((entry) => entry.status === "done" || entry.status === "completed");
  const anyOpen = reviewSlices.some(
    (entry) => entry.status && entry.status !== "done" && entry.status !== "completed"
  );
  return {
    required: true,
    review_slices: reviewSlices.map((entry) => ({
      id: entry.id,
      status: entry.status,
      owner: entry.owner
    })),
    status: allDone ? "complete" : anyOpen ? "open" : "unknown",
    blocked: !allDone
  };
}

function collectOwners(record, sliceSummaries) {
  const owners = new Set();
  if (typeof record.owner === "string" && record.owner.trim().length > 0) {
    owners.add(record.owner.trim());
  }
  for (const slice of sliceSummaries) {
    if (slice && typeof slice.owner === "string" && slice.owner.trim().length > 0) {
      owners.add(slice.owner.trim());
    }
  }
  return [...owners].sort();
}

function summarizeEscalation(escalation) {
  if (!isObject(escalation)) return null;
  return {
    id: escalation.id ?? null,
    kind: escalation.kind ?? null,
    status: escalation.status ?? null,
    reason: escalation.reason ?? escalation.summary ?? null,
    requested_by: escalation.requested_by ?? null,
    accepted_by: escalation.accepted_by ?? null
  };
}

function collectBlockers(record) {
  const blockers = [];
  const escalations = Array.isArray(record.escalations) ? record.escalations : [];
  for (const escalation of escalations) {
    const summary = summarizeEscalation(escalation);
    if (!summary) continue;
    if (summary.status && summary.status === "accepted") {
      blockers.push({ kind: "accepted_escalation", source: "escalations", entry: summary });
      continue;
    }
    if (summary.status && summary.status !== "rejected") {
      blockers.push({ kind: "open_escalation", source: "escalations", entry: summary });
    }
  }
  if (Array.isArray(record.depends_on)) {
    for (const dependency of record.depends_on) {
      if (typeof dependency === "string" && dependency.trim().length > 0) {
        blockers.push({ kind: "depends_on", source: "depends_on", entry: { id: dependency } });
      }
    }
  }
  return blockers;
}

function findSliceById(record, sliceId) {
  if (!sliceId) return null;
  if (!Array.isArray(record.slices)) return null;
  return record.slices.find((entry) => isObject(entry) && entry.id === sliceId) || null;
}

function parseUnitAddress(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pieces = trimmed.split("#");
  if (pieces.length > 2) return null;
  if (!/^WK-[0-9]{4}$/.test(pieces[0])) return null;
  if (pieces.length === 1) {
    return { kind: "work_item", address: pieces[0], record_id: pieces[0], slice_id: null };
  }
  const sliceId = pieces[1];
  if (!SLICE_ID_PATTERN.test(sliceId)) return null;
  return {
    kind: "slice",
    address: trimmed,
    record_id: pieces[0],
    slice_id: sliceId
  };
}

function summarizeNextAction({ blockers, reviewState, validation, status, workKind, unit }) {
  if (unit?.kind === "slice") {
    if (isClosedStatus(status)) {
      return "close out";
    }
    if (Array.isArray(blockers) && blockers.length > 0) {
      return "resolve blockers";
    }
    if (workKind === "review") {
      return "complete review";
    }
    return `continue ${workKind || "work"}`;
  }

  if (Array.isArray(blockers) && blockers.length > 0) {
    return "resolve blockers";
  }
  if (reviewState?.required && reviewState?.status !== "complete") {
    return "complete review";
  }
  if (Array.isArray(validation) && validation.length > 0) {
    return `run validation: ${validation[0]}`;
  }
  if (isClosedStatus(status)) {
    return "close out";
  }
  return "continue work";
}

function buildFullSummary(record, { unit = null, sliceSummaries = [] } = {}) {
  const summary = {
    schema_version: WORK_RECORD_SUMMARY_SCHEMA_VERSION,
    id: record.id ?? null,
    title: record.title ?? null,
    record_kind: record.record_kind ?? null,
    work_kind: record.work_kind ?? null,
    status: record.status ?? null,
    priority: record.priority ?? null,
    owner: record.owner ?? null,
    initiative: record.initiative ?? null,
    repo: record.repo ?? null,
    dependencies: {
      depends_on: normalizeStringList(record.depends_on),
      blocks: normalizeStringList(record.blocks),
      related: normalizeStringList(record.related)
    },
    write_scope: normalizeStringList(record.write_scope),
    docs: normalizeStringList(record.docs),
    repo_paths: normalizeStringList(record.repo_paths),
    acceptance: summarizeAcceptance(record.acceptance),
    dispatch_intent: summarizeDispatchIntent(record.dispatch_intent),
    slices: sliceSummaries,
    validation: summarizeAcceptance(record.acceptance).validation,
    owners: collectOwners(record, sliceSummaries),
    review_state: pickReviewState(record, sliceSummaries),
    blockers: collectBlockers(record),
    closure: cloneJson(record.sections?.closure ?? null)
  };

  if (unit && unit.kind === "slice") {
    const slice = findSliceById(record, unit.slice_id);
    summary.selected_unit_summary = slice
      ? summarizeSlice(slice, { includeAgentNotes: true })
      : null;
  }

  return summary;
}

function summarizeSliceStatusCounts(sliceSummaries) {
  const counts = {
    inbox: 0,
    todo: 0,
    active: 0,
    review: 0,
    blocked: 0,
    parked: 0,
    done: 0,
    cancelled: 0
  };
  for (const slice of sliceSummaries) {
    if (!slice) continue;
    const s = slice.status ?? "unknown";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

function buildCompactSliceProjection(record, slices) {
  const isTracker = record.work_kind === "tracker";
  const suppressedSlices = isTracker
    ? slices.filter((slice) => shouldSuppressTrackerSliceDetail(slice))
    : [];
  const includedSlices = isTracker
    ? slices.filter((slice) => !shouldSuppressTrackerSliceDetail(slice))
    : slices.filter((slice) => !isClosedStatus(slice.status));

  const projection = {
    slices: includedSlices.map(summarizeSliceCompact).filter(Boolean)
  };

  if (isTracker) {
    projection.slice_detail_omissions = {
      policy: "tracker_wk_level_compact_default",
      reason: "suppressed_by_status",
      statuses: [...TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES],
      count: suppressedSlices.length,
      by_status: summarizeSliceStatusCounts(suppressedSlices),
      detail_available_via: ["selected_slice", "include_full_summary"]
    };
  }

  return projection;
}

function collectSliceBlockers(slice) {
  if (!isObject(slice)) return [];
  const blockers = [];
  if (Array.isArray(slice.depends_on)) {
    for (const dep of slice.depends_on) {
      if (typeof dep === "string" && dep.trim()) {
        blockers.push({ kind: "depends_on", source: "depends_on", entry: { id: dep } });
      }
    }
  }
  return blockers;
}

function buildCompactSummary(record, { unit = null, sliceSummaries = [] } = {}) {
  const slices = Array.isArray(record.slices)
    ? record.slices.filter((entry) => isObject(entry))
    : [];
  const slice = unit?.kind === "slice" ? findSliceById(record, unit.slice_id) : null;
  const reviewStateFull = pickReviewState(record, sliceSummaries);
  const blockersFull = collectBlockers(record);
  const acceptance = summarizeAcceptance(record.acceptance);
  const validation = normalizeStringList(slice?.acceptance?.validation ?? record.acceptance?.validation);
  const nextActionBlockers = slice ? collectSliceBlockers(slice) : blockersFull;
  const nextAction = summarizeNextAction({
    blockers: nextActionBlockers,
    reviewState: reviewStateFull,
    validation,
    status: slice?.status ?? record.status ?? null,
    workKind: slice?.work_kind ?? record.work_kind ?? null,
    unit
  });
  const compactSliceProjection = buildCompactSliceProjection(record, slices);

  const summary = {
    schema_version: WORK_RECORD_SUMMARY_SCHEMA_VERSION,
    id: record.id ?? null,
    title: record.title ?? null,
    record_kind: record.record_kind ?? null,
    work_kind: record.work_kind ?? null,
    status: record.status ?? null,
    priority: record.priority ?? null,
    owner: record.owner ?? null,
    initiative: record.initiative ?? null,
    dependencies: {
      depends_on: normalizeStringList(record.depends_on),
      blocks: normalizeStringList(record.blocks),
      related: normalizeStringList(record.related)
    },
    write_scope: normalizeStringList(record.write_scope),
    acceptance,
    validation: acceptance.validation,
    slices: compactSliceProjection.slices,
    owners: collectOwners(record, sliceSummaries),
    review_state: reviewStateFull,
    blockers: blockersFull,
    slice_count: sliceSummaries.length,
    slice_status_counts: summarizeSliceStatusCounts(sliceSummaries)
  };
  if (compactSliceProjection.slice_detail_omissions) {
    summary.slice_detail_omissions = compactSliceProjection.slice_detail_omissions;
  }

  if (unit) {

    if (unit.kind === "slice" && !slice) {
      summary.selected_unit_summary = null;
      return summary;
    }
    if (unit.kind === "slice" && slice) {
      summary.selected_unit_summary = {
        id: slice.id ?? null,
        title: slice.title ?? null,
        work_kind: slice.work_kind ?? null,
        status: slice.status ?? null,
        priority: slice.priority ?? null,
        owner: slice.owner ?? null,
        agent_notes_bytes: calculateSliceAgentNotesBytes(slice),
        agent_notes: sliceAgentNotes(slice),
        write_scope_count: normalizeStringList(slice.write_scope).length,
        dispatch_intent: summarizeDispatchIntent(slice.dispatch_intent),
        blockers: collectSliceBlockers(slice),
        validation,
        validation_count: validation.length,
        next_action: nextAction
      };
    } else {
      summary.selected_unit_summary = {
        unit_address: unit.address ?? null,
        status: record.status ?? null,
        validation,
        validation_count: validation.length,
        next_action: nextAction
      };
    }
    return summary;
  }

  summary.validation_count = validation.length;
  summary.next_action = nextAction;
  return summary;
}

export function summarizeWorkRecord(
  record,
  { unit = null, verbose = false, include_full_summary = false } = {}
) {
  if (!isObject(record)) {
    throw new Error("summarizeWorkRecord requires a record object");
  }

  const sliceSummaries = Array.isArray(record.slices)
    ? record.slices.map(summarizeSlice).filter(Boolean)
    : [];

  if (verbose || include_full_summary) {
    return buildFullSummary(record, { unit, sliceSummaries });
  }

  return buildCompactSummary(record, { unit, sliceSummaries });
}

export function parseWorkRecordSummaryUnit(input) {
  return parseUnitAddress(input);
}
