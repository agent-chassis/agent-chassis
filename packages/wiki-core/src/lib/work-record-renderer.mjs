import path from "node:path";
import {
  computeWorkRecordSourceDigest,
  WORK_RECORD_PROJECTION_AUTHORITY,
  WORK_RECORD_PROJECTION_KIND_VALUES,
  WORK_RECORD_RENDER_SCHEMA_VERSION,
  WORK_RECORD_SCHEMA_VERSION
} from "./work-record-schema.mjs";

export const WORK_RECORD_RENDERER_NAME = "agent-chassis";
export const WORK_RECORD_RENDERER_VERSION = "0.2.0";

export const WORK_RECORD_RENDER_DIAGNOSTIC_CODES = Object.freeze([
  "invalid_projection_record",
  "missing_source_digest",
  "stale_projection",
  "projection_authority_violation",
  "unsupported_projection_kind",
  "unsupported_record_kind",
  "source_record_missing",
  "missing_output_path"
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

function escapeInlineCode(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function isSimpleYamlScalar(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value);
}

function renderYamlScalar(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return isSimpleYamlScalar(value) ? value : JSON.stringify(value);
  }
  if (Array.isArray(value) || isObject(value)) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function renderYamlValue(value, indentLevel = 0) {
  const indent = " ".repeat(indentLevel);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}[]`;
    }
    return value
      .map((entry) => {
        if (Array.isArray(entry) || isObject(entry)) {
          const nested = renderYamlValue(entry, indentLevel + 2).split("\n");
          return `${indent}- ${nested[0].trimStart()}\n${nested.slice(1).join("\n")}`;
        }
        return `${indent}- ${renderYamlScalar(entry)}`;
      })
      .join("\n");
  }

  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `${indent}{}`;
    }
    return keys
      .map((key) => {
        const nestedValue = value[key];
        if (Array.isArray(nestedValue) || isObject(nestedValue)) {
          const rendered = renderYamlValue(nestedValue, indentLevel + 2);
          return `${indent}${key}:\n${rendered}`;
        }
        return `${indent}${key}: ${renderYamlScalar(nestedValue)}`;
      })
      .join("\n");
  }

  return `${indent}${renderYamlScalar(value)}`;
}

function renderYamlLine(key, value) {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return `${key}:`;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? `${key}: []` : `${key}:\n${renderYamlValue(value, 2)}`;
  }
  if (isObject(value)) {
    return Object.keys(value).length === 0 ? `${key}: {}` : `${key}:\n${renderYamlValue(value, 2)}`;
  }
  return `${key}: ${renderYamlScalar(value)}`;
}

function renderFrontmatter(entries) {
  return Object.entries(entries)
    .map(([key, value]) => renderYamlLine(key, value))
    .filter((line) => line !== null)
    .join("\n");
}

function renderSectionHeading(title) {
  return `## ${title}`;
}

function renderParagraph(text) {
  const normalized = String(text ?? "").trim();
  return normalized ? normalized : "- None";
}

function renderBulletList(items, { empty = "- None", formatter = (value) => String(value) } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

function renderKeyValueBulletList(pairs, { empty = "- None" } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return empty;
  }
  return pairs.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => isString(entry)) : [];
}

function normalizeAgentNotes(value) {
  return Array.isArray(value) ? value.join("\n") : isString(value) ? value : "";
}

function formatRecordId(record) {
  return escapeInlineCode(record?.id || "(missing)");
}

function formatRepoPath(value) {
  return escapeInlineCode(value);
}

function formatValidationCommand(value) {
  return escapeInlineCode(value);
}

function formatFieldList(value) {
  return renderBulletList(stringList(value), {
    empty: "- None",
    formatter: (entry) => escapeInlineCode(entry)
  });
}

function formatTaskList(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return "- None";
  }

  return tasks
    .map((task) => {
      const checked = task?.status === "done" ? "x" : " ";
      return `- [${checked}] ${String(task?.text ?? "").trim() || "(missing)"}`;
    })
    .join("\n");
}

