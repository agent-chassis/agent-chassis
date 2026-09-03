

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { getTemplateDir, loadManifest } from "./contract.mjs";
import {
  DEFAULT_PROFILE,
  ensureDirectory,
  normalizeExtensionNamespaces,
  normalizeType,
  pathExists,
  resolveProfileName,
  today
} from "./wiki-shared.mjs";

export async function readTemplate(templateName) {
  const templatePath = path.join(getTemplateDir(), templateName);
  return readFile(templatePath, "utf8");
}

export async function syncTemplates(targetDir) {
  const manifest = await loadManifest();
  const templateTargetDir = path.join(targetDir, "wiki", "templates");
  await ensureDirectory(templateTargetDir);

  const copied = [];
  for (const definition of Object.values(manifest.types)) {
    const content = await readTemplate(definition.template);
    const destination = path.join(templateTargetDir, definition.template);
    await writeFile(destination, content, "utf8");
    copied.push(destination);
  }

  return { copied, manifest };
}

export const AGENTS_BOILERPLATE_TEMPLATE_FILENAME = "AGENTS.md.boilerplate.md";
export const AGENTS_BOILERPLATE_SEEDED_RELATIVE_PATH =
  "wiki/templates/AGENTS.md.boilerplate.md";

const _SEED_TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates"
);

export async function ensureAgentsBoilerplateTemplate(targetDir) {
  const content = await readFile(
    path.join(_SEED_TEMPLATES_DIR, AGENTS_BOILERPLATE_TEMPLATE_FILENAME),
    "utf8"
  );
  const templateTargetDir = path.join(targetDir, "wiki", "templates");
  await ensureDirectory(templateTargetDir);
  const absolutePath = path.join(templateTargetDir, AGENTS_BOILERPLATE_TEMPLATE_FILENAME);

  let existing = null;
  if (await pathExists(absolutePath)) {
    try {
      existing = await readFile(absolutePath, "utf8");
    } catch {
      existing = null;
    }
  }

  let state;
  if (existing === null) {
    state = "created";
  } else if (existing === content) {
    state = "kept";
  } else {
    state = "refreshed";
  }

  if (state !== "kept") {
    await writeFile(absolutePath, content, "utf8");
  }

  return {
    relativePath: AGENTS_BOILERPLATE_SEEDED_RELATIVE_PATH,
    absolutePath,
    state
  };
}

export async function renderTemplate({ type, title, id, date }) {
  const manifest = await loadManifest();
  const normalizedType = normalizeType(type, manifest);
  const definition = manifest.types[normalizedType];
  const template = await readTemplate(definition.template);

  return template
    .replaceAll("{{ID}}", id)
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DATE}}", date);
}

export async function ensureCatalog(targetDir, repo) {
  const catalogPath = path.join(targetDir, "wiki", "catalog.md");
  if (await pathExists(catalogPath)) {
    return { catalogPath, created: false };
  }

  const content = `# Wiki Catalog

Repository: ${repo}

## Core Surfaces

- [Schema](./schema.md)
- [Conventions](./conventions.md)
- [Index](./index.md)
- [Issues](./issues/)
- [Initiatives](./initiatives/)
- [Decisions](./decisions/)
- [Sources](./sources/)
- [Areas](./areas/)

## Retrieval Notes

Use this file as the top-level retrieval entrypoint for the local repository wiki.
`;
  await writeFile(catalogPath, content, "utf8");
  return { catalogPath, created: true };
}

export const WIKI_MCP_DECLARATION_RELATIVE_PATH = "wiki/.wiki-mcp.json";
export const WIKI_MCP_DECLARATION_SCHEMA_VERSION = "wiki-mcp-workspace.v1";

const WIKI_MCP_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;

function sanitizeWorkspaceAlias(repo) {
  const cleaned = String(repo || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");
  return cleaned || "workspace";
}

const RESERVED_NON_OPERATOR_ALIASES = new Set(["default"]);

function isValidOperatorAlias(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !RESERVED_NON_OPERATOR_ALIASES.has(trimmed) &&
    WIKI_MCP_ALIAS_PATTERN.test(trimmed)
  );
}

