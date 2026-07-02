import { readFile } from "node:fs/promises";
import path from "node:path";

export const DOCS_POLICY_SCHEMA_VERSION = "docs-policy.v1";

export const DOCS_POLICY_AUDIENCE_VALUES = Object.freeze([
  "agent_facing",
  "operator_or_internal"
]);

export const DOCS_POLICY_DIAGNOSTIC_CODES = Object.freeze([
  "agent_facing_wrapper_dispatch_drift",
  "agent_facing_orchestrator_launch_drift",
  "agent_facing_hidden_route_leakage",
  "agent_facing_non_mcp_role_route_drift",
  "policy_input_unreadable",
  "policy_input_out_of_scope",
  "policy_input_missing_required"
]);

export const DOCS_POLICY_DIAGNOSTIC_LEVEL_VALUES = Object.freeze([
  "info",
  "warning",
  "error"
]);

const DEFAULT_AGENT_FACING_PATHS = Object.freeze([
  "AGENTS.md",

  "packages/wiki-core/templates/AGENTS.md.boilerplate.md",
  "docs/mcp-integration.md",
  "docs/tool-discovery.md",
  "docs/agent-launch-quickstart.md"
]);

const WORKER_WRAPPER_TOKENS = Object.freeze([
  "codex-worker",
  "codex-worker-spark",
  "codex-worker-fast",
  "codex-review",
  "codex-redteam",
  "claude-worker",
  "claude-review",
  "claude-redteam",
  "gemini-worker",
  "gemini-review",
  "gemini-redteam"
]);

const ORCHESTRATOR_WRAPPER_TOKENS = Object.freeze([
  "codex-orch",
  "codex-orch-resume",
  "codex-orch-list",
  "codex-orch-xhigh",
  "codex-orch-xhigh-resume",
  "claude-orch",
  "claude-orch-resume"
]);

const HIDDEN_ROUTE_TOKENS = Object.freeze([
  "claude-review",
  "claude-redteam",
  "claude-orch",
  "claude-orch-resume",
  "gemini-worker",
  "gemini-review",
  "gemini-redteam",
  "codex-worker-fast"
]);

const OPERATOR_HEADING_PATTERN =
  /\b(operator|operators|human[-\s/]?operator|operator[-\s/]?only|internal|debugging|operational|setup|installation|deactivate|deactivated|historical|legacy)\b/i;

const OPERATOR_QUALIFIER_PATTERNS = Object.freeze([
  /human[\s/-]?operator/i,
  /operator[\s/-]?(only|shell|entrypoint|path|fallback|setup|session|surface|tooling|context)/i,
  /\boperator[s]?\b/i,
  /\brefusal[-\s]?only\b/i,
  /fail[\s-]?closed/i,
  /package[\s-]?file[\s-]?only/i,
  /launcher[\s-]?owned/i,
  /\bdeactivated\b/i,
  /\bhistorical\b/i,
  /\bunsupported\b/i,
  /\bdecommissioned\b/i,
  /\bnot supported\b/i
]);

const RECOMMENDATION_PATTERNS = Object.freeze([
  /\b(agent|agents)\s+(must|should|may|can|are\s+expected\s+to)\s+(run|invoke|use|launch|call|dispatch|start)\b/i,
  /\b(run|invoke|use|launch|call|dispatch|start)\s+`?(codex|claude|gemini)-[a-z-]+/i,
  /\brecommended\s+(route|dispatch|path|command)\b/i
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function classifyHeadingAudience(headingText) {
  if (!headingText) {
    return "agent_facing";
  }
  if (OPERATOR_HEADING_PATTERN.test(headingText)) {
    return "operator_or_internal";
  }
  return "agent_facing";
}

function paragraphHasOperatorQualifier(paragraphText) {
  if (!paragraphText) return false;
  return OPERATOR_QUALIFIER_PATTERNS.some((pattern) => pattern.test(paragraphText));
}

function recommendsAgentAction(paragraphText) {
  if (!paragraphText) return false;
  return RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(paragraphText));
}

function tokenAppearsInLine(line, token) {
  const escaped = token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`);
  return pattern.test(line);
}

