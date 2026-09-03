

import {
  escapeInlineCode,
  formatChildEntry,
  formatEscalationEntry,
  formatSliceEntry,
  isString,
  normalizeAgentNotes,
  renderBulletList,
  renderKeyValueBulletList,
  renderParagraph,
  renderSectionHeading,
  stringList
} from "./work-record-render-primitives.mjs";
import { analyzeWorkRecordFindingsUnit } from "./work-record-findings-semantics.mjs";
import {
  projectWorkRecordTestProofValidation,
  renderWorkRecordValidationEntry
} from "./work-record-test-proof-bindings.mjs";

function projectedValidation(unit) {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit: unit });
  return projection.status === "valid" ? projection.validation_entries : [];
}

function renderListSection(title, items, formatter) {
  return [
    renderSectionHeading(title),
    "",
    renderBulletList(items, {
      empty: "- None",
      formatter
    })
  ].join("\n");
}

function renderRecordIdentity(record) {
  const lines = [
    renderSectionHeading("Identity"),
    "",
    renderKeyValueBulletList([
      ["id", escapeInlineCode(record.id)],
      ["repo", escapeInlineCode(record.repo)],
      ["title", escapeInlineCode(record.title)],
      ["work kind", escapeInlineCode(record.work_kind)],
      ["status", escapeInlineCode(record.status)],
      ["priority", escapeInlineCode(record.priority)],
      record.initiative ? ["initiative", escapeInlineCode(record.initiative)] : null,
      record.area ? ["area", escapeInlineCode(record.area)] : null,
      record.resolution ? ["resolution", escapeInlineCode(record.resolution)] : null,
      record.severity ? ["severity", escapeInlineCode(record.severity)] : null
    ].filter(Boolean))
  ];
  return lines.join("\n");
}

function renderBriefScope(record) {
  return [
    renderListSection("Canonical Docs", stringList(record.docs), escapeInlineCode),
    "",
    renderListSection("Repo Paths", stringList(record.repo_paths), escapeInlineCode),
    "",
    renderListSection("Write Scope", stringList(record.write_scope), escapeInlineCode),
    "",
    renderListSection("Dependencies", stringList(record.depends_on), escapeInlineCode)
  ].join("\n");
}

function renderBriefAcceptance(record) {
  return [
    renderListSection("Acceptance Criteria", stringList(record.acceptance?.criteria), (entry) =>
      String(entry)
    ),
    "",
    renderListSection("Validation", projectedValidation(record), renderWorkRecordValidationEntry)
  ].join("\n");
}

function renderDispatchIntent(record) {
  const intent = record.dispatch_intent || {};
  return [
    renderSectionHeading("Dispatch Intent"),
    "",
    renderKeyValueBulletList([
      ["intended agent role", escapeInlineCode(intent.intended_agent_role ?? "(missing)")],
      ["target unit", escapeInlineCode(intent.target_unit ?? "(missing)")],
      ["requires graph impact", escapeInlineCode(intent.requires_graph_impact ?? false)],
      ["requires escalation", escapeInlineCode(intent.requires_escalation ?? false)]
    ])
  ].join("\n");
}

function renderChildrenBrief(record) {
  return renderListSection("Children", Array.isArray(record.children) ? record.children : [], (
    child
  ) => formatChildEntry(child));
}

function renderSlicesBrief(record, { sliceId = null } = {}) {
  const slices = Array.isArray(record.slices) ? record.slices : [];
  if (sliceId) {
    const selected = slices.find((slice) => String(slice.id) === String(sliceId));
    if (!selected) {
      return renderKeyValueBulletList([
        ["selected slice", `not found: ${escapeInlineCode(sliceId)}`]
      ]);
    }

    const selectedReviewPurpose =
      analyzeWorkRecordFindingsUnit(selected).effective_review_purpose;

    const sections = [
      renderSectionHeading("Selected Slice"),
      "",
      renderKeyValueBulletList([
        ["id", escapeInlineCode(selected.id)],
        ["title", escapeInlineCode(selected.title)],
        ["work kind", escapeInlineCode(selected.work_kind)],

        ...(selectedReviewPurpose === null
          ? []
          : [["review purpose", escapeInlineCode(selectedReviewPurpose)]]),
        ["status", escapeInlineCode(selected.status)],
        ["dispatch unit", escapeInlineCode(`${record.id}#${selected.id}`)]
      ]),
      "",
      renderListSection("Slice Docs", stringList(selected.docs), escapeInlineCode),
      "",
      renderListSection("Slice Repo Paths", stringList(selected.repo_paths), escapeInlineCode),
      "",
      renderListSection("Slice Write Scope", stringList(selected.write_scope), escapeInlineCode),
      "",
      renderListSection("Slice Dependencies", stringList(selected.depends_on), escapeInlineCode),
      "",
      renderListSection("Slice Acceptance Criteria", stringList(selected.acceptance?.criteria), (
        entry
      ) => String(entry)),
      "",
      renderListSection("Slice Validation", projectedValidation(selected),
        renderWorkRecordValidationEntry),
      "",
      renderDispatchIntent(selected)
    ];
    const sliceAgentNotes = normalizeAgentNotes(selected.sections?.agent_notes);
    if (sliceAgentNotes !== "") {
      sections.push(
        "",
        renderSectionHeading("Slice Agent Notes"),
        "",
        renderParagraph(sliceAgentNotes)
      );
    }
    return sections.join("\n");
  }

  return renderListSection("Slices", slices, (slice) => formatSliceEntry(slice));
}