export async function ensureWikiMcpDeclaration(targetDir, { repo } = {}) {
  const wikiDir = path.join(targetDir, "wiki");
  await ensureDirectory(wikiDir);
  const absolutePath = path.join(targetDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);

  const resolvedRoot = await realpath(targetDir);
  const defaultAlias = sanitizeWorkspaceAlias(repo);

  let existingRaw = null;
  let existingParsed = null;
  let malformed = false;
  let malformedReason = null;

  if (await pathExists(absolutePath)) {
    try {
      existingRaw = await readFile(absolutePath, "utf8");
    } catch (error) {
      malformed = true;
      malformedReason = `unreadable: ${error.message}`;
    }
    if (existingRaw !== null) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existingParsed = parsed;
        } else {
          malformed = true;
          malformedReason = "declaration is not a JSON object";
        }
      } catch (error) {
        malformed = true;
        malformedReason = `malformed JSON: ${error.message}`;
      }
    }
  }

  const base = existingParsed && !malformed ? existingParsed : {};
  const existingCurrent =
    base.current && typeof base.current === "object" && !Array.isArray(base.current)
      ? base.current
      : {};
  const preservedAlias = isValidOperatorAlias(existingCurrent.alias);
  const alias = preservedAlias ? existingCurrent.alias.trim() : defaultAlias;

  const declaration = {
    ...base,
    schema_version: WIKI_MCP_DECLARATION_SCHEMA_VERSION,
    current: {
      ...existingCurrent,
      alias,
      root: resolvedRoot
    }
  };

  const serialized = `${JSON.stringify(declaration, null, 2)}\n`;

  let state;
  if (existingRaw === null) {
    state = "created";
  } else if (!malformed && existingRaw === serialized) {
    state = "kept";
  } else {
    state = "refreshed";
  }

  if (state !== "kept") {
    await writeFile(absolutePath, serialized, "utf8");
  }

  return {
    relativePath: WIKI_MCP_DECLARATION_RELATIVE_PATH,
    absolutePath,
    schemaVersion: WIKI_MCP_DECLARATION_SCHEMA_VERSION,
    alias,
    root: resolvedRoot,
    state,
    malformed,
    malformedReason,
    preservedAlias
  };
}

function renderAdoptionInitiativePage({ seed, body, date }) {
  const frontMatterLines = [
    "---",
    `id: ${seed.record_id}`,
    `title: ${seed.title}`,
    "status: in_progress",
    "priority: medium",
    "owner: unassigned",
    `created: ${date}`,
    `updated: ${date}`,
    "area: work",
    "docs: []",
    "depends_on: []",
    "blocks: []",
    "related: []",
    "write_scope: []",
    "---",
    ""
  ];
  const renderedBody = String(body || "").trimStart();
  return `${frontMatterLines.join("\n")}\n${renderedBody}`;
}

export async function ensureAdoptionInitiative(
  targetDir,
  { seed, body, date = today() } = {}
) {
  if (!seed || !seed.record_id) {
    throw new Error("ensureAdoptionInitiative requires a seed with record_id");
  }

  const relativePath = path.join("wiki", "initiatives", `${seed.record_id}.md`);
  const absolutePath = path.join(targetDir, relativePath);
  const normalizedRelative = relativePath.replaceAll(path.sep, "/");
  await ensureDirectory(path.dirname(absolutePath));

  if (await pathExists(absolutePath)) {
    return {
      recordId: seed.record_id,
      relativePath: normalizedRelative,
      absolutePath,
      created: false,
      kept: true
    };
  }

  const content = renderAdoptionInitiativePage({ seed, body, date });
  await writeFile(absolutePath, content, "utf8");
  return {
    recordId: seed.record_id,
    relativePath: normalizedRelative,
    absolutePath,
    created: true,
    kept: false
  };
}

export async function syncCoreFiles(
  targetDir,
  {
    repo,
    profile = DEFAULT_PROFILE,
    extensionNamespaces = []
  } = {}
) {
  const manifest = await loadManifest();
  const resolvedProfile = resolveProfileName(profile, manifest);
  const extensions = normalizeExtensionNamespaces(extensionNamespaces);
  const wikiDir = path.join(targetDir, "wiki");
  await ensureDirectory(wikiDir);

  const files = {
    schema: path.join(wikiDir, "schema.md"),
    conventions: path.join(wikiDir, "conventions.md"),
    index: path.join(wikiDir, "index.md")
  };

  const desired = buildCoreFileContents({
    repo,
    profile: resolvedProfile,
    extensions,
    manifest
  });
  const created = [];
  const preserved = [];

  for (const [key, filePath] of Object.entries(files)) {
    if (await pathExists(filePath)) {
      preserved.push(filePath);
      continue;
    }
    await writeFile(filePath, desired[key], "utf8");
    created.push(filePath);
  }

  return {
    manifest,
    files: Object.values(files),
    created,
    preserved,
    desired
  };
}