function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = {
    heading: null,
    headingLine: 0,
    depth: 0,
    audience: "agent_facing",
    startLine: 1,
    paragraphs: []
  };
  let paragraph = { startLine: 1, text: "", lines: [] };

  function pushParagraph() {
    if (paragraph.lines.length > 0) {
      current.paragraphs.push({
        startLine: paragraph.startLine,
        text: paragraph.text.trim(),
        lines: paragraph.lines.slice()
      });
    }
    paragraph = { startLine: 0, text: "", lines: [] };
  }

  function pushSection(nextHeading) {
    pushParagraph();
    sections.push(current);
    current = {
      heading: nextHeading.text,
      headingLine: nextHeading.line,
      depth: nextHeading.depth,
      audience: classifyHeadingAudience(nextHeading.text),
      startLine: nextHeading.line,
      paragraphs: []
    };
  }

  let fenceMarker = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      const length = fenceMatch[2].length;
      if (fenceMarker == null) {
        fenceMarker = { marker, length };
      } else if (
        fenceMarker.marker === marker &&
        length >= fenceMarker.length &&
        line.trim().replace(/^[`~]+/, "").length === 0
      ) {
        fenceMarker = null;
      }
      if (paragraph.lines.length === 0) {
        paragraph.startLine = lineNumber;
      }
      paragraph.lines.push({ lineNumber, text: line });
      paragraph.text = paragraph.text ? `${paragraph.text}\n${line}` : line;
      continue;
    }
    if (fenceMarker != null) {
      if (paragraph.lines.length === 0) {
        paragraph.startLine = lineNumber;
      }
      paragraph.lines.push({ lineNumber, text: line });
      paragraph.text = paragraph.text ? `${paragraph.text}\n${line}` : line;
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      pushSection({
        depth: headingMatch[1].length,
        text: headingMatch[2].trim(),
        line: lineNumber
      });
      continue;
    }
    if (line.trim() === "") {
      pushParagraph();
      continue;
    }
    if (paragraph.lines.length === 0) {
      paragraph.startLine = lineNumber;
    }
    paragraph.lines.push({ lineNumber, text: line });
    paragraph.text = paragraph.text ? `${paragraph.text}\n${line}` : line;
  }
  pushParagraph();
  sections.push(current);
  return sections;
}

function createDiagnostic({ code, level, message, audience, file, line, snippet, token }) {
  return {
    code,
    level,
    message,
    audience,
    file,
    line,
    snippet,
    token: token || null
  };
}

function evaluateParagraph({ section, paragraph, relativePath, diagnostics }) {
  if (section.audience !== "agent_facing") {
    return;
  }
  const paragraphText = paragraph.text;
  const operatorQualifier = paragraphHasOperatorQualifier(paragraphText);
  const recommendsAgent = recommendsAgentAction(paragraphText);

  for (const entry of paragraph.lines) {
    const line = entry.text;
    for (const token of WORKER_WRAPPER_TOKENS) {
      if (!tokenAppearsInLine(line, token)) continue;
      if (operatorQualifier && !recommendsAgent) {
        continue;
      }
      diagnostics.push(
        createDiagnostic({
          code: "agent_facing_wrapper_dispatch_drift",
          level: "error",
          message: `Agent-facing section references wrapper command \`${token}\` without an operator/refusal qualifier; agents must dispatch via MCP \`workspace_agent_dispatch\` instead.`,
          audience: section.audience,
          file: relativePath,
          line: entry.lineNumber,
          snippet: line.trim(),
          token
        })
      );
    }
    for (const token of ORCHESTRATOR_WRAPPER_TOKENS) {
      if (!tokenAppearsInLine(line, token)) continue;
      if (operatorQualifier) {
        continue;
      }
      diagnostics.push(
        createDiagnostic({
          code: "agent_facing_orchestrator_launch_drift",
          level: "error",
          message: `Agent-facing section references orchestrator command \`${token}\` without a human/operator qualifier; agents do not launch orchestrators.`,
          audience: section.audience,
          file: relativePath,
          line: entry.lineNumber,
          snippet: line.trim(),
          token
        })
      );
    }
    for (const token of HIDDEN_ROUTE_TOKENS) {
      if (!tokenAppearsInLine(line, token)) continue;
      if (operatorQualifier) {
        continue;
      }
      diagnostics.push(
        createDiagnostic({
          code: "agent_facing_hidden_route_leakage",
          level: "warning",
          message: `Agent-facing section names hidden/refusal-only route \`${token}\` without a fail-closed/deactivated qualifier; this can leak hidden routes into agent diagnostics.`,
          audience: section.audience,
          file: relativePath,
          line: entry.lineNumber,
          snippet: line.trim(),
          token
        })
      );
    }
  }

  if (recommendsAgent && !operatorQualifier) {
    const wrapperHit = WORKER_WRAPPER_TOKENS.find((token) => tokenAppearsInLine(paragraphText, token));
    const orchestratorHit = ORCHESTRATOR_WRAPPER_TOKENS.find((token) =>
      tokenAppearsInLine(paragraphText, token)
    );
    if (wrapperHit || orchestratorHit) {
      diagnostics.push(
        createDiagnostic({
          code: "agent_facing_non_mcp_role_route_drift",
          level: "error",
          message: `Agent-facing paragraph recommends a non-MCP role route (\`${wrapperHit || orchestratorHit}\`); agents must use MCP \`workspace_agent_dispatch\` for worker, reviewer, and redteam calls.`,
          audience: section.audience,
          file: relativePath,
          line: paragraph.startLine,
          snippet: paragraphText.split(/\r?\n/)[0].trim(),
          token: wrapperHit || orchestratorHit
        })
      );
    }
  }
}

