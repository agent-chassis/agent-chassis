

import path from "node:path";

export const AREA_README_TARGETS = {
  "wiki-core": "packages/wiki-core",
  "wiki-mcp": "packages/wiki-mcp",
  "wiki-cli": "packages/wiki-cli",
  "agent-launch-core": "packages/agent-launch-core",
  "agent-launch-cli": "packages/agent-launch-cli",
  "controlled-vocab": "packages/wiki-core/data"
};

export const AREA_PACKAGE_META = {
  "wiki-core": { npm: "@agent-chassis/wiki-core", surface: "Exports" },
  "wiki-mcp": { npm: "@agent-chassis/wiki-mcp", surface: "Entry Points" },
  "wiki-cli": { npm: "@agent-chassis/wiki-cli", surface: "Entry Points" },
  "agent-launch-core": { npm: "@agent-chassis/agent-launch-core", surface: "Exports" },
  "agent-launch-cli": { npm: "@agent-chassis/agent-launch-cli", surface: "Entry Points" },
  "controlled-vocab": { npm: null, surface: "Public Surface" }
};

const PACKAGE_INSTALL_DOC_PATH = "docs/package-install.md";

export const ROADMAP_AREA_ALIASES = {
  "wiki-core": ["wiki-core"],
  "wiki-mcp": ["wiki-mcp"],
  "wiki-cli": ["wiki-cli"],
  "controlled-vocab": ["controlled-vocab"],
  "agent-launch-core": ["agent-launch", "agent-launch-core"],
  "agent-launch-cli": ["agent-launch", "agent-launch-cli"]
};

export const ROADMAP_OPEN_STATUSES = new Set(["inbox", "todo", "active", "review", "blocked"]);
const ROADMAP_KNOWN_WORK_AREAS = new Set(Object.values(ROADMAP_AREA_ALIASES).flat());

const INTERNAL_TOKEN_PATTERNS = [
  { kind: "record_id", regex: /\b(?:IN|DEC|SRC|HO)-\d{3,4}\b/g },
  { kind: "internal_path", regex: /\binternal\/[^\s`)\]]*/g },
  { kind: "wiki_path", regex: /\bwiki\/[^\s`)\]]*/g }
];