function renderEscalationsBrief(record) {
  return renderListSection("Escalations", Array.isArray(record.escalations) ? record.escalations : [], (
    escalation
  ) => formatEscalationEntry(escalation));
}

function renderClosureBrief(record) {
  const closure = record.sections?.closure;
  if (!closure) {
    return [
      renderSectionHeading("Closure"),
      "",
      "- None"
    ].join("\n");
  }

  return [
    renderSectionHeading("Closure"),
    "",
    renderKeyValueBulletList([["summary", renderParagraph(closure.summary)]]),
    "",
    renderListSection("Closure Validation", stringList(closure.validation), (entry) =>
      String(entry)
    ),
    "",
    renderListSection("Closure Follow Ups", stringList(closure.follow_ups), (entry) => String(entry))
  ].join("\n");
}

function renderBriefGeneratedSource(metadata) {
  return [
    renderSectionHeading("Generated Source"),
    "",
    renderKeyValueBulletList([
      ["schema_version", escapeInlineCode(metadata.schema_version)],
      ["projection_id", escapeInlineCode(metadata.projection_id)],
      ["projection_kind", escapeInlineCode(metadata.projection_kind)],
      ["source_record_id", escapeInlineCode(metadata.source_record_id)],
      ["source_schema_version", escapeInlineCode(metadata.source_schema_version)],
      ["source_digest", escapeInlineCode(metadata.source_digest)],
      [
        "renderer",
        `${escapeInlineCode(metadata.renderer.name)} ${escapeInlineCode(metadata.renderer.version)}`
      ],
      ["generated_at", escapeInlineCode(metadata.generated_at)],
      metadata.output_path ? ["output_path", escapeInlineCode(metadata.output_path)] : null,
      ["authority", escapeInlineCode(metadata.authority)]
    ].filter(Boolean))
  ].join("\n");
}

export function createProjectionCompactionLists(record, kind, options = {}) {
  const sliceSelected = Boolean(options.sliceId);
  if (kind === "markdown") {
    return {
      omittedFields: ["origin", "migration", "projections"],
      compactedFields: [
        "sections.summary",
        "sections.why_it_matters",
        "sections.scope.items",
        "sections.scope.out_of_scope",
        "acceptance.criteria",
        "acceptance.validation",
        "sections.tasks",
        "children",
        "slices",
        "escalations",
        "docs",
        "repo_paths",
        "write_scope",
        "depends_on",
        "sections.closure"
      ]
    };
  }

  const baseOmitted = [
    "origin",
    "migration",
    "projections",
    "external_links",
    "links",
    "assignees",
    "agents",
    "reviewers",
    "target",
    "started",
    "completed",
    "superseded_by",
    "duplicate_of",
    "deprecated_by"
  ];

  if (sliceSelected) {
    return {
      omittedFields: [
        ...baseOmitted,
        "sections.summary",
        "sections.why_it_matters",
        "sections.scope.items",
        "sections.scope.out_of_scope",
        "children",
        "slices[siblings]",
        "sections.closure",
        "dispatch_intent[parent]"
      ],
      compactedFields: [
        "slices[selected]",
        "escalations[selected_slice]",
        "docs[inherited_when_slice_empty]",
        "repo_paths[inherited_when_slice_empty]",
        "write_scope[inherited_when_slice_empty]",
        "depends_on[inherited_when_slice_empty]",
        "acceptance.criteria[inherited_when_slice_empty]",
        "acceptance.validation[inherited_when_slice_empty]"
      ]
    };
  }

  return {
    omittedFields: baseOmitted,
    compactedFields: [
      "sections.summary",
      "sections.why_it_matters",
      "sections.scope.items",
      "sections.scope.out_of_scope",
      "acceptance.criteria",
      "acceptance.validation",
      "slices",
      "children",
      "escalations",
      "sections.closure"
    ]
  };
}

export function findSelectedSlice(record, sliceId) {
  if (!sliceId) {
    return null;
  }
  const slices = Array.isArray(record.slices) ? record.slices : [];
  return slices.find((slice) => String(slice?.id) === String(sliceId)) ?? null;
}

