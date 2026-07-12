import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManifest } from "../lib/contract.mjs";
import { buildAreaReadmeProjections } from "./generate-area-readme-projection.mjs";
import {
  ensureDirectory,
  listRecordFiles,
  loadCanonicalState,
  pathExists,
  resolvePageFacets,
  resolveContractContext,
  today
} from "../lib/wiki.mjs";

async function countMarkdownFiles(directoryPath) {
  if (!(await pathExists(directoryPath))) {
    return 0;
  }
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
}

function priorityRank(value) {
  return {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
  }[String(value ?? "").toLowerCase()] ?? 99;
}

function sortByPriorityAndUpdated(items) {
  return [...items].sort((left, right) => {
    const priorityDelta =
      priorityRank(left.frontmatter?.priority) - priorityRank(right.frontmatter?.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const leftUpdated = String(left.frontmatter?.updated ?? "");
    const rightUpdated = String(right.frontmatter?.updated ?? "");
    if (leftUpdated !== rightUpdated) {
      return rightUpdated.localeCompare(leftUpdated);
    }

    return String(left.frontmatter?.id ?? left.title).localeCompare(
      String(right.frontmatter?.id ?? right.title)
    );
  });
}

function isClosedStatus(status) {
  return ["done", "cancelled", "deprecated", "duplicate", "superseded", "expired", "wont_do"].includes(
    String(status ?? "").toLowerCase()
  );
}

function hasUnresolvedDependencies(page, pagesById) {
  const dependencies = Array.isArray(page.frontmatter?.depends_on)
    ? page.frontmatter.depends_on
    : [];

  return dependencies.some((dependencyId) => {
    const dependencyPage = pagesById.get(String(dependencyId));
    if (!dependencyPage) {
      return true;
    }
    return !isClosedStatus(dependencyPage.frontmatter?.status);
  });
}

function entryLink(targetDir, page) {
  return `./${path.relative(path.join(targetDir, "wiki"), page.path).replaceAll(path.sep, "/")}`;
}

function docLink(targetDir, docPath) {
  return `../${path.relative(targetDir, docPath).replaceAll(path.sep, "/")}`;
}

function renderPageBullet(targetDir, page, extra = []) {
  const owners = Array.isArray(page.frontmatter?.owners)
    ? page.frontmatter.owners
    : null;
  const ownerValue = page.frontmatter?.owner || (owners?.length ? owners.join(", ") : null);
  const parts = [
    `\`${page.frontmatter?.id ?? page.title}\``,
    ...(ownerValue ? [`owner: ${ownerValue}`] : []),
    ...(page.frontmatter?.priority ? [`priority: ${page.frontmatter.priority}`] : []),
    ...(page.frontmatter?.status ? [`status: ${page.frontmatter.status}`] : []),
    ...(page.frontmatter?.updated ? [`updated: ${page.frontmatter.updated}`] : []),
    ...extra
  ];

  return `- [${page.title}](${entryLink(targetDir, page)})${
    parts.length > 0 ? ` - ${parts.join(", ")}` : ""
  }`;
}

function buildGeneratedHeader(title, description) {
  return [
    `# ${title}`,
    "",
    "<!-- generated: do not edit manually -->",
    description,
    ""
  ].join("\n");
}

function renderSection(title, lines) {
  if (lines.length === 0) {
    return `## ${title}\n\n- None\n`;
  }

  return `## ${title}\n\n${lines.join("\n")}\n`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeCatalogPolicyHash(policy) {
  return createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

function catalogEnabled(page, context) {
  if (page.frontmatter?.catalog === false) {
    return false;
  }
  return resolvePageFacets(page, context).effective.retrieval_visibility !== "suppressed";
}

function catalogEligibleByOverride(page) {
  return page.frontmatter?.catalog_eligible === true;
}

function catalogWeight(page) {
  const value = Number(page.frontmatter?.catalog_weight ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function tieBreakPageOrder(left, right) {
  const leftUpdated = String(left.frontmatter?.updated ?? "");
  const rightUpdated = String(right.frontmatter?.updated ?? "");
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }

  const leftId = String(left.frontmatter?.id ?? "");
  const rightId = String(right.frontmatter?.id ?? "");
  if (leftId && rightId && leftId !== rightId) {
    return leftId.localeCompare(rightId);
  }

  return left.title.localeCompare(right.title);
}

function pageSection(page, extensionNamespaces) {
  const relativePath = page.relativePath;
  if (relativePath.startsWith("docs/")) {
    return "docs";
  }
  if (relativePath.startsWith("wiki/sources/")) {
    return "sources";
  }
  if (relativePath.startsWith("wiki/areas/")) {
    return "areas";
  }
  if (relativePath.startsWith("wiki/decisions/")) {
    return "decisions";
  }
  if (
    relativePath.startsWith("wiki/issues/") ||
    relativePath.startsWith("wiki/initiatives/")
  ) {
    return "active_work";
  }

  for (const namespace of extensionNamespaces) {
    if (relativePath.startsWith(`wiki/${namespace}/`)) {
      return "extensions";
    }
  }

  return null;
}

function namespaceName(page, extensionNamespaces) {
  for (const namespace of extensionNamespaces) {
    if (page.relativePath.startsWith(`wiki/${namespace}/`)) {
      return namespace;
    }
  }
  return null;
}

function isLocalLink(target) {
  return (
    target &&
    !target.startsWith("#") &&
    !target.startsWith("http://") &&
    !target.startsWith("https://") &&
    !target.startsWith("mailto:")
  );
}

function resolveLinkedPage(targetDir, sourcePage, href, pagesByRelativePath) {
  const clean = String(href || "").split("#")[0];
  if (!isLocalLink(clean)) {
    return null;
  }

  const sourceDir = path.dirname(path.join(targetDir, sourcePage.relativePath));
  const absolutePath = path.resolve(sourceDir, clean);
  if (!absolutePath.startsWith(path.resolve(targetDir))) {
    return null;
  }

  const relativePath = path.relative(targetDir, absolutePath).replaceAll(path.sep, "/");
  return pagesByRelativePath.get(relativePath) || null;
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function collectCatalogDocPaths(state, context) {
  const docPaths = new Set();

  for (const page of [...state.issues, ...state.initiatives, ...state.decisions, ...state.areas]) {
    for (const docPath of Array.isArray(page.frontmatter?.docs) ? page.frontmatter.docs : []) {
      docPaths.add(String(docPath));
    }
  }

  for (const source of state.sources) {
    for (const docPath of Array.isArray(source.frontmatter?.related_docs)
      ? source.frontmatter.related_docs
      : []) {
      docPaths.add(String(docPath));
    }
  }

  for (const doc of state.docs) {
    if ((doc.backlinks.length > 0 || catalogEligibleByOverride(doc)) && catalogEnabled(doc, context)) {
      docPaths.add(doc.relativePath);
    }
  }

  return docPaths;
}

function buildCatalogGraph(targetDir, state, context) {
  const extensionNamespaces = state.extensionNamespaces || [];
  const allPages = [
    ...state.docs,
    ...state.sources,
    ...state.areas,
    ...state.decisions,
    ...state.issues,
    ...state.initiatives,
    ...state.extensionPages
  ];
  const pagesByRelativePath = new Map(allPages.map((page) => [page.relativePath, page]));
  const pagesById = new Map();
  for (const page of [
    ...state.sources,
    ...state.areas,
    ...state.decisions,
    ...state.issues,
    ...state.initiatives
  ]) {
    if (page.frontmatter?.id) {
      pagesById.set(String(page.frontmatter.id), page);
    }
  }

  const inboundBySection = new Map();
  const outboundBySection = new Map();
  const inboundByPage = new Map();
  const outboundByPage = new Map();

  function addEdge(sourcePage, targetPage) {
    if (!sourcePage || !targetPage || !catalogEnabled(targetPage, context)) {
      return;
    }

    const sourceSection = pageSection(sourcePage, extensionNamespaces);
    const targetSection = pageSection(targetPage, extensionNamespaces);
    if (!sourceSection || !targetSection) {
      return;
    }

    addCount(outboundBySection, sourceSection);
    addCount(inboundBySection, targetSection);
    addCount(outboundByPage, sourcePage.relativePath);
    addCount(inboundByPage, targetPage.relativePath);
  }

  const structuredPages = [
    ...state.sources,
    ...state.areas,
    ...state.decisions,
    ...state.issues,
    ...state.initiatives
  ];

  const docFieldNames = ["docs", "related_docs"];
  const idFieldNames = [
    "area",
    "initiative",
    "related_work",
    "sources",
    "decisions",
    "initiatives",
    "related",
    "depends_on",
    "blocks",
    "supersedes",
    "superseded_by",
    "duplicate_of",
    "deprecated_by"
  ];

  for (const page of structuredPages) {
    for (const fieldName of docFieldNames) {
      const values = Array.isArray(page.frontmatter?.[fieldName])
        ? page.frontmatter[fieldName]
        : [];
      for (const relativePath of values) {
        addEdge(page, pagesByRelativePath.get(String(relativePath)));
      }
    }

    for (const fieldName of idFieldNames) {
      const rawValue = page.frontmatter?.[fieldName];
      const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
      for (const value of values) {
        addEdge(page, pagesById.get(String(value)));
      }
    }
  }

  for (const page of [...allPages, ...state.wikiPages]) {
    for (const markdownLink of page.markdownLinks || []) {
      addEdge(page, resolveLinkedPage(targetDir, page, markdownLink, pagesByRelativePath));
    }
  }

  return {
    inboundBySection,
    outboundBySection,
    inboundByPage,
    outboundByPage
  };
}

function buildSectionDefinitions(targetDir, state, context) {
  const catalogDocs = [...collectCatalogDocPaths(state, context)]
    .map((docRelativePath) => state.docs.find((doc) => doc.relativePath === docRelativePath))
    .filter((doc) => doc && catalogEnabled(doc, context));
  const sources = state.sources.filter((page) => catalogEnabled(page, context));
  const areas = state.areas.filter((page) => catalogEnabled(page, context));
  const decisions = state.decisions.filter((page) => catalogEnabled(page, context));
  const activeWork = [...state.issues, ...state.initiatives].filter(
    (page) => catalogEnabled(page, context) && !isClosedStatus(page.frontmatter?.status)
  );
  const extensionNamespaces = state.extensionNamespaces || [];
  const extensionGroups = extensionNamespaces
    .map((namespace) => ({
      namespace,
      pages: state.extensionPages.filter(
        (page) => namespaceName(page, extensionNamespaces) === namespace && catalogEnabled(page, context)
      )
    }))
    .filter((group) => group.pages.length > 0);

  return {
    docs: {
      title: "Docs",
      items: catalogDocs,
      renderLines: (orderedItems) =>
        orderedItems.map((doc) => `- [${doc.title}](${docLink(targetDir, doc.path)})`)
    },
    sources: {
      title: "Sources",
      items: sources,
      renderLines: (orderedItems) =>
        orderedItems.map((page) =>
          renderPageBullet(targetDir, page, [
            ...(page.frontmatter?.kind ? [`kind: ${page.frontmatter.kind}`] : [])
          ])
        )
    },
    areas: {
      title: "Areas",
      items: areas,
      renderLines: (orderedItems) =>
        orderedItems.map((page) => `- [${page.title}](${entryLink(targetDir, page)})`)
    },
    decisions: {
      title: "Decisions",
      items: decisions,
      renderLines: (orderedItems) => orderedItems.map((page) => renderPageBullet(targetDir, page))
    },
    active_work: {
      title: "Active Work",
      items: activeWork,
      renderLines: (orderedItems) => orderedItems.map((page) => renderPageBullet(targetDir, page))
    },
    extensions: {
      title: "Extensions",
      items: extensionGroups.flatMap((group) => group.pages),
      groups: extensionGroups
    }
  };
}

function itemScore(page, graph) {
  return (
    (graph.inboundByPage.get(page.relativePath) || 0) +
    (graph.outboundByPage.get(page.relativePath) || 0) +
    catalogWeight(page)
  );
}

function sortItemsForCatalog(items, graph) {
  return [...items].sort((left, right) => {
    const scoreDelta = itemScore(right, graph) - itemScore(left, graph);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return tieBreakPageOrder(left, right);
  });
}

function renderExtensionSection(targetDir, section, graph) {
  if (section.groups.length === 0) {
    return renderSection(section.title, []);
  }

  const namespaceBlocks = [...section.groups]
    .sort((left, right) => left.namespace.localeCompare(right.namespace))
    .map((group) => {
      const lines = sortItemsForCatalog(group.pages, graph).map(
        (page) => `- [${page.title}](${entryLink(targetDir, page)})`
      );
      return [`### ${group.namespace}`, "", ...lines].join("\n");
    });

  return `## ${section.title}\n\n${namespaceBlocks.join("\n\n")}\n`;
}

export function generateNowPage(targetDir, state, context) {
  const activePages = [...state.issues, ...state.initiatives];
  const inProgress = sortByPriorityAndUpdated(
    activePages.filter(
      (page) => page.frontmatter?.status === "in_progress" && catalogEnabled(page, context)
    )
  );
  const inReview = sortByPriorityAndUpdated(
    activePages.filter((page) => page.frontmatter?.status === "review" && catalogEnabled(page, context))
  );
  const blocked = sortByPriorityAndUpdated(
    activePages.filter((page) => page.frontmatter?.status === "blocked" && catalogEnabled(page, context))
  );
  const readyNext = sortByPriorityAndUpdated(
    state.issues.filter(
      (page) =>
        catalogEnabled(page, context) &&
        page.frontmatter?.status === "todo" &&
        !hasUnresolvedDependencies(page, state.pagesById) &&
        ["critical", "high"].includes(String(page.frontmatter?.priority ?? "").toLowerCase())
    )
  );

  return [
    buildGeneratedHeader("Now", "Generated from canonical issue and initiative pages."),
    renderSection("In Progress", inProgress.map((page) => renderPageBullet(targetDir, page))),
    renderSection("In Review", inReview.map((page) => renderPageBullet(targetDir, page))),
    renderSection("Blocked", blocked.map((page) => renderPageBullet(targetDir, page))),
    renderSection("Ready Next", readyNext.map((page) => renderPageBullet(targetDir, page)))
  ].join("\n");
}

export function generateInboxPage(targetDir, state, context) {
  const inboxItems = sortByPriorityAndUpdated(
    state.issues.filter((page) => page.frontmatter?.status === "inbox" && catalogEnabled(page, context))
  );

  return [
    buildGeneratedHeader(
      "Inbox",
      "Generated from canonical issue pages with `status: inbox`. Use this only for untriaged work."
    ),
    renderSection("Untriaged", inboxItems.map((page) => renderPageBullet(targetDir, page)))
  ].join("\n");
}

export function generateBacklogPage(targetDir, state, context) {
  const todoItems = sortByPriorityAndUpdated(
    state.issues.filter(
      (page) =>
        catalogEnabled(page, context) &&
        page.frontmatter?.status === "todo" &&
        !["critical", "high"].includes(String(page.frontmatter?.priority ?? "").toLowerCase())
    )
  );
  const parkedItems = sortByPriorityAndUpdated(
    state.issues.filter((page) => page.frontmatter?.status === "parked" && catalogEnabled(page, context))
  );

  return [
    buildGeneratedHeader("Backlog", "Generated from triaged issue pages that are not currently active."),
    renderSection("Todo", todoItems.map((page) => renderPageBullet(targetDir, page))),
    renderSection("Parked", parkedItems.map((page) => renderPageBullet(targetDir, page)))
  ].join("\n");
}

export function generateArchivePage(targetDir, state, context) {
  const archivedItems = sortByPriorityAndUpdated(
    state.issues.filter((page) => isClosedStatus(page.frontmatter?.status) && catalogEnabled(page, context))
  );

  return [
    buildGeneratedHeader("Archive", "Generated from closed issue pages."),
    renderSection("Closed Work", archivedItems.map((page) => renderPageBullet(targetDir, page)))
  ].join("\n");
}

export function generateCatalogPage(targetDir, state, manifest, context) {
  const catalogPolicy = manifest.catalog;
  const policyHash = computeCatalogPolicyHash(catalogPolicy);
  const graph = buildCatalogGraph(targetDir, state, context);
  const sections = buildSectionDefinitions(targetDir, state, context);
  const eligibleSections = Object.entries(sections).filter(([, section]) => section.items.length > 0);
  const eligibleSectionKeys = new Set(eligibleSections.map(([sectionKey]) => sectionKey));
  const orderedSectionKeys = [
    ...catalogPolicy.sectionBaseOrder.filter((sectionKey) => eligibleSectionKeys.has(sectionKey)),
    ...eligibleSections
      .map(([sectionKey]) => sectionKey)
      .filter((sectionKey) => !catalogPolicy.sectionBaseOrder.includes(sectionKey))
      .sort()
  ];

  const sectionBlocks = orderedSectionKeys.map((key) => {
    const section = sections[key];
    if (key === "extensions") {
      return renderExtensionSection(targetDir, section, graph);
    }
    return renderSection(section.title, section.renderLines(sortItemsForCatalog(section.items, graph)));
  });

  return [
    "# Catalog",
    "",
    "<!-- generated: do not edit manually -->",
    `<!-- catalog_version: ${catalogPolicy.catalogVersion} -->`,
    `<!-- catalog_policy_hash: ${policyHash} -->`,
    "Generated retrieval entrypoint ranked from canonical wiki/docs signals and shared policy.",
    "",
    ...sectionBlocks
  ].join("\n");
}

export async function buildGeneratedViews({
  dir = ".",
  profile = null,
  extensionNamespaces = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const context = await resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const manifest = await loadManifest();
  const generatedDir = path.join(targetDir, manifest.generatedViews.defaultDirectory);

  const counts = [];
  for (const [type, definition] of Object.entries(manifest.types)) {
    const count = (await listRecordFiles(targetDir, definition)).length;
    counts.push({ type, count, directory: definition.directory });
  }

  const extensionCounts = [];
  for (const namespace of context.extensionNamespaces) {
    const count = await countMarkdownFiles(path.join(targetDir, "wiki", namespace));
    extensionCounts.push({
      type: `extension:${namespace}`,
      count,
      directory: `wiki/${namespace}`
    });
  }

  const summaryLines = [
    "# Generated Wiki Summary",
    "",
    `Generated: ${today()}`,
    `Profile: ${context.profile}`,
    "",
    "> This file is derived output and is not canonical state.",
    "",
    "| Type | Directory | Count |",
    "| --- | --- | ---: |",
    ...counts.map((item) => `| ${item.type} | ${item.directory} | ${item.count} |`),
    ...extensionCounts.map(
      (item) => `| ${item.type} | ${item.directory} | ${item.count} |`
    )
  ];

  const summaryPath = path.join(generatedDir, "summary.md");
  const state = await loadCanonicalState(targetDir, {
    extensionNamespaces: context.extensionNamespaces
  });
  const outputs = new Map([
    [path.join(targetDir, "wiki", "now.md"), generateNowPage(targetDir, state, context)],
    [path.join(targetDir, "wiki", "inbox.md"), generateInboxPage(targetDir, state, context)],
    [path.join(targetDir, "wiki", "backlog.md"), generateBacklogPage(targetDir, state, context)],
    [path.join(targetDir, "wiki", "archive.md"), generateArchivePage(targetDir, state, context)],
    [path.join(targetDir, "wiki", "catalog.md"), generateCatalogPage(targetDir, state, manifest, context)]
  ]);

  const areaReadmeProjection = buildAreaReadmeProjections(targetDir, state);
  for (const [filePath, content] of areaReadmeProjection.outputs) {
    outputs.set(filePath, content);
  }

  const areaReadmeDiagnostics = Array.isArray(areaReadmeProjection.diagnostics)
    ? areaReadmeProjection.diagnostics
    : [];

  return {
    targetDir,
    context,
    manifest,
    generatedDir,
    state,
    summaryPath,
    summaryContent: `${summaryLines.join("\n")}\n`,
    outputs,
    areaReadmePaths: areaReadmeProjection.paths,
    areaReadmeLeaks: areaReadmeProjection.leaks,
    areaReadmeDiagnostics,
    counts: [...counts, ...extensionCounts]
  };
}

export async function generateViews({
  dir = ".",
  profile = null,
  extensionNamespaces = null
} = {}) {
  const build = await buildGeneratedViews({ dir, profile, extensionNamespaces });

  if (Array.isArray(build.areaReadmeLeaks) && build.areaReadmeLeaks.length > 0) {
    const detail = build.areaReadmeLeaks
      .map((leak) => `${leak.relativePath}:${leak.line} ${leak.kind} '${leak.token}'`)
      .join("; ");
    throw new Error(
      `Refusing to generate package READMEs: internal-only reference would leak into a shipped projection (${detail}). Remove the internal reference from the source area record.`
    );
  }

  await ensureDirectory(build.generatedDir);
  await writeFile(build.summaryPath, build.summaryContent, "utf8");

  for (const [filePath, content] of build.outputs) {
    await ensureDirectory(path.dirname(filePath));
    await writeFile(filePath, `${content.trimEnd()}\n`, "utf8");
  }

  return {
    targetDir: build.targetDir,
    outputPath: build.summaryPath,
    summaryPath: build.summaryPath,
    outputPaths: [...build.outputs.keys(), build.summaryPath],
    generatedViews: [...build.outputs.keys()],

    areaReadmeDiagnostics: Array.isArray(build.areaReadmeDiagnostics)
      ? build.areaReadmeDiagnostics
      : [],
    counts: build.counts
  };
}