export async function ensureCoreSurfaces(
  targetDir,
  {
    profile = DEFAULT_PROFILE,
    extensionNamespaces = []
  } = {}
) {
  const manifest = await loadManifest();
  const resolvedProfile = resolveProfileName(profile, manifest);
  const created = [];
  const profileConfig = manifest.profiles[resolvedProfile];

  if (profileConfig.durableKnowledgeLayer.required) {
    const docsPath = path.join(
      targetDir,
      profileConfig.durableKnowledgeLayer.path.replace(/\/$/, "")
    );
    await ensureDirectory(docsPath);
    created.push(docsPath);
  }

  for (const relativePath of manifest.requiredSurfaces) {
    const absolutePath = path.join(targetDir, relativePath);
    await ensureDirectory(absolutePath);
    created.push(absolutePath);
  }

  for (const namespace of normalizeExtensionNamespaces(extensionNamespaces)) {
    const absolutePath = path.join(targetDir, "wiki", namespace);
    await ensureDirectory(absolutePath);
    created.push(absolutePath);
  }

  return {
    created,
    manifest,
    profile: resolvedProfile,
    extensionNamespaces: normalizeExtensionNamespaces(extensionNamespaces)
  };
}

export function buildCoreFileContents({ repo, profile, extensions, manifest }) {
  return {
    schema: buildSchemaFile({ repo, profile, extensions, manifest }),
    conventions: buildConventionsFile({ repo, profile, extensions }),
    index: buildIndexFile({ repo, profile, extensions })
  };
}

function buildSchemaFile({ repo, profile, extensions, manifest }) {
  const extensionLines =
    extensions.length === 0
      ? "- none declared"
      : extensions.map((namespace) => `- \`wiki/${namespace}/\``).join("\n");

  const docsRule = manifest.profiles[profile].durableKnowledgeLayer.required
    ? "`docs/` is required for this repo profile."
    : "`docs/` is optional for this repo profile.";

  return `# Wiki Schema

This file documents the local adoption of the shared portfolio wiki contract.

## Repo

- repo: ${repo || "replace-me/repo"}
- profile: ${profile}

## Shared Core Surface

\`\`\`text
wiki/
  schema.md
  conventions.md
  catalog.md
  index.md
  issues/
  initiatives/
  decisions/
  sources/
  areas/
  templates/
\`\`\`

${docsRule}

## Core Meaning

- \`wiki/work-records/WK-*.json\` is the canonical work-record layer for \`WK-*\` work
- \`wiki/issues/WK-*.md\` is only a legacy/historical Markdown issue surface for \`WK-*\` work items not yet migrated to JSON authority
- \`wiki/initiatives/IN-*.md\` is the grouped execution layer
- \`wiki/decisions/DEC-*.md\` is the durable decision layer
- \`wiki/sources/SRC-*.md\` is the evidence and provenance layer
- \`wiki/areas/{slug}.md\` groups durable repo boundaries
- \`wiki/catalog.md\` is the retrieval entrypoint
- \`wiki/catalog.md\`, \`wiki/now.md\`, \`wiki/inbox.md\`, \`wiki/backlog.md\`, and \`wiki/archive.md\` are generated views

## Declared Extension Namespaces

${extensionLines}

## Notes

- Shared core contract version: ${manifest.contractVersion}
- Generated views are not canonical state.
`;
}

function buildConventionsFile({ repo, profile, extensions }) {
  const extensionLines =
    extensions.length === 0
      ? "- no extension namespaces are currently declared"
      : extensions
          .map((namespace) => `- keep \`wiki/${namespace}/\` repo-local and explicitly documented`)
          .join("\n");

  return `# Wiki Conventions

This file is the local operating playbook for the shared portfolio wiki contract.

## Repo

- repo: ${repo || "replace-me/repo"}
- profile: ${profile}

## Core Rules

- use \`WK-*\` for canonical work items
- use \`IN-*\` for canonical initiatives
- use \`DEC-*\` for durable decisions
- use \`SRC-*\` for source registry entries
- use slug-based pages in \`wiki/areas/\`
- start retrieval from \`wiki/catalog.md\`
- treat \`wiki/catalog.md\`, \`wiki/now.md\`, \`wiki/inbox.md\`, \`wiki/backlog.md\`, and \`wiki/archive.md\` as non-canonical generated views

## Extension Rules

${extensionLines}
`;
}

function buildIndexFile({ repo, profile, extensions }) {
  const extensionSection =
    extensions.length === 0
      ? "- no extension namespaces declared"
      : extensions.map((namespace) => `- [${namespace}](./${namespace}/)`).join("\n");

  return `# Wiki Index

Repository: ${repo || "replace-me/repo"}

Profile: ${profile}

## Core

- [Catalog](./catalog.md)
- [Now](./now.md)
- [Inbox](./inbox.md)
- [Backlog](./backlog.md)
- [Archive](./archive.md)
- [Schema](./schema.md)
- [Conventions](./conventions.md)
- [Issues](./issues/)
- [Initiatives](./initiatives/)
- [Decisions](./decisions/)
- [Sources](./sources/)
- [Areas](./areas/)

## Extensions

${extensionSection}
`;
}
