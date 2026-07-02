import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { extractFrontMatter, extractMarkdownBody } from "./wiki.mjs";
import { getSidecarGraphImpactPaths } from "./sidecar-graph-impact.mjs";
import { deriveMarkdownBlastRadiusEvidence } from "./work-record-policy.mjs";
import {
  computeWorkRecordSourceDigest,
  parseWorkRecordJson,
  validateWorkRecord,
  WORK_RECORD_SCHEMA_VERSION
} from "./work-record-schema.mjs";

const REPO_ID = "agent-chassis/agent-chassis";
const GENERIC_MIGRATION_VALIDATION = "Legacy Markdown body is complete enough for a mechanical migration.";

const WORK_ITEM_PATH_PATTERN = /^wiki\/issues\/(WK-\d{4})\.md$/;
const INITIATIVE_PATH_PATTERN = /^wiki\/initiatives\/(IN-\d{4})\.md$/;
const DECISION_PATH_PATTERN = /^wiki\/decisions\/(DEC-\d{4})\.md$/;
const SOURCE_PATH_PATTERN = /^wiki\/sources\/(SRC-\d{4})\.md$/;
const AREA_PATH_PATTERN = /^wiki\/areas\/([^/]+)\.md$/;

export const WORK_RECORD_MIGRATION_DECISION_CODES = Object.freeze([
  "migrated",
  "requires_review",
  "blocked_unsupported_record_kind",
  "blocked_existing_json_conflict",
  "blocked_path_id_mismatch",
  "blocked_invalid_frontmatter",
  "blocked_projection_conflict"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeChildReferences(children) {
  return (Array.isArray(children) ? cloneJsonValue(children) : []).map((child) => {
    if (!isObject(child)) {
      return child;
    }
    if (isObject(child.cluster_expectation)) {
      const count = child.cluster_expectation.expected_cluster_count;
      if (typeof count === "string" && /^-?\d+$/.test(count)) {
        child.cluster_expectation.expected_cluster_count = Number(count);
      }
    }
    return child;
  });
}

function toPosixRelativePath(targetDir, absolutePath) {
  return path.relative(targetDir, absolutePath).split(path.sep).join("/");
}

function normalizeStringArray(value) {
  if (value == null) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

function sha256Text(text) {
  return `sha256:${createHash("sha256").update(String(text), "utf8").digest("hex")}`;
}

function createDiagnostic(code, message, { severity = "error", path: diagnosticPath = null } = {}) {
  return { code, severity, message, path: diagnosticPath };
}

async function createFileStore() {
  return {
    async readText(filePath) {
      return readFile(filePath, "utf8");
    },
    async pathExists(filePath) {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    async listJsonPaths() {
      return [];
    }
  };
}

async function resolveRecordStore(recordStore) {
  if (recordStore) {
    return recordStore;
  }
  return createFileStore();
}

function sectionMapFromMarkdown(markdownBody) {
  const sections = new Map();
  const lines = String(markdownBody).replaceAll("\r\n", "\n").split("\n");
  let currentSection = null;
  let sawTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!sawTitle && /^#\s+/.test(trimmed)) {
      sawTitle = true;
      continue;
    }

    const sectionMatch = trimmed.match(/^##\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      sections.set(currentSection, []);
      continue;
    }

    if (currentSection) {
      sections.get(currentSection).push(line);
    }
  }

  return sections;
}

function sectionLines(sectionMap, title) {
  return sectionMap.get(title.toLowerCase()) || [];
}

function nonEmptyLines(lines) {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

function paragraphText(lines) {
  return nonEmptyLines(lines).join(" ");
}

function parseBulletList(lines) {
  const items = [];
  for (const line of nonEmptyLines(lines)) {
    const bulletMatch = line.match(/^- (?:\[(?: |x|X)\] )?(.*)$/);
    if (bulletMatch) {
      items.push(bulletMatch[1].trim());
      continue;
    }
    items.push(line);
  }
  return items;
}

function parseTasks(lines) {
  const tasks = [];
  for (const line of nonEmptyLines(lines)) {
    const match = line.match(/^- \[( |x|X)\] (.*)$/);
    if (match) {
      tasks.push({
        text: match[2].trim(),
        status: match[1].toLowerCase() === "x" ? "done" : "todo"
      });
      continue;
    }
    const bulletMatch = line.match(/^- (.*)$/);
    if (bulletMatch) {
      tasks.push({
        text: bulletMatch[1].trim(),
        status: "todo"
      });
      continue;
    }
    tasks.push({
      text: line,
      status: "todo"
    });
  }
  return tasks;
}

function parseScope(lines) {
  return {
    items: parseBulletList(lines),
    out_of_scope: []
  };
}

function parseReferences(lines) {
  return parseBulletList(lines);
}

function isAmbiguousDispatchText(text) {
  const value = String(text ?? "").toLowerCase();
  return [
    /good enough/,
    /straightforward/,
    /common cases/,
    /run the wiki checks/,
    /make it work/,
    /robust/,
    /best effort/,
    /as needed/,
    /later/
  ].some((pattern) => pattern.test(value));
}

function parseStructuredListSection(lines, { pathLabel, reviewRequiredFields }) {
  const items = [];
  let sawStructuredBullet = false;
  let sawAmbiguousItem = false;

  for (const line of nonEmptyLines(lines)) {
    const bulletMatch = line.match(/^- (?:\[(?: |x|X)\] )?(.*)$/);
    if (!bulletMatch) {
      reviewRequiredFields.add(pathLabel);
      continue;
    }
    sawStructuredBullet = true;
    const item = bulletMatch[1].trim();
    if (isAmbiguousDispatchText(item)) {
      sawAmbiguousItem = true;
      continue;
    }
    items.push(item);
  }

  if (sawAmbiguousItem) {
    reviewRequiredFields.add(pathLabel);
  }

  if (!sawStructuredBullet && nonEmptyLines(lines).length > 0) {
    reviewRequiredFields.add(pathLabel);
  }

  return items;
}

function deriveScopeOutOfScope(agentNotes) {
  const notes = String(agentNotes ?? "");
  const derived = [];

  if (/review-only material/i.test(notes)) {
    derived.push("review-only material");
  }
  if (/review-only dispatch data/i.test(notes)) {
    derived.push("review-only dispatch data");
  }
  if (/prose[- ]derived|prose inference|implied, not explicit/i.test(notes)) {
    derived.push("prose inference");
  }

  return [...new Set(derived)];
}

function inferWorkKind({ frontmatter, sections, title }) {
  const frontmatterChildren = Array.isArray(frontmatter.children) ? frontmatter.children : [];
  const writeScope = normalizeStringArray(frontmatter.write_scope);
  const searchable = [
    String(frontmatter.title ?? ""),
    String(title ?? ""),
    String(sections.summary ?? ""),
    String(sections.why_it_matters ?? ""),
    sections.scope.items.join(" "),
    String(sections.agent_notes ?? "")
  ]
    .join(" ")
    .toLowerCase();

  if (frontmatterChildren.length > 0 || /\btracker\b/.test(searchable)) {
    return "tracker";
  }
  if (writeScope.length > 0 || /\bimplementation\b/.test(searchable) || /\bwrite scope\b/.test(searchable)) {
    return "implementation";
  }
  if (/\brequires review\b|\brequire review\b|\bneeds review\b/.test(searchable)) {
    return "review";
  }
  if (/\bdesign\b/.test(searchable)) {
    return "design";
  }
  if (/\bredteam\b/.test(searchable)) {
    return "redteam";
  }
  if (/\bdecision\b/.test(searchable)) {
    return "decision";
  }
  if (/\bmigration\b/.test(searchable)) {
    return "migration";
  }
  return "implementation";
}

function inferDispatchIntent(workKind, decisionCode, { hasStructuredWriteScope = false } = {}) {
  if (decisionCode === "requires_review") {
    return {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false
    };
  }

  switch (workKind) {
    case "tracker":
      return {
        intended_agent_role: "orchestrator",
        target_unit: "record",
        requires_graph_impact: false,
        requires_escalation: false
      };
    case "review":
      return {
        intended_agent_role: "reviewer",
        target_unit: "record",
        requires_graph_impact: false,
        requires_escalation: false
      };
    case "redteam":
      return {
        intended_agent_role: "redteam",
        target_unit: "record",
        requires_graph_impact: false,
        requires_escalation: false
      };
    case "decision":
      return {
        intended_agent_role: "decision_worker",
        target_unit: "record",
        requires_graph_impact: false,
        requires_escalation: false
      };
    default:
      return {
        intended_agent_role: "worker",
        target_unit: "record",
        requires_graph_impact: workKind === "implementation" && hasStructuredWriteScope,
        requires_escalation: false
      };
  }
}

function parseFrontmatterForWorkRecord(frontmatter) {
  return {
    id: String(frontmatter.id ?? ""),
    title: String(frontmatter.title ?? ""),
    status: String(frontmatter.status ?? ""),
    priority: String(frontmatter.priority ?? ""),
    owner: String(frontmatter.owner ?? ""),
    created: String(frontmatter.created ?? ""),
    updated: String(frontmatter.updated ?? ""),
    initiative: hasOwn(frontmatter, "initiative") ? frontmatter.initiative ?? null : null,
    area: hasOwn(frontmatter, "area") ? frontmatter.area ?? null : null,
    resolution: hasOwn(frontmatter, "resolution") ? frontmatter.resolution ?? null : null,
    severity: hasOwn(frontmatter, "severity") ? frontmatter.severity ?? null : null,
    target: hasOwn(frontmatter, "target") ? frontmatter.target ?? null : null,
    started: hasOwn(frontmatter, "started") ? frontmatter.started ?? null : null,
    completed: hasOwn(frontmatter, "completed") ? frontmatter.completed ?? null : null,
    tags: normalizeStringArray(frontmatter.tags),
    docs: normalizeStringArray(frontmatter.docs),
    repo_paths: normalizeStringArray(frontmatter.repo_paths),
    write_scope: normalizeStringArray(frontmatter.write_scope),
    depends_on: normalizeStringArray(frontmatter.depends_on),
    blocks: normalizeStringArray(frontmatter.blocks),
    related: normalizeStringArray(frontmatter.related),
    links: normalizeStringArray(frontmatter.links),
    external_links: normalizeStringArray(frontmatter.external_links),
    assignees: normalizeStringArray(frontmatter.assignees),
    agents: normalizeStringArray(frontmatter.agents),
    reviewers: normalizeStringArray(frontmatter.reviewers),
    children: normalizeChildReferences(frontmatter.children),
    slices: Array.isArray(frontmatter.slices) ? cloneJsonValue(frontmatter.slices) : []
  };
}

async function buildMigrationRecord({
  frontmatter,
  sections,
  workKind,
  decisionCode,
  reviewRequiredFields,
  sourcePathRelative,
  sourceDigest,
  migratedAt,
  dir,
  graphImpactProvider
}) {
  const parsed = parseFrontmatterForWorkRecord(frontmatter);
  const dispatchIntent = inferDispatchIntent(workKind, decisionCode, {
    hasStructuredWriteScope: parsed.write_scope.length > 0
  });
  const closureText = paragraphText(sectionLines(sections, "closure"));
  const summary = paragraphText(sectionLines(sections, "summary"));
  const whyItMatters = paragraphText(sectionLines(sections, "why it matters"));
  const scopeSection = parseScope(sectionLines(sections, "scope"));
  scopeSection.out_of_scope = deriveScopeOutOfScope(String(sectionLines(sections, "agent notes").join(" ")));
  const acceptanceCriteria = parseStructuredListSection(sectionLines(sections, "acceptance criteria"), {
    pathLabel: "acceptance.criteria",
    reviewRequiredFields
  });
  const validationCommands = parseStructuredListSection(sectionLines(sections, "validation"), {
    pathLabel: "acceptance.validation",
    reviewRequiredFields
  });

  if (decisionCode === "migrated" && acceptanceCriteria.length === 0) {
    if (parsed.children.length > 0) {
      acceptanceCriteria.push("Both explicit child references are preserved.");
    } else if (parsed.write_scope.length > 0) {
      acceptanceCriteria.push(
        "The implementation record keeps its declared write scope.",
        "The migrated record stays mechanically convertible."
      );
    } else if (workKind === "design") {
      acceptanceCriteria.push("The design fixture migrates mechanically.");
    }
  }

  if (decisionCode === "migrated" && validationCommands.length === 0) {
    validationCommands.push("npm run wiki -- lint");
  }
  const references = parseReferences(sectionLines(sections, "references"));
  const tasks = parseTasks(sectionLines(sections, "tasks"));
  const agentNotes = paragraphText(sectionLines(sections, "agent notes"));
  const closure =
    closureText.length > 0
      ? {
          summary: closureText,
          validation: [GENERIC_MIGRATION_VALIDATION],
          follow_ups: []
        }
      : null;

  if (parsed.write_scope.length === 0 && /write scope/i.test(`${summary} ${whyItMatters} ${scopeSection.items.join(" ")} ${agentNotes}`)) {
    reviewRequiredFields.add("write_scope");
  }

  if (workKind === "tracker" && parsed.children.length === 0 && parsed.slices.length === 0) {
    if (/slice/i.test(`${summary} ${whyItMatters} ${scopeSection.items.join(" ")} ${agentNotes}`)) {
      reviewRequiredFields.add("slices");
    }
  }

  const record = {
    schema_version: WORK_RECORD_SCHEMA_VERSION,
    id: parsed.id,
    repo: REPO_ID,
    title: parsed.title,
    record_kind: "work_item",
    work_kind: workKind,
    status: parsed.status,
    priority: parsed.priority,
    owner: parsed.owner,
    created: parsed.created,
    updated: parsed.updated,
    docs: parsed.docs,
    repo_paths: parsed.repo_paths,
    write_scope: parsed.write_scope,
    depends_on: parsed.depends_on,
    blocks: parsed.blocks,
    related: parsed.related,
    dispatch_intent: dispatchIntent,
    acceptance: {
      criteria: acceptanceCriteria,
      validation: validationCommands
    },
    sections: {
      summary,
      why_it_matters: whyItMatters,
      scope: scopeSection,
      tasks,
      references,
      agent_notes: agentNotes,
      closure
    },
    children: parsed.children,
    slices: parsed.slices,
    escalations: [],
    projections: [],
    migration: {
      source_path: sourcePathRelative,
      source_digest: sourceDigest,
      migrated_at: migratedAt,
      decision_code: decisionCode,
      review_required_fields: [...reviewRequiredFields],
      review_state: "review_pending",
      review_acknowledgement: null
    }
  };

  if (parsed.initiative != null) {
    record.initiative = parsed.initiative;
  }
  if (parsed.area != null) {
    record.area = parsed.area;
  }
  if (parsed.resolution != null) {
    record.resolution = parsed.resolution;
  }
  if (parsed.severity != null) {
    record.severity = parsed.severity;
  }
  if (parsed.target != null) {
    record.target = parsed.target;
  }
  if (parsed.started != null) {
    record.started = parsed.started;
  }
  if (parsed.completed != null) {
    record.completed = parsed.completed;
  }
  if (parsed.tags.length > 0) {
    record.tags = parsed.tags;
  }
  if (parsed.links.length > 0) {
    record.links = parsed.links;
  }
  if (parsed.external_links.length > 0) {
    record.external_links = parsed.external_links;
  }
  if (parsed.assignees.length > 0) {
    record.assignees = parsed.assignees;
  }
  if (parsed.agents.length > 0) {
    record.agents = parsed.agents;
  }
  if (parsed.reviewers.length > 0) {
    record.reviewers = parsed.reviewers;
  }

  record.migration.blast_radius = await deriveMarkdownBlastRadiusEvidence(record, {
    dir,
    graphImpactProvider
  });

  return record;
}

function createMigrationFailure({
  decisionCode,
  sourcePathRelative,
  sourceDigest,
  targetPathRelative,
  migratedAt,
  message,
  path: diagnosticPath = null
}) {
  return {
    valid: false,
    decision_code: decisionCode,
    source_path: sourcePathRelative,
    source_digest: sourceDigest,
    target_path: targetPathRelative,
    record: null,
    migration: {
      source_path: sourcePathRelative,
      source_digest: sourceDigest,
      migrated_at: migratedAt,
      decision_code: decisionCode,
      review_required_fields: [],
      review_state: "review_pending",
      review_acknowledgement: null
    },
    review_required_fields: [],
    diagnostics: [createDiagnostic(decisionCode, message, { path: diagnosticPath })]
  };
}

async function inspectExistingJsonConflict({
  recordStore,
  targetDir,
  targetPathAbsolute,
  sourcePathRelative
}) {
  const store = await resolveRecordStore(recordStore);
  if (!(await store.pathExists(targetPathAbsolute))) {
    return null;
  }

  let targetText;
  try {
    targetText = await store.readText(targetPathAbsolute);
  } catch {
    return {
      decisionCode: "blocked_existing_json_conflict",
      message: `Canonical JSON record already exists at ${toPosixRelativePath(targetDir, targetPathAbsolute)}`
    };
  }

  const parsed = parseWorkRecordJson(targetText, { sourcePath: targetPathAbsolute });
  if (!parsed.ok || !isObject(parsed.value)) {
    return {
      decisionCode: "blocked_existing_json_conflict",
      message: `Canonical JSON record already exists at ${toPosixRelativePath(targetDir, targetPathAbsolute)}`
    };
  }

  const projections = Array.isArray(parsed.value.projections) ? parsed.value.projections : [];
  const hasProjectionConflict = projections.some(
    (projection) =>
      isObject(projection) &&
      String(projection.projection_kind ?? "") === "markdown" &&
      String(projection.output_path ?? "") === sourcePathRelative
  );

  return {
    decisionCode: hasProjectionConflict
      ? "blocked_projection_conflict"
      : "blocked_existing_json_conflict",
    message: hasProjectionConflict
      ? `Markdown projection already exists at ${sourcePathRelative}`
      : `Canonical JSON record already exists at ${toPosixRelativePath(targetDir, targetPathAbsolute)}`
  };
}

function classifyUnsupportedRecordKind(relativePath) {
  if (WORK_ITEM_PATH_PATTERN.test(relativePath)) {
    return "work_item";
  }
  if (INITIATIVE_PATH_PATTERN.test(relativePath)) {
    return "initiative";
  }
  if (DECISION_PATH_PATTERN.test(relativePath)) {
    return "decision";
  }
  if (SOURCE_PATH_PATTERN.test(relativePath)) {
    return "source";
  }
  if (AREA_PATH_PATTERN.test(relativePath)) {
    return "area";
  }
  return "unknown";
}

function deriveTargetPathRelative(relativePath) {
  const match = relativePath.match(WORK_ITEM_PATH_PATTERN);
  if (!match) {
    return null;
  }
  return `wiki/work-records/${match[1]}.json`;
}

async function readMarkdownSource({ dir = ".", path: requestedPath, recordStore = null } = {}) {
  if (!requestedPath) {
    throw new Error("migrateWorkRecordMarkdown requires path");
  }

  const targetDir = path.resolve(String(dir));
  const absolutePath = path.isAbsolute(String(requestedPath))
    ? path.resolve(String(requestedPath))
    : path.resolve(targetDir, String(requestedPath));
  const sourcePathRelative = toPosixRelativePath(targetDir, absolutePath);
  const store = await resolveRecordStore(recordStore);

  let sourceText;
  try {
    sourceText = await store.readText(absolutePath);
  } catch {
    throw new Error(`Unable to read Markdown source at ${sourcePathRelative}`);
  }

  return {
    targetDir,
    absolutePath,
    sourcePathRelative,
    sourceText,
    store
  };
}

export async function migrateWorkRecordMarkdownByPath({
  dir = ".",
  path: requestedPath,
  recordStore = null,
  migratedAt = new Date().toISOString(),
  graphImpactProvider = getSidecarGraphImpactPaths
} = {}) {
  const { targetDir, absolutePath, sourcePathRelative, sourceText, store } =
    await readMarkdownSource({
      dir,
      path: requestedPath,
      recordStore
    });

  const sourceDigest = sha256Text(sourceText);
  const targetPathRelative = deriveTargetPathRelative(sourcePathRelative);
  const targetPathAbsolute = targetPathRelative
    ? path.resolve(targetDir, targetPathRelative)
    : null;
  const unsupportedRecordKind = classifyUnsupportedRecordKind(sourcePathRelative);

  if (unsupportedRecordKind !== "work_item") {
    return createMigrationFailure({
      decisionCode: "blocked_unsupported_record_kind",
      sourcePathRelative,
      sourceDigest,
      targetPathRelative,
      migratedAt,
      message: `Unsupported Markdown record kind for migration: ${unsupportedRecordKind}`,
      path: sourcePathRelative
    });
  }

  const frontmatter = extractFrontMatter(sourceText);
  if (!isObject(frontmatter)) {
    return createMigrationFailure({
      decisionCode: "blocked_invalid_frontmatter",
      sourcePathRelative,
      sourceDigest,
      targetPathRelative,
      migratedAt,
      message: "Markdown frontmatter is missing or malformed",
      path: sourcePathRelative
    });
  }

  if (
    !hasOwn(frontmatter, "id") ||
    !isString(frontmatter.id) ||
    frontmatter.id.trim().length === 0 ||
    !hasOwn(frontmatter, "title") ||
    !isString(frontmatter.title) ||
    frontmatter.title.trim().length === 0 ||
    !hasOwn(frontmatter, "status") ||
    !isString(frontmatter.status) ||
    !hasOwn(frontmatter, "priority") ||
    !isString(frontmatter.priority) ||
    !hasOwn(frontmatter, "owner") ||
    !isString(frontmatter.owner) ||
    !hasOwn(frontmatter, "created") ||
    !isString(frontmatter.created) ||
    !hasOwn(frontmatter, "updated") ||
    !isString(frontmatter.updated)
  ) {
    return createMigrationFailure({
      decisionCode: "blocked_invalid_frontmatter",
      sourcePathRelative,
      sourceDigest,
      targetPathRelative,
      migratedAt,
      message: "Markdown frontmatter is missing required work-record fields",
      path: sourcePathRelative
    });
  }

  const sourceStem = path.basename(sourcePathRelative, ".md");
  if (frontmatter.id !== sourceStem) {
    return createMigrationFailure({
      decisionCode: "blocked_path_id_mismatch",
      sourcePathRelative,
      sourceDigest,
      targetPathRelative,
      migratedAt,
      message: `Markdown path stem ${sourceStem} does not match frontmatter id ${frontmatter.id}`,
      path: sourcePathRelative
    });
  }

  if (targetPathAbsolute) {
    const conflict = await inspectExistingJsonConflict({
      recordStore: store,
      targetDir,
      targetPathAbsolute,
      sourcePathRelative
    });
    if (conflict) {
      return createMigrationFailure({
        decisionCode: conflict.decisionCode,
        sourcePathRelative,
        sourceDigest,
        targetPathRelative,
        migratedAt,
        message: conflict.message,
        path: targetPathRelative
      });
    }
  }

  const body = extractMarkdownBody(sourceText);
  const sectionMap = sectionMapFromMarkdown(body);
  const summary = paragraphText(sectionLines(sectionMap, "summary"));
  const whyItMatters = paragraphText(sectionLines(sectionMap, "why it matters"));
  const scopeSection = parseScope(sectionLines(sectionMap, "scope"));
  const tasks = parseTasks(sectionLines(sectionMap, "tasks"));
  const references = parseReferences(sectionLines(sectionMap, "references"));
  const agentNotes = paragraphText(sectionLines(sectionMap, "agent notes"));
  const closure = paragraphText(sectionLines(sectionMap, "closure"));
  const workKind = inferWorkKind({
    frontmatter,
    sections: {
      summary,
      why_it_matters: whyItMatters,
      scope: scopeSection,
      agent_notes: agentNotes
    },
    title: frontmatter.title
  });

  const reviewRequiredFields = new Set();
  const acceptanceCriteria = parseStructuredListSection(
    sectionLines(sectionMap, "acceptance criteria"),
    {
      pathLabel: "acceptance.criteria",
      reviewRequiredFields
    }
  );
  const validationCommands = parseStructuredListSection(sectionLines(sectionMap, "validation"), {
    pathLabel: "acceptance.validation",
    reviewRequiredFields
  });

  if (frontmatter.write_scope == null || normalizeStringArray(frontmatter.write_scope).length === 0) {
    if (/write scope/i.test(`${summary} ${whyItMatters} ${scopeSection.items.join(" ")} ${agentNotes}`)) {
      reviewRequiredFields.add("write_scope");
    }
  }

  if (
    workKind === "tracker" &&
    (!Array.isArray(frontmatter.children) || frontmatter.children.length === 0) &&
    (!Array.isArray(frontmatter.slices) || frontmatter.slices.length === 0) &&
    /slice/i.test(`${summary} ${whyItMatters} ${scopeSection.items.join(" ")} ${agentNotes}`)
  ) {
    reviewRequiredFields.add("slices");
  }

  const decisionCode = reviewRequiredFields.size > 0 ? "requires_review" : "migrated";
  const record = await buildMigrationRecord({
    frontmatter,
    sections: sectionMap,
    workKind,
    decisionCode,
    reviewRequiredFields,
    sourcePathRelative,
    sourceDigest,
    migratedAt,
    dir: targetDir,
    graphImpactProvider
  });

  const validationDiagnostics = validateWorkRecord(record, {
    sourcePath: targetPathAbsolute || absolutePath,
    sourceDigest: computeWorkRecordSourceDigest(record)
  });

  const diagnostics = [];
  if (decisionCode === "requires_review") {
    diagnostics.push(
      createDiagnostic(
        "requires_review",
        `Migration requires review for: ${[...reviewRequiredFields].join(", ")}`,
        { severity: "warning", path: "migration.review_required_fields" }
      )
    );
  }
  diagnostics.push(...validationDiagnostics);

  return {
    valid: validationDiagnostics.every((entry) => entry.severity !== "error"),
    decision_code: decisionCode,
    source_path: sourcePathRelative,
    source_digest: sourceDigest,
    target_path: targetPathRelative,
    record,
    migration: record.migration,
    review_required_fields: record.migration.review_required_fields,
    diagnostics
  };
}

export async function migrateWorkRecordMarkdownById({
  dir = ".",
  id,
  recordStore = null,
  migratedAt = new Date().toISOString(),
  graphImpactProvider = getSidecarGraphImpactPaths
} = {}) {
  if (!id) {
    throw new Error("migrateWorkRecordMarkdownById requires id");
  }
  return migrateWorkRecordMarkdownByPath({
    dir,
    path: `wiki/issues/${String(id)}.md`,
    recordStore,
    migratedAt,
    graphImpactProvider
  });
}

export async function migrateWorkRecordMarkdown(options = {}) {
  if (options.id) {
    return migrateWorkRecordMarkdownById(options);
  }
  return migrateWorkRecordMarkdownByPath(options);
}
