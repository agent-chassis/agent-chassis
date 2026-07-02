import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const REQUIRED_FRONTMATTER_FIELDS = [
  "schema_version",
  "id",
  "title",
  "subject",
  "allowed_agents",
  "mode"
];
const FORBIDDEN_FRONTMATTER_FIELDS = new Set([
  "outputs",
  "command",
  "cwd",
  "model",
  "permissions"
]);
const FORBIDDEN_PATH_FIELD_PATTERNS = [
  /(?:^|_)path(?:s)?$/i,
  /(?:^|_)dir(?:s)?$/i,
  /(?:^|_)(?:response|wrapper|handoff|context|repo)_path$/i,
  /(?:^|_)(?:response|wrapper|handoff|context|repo)_dir$/i
];
const ALLOWED_MODES = new Set(["redteam", "code_review", "implement"]);
const GRAPH_IMPACT_CHECKPOINT_HEADING = "Graph Impact Checkpoint";
const IMPLEMENTATION_SCOPE_HEADINGS = new Set(["Write Scope"]);
const GRAPH_IMPACT_PATH_MARKERS = [
  "graph-impact-paths",
  "workspace_code_index_graph_impact_paths"
];
const GRAPH_IMPACT_DIFF_MARKERS = [
  "graph-impact-diff",
  "workspace_code_index_graph_impact_diff"
];
const GRAPH_IMPACT_MARKERS = [
  ...GRAPH_IMPACT_PATH_MARKERS,
  ...GRAPH_IMPACT_DIFF_MARKERS
];

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return value;
}

function parseFrontmatter(frontmatterText) {
  const result = {};
  for (const line of frontmatterText.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1);
    result[key] = parseScalar(rawValue);
  }
  return result;
}

function extractReadFirst(body) {
  const lines = body.split("\n");
  const results = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSection = line.trim() === "## Read First";
      continue;
    }
    if (!inSection) {
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    if (!line.startsWith("- ")) {
      throw new Error("Read First section may contain only bare bullet paths");
    }
    const value = line.slice(2).trim();
    if (!value) {
      continue;
    }
    if (value.includes("[") || value.includes("]") || value.includes("(") || value.includes(")")) {
      throw new Error("Read First section does not allow markdown links");
    }
    if (path.isAbsolute(value)) {
      throw new Error("Read First paths must be relative");
    }
    results.push(value);
  }
  return results;
}

function extractExactSection(body, heading) {
  const lines = body.split("\n");
  let inSection = false;
  const sectionLines = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inSection) {
        break;
      }
      inSection = line.trim() === `## ${heading}`;
      continue;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }
  return inSection ? sectionLines.join("\n") : null;
}

function hasExactSection(body, heading) {
  return extractExactSection(body, heading) !== null;
}

function hasNotApplicableReason(sectionText) {
  const lower = sectionText.toLowerCase();
  const marker = "not applicable";
  const index = lower.indexOf(marker);
  if (index === -1) {
    return false;
  }
  const reason = sectionText
    .slice(index + marker.length)
    .replace(/^[\s:;.,-]+/, "")
    .trim();
  return reason.length > 0;
}

export function assessGraphImpactCheckpoint(handoff) {
  const implementationScopedSignals = [];
  if (String(handoff.frontmatter.mode) === "implement") {
    implementationScopedSignals.push("mode: implement");
  }
  for (const heading of IMPLEMENTATION_SCOPE_HEADINGS) {
    if (hasExactSection(handoff.body, heading)) {
      implementationScopedSignals.push(`## ${heading}`);
    }
  }

  const required = implementationScopedSignals.length > 0;
  const checkpointText = extractExactSection(handoff.body, GRAPH_IMPACT_CHECKPOINT_HEADING);
  const sectionPresent = checkpointText !== null;
  const acceptedMarkers = sectionPresent
    ? GRAPH_IMPACT_MARKERS.filter((marker) => checkpointText.includes(marker))
    : [];
  const pathImpactMarkers = acceptedMarkers.filter((marker) =>
    GRAPH_IMPACT_PATH_MARKERS.includes(marker)
  );
  const diffImpactMarkers = acceptedMarkers.filter((marker) =>
    GRAPH_IMPACT_DIFF_MARKERS.includes(marker)
  );
  const notApplicableWithReason = sectionPresent ? hasNotApplicableReason(checkpointText) : false;
  const valid = !required || (sectionPresent && (acceptedMarkers.length > 0 || notApplicableWithReason));

  let failureReason = null;
  if (required && !sectionPresent) {
    failureReason = "missing_section";
  } else if (required && sectionPresent && !valid) {
    failureReason = checkpointText.toLowerCase().includes("not applicable")
      ? "not_applicable_missing_reason"
      : "missing_marker_or_not_applicable_reason";
  }

  return {
    required,
    valid,
    failure_reason: failureReason,
    implementation_scoped_signals: implementationScopedSignals,
    required_section: `## ${GRAPH_IMPACT_CHECKPOINT_HEADING}`,
    section_present: sectionPresent,
    accepted_markers: acceptedMarkers,
    path_impact_present: pathImpactMarkers.length > 0,
    diff_impact_present: diffImpactMarkers.length > 0,
    impact_kinds_present: [
      ...(pathImpactMarkers.length > 0 ? ["path"] : []),
      ...(diffImpactMarkers.length > 0 ? ["diff"] : [])
    ],
    path_impact_markers: pathImpactMarkers,
    diff_impact_markers: diffImpactMarkers,
    not_applicable_with_reason: notApplicableWithReason
  };
}

export async function loadHandoff(handoffPath, limits) {
  const content = await readFile(handoffPath, "utf8");
  const handoffStats = await stat(handoffPath);
  if (handoffStats.size > limits.maxHandoffBytes) {
    throw new Error(`Handoff exceeds max size of ${limits.maxHandoffBytes} bytes`);
  }
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Handoff file must begin with frontmatter");
  }
  const [, frontmatterText, body] = match;
  const frontmatter = parseFrontmatter(frontmatterText);
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (!(field in frontmatter)) {
      throw new Error(`Missing required handoff field: ${field}`);
    }
  }
  for (const field of Object.keys(frontmatter)) {
    if (FORBIDDEN_FRONTMATTER_FIELDS.has(field)) {
      throw new Error(`Forbidden handoff field: ${field}`);
    }
    if (FORBIDDEN_PATH_FIELD_PATTERNS.some((pattern) => pattern.test(field))) {
      throw new Error(`Forbidden handoff path field: ${field}`);
    }
  }
  if (!/^HO-\d{4}$/.test(String(frontmatter.id))) {
    throw new Error("Handoff id must match ^HO-[0-9]{4}$");
  }
  if (!Array.isArray(frontmatter.allowed_agents) || frontmatter.allowed_agents.length === 0) {
    throw new Error("allowed_agents must be a non-empty array");
  }
  if (!ALLOWED_MODES.has(String(frontmatter.mode))) {
    throw new Error(`Unknown handoff mode: ${frontmatter.mode}`);
  }
  return {
    content,
    frontmatter,
    body,
    readFirst: extractReadFirst(body)
  };
}
