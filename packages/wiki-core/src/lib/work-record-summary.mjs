import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";
import {
  TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES,
  calculateSliceAgentNotesBytes,
  shouldSuppressTrackerSliceDetail
} from "./work-record-projection-helpers.mjs";
import {
  projectSelectedWorkRecordUnit,
  selectedUnitProjectionProbe
} from "./work-record-selected-unit-projection.mjs";
import {
  evaluateWorkRecordParentLifecycleContract
} from "./work-record-parent-lifecycle-contract.mjs";
import {
  projectWorkRecordTestProofValidation,
  renderWorkRecordValidationEntry
} from "./work-record-test-proof-bindings.mjs";

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

export function normalizeStringList(value) {
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
  const validationProjection = projectWorkRecordTestProofValidation({
    selectedUnit: { acceptance }
  });
  return {
    criteria: normalizeStringList(acceptance.criteria),
    validation: validationProjection.status === "valid"
      ? cloneJson(validationProjection.validation_entries)
      : []
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

const REVIEW_PURPOSE_PROBE_FIELDS = Object.freeze(["work_kind", "review_purpose"]);

function sliceReviewPurpose(slice) {
  const projected = projectSelectedWorkRecordUnit(
    selectedUnitProjectionProbe(slice, REVIEW_PURPOSE_PROBE_FIELDS)
  );
  return projected && Object.hasOwn(projected, "review_purpose")
    ? projected.review_purpose
    : null;
}

function assignForwardedUnitFields(summary, slice) {
  const reviewPurpose = sliceReviewPurpose(slice);
  if (reviewPurpose !== null) summary.review_purpose = reviewPurpose;
  return summary;
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
  assignForwardedUnitFields(summary, slice);
  if (includeAgentNotes) {
    summary.agent_notes = sliceAgentNotes(slice);
  }
  return summary;
}

function summarizeSliceCompact(slice, record, dependencyResolver) {
  if (!isObject(slice)) return null;
  const blockers = collectSliceBlockers(record, slice, dependencyResolver);
  return assignForwardedUnitFields({
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
  }, slice);
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
    review_slices: reviewSlices.map((entry) => {
      const row = { id: entry.id, status: entry.status, owner: entry.owner };

      if (Object.hasOwn(entry, "review_purpose")) row.review_purpose = entry.review_purpose;
      return row;
    }),
    status: allDone ? "complete" : anyOpen ? "open" : "unknown",
    blocked: !allDone
  };
}

function hasImplementationWork(record) {
  if (record.work_kind === "implementation") return true;
  return Array.isArray(record.slices) &&
    record.slices.some((slice) => isObject(slice) && slice.work_kind === "implementation");
}

export function summarizeTerminalReviewDesignation(record) {
  const { terminal_review_designation: designation } =
    evaluateWorkRecordParentLifecycleContract(record);
  const eligible_count = designation.eligible_count;

  if (!isObject(record) || isClosedStatus(record.status) || !hasImplementationWork(record)) {
    return { state: "not_applicable", eligible_count };
  }
  if (eligible_count === 1) {
    return { state: "designated", eligible_count, unit_id: designation.unit.id ?? null };
  }
  return { state: eligible_count === 0 ? "missing" : "ambiguous", eligible_count };
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
    terminal_review_designation: summarizeTerminalReviewDesignation(record),
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

export const WORK_RECORD_READ_TOOLS = Object.freeze({
  SUMMARY: "workspace_work_record_summary",
  GET_RECORD: "workspace_get_record",
  READ_PAGE: "workspace_read_page"
});

export const WORK_RECORD_DETAIL_ROUTES = Object.freeze({
  UNIT: "unit",
  UNIT_AGENT_NOTES: "unit_agent_notes",
  SELECTED_SLICE: "selected_slice",
  SELECTED_RECORD: "selected_record",
  SLICE_ENUMERATION: "slice_enumeration"
});

const DETAIL_ROUTE_ORDER = Object.freeze([
  WORK_RECORD_DETAIL_ROUTES.UNIT,
  WORK_RECORD_DETAIL_ROUTES.UNIT_AGENT_NOTES,
  WORK_RECORD_DETAIL_ROUTES.SELECTED_SLICE,
  WORK_RECORD_DETAIL_ROUTES.SELECTED_RECORD,
  WORK_RECORD_DETAIL_ROUTES.SLICE_ENUMERATION
]);

const SLICE_ENUMERATION_SELECTOR_ARGUMENTS = Object.freeze([
  "slice_offset",
  "slice_limit",
  "slice_status",
  "expected_source_digest"
]);

export const WORK_RECORD_COMPACT_SMALL_RESPONSE_MAX_BYTES = 8192;
export const WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT = 25;
export const WORK_RECORD_SLICE_PAGE_MAX_LIMIT = 50;

const DETAIL_ROUTE_SUPPORT = Object.freeze({
  [WORK_RECORD_READ_TOOLS.SUMMARY]: Object.freeze({
    [WORK_RECORD_DETAIL_ROUTES.UNIT]: Object.freeze({
      resource_kinds: ["work_record"],
      reaches: "slices",
      selector_arguments: ["unit"],
      primary_selector: true
    }),

    [WORK_RECORD_DETAIL_ROUTES.UNIT_AGENT_NOTES]: Object.freeze({
      resource_kinds: ["work_record"],
      reaches: "agent_notes",
      selector_arguments: ["unit"],
      primary_selector: true
    }),
    [WORK_RECORD_DETAIL_ROUTES.SELECTED_RECORD]: Object.freeze({
      resource_kinds: ["work_record"],
      reaches: "record_fields",
      selector_arguments: ["selected_record"],
      primary_selector: false
    }),
    [WORK_RECORD_DETAIL_ROUTES.SLICE_ENUMERATION]: Object.freeze({
      resource_kinds: ["work_record"],
      reaches: "slices",
      selector_arguments: SLICE_ENUMERATION_SELECTOR_ARGUMENTS,
      primary_selector: false
    })
  }),
  [WORK_RECORD_READ_TOOLS.GET_RECORD]: Object.freeze({
    [WORK_RECORD_DETAIL_ROUTES.SELECTED_SLICE]: Object.freeze({
      resource_kinds: ["work_record"],
      reaches: "slices",
      selector_arguments: ["selected_slice"],
      primary_selector: false
    }),
    [WORK_RECORD_DETAIL_ROUTES.SLICE_ENUMERATION]: Object.freeze({
      resource_kinds: ["work_record"],
      reaches: "slices",
      selector_arguments: SLICE_ENUMERATION_SELECTOR_ARGUMENTS,
      primary_selector: false
    })
  }),
  [WORK_RECORD_READ_TOOLS.READ_PAGE]: Object.freeze({
    [WORK_RECORD_DETAIL_ROUTES.SELECTED_SLICE]: Object.freeze({
      resource_kinds: ["work_record", "graph_evidence"],
      reaches: "slices",
      selector_arguments: ["selected_slice"],
      primary_selector: false
    }),

    [WORK_RECORD_DETAIL_ROUTES.SELECTED_RECORD]: Object.freeze({
      resource_kinds: ["graph_evidence"],
      reaches: "record_entry",
      selector_arguments: ["selected_record"],
      primary_selector: false
    })
  })
});

export function workRecordDetailRouteSupported(tool, route) {
  return Boolean(DETAIL_ROUTE_SUPPORT[tool]?.[route]);
}

export function workRecordDetailSelectorSupported(tool, selectorArgument) {
  return Object.values(DETAIL_ROUTE_SUPPORT[tool] ?? {}).some((entry) =>
    entry.selector_arguments.includes(selectorArgument));
}

export function workRecordDetailSelectorArguments(tool) {
  const args = [];
  for (const route of DETAIL_ROUTE_ORDER) {
    const entry = DETAIL_ROUTE_SUPPORT[tool]?.[route];
    if (!entry || entry.primary_selector) continue;
    for (const argument of entry.selector_arguments) {
      if (!args.includes(argument)) args.push(argument);
    }
  }
  return args;
}

export function workRecordDetailRouteIsValid({ tool, route, resource } = {}) {
  const entry = DETAIL_ROUTE_SUPPORT[tool]?.[route];
  if (!entry) return false;
  const kind = resource?.kind ?? "work_record";
  if (!entry.resource_kinds.includes(kind)) return false;
  const withheld = resource?.withheld ?? {};
  const reachable = withheld[entry.reaches];
  return Number.isInteger(reachable) && reachable > 0;
}

export function workRecordDetailRoutesFor({ tool, resource } = {}) {
  return DETAIL_ROUTE_ORDER.filter((route) =>
    workRecordDetailRouteIsValid({ tool, route, resource }));
}

export const WORK_RECORD_COMPACT_READ_OMISSIONS_SCHEMA_VERSION =
  "work-record-compact-read-omissions.v1";

export const WORK_RECORD_LEVEL_CONTRACT_FIELDS = Object.freeze([
  Object.freeze({
    name: "write_scope",
    bucket: "write_scope",
    disclosure: "write_scope",
    authored: (record) => normalizeStringList(record?.write_scope)
  }),
  Object.freeze({
    name: "acceptance",
    bucket: "criteria",
    disclosure: "acceptance_criteria",
    authored: (record) => normalizeStringList(record?.acceptance?.criteria)
  }),
  Object.freeze({
    name: "validation",
    bucket: "validation",
    disclosure: "validation",
    authored: (record) => summarizeAcceptance(record?.acceptance).validation
  })
]);

export function workRecordLevelContractFieldsPresent(record) {
  if (!isObject(record)) return [...WORK_RECORD_LEVEL_CONTRACT_FIELDS];
  return WORK_RECORD_LEVEL_CONTRACT_FIELDS.filter(
    (field) => field.authored(record).length > 0
  );
}

function omissionFromSlices(slices, returnedIds) {
  const omitted = slices.filter(
    (slice) => !(typeof slice.id === "string" && returnedIds.has(slice.id))
  );
  return {
    total: slices.length,
    returned: slices.length - omitted.length,
    omitted_count: omitted.length,
    omitted: omitted.map((slice) => ({
      id: slice.id ?? null,
      status: slice.status ?? null,
      work_kind: slice.work_kind ?? null
    })),
    by_status: summarizeSliceStatusCounts(omitted)
  };
}

function omissionFromObservedCounts(observedTotal, returnedCount) {
  const total = Number.isInteger(observedTotal) && observedTotal >= 0
    ? observedTotal
    : returnedCount;
  return {
    total,
    returned: Math.min(returnedCount, total),
    omitted_count: Math.max(0, total - returnedCount),
    omitted: [],
    by_status: summarizeSliceStatusCounts([])
  };
}

export function projectWorkRecordCompactOmissions({
  record = null,
  returnedSliceIds = [],
  returnedReviewSliceIds = [],
  returnedSliceRows = [],
  returnedRecordFields = [],
  observedSliceTotal = null,
  observedReviewSliceTotal = null
} = {}) {
  const recordSlices = isObject(record) && Array.isArray(record.slices)
    ? record.slices.filter((entry) => isObject(entry))
    : null;
  const identitiesAvailable = recordSlices !== null;

  const returnedSlices = new Set(normalizeStringList(returnedSliceIds));
  const returnedReviewSlices = new Set(normalizeStringList(returnedReviewSliceIds));

  const slices = identitiesAvailable
    ? omissionFromSlices(recordSlices, returnedSlices)
    : omissionFromObservedCounts(observedSliceTotal, returnedSlices.size);
  const reviewSlices = identitiesAvailable
    ? omissionFromSlices(
        recordSlices.filter((slice) => slice.work_kind === "review"),
        returnedReviewSlices
      )
    : omissionFromObservedCounts(observedReviewSliceTotal, returnedReviewSlices.size);

  const rows = (Array.isArray(returnedSliceRows) ? returnedSliceRows : []).filter(isObject);
  const withheldNotes = rows.filter(
    (row) => Number(row.agent_notes_bytes ?? 0) > 0 && !Object.hasOwn(row, "agent_notes")
  );

  const returnedFieldNames = new Set(normalizeStringList(returnedRecordFields));
  const recordFields = workRecordLevelContractFieldsPresent(record);
  const omittedRecordFields = recordFields
    .filter((field) => !returnedFieldNames.has(field.name))
    .map((field) => field.name);

  return {
    schema_version: WORK_RECORD_COMPACT_READ_OMISSIONS_SCHEMA_VERSION,
    identities_available: identitiesAvailable,
    slices,
    review_slices: reviewSlices,
    agent_notes: {
      omitted_count: withheldNotes.length,
      omitted: withheldNotes
        .map((row) => (typeof row.id === "string" ? row.id : null))
        .filter((id) => id !== null)
    },
    record_fields: {
      total: recordFields.length,
      returned: recordFields.length - omittedRecordFields.length,
      omitted_count: omittedRecordFields.length,
      omitted: omittedRecordFields
    }
  };
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

    const omissions = projectWorkRecordCompactOmissions({
      record: { slices },
      returnedSliceIds: returnedSlices.map((slice) => slice.id)
    });
    projection.slice_detail_omissions = {
      policy: "tracker_wk_level_compact_default",
      reason: includedSlices.length > returnedSlices.length
        ? "suppressed_by_status_or_limit"
        : "suppressed_by_status",
      statuses: [...TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES],
      count: omissions.slices.omitted_count,
      by_status: omissions.slices.by_status,

      detail_available_via: workRecordDetailRoutesFor({
        tool: WORK_RECORD_READ_TOOLS.SUMMARY,
        resource: {
          kind: "work_record",
          withheld: {
            slices: omissions.slices.omitted_count,
            review_slices: 0,
            agent_notes: 0,
            record_fields: 0,
            record_entry: 0
          }
        }
      })
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
  const validation = summarizeAcceptance(
    slice?.acceptance ?? record.acceptance
  ).validation;
  const validationInstructions = validation.map((entry) =>
    renderWorkRecordValidationEntry(entry));
  const nextActionBlockers = slice
    ? collectSliceBlockers(record, slice, dependencyResolver)
    : blockersFull;
  const nextAction = summarizeNextAction({
    blockers: nextActionBlockers,
    reviewState: reviewStateFull,
    validation: validationInstructions,
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
    terminal_review_designation: summarizeTerminalReviewDesignation(record),
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
      summary.selected_unit_summary = assignForwardedUnitFields({
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
      }, slice);
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
