

import { isBashWrapperPath } from "./work-record-dispatch-shared.mjs";
import { collectGraphImpactSubjectPaths } from "./work-record-dispatch-graph.mjs";

export function collectValidationHints({
  policy,
  parserDiagnostics,
  subject,
  unit,
  selectedUnit,
  reportOnly,
  decisionCode = null
}) {
  const hints = [];

  for (const diagnostic of Array.isArray(parserDiagnostics) ? parserDiagnostics : []) {
    if (diagnostic.code === "stale_projection") {
      hints.push("Projection metadata is stale; refresh generated projections before launch.");
    }
  }

  if (policy?.split_recommendation?.required) {
    hints.push(policy.split_recommendation.reason);
  }

  if (unit.kind === "work_item" && selectedUnit?.kind === "slice") {
    hints.push(`Selected slice ${unit.address} is being evaluated independently of the parent tracker.`);
  }

  if (reportOnly) {
    hints.push("Compatibility/report mode is non-authoritative for worker launch.");
  }

  if (decisionCode === "missing_graph_impact") {
    hints.push(
      ...collectMissingGraphImpactHints({
        subject: subject || selectedUnit || unit,
        unit
      })
    );
  }

  return [...new Set(hints)];
}

function buildGraphImpactPathsCommand(paths) {
  return [
    "npm",
    "run",
    "--silent",
    "wiki",
    "--",
    "code-index",
    "graph-impact-paths",
    "--json",
    "--paths",
    ...paths.map((path) => shellQuote(path))
  ].join(" ");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function buildValidateDispatchCommand(unitAddress) {
  return ["npm", "run", "wiki", "--", "validate-dispatch", "--unit", unitAddress, "--json"].join(
    " "
  );
}

function buildPersistGraphImpactCommand(unitAddress, graphImpactFilePlaceholder) {
  return [
    "npm",
    "run",
    "wiki",
    "--",
    "work-records",
    "persist-graph-impact",
    "--unit",
    unitAddress,
    "--graph-impact-json-file",
    graphImpactFilePlaceholder,
    "--json"
  ].join(" ");
}

function collectMissingGraphImpactHints({ subject, unit }) {
  const allSubjectPaths = collectGraphImpactSubjectPaths(subject);

  const selectedUnitPaths = allSubjectPaths.filter(
    (subjectPath) => !isBashWrapperPath(subjectPath)
  );
  if (selectedUnitPaths.length === 0) {
    return [
      `Selected unit ${unit.address} requires graph-impact evidence, but no implementation/test subject paths remain after filtering write_scope and repo_paths. Update graph-impact scope or dispatch intent before rerunning validation.`
    ];
  }

  const generateCommand = buildGraphImpactPathsCommand(selectedUnitPaths);
  const persistCommand = buildPersistGraphImpactCommand(
    unit.address,
    "<graph-impact-json-file>"
  );
  const validateDispatchCommand = buildValidateDispatchCommand(unit.address);

  return [
    `Selected unit ${unit.address} is missing graph-impact evidence. Generate it with \`${generateCommand}\` and write the JSON output to a file.`,
    `Persist that evidence onto the work record with \`${persistCommand}\` so dispatch consumes it from canonical WK-stored evidence, then rerun \`${validateDispatchCommand}\`.`,
    "`validate-dispatch --graph-impact-json-file` and graph-impact env-file variables (CODEX_WORKER_GRAPH_IMPACT_JSON_FILE, AGENT_LAUNCH_GRAPH_IMPACT_JSON_FILE) are read-only diagnostic inputs and do not authorize worker launch."
  ];
}