function formatScopeBlock(scope, { title }) {
  const items = stringList(scope?.items);
  const outOfScope = stringList(scope?.out_of_scope);

  return [
    renderSectionHeading(title),
    "",
    "### In Scope",
    "",
    renderBulletList(items, {
      empty: "- None",
      formatter: (entry) => String(entry)
    }),
    "",
    "### Out of Scope",
    "",
    renderBulletList(outOfScope, {
      empty: "- None",
      formatter: (entry) => String(entry)
    })
  ].join("\n");
}

function formatChildEntry(child, { selected = false } = {}) {
  const parts = [
    `${formatRecordId(child)}: ${String(child?.title ?? "(missing)")}`
  ];
  if (child?.relation) {
    parts.push(`relation: ${escapeInlineCode(child.relation)}`);
  }
  if (child?.work_kind) {
    parts.push(`work kind: ${escapeInlineCode(child.work_kind)}`);
  }
  if (child?.status) {
    parts.push(`status: ${escapeInlineCode(child.status)}`);
  }
  if (child?.dispatch_unit_ref) {
    parts.push(`dispatch unit: ${escapeInlineCode(child.dispatch_unit_ref)}`);
  }
  if (selected) {
    parts.push("selected: true");
  }
  return `- ${parts.join(", ")}`;
}

function formatSliceEntry(slice, { selected = false } = {}) {
  const dispatchUnit = selected ? `${escapeInlineCode(slice?.id || "(missing)")}` : null;
  const agentNotes = normalizeAgentNotes(slice?.sections?.agent_notes);
  const details = [
    `${escapeInlineCode(slice?.id || "(missing)")}: ${String(slice?.title ?? "(missing)")}`,
    slice?.work_kind ? `work kind: ${escapeInlineCode(slice.work_kind)}` : null,
    slice?.status ? `status: ${escapeInlineCode(slice.status)}` : null,
    dispatchUnit ? `dispatch unit: ${dispatchUnit}` : null,
    agentNotes !== "" ? "agent notes: yes" : null
  ].filter(Boolean);
  return `- ${details.join(", ")}`;
}

function formatEscalationEntry(escalation) {
  const parts = [
    `${escapeInlineCode(escalation?.id || "(missing)")}: ${String(escalation?.kind ?? "(missing)")}`,
    escalation?.status ? `status: ${escapeInlineCode(escalation.status)}` : null
  ].filter(Boolean);

  const lines = [parts.join(", ")];
  const scope = escalation?.scope || {};
  lines.push(
    `  - scope unit: ${escapeInlineCode(scope.unit || "(missing)")}`,
    `  - slice id: ${scope.slice_id === null ? "null" : escapeInlineCode(scope.slice_id || "")}`,
    `  - write scope:`,
    ...stringList(scope.write_scope).map((entry) => `    - ${escapeInlineCode(entry)}`),
    scope.max_blast_radius
      ? `  - max blast radius: ${escapeInlineCode(scope.max_blast_radius)}`
      : "  - max blast radius: -"
  );
  if (escalation?.reason) {
    lines.push(`  - reason: ${String(escalation.reason)}`);
  }
  if (escalation?.accepted_by) {
    lines.push(
      `  - accepted by: ${escapeInlineCode(escalation.accepted_by.actor || "(missing)")}, ${escapeInlineCode(escalation.accepted_by.id || "(missing)")}, source: ${escapeInlineCode(escalation.accepted_by.source || "(missing)")}`
    );
  }
  if (escalation?.accepted_at) {
    lines.push(`  - accepted at: ${escapeInlineCode(escalation.accepted_at)}`);
  }
  if (escalation?.expires_at) {
    lines.push(`  - expires at: ${escapeInlineCode(escalation.expires_at)}`);
  }
  if (escalation?.authority_ref) {
    lines.push(`  - authority ref: ${escapeInlineCode(escalation.authority_ref)}`);
  }
  if (escalation?.provenance) {
    lines.push(
      `  - provenance: source kind ${escapeInlineCode(escalation.provenance.source_kind || "(missing)")}, canonicality ${escapeInlineCode(escalation.provenance.canonicality || "(missing)")}, evidence basis ${escapeInlineCode(escalation.provenance.evidence_basis || "(missing)")}`
    );
  }
  return lines.join("\n");
}