function escalationTargetsSlice(escalation, sliceId) {
  const scope = escalation?.scope || {};
  const target = String(sliceId);
  if (String(scope.slice_id ?? "") === target) {
    return true;
  }

  const unit = scope.unit;
  return isString(unit) && unit.endsWith(`#${target}`);
}

function renderSelectedSliceEscalations(record, sliceId) {
  const escalations = Array.isArray(record.escalations) ? record.escalations : [];
  const relevant = escalations.filter((escalation) => escalationTargetsSlice(escalation, sliceId));
  if (relevant.length > 0) {
    return renderListSection("Escalations", relevant, (escalation) =>
      formatEscalationEntry(escalation)
    );
  }

  const parentCount = escalations.length;
  const note =
    parentCount > 0
      ? `None scoped to this slice (${parentCount} parent-scope escalation(s) exist on ${escapeInlineCode(record.id)}; consult the canonical record if relevant)`
      : "None";
  return [renderSectionHeading("Escalations"), "", `- ${note}`].join("\n");
}

function renderInheritedParentContext(record, slice) {
  const sections = [];
  const inheritList = (sliceValue, parentValue, title, formatter = escapeInlineCode) => {
    if (stringList(sliceValue).length === 0 && stringList(parentValue).length > 0) {
      sections.push(
        "",
        renderListSection(`Inherited Parent ${title}`, stringList(parentValue), formatter)
      );
    }
  };

  inheritList(slice.docs, record.docs, "Canonical Docs");
  inheritList(slice.repo_paths, record.repo_paths, "Repo Paths");
  inheritList(slice.write_scope, record.write_scope, "Write Scope");
  inheritList(slice.depends_on, record.depends_on, "Dependencies");
  inheritList(
    slice.acceptance?.criteria,
    record.acceptance?.criteria,
    "Acceptance Criteria",
    (entry) => String(entry)
  );
  const sliceValidation = projectedValidation(slice);
  const parentValidation = projectedValidation(record);
  if (sliceValidation.length === 0 && parentValidation.length > 0) {
    sections.push(
      "",
      renderListSection("Inherited Parent Validation", parentValidation,
        renderWorkRecordValidationEntry)
    );
  }

  return sections;
}

function buildSelectedSliceBriefResult(record, metadata, slice) {
  const dispatchUnit = `${record.id}#${slice.id}`;
  const lines = [
    `# Agent Brief: ${record.title} — slice ${escapeInlineCode(slice.id)}`,
    "",
    "> Canonical authority is the JSON work record. This brief is a generated projection.",
    "> Scoped to the selected tracker-local slice; broad parent tracker context is intentionally omitted.",
    `> Dispatch unit: ${escapeInlineCode(dispatchUnit)}`,
    `> Source digest: ${escapeInlineCode(metadata.source_digest)}`,
    "",
    renderRecordIdentity(record),
    "",
    renderSlicesBrief(record, { sliceId: slice.id }),
    ...renderInheritedParentContext(record, slice),
    "",
    renderSelectedSliceEscalations(record, slice.id),
    "",
    renderBriefGeneratedSource(metadata)
  ];

  return {
    valid: true,
    diagnostics: [],
    projection: {
      ...metadata,
      brief: lines.join("\n")
    },
    brief: lines.join("\n")
  };
}

export function buildBriefProjectionResult(record, metadata, options = {}) {
  const sliceId = options.sliceId ?? null;
  const selectedSlice = findSelectedSlice(record, sliceId);
  if (sliceId && selectedSlice) {
    return buildSelectedSliceBriefResult(record, metadata, selectedSlice);
  }

  const lines = [
    `# Agent Brief: ${record.title}`,
    "",
    "> Canonical authority is the JSON work record. This brief is a generated projection.",
    `> Source digest: ${escapeInlineCode(metadata.source_digest)}`,
    "",
    renderRecordIdentity(record),
    "",
    renderListSection("Canonical Docs", stringList(record.docs), escapeInlineCode),
    "",
    renderListSection("Repo Paths", stringList(record.repo_paths), escapeInlineCode),
    "",
    renderListSection("Write Scope", stringList(record.write_scope), escapeInlineCode),
    "",
    renderListSection("Dependencies", stringList(record.depends_on), escapeInlineCode),
    "",
    renderBriefAcceptance(record),
    "",
    renderDispatchIntent(record),
    "",
    renderChildrenBrief(record),
    "",
    renderSlicesBrief(record, options),
    "",
    renderEscalationsBrief(record),
    "",
    renderClosureBrief(record),
    "",
    renderBriefGeneratedSource(metadata)
  ];

  return {
    valid: true,
    diagnostics: [],
    projection: {
      ...metadata,
      brief: lines.join("\n")
    },
    brief: lines.join("\n")
  };
}
