import path from "node:path";
import {
  computeWorkRecordSourceDigest,
  WORK_RECORD_PROJECTION_AUTHORITY,
  WORK_RECORD_PROJECTION_KIND_VALUES,
  WORK_RECORD_RENDER_SCHEMA_VERSION,
  WORK_RECORD_SCHEMA_VERSION
} from "./work-record-schema.mjs";
import {
  buildBriefProjectionResult,
  createProjectionCompactionLists,
  findSelectedSlice
} from "./work-record-brief-renderer.mjs";
import {
  createDiagnostic,
  escapeInlineCode,
  formatChildEntry,
  formatEscalationEntry,
  formatFieldList,
  formatSliceEntry,
  isObject,
  isString,
  renderBulletList,
  renderKeyValueBulletList,
  renderParagraph,
  renderSectionHeading,
  stringList
} from "./work-record-render-primitives.mjs";
import {
  projectWorkRecordTestProofValidation,
  renderWorkRecordValidationEntry
} from "./work-record-test-proof-bindings.mjs";

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

function renderWorkRecordMarkdownBody(record, metadata) {
  const validationProjection = projectWorkRecordTestProofValidation({ selectedUnit: record });
  const validation = validationProjection.status === "valid"
    ? validationProjection.validation_entries
    : [];
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
    renderBulletList(validation, {
      empty: "- None",
      formatter: (entry) => renderWorkRecordValidationEntry(entry)
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