function formatClosureSection(closure) {
  if (!closure) {
    return "- None";
  }

  const lines = [`- summary: ${renderParagraph(closure.summary)}`];
  lines.push("  - validation:");
  lines.push(
    ...renderBulletList(stringList(closure.validation), {
      empty: "- None",
      formatter: (entry) => String(entry)
    })
      .split("\n")
      .map((line) => `    ${line}`)
  );
  lines.push("  - follow ups:");
  lines.push(
    ...renderBulletList(stringList(closure.follow_ups), {
      empty: "- None",
      formatter: (entry) => String(entry)
    })
      .split("\n")
      .map((line) => `    ${line}`)
  );
  return lines.join("\n");
}

function buildProjectionId(recordId, projectionKind, sliceId = null) {
  return sliceId ? `${recordId}.${sliceId}.${projectionKind}` : `${recordId}.${projectionKind}`;
}

function buildProjectionMetadata(record, projectionKind, options = {}) {
  const {
    generatedAt = new Date().toISOString(),
    outputPath,
    omittedFields = [],
    compactedFields = [],
    sliceId = null
  } = options;

  const metadata = {
    schema_version: WORK_RECORD_RENDER_SCHEMA_VERSION,
    projection_id: buildProjectionId(record.id, projectionKind, sliceId),
    projection_kind: projectionKind,
    source_record_id: record.id,
    source_schema_version: WORK_RECORD_SCHEMA_VERSION,
    source_digest: computeWorkRecordSourceDigest(record),
    renderer: {
      name: WORK_RECORD_RENDERER_NAME,
      version: WORK_RECORD_RENDERER_VERSION
    },
    generated_at: generatedAt,
    omitted_fields: omittedFields,
    compacted_fields: compactedFields,
    authority: WORK_RECORD_PROJECTION_AUTHORITY
  };

  if (outputPath !== undefined) {
    metadata.output_path = outputPath;
  }

  return metadata;
}

