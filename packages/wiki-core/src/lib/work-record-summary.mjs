import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";
import {
  TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES,
  calculateSliceAgentNotesBytes,
  shouldSuppressTrackerSliceDetail
} from "./work-record-projection-helpers.mjs";

export const WORK_RECORD_SUMMARY_SCHEMA_VERSION = "work-record-summary.v1";

const COMPACT_COLLECTION_LIMIT = 3;
const COMPACT_BLOCKER_LIMIT = 2;
const COMPACT_NEXT_ACTION_DETAIL_LIMIT = 160;

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

function summarizeSliceCompact(slice, record, dependencyResolver) {
  if (!isObject(slice)) return null;
  const blockers = collectSliceBlockers(record, slice, dependencyResolver);
  return {
    id: slice.id ?? null,
    status: slice.status ?? null,
    work_kind: slice.work_kind ?? null,
    agent_notes_bytes: calculateSliceAgentNotesBytes(slice),
    blocker_count: blockers.length,
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
  const allDone = reviewSlices.every((entry) => isClosedStatus(entry.status));
  const anyOpen = reviewSlices.some((entry) => entry.status && !isClosedStatus(entry.status));
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

function boundedStringList(value, limit = COMPACT_COLLECTION_LIMIT) {
  const values = normalizeStringList(value);
  const items = values.slice(0, limit);
  return {
    items,
    total: values.length,
    returned: items.length,
    truncated: items.length < values.length
  };
}

function summarizeCompactDependencies(record) {
  const dependsOn = boundedStringList(record.depends_on);
  const blocks = boundedStringList(record.blocks);
  const related = boundedStringList(record.related);
  return {
    depends_on: dependsOn.items,
    depends_on_meta: {
      total: dependsOn.total,
      returned: dependsOn.returned,
      truncated: dependsOn.truncated
    },
    blocks: blocks.items,
    blocks_meta: {
      total: blocks.total,
      returned: blocks.returned,
      truncated: blocks.truncated
    },
    related: related.items,
    related_meta: {
      total: related.total,
      returned: related.returned,
      truncated: related.truncated
    }
  };
}

function summarizeCompactReviewState(reviewState) {
  const allReviewSlices = Array.isArray(reviewState?.review_slices)
    ? reviewState.review_slices
    : [];
  const openReviewSlices = allReviewSlices.filter((entry) => !isClosedStatus(entry?.status));
  const reviewSlices = openReviewSlices.slice(0, COMPACT_COLLECTION_LIMIT);
  return {
    required: Boolean(reviewState?.required),
    status: reviewState?.status ?? null,
    blocked: Boolean(reviewState?.blocked),
    review_slices: reviewSlices,
    review_slices_total: allReviewSlices.length,
    review_slices_returned: reviewSlices.length,
    review_slices_truncated: reviewSlices.length < allReviewSlices.length
  };
}

function summarizeCompactBlocker(blocker) {
  if (blocker?.kind === "depends_on") {
    return {
      kind: blocker.kind,
      source: blocker.source ?? null,
      resolution: blocker.resolution ?? null,
      entry: {
        id: blocker.entry?.id ?? null,
        marker: blocker.entry?.marker ?? null,
        selected_status: blocker.entry?.selected_status ?? null
      }
    };
  }
  const summary = { kind: blocker?.kind ?? null };
  if (blocker?.source != null) summary.source = blocker.source;
  if (blocker?.resolution != null) summary.resolution = blocker.resolution;
  if (blocker?.entry?.id != null) summary.id = blocker.entry.id;
  if (blocker?.entry?.status != null) summary.status = blocker.entry.status;
  if (blocker?.entry?.marker != null) summary.marker = blocker.entry.marker;
  if (blocker?.entry?.selected_status != null) {
    summary.selected_status = blocker.entry.selected_status;
  }
  return summary;
}

function summarizeCompactBlockers(blockers) {
  const allBlockers = Array.isArray(blockers) ? blockers : [];
  return allBlockers
    .slice(0, COMPACT_BLOCKER_LIMIT)
    .map(summarizeCompactBlocker);
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

function parseResolvedRecord(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return isObject(value) ? value : null;
}

function resolveDependency(record, dependency, resolver) {
  const parsed = parseUnitAddress(dependency);
  if (!parsed) return null;

  let resolvedRecord = null;
  if (parsed.record_id === record.id) {
    resolvedRecord = record;
  } else if (typeof resolver === "function") {
    try {
      resolvedRecord = parseResolvedRecord(resolver(dependency, parsed));
    } catch {
      return null;
    }
  }

  if (!resolvedRecord || resolvedRecord.id !== parsed.record_id) return null;
  if (parsed.slice_id) {
    const slice = findSliceById(resolvedRecord, parsed.slice_id);
    if (!slice) return null;
    return { status: slice.status ?? null };
  }
  return { status: resolvedRecord.status ?? null };
}

function dependencyBlocker(record, dependency, resolver) {
  const resolved = resolveDependency(record, dependency, resolver);
  if (resolved?.status === "done") return null;

  const resolution = resolved?.status === "cancelled" ? "cancelled" :
    resolved ? "unsatisfied_open" : "unresolved";
  const marker = resolution === "unsatisfied_open" ? "unsatisfied" : resolution;
  return {
    kind: "depends_on",
    source: "depends_on",
    resolution,
    entry: {
      id: dependency,
      marker,
      selected_status: resolved?.status ?? null
    }
  };
}

function collectBlockers(record, { dependencyResolver = null } = {}) {
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
        const blocker = dependencyBlocker(record, dependency.trim(), dependencyResolver);
        if (blocker) blockers.push(blocker);
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

  if (isClosedStatus(status)) {
    return "close out";
  }
  if (Array.isArray(blockers) && blockers.length > 0) {
    return "resolve blockers";
  }
  if (reviewState?.required && reviewState?.status !== "complete") {
    return "complete review";
  }
  if (Array.isArray(validation) && validation.length > 0) {
    return validation[0].length <= COMPACT_NEXT_ACTION_DETAIL_LIMIT
      ? `run validation: ${validation[0]}`
      : "run validation (details available via full summary)";
  }
  return "continue work";
}

function buildFullSummary(
  record,
  { unit = null, sliceSummaries = [], dependencyResolver = null } = {}
) {
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
    blockers: collectBlockers(record, { dependencyResolver }),
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
  counts.unknown = 0;
  for (const slice of sliceSummaries) {
    if (!slice) continue;
    const s = slice.status ?? "unknown";
    if (Object.hasOwn(counts, s)) counts[s] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function buildCompactSliceProjection(record, slices, dependencyResolver) {
  const isTracker = record.work_kind === "tracker";
  const includedSlices = isTracker
    ? slices.filter((slice) => !shouldSuppressTrackerSliceDetail(slice))
    : slices.filter((slice) => !isClosedStatus(slice.status));

  const returnedSlices = includedSlices.slice(0, COMPACT_COLLECTION_LIMIT);
  const projection = {
    slices: returnedSlices
      .map((slice) => summarizeSliceCompact(slice, record, dependencyResolver))
      .filter(Boolean),
    total: slices.length,
    returned: returnedSlices.length,
    truncated: returnedSlices.length < slices.length
  };

  if (isTracker) {
    const omittedSlices = slices.filter((slice) => !returnedSlices.includes(slice));
    projection.slice_detail_omissions = {
      policy: "tracker_wk_level_compact_default",
      reason: includedSlices.length > returnedSlices.length
        ? "suppressed_by_status_or_limit"
        : "suppressed_by_status",
      statuses: [...TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES],
      count: omittedSlices.length,
      by_status: summarizeSliceStatusCounts(omittedSlices),
      detail_available_via: ["selected_slice", "include_full_summary"]
    };
  }

  return projection;
}

function collectSliceBlockers(record, slice, dependencyResolver = null) {
  if (!isObject(record) || !isObject(slice)) return [];
  const blockers = [];
  if (Array.isArray(slice.depends_on)) {
    for (const dep of slice.depends_on) {
      if (typeof dep === "string" && dep.trim()) {
        const dependency = dep.trim();
        const address = SLICE_ID_PATTERN.test(dependency)
          ? `${record.id}#${dependency}`
          : dependency;
        const blocker = dependencyBlocker(record, address, dependencyResolver);
        if (blocker) {
          blocker.entry.id = dependency;
          blockers.push(blocker);
        }
      }
    }
  }
  return blockers;
}

function buildCompactSummary(
  record,
  { unit = null, sliceSummaries = [], dependencyResolver = null } = {}
) {
  const slices = Array.isArray(record.slices)
    ? record.slices.filter((entry) => isObject(entry))
    : [];
  const slice = unit?.kind === "slice" ? findSliceById(record, unit.slice_id) : null;
  const reviewStateFull = pickReviewState(record, sliceSummaries);
  const blockersFull = collectBlockers(record, { dependencyResolver });
  const validation = normalizeStringList(slice?.acceptance?.validation ?? record.acceptance?.validation);
  const nextActionBlockers = slice
    ? collectSliceBlockers(record, slice, dependencyResolver)
    : blockersFull;
  const nextAction = summarizeNextAction({
    blockers: nextActionBlockers,
    reviewState: reviewStateFull,
    validation,
    status: slice?.status ?? record.status ?? null,
    workKind: slice?.work_kind ?? record.work_kind ?? null,
    unit
  });
  const compactSliceProjection = buildCompactSliceProjection(record, slices, dependencyResolver);

  const blockers = summarizeCompactBlockers(blockersFull);
  const reviewState = summarizeCompactReviewState(reviewStateFull);

  const summary = {
    schema_version: WORK_RECORD_SUMMARY_SCHEMA_VERSION,
    id: record.id ?? null,
    title: record.title ?? null,
    work_kind: record.work_kind ?? null,
    status: record.status ?? null,
    owner: record.owner ?? null,
    dependencies: summarizeCompactDependencies(record),
    slices: compactSliceProjection.slices,
    slices_total: compactSliceProjection.total,
    slices_returned: compactSliceProjection.returned,
    slices_truncated: compactSliceProjection.truncated,
    review_state: reviewState,
    blockers,
    blockers_total: blockersFull.length,
    blockers_returned: blockers.length,
    blockers_truncated: blockers.length < blockersFull.length,
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
        blockers: collectSliceBlockers(record, slice, dependencyResolver),
        validation,
        validation_count: validation.length,
        next_action: nextAction
      };
    } else {
      summary.selected_unit_summary = {
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
  {
    unit = null,
    verbose = false,
    include_full_summary = false,
    dependencyResolver = null,
    resolveDependency: resolverAlias = null
  } = {}
) {
  if (!isObject(record)) {
    throw new Error("summarizeWorkRecord requires a record object");
  }

  const sliceSummaries = Array.isArray(record.slices)
    ? record.slices.map(summarizeSlice).filter(Boolean)
    : [];

  const resolver = dependencyResolver ?? resolverAlias;
  if (verbose || include_full_summary) {
    return buildFullSummary(record, { unit, sliceSummaries, dependencyResolver: resolver });
  }

  return buildCompactSummary(record, { unit, sliceSummaries, dependencyResolver: resolver });
}

export function parseWorkRecordSummaryUnit(input) {
  return parseUnitAddress(input);
}