const ROADMAP_TITLE_INTERNAL_REF_REGEX = /\b(?:IN|DEC|SRC|HO)-\d{3,4}\b/g;
const ROADMAP_TITLE_INTERNAL_PATH_REGEX = /(?:\.\.\/)*(?:internal|wiki)\/[^\s`)\]]+/g;
const ROADMAP_TITLE_DANGLING_PREPOSITION_REGEX =
  /\b(?:for|per|from)\s*(?=$|[-:;,.)\]])/gi;
const ROADMAP_TITLE_DANGLING_CONNECTOR_REGEX =
  /\b(?:and|or|with|to)\s*(?=$|[-:;,.)\]])/gi;

const ROADMAP_TITLE_DANGLING_BEFORE_CLOSE_REGEX =
  /\s*[-:;,/|+]+\s*(?=[)\]])/g;
const PUBLIC_BRANDING_TEXT_SEGMENT_REGEX = /(`+[^`]*`+)/g;
const PUBLIC_BRANDING_NODE_ENGINE_REGEX = /\bNode Engine\b/g;

function projectPublicBranding(text) {
  return String(text ?? "")
    .split(PUBLIC_BRANDING_TEXT_SEGMENT_REGEX)
    .map((segment) => {
      if (/^`/.test(segment)) {
        return segment;
      }
      return segment.replace(PUBLIC_BRANDING_NODE_ENGINE_REGEX, "Chassis Control Engine");
    })
    .join("");
}

function scrubRoadmapTitle(title) {
  let scrubbed = projectPublicBranding(title)
    .replace(ROADMAP_TITLE_INTERNAL_REF_REGEX, "")
    .replace(ROADMAP_TITLE_INTERNAL_PATH_REGEX, "")
    .replace(/\s+([:;,.)\]])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  let previous;
  do {
    previous = scrubbed;
    scrubbed = scrubbed
      .replace(ROADMAP_TITLE_DANGLING_PREPOSITION_REGEX, "")
      .replace(ROADMAP_TITLE_DANGLING_CONNECTOR_REGEX, "")
      .replace(ROADMAP_TITLE_DANGLING_BEFORE_CLOSE_REGEX, "")
      .replace(/\s+([:;,.)\]])/g, "$1")
    .replace(/(?:\s*[-:;,/|+]+\s*)+$/g, "")
      .replace(/\(\s*\)/g, "")
    .replace(/(^|[^\w])\[\s*\](?=$|[^\w])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  } while (scrubbed !== previous);
  return scrubbed;
}

export function scanInternalLeaks(text) {
  const leaks = [];
  const lines = String(text ?? "").split("\n");
  lines.forEach((lineText, index) => {
    for (const { kind, regex } of INTERNAL_TOKEN_PATTERNS) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(lineText)) !== null) {
        leaks.push({ kind, token: match[0], line: index + 1 });
      }
    }
  });
  return leaks;
}

function extractSections(body) {
  const sections = new Map();
  let currentHeading = "";
  let buffer = [];
  const flush = () => {
    sections.set(currentHeading, buffer.join("\n").trim());
  };
  for (const line of String(body ?? "").split("\n")) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function isShippedDocPath(docPath) {
  return /^docs\//.test(String(docPath ?? ""));
}

function relativeDocLink(readmeAbsPath, targetDir, docPath) {
  const docAbs = path.resolve(targetDir, docPath);
  return path.relative(path.dirname(readmeAbsPath), docAbs).replaceAll(path.sep, "/");
}

function roadmapPriorityRank(value) {
  return {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
  }[String(value ?? "").toLowerCase()] ?? 99;
}

function isOpenRoadmapStatus(status) {
  return ROADMAP_OPEN_STATUSES.has(String(status ?? "").toLowerCase());
}

function getLoadedWorkRecord(load) {
  if (!load || typeof load !== "object") {
    return null;
  }
  if (load.valid === false) {
    return null;
  }
  if (load.record && typeof load.record === "object") {
    return load.record;
  }
  return load;
}

function getRoadmapWorkNumber(record) {
  const match = String(record?.id ?? "").match(/\d+/);
  return match ? match[0] : null;
}

function hasRoadmapExcludeTag(record) {
  return Array.isArray(record?.tags) && record.tags.includes("roadmap:exclude");
}

export function isRoadmapEligibleWorkRecord(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (!isOpenRoadmapStatus(record.status)) {
    return false;
  }
  if (hasRoadmapExcludeTag(record)) {
    return false;
  }
  return String(record.area ?? "").trim().length > 0;
}

function sortRoadmapFallback(left, right) {
  const priorityDelta = roadmapPriorityRank(left.priority) - roadmapPriorityRank(right.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const leftUpdated = String(left.updated ?? "");
  const rightUpdated = String(right.updated ?? "");
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }

  return String(left.id ?? left.title ?? "").localeCompare(String(right.id ?? right.title ?? ""));
}

function buildRoadmapDependencyOrder(records) {
  if (records.length <= 1) {
    return [...records];
  }

  const byId = new Map(records.map((record) => [String(record.id), record]));
  const indegree = new Map(records.map((record) => [String(record.id), 0]));
  const dependents = new Map(records.map((record) => [String(record.id), new Set()]));

  for (const record of records) {
    const recordId = String(record.id);
    const dependencies = Array.isArray(record.depends_on) ? record.depends_on : [];
    for (const dependencyId of dependencies) {
      const normalizedDependencyId = String(dependencyId);
      if (normalizedDependencyId === recordId || !byId.has(normalizedDependencyId)) {
        continue;
      }
      dependents.get(normalizedDependencyId).add(recordId);
      indegree.set(recordId, (indegree.get(recordId) || 0) + 1);
    }
  }

  const queue = records
    .filter((record) => (indegree.get(String(record.id)) || 0) === 0)
    .sort(sortRoadmapFallback)
    .map((record) => String(record.id));
  const queued = new Set(queue);
  const ordered = [];

  while (queue.length > 0) {
    const recordId = queue.shift();
    queued.delete(recordId);
    const record = byId.get(recordId);
    if (!record) {
      continue;
    }
    ordered.push(record);

    for (const dependentId of dependents.get(recordId) || []) {
      const nextDegree = (indegree.get(dependentId) || 0) - 1;
      indegree.set(dependentId, nextDegree);
      if (nextDegree !== 0 || queued.has(dependentId)) {
        continue;
      }
      const dependentRecord = byId.get(dependentId);
      if (!dependentRecord) {
        continue;
      }
      let insertionIndex = queue.findIndex((candidateId) => {
        const candidateRecord = byId.get(candidateId);
        return sortRoadmapFallback(dependentRecord, candidateRecord) < 0;
      });
      if (insertionIndex === -1) {
        queue.push(dependentId);
      } else {
        queue.splice(insertionIndex, 0, dependentId);
      }
      queued.add(dependentId);
    }
  }

  if (ordered.length === records.length) {
    return ordered;
  }

  const remaining = records
    .filter((record) => !ordered.some((chosen) => String(chosen.id) === String(record.id)))
    .sort(sortRoadmapFallback);
  return [...ordered, ...remaining];
}

function renderRoadmapEntry(record) {
  const title = scrubRoadmapTitle(record.title) || "Untitled work";
  const details = [];
  const workNumber = getRoadmapWorkNumber(record);
  if (workNumber) {
    details.push(`work #${workNumber}`);
  }
  details.push(`priority: ${String(record.priority ?? "unspecified")}`);
  details.push(`status: ${String(record.status ?? "unspecified")}`);
  return `- ${title}${details.length > 0 ? ` - ${details.join(", ")}` : ""}`;
}

function renderRoadmapSection(entries) {
  const lines = [
    "## Roadmap",
    "",
    "Directional open work for this area. Ordered by dependency when available; otherwise by a stable fallback. This is not a delivery schedule.",
    ""
  ];

  if (entries.length === 0) {
    lines.push("- No open work is currently mapped to this area.");
  } else {
    lines.push(...entries.map((entry) => renderRoadmapEntry(entry)));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderAreaReadme(targetDir, area, readmeAbsPath, roadmap = null) {
  const sections = extractSections(area.body);
  const areaId = area.frontmatter?.id;
  const meta = AREA_PACKAGE_META[areaId] || {};
  const packageName = meta.npm || null;
  const surfaceHeading = meta.surface || "Entry Points";

  const title = packageName
    ? packageName
    : projectPublicBranding(area.frontmatter?.title || areaId || "Area");
  const purpose = projectPublicBranding(sections.get("Summary") || "");
  const surface = projectPublicBranding(sections.get("Notes") || "");
  const roadmapEntries = Array.isArray(roadmap?.entries) ? roadmap.entries : [];

  const declaredDocPaths = (Array.isArray(area.frontmatter?.docs) ? area.frontmatter.docs : [])
    .map((docPath) => String(docPath))
    .filter(isShippedDocPath)
    .filter((docPath) => docPath !== PACKAGE_INSTALL_DOC_PATH);
  const docLinks = [PACKAGE_INSTALL_DOC_PATH, ...declaredDocPaths].map((docPath) => {
    const href = relativeDocLink(readmeAbsPath, targetDir, docPath);
    const label = docPath === PACKAGE_INSTALL_DOC_PATH ? "Package Install" : path.basename(docPath);
    return `- [${label}](${href})`;
  });

  const lines = [
    `# ${title}`,
    "<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->",
    ""
  ];

  if (purpose) {
    lines.push(purpose, "");
  }
  if (surface) {
    lines.push(`## ${surfaceHeading}`, "", surface, "");
  }
  if (packageName) {
    lines.push(
      "## Package Role",
      "",
      "This package is installed through `@agent-chassis/core` for normal use. It remains available as a granular package for consumers that need direct package control.",
      ""
    );
  }

  lines.push(renderRoadmapSection(roadmapEntries).trimEnd(), "");

  lines.push("## Related Docs", "");
  lines.push(...docLinks);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildAreaReadmeProjections(targetDir, state) {
  const outputs = new Map();
  const paths = new Set();
  const leaks = [];
  const diagnostics = [];

  const workRecords = Array.isArray(state.workRecords) ? state.workRecords : [];
  const openWorkRecords = [];
  const unmappedOpenAreas = new Map();

  for (const load of workRecords) {
    const record = getLoadedWorkRecord(load);
    if (!isRoadmapEligibleWorkRecord(record)) {
      continue;
    }

    const areaValue = String(record.area ?? "").trim();
    if (!ROADMAP_KNOWN_WORK_AREAS.has(areaValue)) {
      unmappedOpenAreas.set(areaValue, (unmappedOpenAreas.get(areaValue) || 0) + 1);
      continue;
    }

    openWorkRecords.push(record);
  }

  for (const [area, count] of unmappedOpenAreas) {
    diagnostics.push({
      kind: "unmapped_work_area",
      area,
      count
    });
  }

  const mappedAreas = (state.areas || [])
    .filter((area) => Object.prototype.hasOwnProperty.call(AREA_README_TARGETS, area.frontmatter?.id))
    .sort((left, right) =>
      String(left.frontmatter?.id).localeCompare(String(right.frontmatter?.id))
    );

  for (const area of mappedAreas) {
    const targetSubdir = AREA_README_TARGETS[area.frontmatter.id];
    const readmeAbsPath = path.join(targetDir, targetSubdir, "README.md");
    const roadmapAreaAliases = ROADMAP_AREA_ALIASES[area.frontmatter?.id] || [];
    const roadmapEntries = buildRoadmapDependencyOrder(
      openWorkRecords.filter((record) => roadmapAreaAliases.includes(String(record.area ?? "").trim()))
    );
    const content = renderAreaReadme(targetDir, area, readmeAbsPath, {
      entries: roadmapEntries
    });
    outputs.set(readmeAbsPath, content);
    paths.add(readmeAbsPath);

    const relativePath = path.relative(targetDir, readmeAbsPath).replaceAll(path.sep, "/");
    for (const leak of scanInternalLeaks(content)) {
      leaks.push({ relativePath, ...leak });
    }
  }

  return { outputs, paths, leaks, diagnostics, roadmapDiagnostics: diagnostics };
}