export function validateDocsPolicyMarkdown({
  relativePath,
  markdown
}) {
  const diagnostics = [];
  const sections = parseSections(markdown);
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      evaluateParagraph({ section, paragraph, relativePath, diagnostics });
    }
  }
  return {
    file: relativePath,
    diagnostics
  };
}

function sortDiagnostics(diagnostics) {
  const levelOrder = new Map(DOCS_POLICY_DIAGNOSTIC_LEVEL_VALUES.map((value, index) => [value, index]));
  return diagnostics.slice().sort((left, right) => {
    const leftLevel = levelOrder.get(left.level) ?? Number.POSITIVE_INFINITY;
    const rightLevel = levelOrder.get(right.level) ?? Number.POSITIVE_INFINITY;
    if (leftLevel !== rightLevel) return rightLevel - leftLevel;
    if (left.file !== right.file) return String(left.file).localeCompare(String(right.file));
    if (left.line !== right.line) return left.line - right.line;
    return left.code.localeCompare(right.code);
  });
}

function summarizeDiagnostics(diagnostics) {
  const summary = {
    total: diagnostics.length,
    by_code: {},
    by_level: {},
    by_file: {}
  };
  for (const diagnostic of diagnostics) {
    summary.by_code[diagnostic.code] = (summary.by_code[diagnostic.code] || 0) + 1;
    summary.by_level[diagnostic.level] = (summary.by_level[diagnostic.level] || 0) + 1;
    summary.by_file[diagnostic.file] = (summary.by_file[diagnostic.file] || 0) + 1;
  }
  return summary;
}

function isActionableDiagnostic(diagnostic) {
  return diagnostic.level !== "info";
}

function summarizeDiagnosticCounts(diagnostics) {
  let info = 0;
  let warning = 0;
  let error = 0;

  for (const diagnostic of diagnostics) {
    switch (diagnostic.level) {
      case "info":
        info += 1;
        break;
      case "warning":
        warning += 1;
        break;
      case "error":
        error += 1;
        break;
      default:
        break;
    }
  }

  return {
    total: diagnostics.length,
    actionable: diagnostics.filter(isActionableDiagnostic).length,
    info,
    warning,
    error
  };
}

function defineHiddenProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: false
  });
}