function renderGeneratedSource(metadata) {
  const lines = [
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
  ];

  return lines.join("\n");
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

function renderWorkRecordMarkdownBody(record, metadata) {
  const sections = [
    renderSectionHeading("Summary"),
    "",
    renderParagraph(record.sections?.summary),
    "",
    renderSectionHeading("Why It Matters"),
    "",
    renderParagraph(record.sections?.why_it_matters),
    "",
    formatScopeBlock(record.sections?.scope, { title: "Scope" }),
    "",
    renderSectionHeading("Acceptance Criteria"),
    "",
    renderBulletList(stringList(record.acceptance?.criteria), {
      empty: "- None",
      formatter: (entry) => String(entry)
    }),
    "",
    renderSectionHeading("Validation"),
    "",
    renderBulletList(stringList(record.acceptance?.validation), {
      empty: "- None",
      formatter: (entry) => formatValidationCommand(entry)
    }),
    "",
    renderSectionHeading("Tasks"),
    "",
    formatTaskList(record.sections?.tasks),
    "",
    renderSectionHeading("Children"),
    "",
    renderBulletList(Array.isArray(record.children) ? record.children : [], {
      empty: "- None",
      formatter: (child) => formatChildEntry(child)
    }),
    "",
    renderSectionHeading("Slices"),
    "",
    renderBulletList(Array.isArray(record.slices) ? record.slices : [], {
      empty: "- None",
      formatter: (slice) => formatSliceEntry(slice)
    }),
    "",
    renderSectionHeading("Escalations"),
    "",
    renderBulletList(Array.isArray(record.escalations) ? record.escalations : [], {
      empty: "- None",
      formatter: (escalation) => formatEscalationEntry(escalation)
    }),
    "",
    renderSectionHeading("References"),
    "",
    renderBulletList(stringList(record.sections?.references), {
      empty: "- None",
      formatter: (entry) => String(entry)
    }),
    "",
    renderSectionHeading("Canonical Docs"),
    "",
    formatFieldList(record.docs),
    "",
    renderSectionHeading("Repo Paths"),
    "",
    formatFieldList(record.repo_paths),
    "",
    renderSectionHeading("Write Scope"),
    "",
    formatFieldList(record.write_scope),
    "",
    renderSectionHeading("Dependencies"),
    "",
    formatFieldList(record.depends_on),
    "",
    renderSectionHeading("Agent Notes"),
    "",
    renderParagraph(record.sections?.agent_notes),
    "",
    renderSectionHeading("Closure"),
    "",
    formatClosureSection(record.sections?.closure),
    "",
    renderGeneratedSource(metadata)
  ];

  return sections.join("\n");
}

function renderWorkRecordMarkdownFrontmatter(record, metadata) {
  return renderFrontmatter({
    id: record.id,
    title: record.title,
    type: "task",
    status: record.status,
    priority: record.priority,
    owner: record.owner,
    created: record.created,
    updated: record.updated,
    resolution: record.resolution ?? null,
    severity: record.severity ?? null,
    area: record.area ?? null,
    initiative: record.initiative ?? null,
    tags: Array.isArray(record.tags) ? record.tags : [],
    origin: record.origin && Object.keys(record.origin).length > 0 ? record.origin : {},
    migration: record.migration && Object.keys(record.migration).length > 0 ? record.migration : {},
    repo_paths: Array.isArray(record.repo_paths) ? record.repo_paths : [],
    docs: Array.isArray(record.docs) ? record.docs : [],
    external_links: Array.isArray(record.external_links) ? record.external_links : [],
    links: Array.isArray(record.links) ? record.links : [],
    depends_on: Array.isArray(record.depends_on) ? record.depends_on : [],
    blocks: Array.isArray(record.blocks) ? record.blocks : [],
    related: Array.isArray(record.related) ? record.related : [],
    write_scope: Array.isArray(record.write_scope) ? record.write_scope : [],
    assignees: Array.isArray(record.assignees) ? record.assignees : [],
    agents: Array.isArray(record.agents) ? record.agents : [],
    reviewers: Array.isArray(record.reviewers) ? record.reviewers : [],
    target: record.target ?? null,
    started: record.started ?? null,
    completed: record.completed ?? null,
    superseded_by: record.superseded_by ?? null,
    duplicate_of: record.duplicate_of ?? null,
    deprecated_by: record.deprecated_by ?? null
  });
}

function buildMarkdownProjectionResult(record, metadata, { diagnostics = [] } = {}) {
  const frontmatter = renderWorkRecordMarkdownFrontmatter(record, metadata);
  const markdown = [
    "---",
    frontmatter,
    "# Retrieval facets are inferred from path/template by default.",
    "# Add overrides only when needed:",
    "# lifecycle: active",
    "# retrieval_visibility: support",
    "# topics: []",
    "---",
    "",
    `# ${record.title}`,
    "",
    renderWorkRecordMarkdownBody(record, metadata)
  ].join("\n");

  return {
    valid: diagnostics.every((entry) => entry.severity !== "error"),
    diagnostics,
    projection: {
      ...metadata,
      markdown
    },
    markdown
  };
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
    renderListSection("Validation", stringList(record.acceptance?.validation), formatValidationCommand)
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

    const sections = [
      renderSectionHeading("Selected Slice"),
      "",
      renderKeyValueBulletList([
        ["id", escapeInlineCode(selected.id)],
        ["title", escapeInlineCode(selected.title)],
        ["work kind", escapeInlineCode(selected.work_kind)],
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
      renderListSection("Slice Validation", stringList(selected.acceptance?.validation), (
        entry
      ) => formatValidationCommand(entry)),
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

function createProjectionCompactionLists(record, kind, options = {}) {
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

function findSelectedSlice(record, sliceId) {
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
  inheritList(
    slice.acceptance?.validation,
    record.acceptance?.validation,
    "Validation",
    formatValidationCommand
  );

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

function buildBriefProjectionResult(record, metadata, options = {}) {
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

function validateProjectionMetadata(projection, { sourceRecord = null, sourceDigest = null } = {}) {
  const diagnostics = [];

  if (!isObject(projection)) {
    diagnostics.push(
      createDiagnostic("invalid_projection_record", "projection record must be an object")
    );
    return diagnostics;
  }

  if (projection.schema_version !== WORK_RECORD_RENDER_SCHEMA_VERSION) {
    diagnostics.push(
      createDiagnostic(
        "invalid_projection_record",
        `projection schema_version must be ${WORK_RECORD_RENDER_SCHEMA_VERSION}`,
        { path: "schema_version" }
      )
    );
    return diagnostics;
  }

  if (!isString(projection.projection_kind)) {
    diagnostics.push(
      createDiagnostic("invalid_projection_record", "projection_kind is required", {
        path: "projection_kind"
      })
    );
  } else if (!WORK_RECORD_PROJECTION_KIND_VALUES.includes(projection.projection_kind)) {
    diagnostics.push(
      createDiagnostic(
        "unsupported_projection_kind",
        `Unsupported projection kind: ${projection.projection_kind}`,
        { path: "projection_kind" }
      )
    );
  }

  if (!isString(projection.source_record_id)) {
    diagnostics.push(
      createDiagnostic("invalid_projection_record", "source_record_id is required", {
        path: "source_record_id"
      })
    );
  }

  if (projection.source_schema_version !== WORK_RECORD_SCHEMA_VERSION) {
    diagnostics.push(
      createDiagnostic(
        "invalid_projection_record",
        `source_schema_version must be ${WORK_RECORD_SCHEMA_VERSION}`,
        { path: "source_schema_version" }
      )
    );
  }

  if (!isString(projection.source_digest) || projection.source_digest.trim() === "") {
    diagnostics.push(
      createDiagnostic("missing_source_digest", "source_digest is required", {
        path: "source_digest"
      })
    );
  }

  if (
    !isString(projection.authority) ||
    projection.authority !== WORK_RECORD_PROJECTION_AUTHORITY
  ) {
    diagnostics.push(
      createDiagnostic(
        "projection_authority_violation",
        `authority must be ${WORK_RECORD_PROJECTION_AUTHORITY}`,
        { path: "authority" }
      )
    );
  }

  if (projection.projection_kind === "markdown" && !isString(projection.output_path)) {
    diagnostics.push(
      createDiagnostic("missing_output_path", "markdown projections require output_path", {
        path: "output_path"
      })
    );
  }

  if (
    sourceDigest &&
    isString(projection.source_digest) &&
    projection.source_digest.trim() !== "" &&
    projection.source_digest !== sourceDigest
  ) {
    diagnostics.push(
      createDiagnostic(
        "stale_projection",
        "projection source_digest does not match canonical source digest",
        { severity: "warning", path: "source_digest" }
      )
    );
  } else if (
    sourceRecord &&
    isString(projection.source_digest) &&
    projection.source_digest.trim() !== "" &&
    !sourceDigest
  ) {
    const computed = computeWorkRecordSourceDigest(sourceRecord);
    if (projection.source_digest !== computed) {
      diagnostics.push(
        createDiagnostic(
          "stale_projection",
          "projection source_digest does not match canonical source digest",
          { severity: "warning", path: "source_digest" }
        )
      );
    }
  }

  return diagnostics;
}

export function renderWorkRecordMarkdown(record, options = {}) {
  const {
    generatedAt = new Date().toISOString(),
    outputPath = path.posix.join("wiki", "issues", `${record.id}.md`),
    sliceId = null
  } = options;
  const { omittedFields, compactedFields } = createProjectionCompactionLists(record, "markdown", {
    sliceId
  });
  const metadata = buildProjectionMetadata(record, "markdown", {
    generatedAt,
    outputPath,
    omittedFields,
    compactedFields,
    sliceId
  });
  return buildMarkdownProjectionResult(record, metadata);
}

export function renderWorkRecordAgentBrief(record, options = {}) {
  const { generatedAt = new Date().toISOString(), outputPath = null, sliceId = null } = options;

  const metadataSliceId = findSelectedSlice(record, sliceId) ? sliceId : null;
  const { omittedFields, compactedFields } = createProjectionCompactionLists(record, "agent_brief", {
    sliceId: metadataSliceId
  });
  const metadata = buildProjectionMetadata(record, "agent_brief", {
    generatedAt,
    outputPath: outputPath ?? undefined,
    omittedFields,
    compactedFields,
    sliceId: metadataSliceId
  });
  return buildBriefProjectionResult(record, metadata, { sliceId });
}

export function checkWorkRecordRenderProjectionRecord(projection, { sourceRecord = null } = {}) {
  const sourceDigest = sourceRecord ? computeWorkRecordSourceDigest(sourceRecord) : null;
  const diagnostics = validateProjectionMetadata(projection, {
    sourceRecord,
    sourceDigest
  });

  return {
    valid: diagnostics.every((entry) => entry.severity !== "error"),
    diagnostics,
    projection_kind: isObject(projection) ? projection.projection_kind || null : null,
    source_record_id: isObject(projection) ? projection.source_record_id || null : null,
    source_digest: isObject(projection) ? projection.source_digest || null : null
  };
}

export function checkWorkRecordRenderRecord(record, { sourcePath = null } = {}) {
  const diagnostics = [];
  if (!isObject(record)) {
    diagnostics.push(
      createDiagnostic("invalid_projection_record", "renderable record must be an object", {
        path: sourcePath
      })
    );
    return {
      valid: false,
      diagnostics
    };
  }

  if (record.schema_version !== WORK_RECORD_SCHEMA_VERSION) {
    diagnostics.push(
      createDiagnostic("invalid_projection_record", "record schema_version must be work-record.v1", {
        path: "schema_version"
      })
    );
    return {
      valid: false,
      diagnostics
    };
  }

  if (!isString(record.record_kind)) {
    diagnostics.push(
      createDiagnostic("invalid_projection_record", "record_kind is required", {
        path: "record_kind"
      })
    );
  } else if (record.record_kind !== "work_item") {
    diagnostics.push(
      createDiagnostic("unsupported_record_kind", `Unsupported record kind: ${record.record_kind}`, {
        path: "record_kind"
      })
    );
  }

  const sourceDigest = computeWorkRecordSourceDigest(record);
  const projections = Array.isArray(record.projections) ? record.projections : [];
  for (const projection of projections) {
    diagnostics.push(
      ...validateProjectionMetadata(projection, {
        sourceRecord: record,
        sourceDigest
      })
    );
  }

  return {
    valid: diagnostics.every((entry) => entry.severity !== "error"),
    diagnostics,
    source_digest: sourceDigest
  };
}

export function renderWorkRecordProjection(record, options = {}) {
  const kind = options.projectionKind || "markdown";
  if (kind === "markdown") {
    return renderWorkRecordMarkdown(record, options);
  }
  if (kind === "agent_brief") {
    return renderWorkRecordAgentBrief(record, options);
  }
  return {
    valid: false,
    diagnostics: [
      createDiagnostic(
        "unsupported_projection_kind",
        `Unsupported projection kind: ${String(kind)}`,
        { path: "projection_kind" }
      )
    ],
    projection: null
  };
}