function buildDocsPolicyEnvelope({
  schemaVersion,
  targetDir,
  requestedPaths,
  filesScanned,
  valid,
  diagnostics,
  verbose,
  includeAllFindings
}) {
  const fullOutput = verbose === true || includeAllFindings === true;
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  const diagnosticCounts = summarizeDiagnosticCounts(sortedDiagnostics);
  const actionableDiagnostics = sortedDiagnostics.filter(isActionableDiagnostic);
  const envelope = {
    schema_version: schemaVersion,
    valid,
    ok: valid,
    diagnostic_counts: diagnosticCounts,
    diagnostics: fullOutput ? sortedDiagnostics : actionableDiagnostics
  };

  if (fullOutput) {
    envelope.generated_at = new Date().toISOString();
    envelope.target_dir = targetDir;
    envelope.files_scanned = filesScanned.slice();
    envelope.requested_paths = requestedPaths.slice();
    envelope.summary = summarizeDiagnostics(sortedDiagnostics);
    return envelope;
  }

  defineHiddenProperty(envelope, "generated_at", new Date().toISOString());
  defineHiddenProperty(envelope, "target_dir", targetDir);
  defineHiddenProperty(envelope, "files_scanned", filesScanned.slice());
  defineHiddenProperty(envelope, "requested_paths", requestedPaths.slice());
  return envelope;
}

function resolveContainedPath(targetDir, requested) {
  const raw = String(requested).replaceAll("\\", "/");
  const relativeInput = raw.replace(/^\.\//, "");
  if (path.isAbsolute(raw)) {
    return { error: "absolute", relativePath: raw };
  }
  const absolutePath = path.resolve(targetDir, relativeInput);
  const containment = path.relative(targetDir, absolutePath).split(path.sep).join("/");
  if (
    containment === ".." ||
    containment.startsWith("../") ||
    path.isAbsolute(containment)
  ) {
    return { error: "traversal", relativePath: raw };
  }
  const relativePath = containment === "" ? relativeInput : containment;
  return { absolutePath, relativePath };
}

export async function validateDocsPolicy({
  dir = ".",
  paths = null,
  verbose = false,
  include_all_findings = false
} = {}) {
  const targetDir = path.resolve(String(dir));
  const useDefaults = !(Array.isArray(paths) && paths.length > 0);
  const requestedPaths = useDefaults
    ? DEFAULT_AGENT_FACING_PATHS.slice()
    : paths.slice();
  const diagnostics = [];
  const filesScanned = [];

  for (const requested of requestedPaths) {
    const resolved = resolveContainedPath(targetDir, requested);
    const relativePath = resolved.relativePath;
    if (resolved.error) {
      diagnostics.push({
        code: "policy_input_out_of_scope",
        level: "error",
        message:
          resolved.error === "absolute"
            ? `Policy input must be a workspace-relative path; absolute paths are rejected: ${relativePath}`
            : `Policy input resolves outside the configured workspace and is rejected: ${relativePath}`,
        audience: "agent_facing",
        file: relativePath,
        line: 0,
        snippet: null,
        token: null,
        details: { reason: resolved.error }
      });
      continue;
    }
    let text;
    try {
      text = await readFile(resolved.absolutePath, "utf8");
    } catch (error) {
      diagnostics.push({
        code: useDefaults ? "policy_input_missing_required" : "policy_input_unreadable",
        level: useDefaults ? "error" : "warning",
        message: useDefaults
          ? `Required canonical policy input is missing or unreadable: ${relativePath}`
          : `Unable to read policy input: ${relativePath}`,
        audience: "agent_facing",
        file: relativePath,
        line: 0,
        snippet: null,
        token: null,
        details: { errno: error?.code || null }
      });
      continue;
    }
    filesScanned.push(relativePath);
    const result = validateDocsPolicyMarkdown({ relativePath, markdown: text });
    diagnostics.push(...result.diagnostics);
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  const hasError = sortedDiagnostics.some((entry) => entry.level === "error");
  const scannedRequired = useDefaults && filesScanned.length === 0;
  const valid = !hasError && !scannedRequired;
  return buildDocsPolicyEnvelope({
    schemaVersion: DOCS_POLICY_SCHEMA_VERSION,
    targetDir,
    requestedPaths,
    filesScanned,
    valid,
    diagnostics: sortedDiagnostics,
    verbose,
    includeAllFindings: include_all_findings
  });
}

export function getDocsPolicyDefaultPaths() {
  return DEFAULT_AGENT_FACING_PATHS.slice();
}

export function isDocsPolicyDiagnosticCode(code) {
  return DOCS_POLICY_DIAGNOSTIC_CODES.includes(code);
}

export function _internal_classifyHeadingAudience(headingText) {
  return classifyHeadingAudience(headingText);
}
