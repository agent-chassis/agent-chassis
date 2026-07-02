import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validateWorkRecordDispatch,
  validateWorkRecordDispatchReport
} from "@agent-chassis/wiki-core";
import { parseArgs } from "../lib/cli.mjs";

const DEFAULT_VALIDATE_WORK_RECORD_DISPATCH = validateWorkRecordDispatch;
const DEFAULT_VALIDATE_WORK_RECORD_DISPATCH_REPORT = validateWorkRecordDispatchReport;

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function parseJsonOption(options, key, fallback = null) {
  if (!(key in options) || options[key] === true || options[key] === "") {
    return fallback;
  }

  return JSON.parse(String(options[key]));
}

function parseJsonFileOption(options, key, fallback = null) {
  if (!(key in options) || options[key] === true || options[key] === "") {
    return fallback;
  }

  const filePath = path.resolve(String(options[key]));
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseGraphImpactOption(options) {
  const hasInlineGraphImpact =
    "graph-impact-json" in options && options["graph-impact-json"] !== true && options["graph-impact-json"] !== "";
  const hasFileGraphImpact =
    "graph-impact-json-file" in options &&
    options["graph-impact-json-file"] !== true &&
    options["graph-impact-json-file"] !== "";

  if (hasInlineGraphImpact && hasFileGraphImpact) {
    throw new Error("Use only one of --graph-impact-json or --graph-impact-json-file");
  }

  if (hasFileGraphImpact) {
    return parseJsonFileOption(options, "graph-impact-json-file");
  }

  return parseJsonOption(options, "graph-impact-json");
}

function parseDependencyStatusOption(options) {
  const hasInline =
    "dependency-status-json" in options &&
    options["dependency-status-json"] !== true &&
    options["dependency-status-json"] !== "";
  const hasFile =
    "dependency-status-json-file" in options &&
    options["dependency-status-json-file"] !== true &&
    options["dependency-status-json-file"] !== "";

  if (hasInline && hasFile) {
    throw new Error(
      "Use only one of --dependency-status-json or --dependency-status-json-file"
    );
  }

  if (hasFile) {
    return parseJsonFileOption(options, "dependency-status-json-file");
  }

  return parseJsonOption(options, "dependency-status-json");
}

const DISPATCH_ROLE_VALUES = new Set(["implementation", "read_only"]);

function parseDispatchRoleOption(options) {
  if (!("dispatch-role" in options)) {
    return "implementation";
  }
  const raw = options["dispatch-role"];
  if (raw === true || raw === "") {
    throw new Error(
      "--dispatch-role requires a value (implementation or read_only)"
    );
  }
  const value = String(raw);
  if (!DISPATCH_ROLE_VALUES.has(value)) {
    throw new Error(
      `Unknown --dispatch-role value: ${value}. Expected implementation or read_only.`
    );
  }
  return value;
}

const NODE_ENGINE_ADMISSIBILITY_DISABLE_VALUES = new Set(["false", "0", "no", "off"]);

function parseNodeEngineAdmissibilityOption(options) {
  if (!("node-engine-admissibility" in options)) {
    return null;
  }
  const raw = options["node-engine-admissibility"];
  if (raw === true || raw === "") {
    return true;
  }
  if (NODE_ENGINE_ADMISSIBILITY_DISABLE_VALUES.has(String(raw).toLowerCase())) {
    return null;
  }
  return true;
}

function parsePreparationAuditOption(options) {
  const hasInline =
    "preparation-audit-json" in options &&
    options["preparation-audit-json"] !== true &&
    options["preparation-audit-json"] !== "";
  const hasFile =
    "preparation-audit-json-file" in options &&
    options["preparation-audit-json-file"] !== true &&
    options["preparation-audit-json-file"] !== "";

  if (hasInline && hasFile) {
    throw new Error(
      "Use only one of --preparation-audit-json or --preparation-audit-json-file"
    );
  }

  if (hasFile) {
    return parseJsonFileOption(options, "preparation-audit-json-file");
  }

  return parseJsonOption(options, "preparation-audit-json");
}

function printReadinessSummary(result) {
  console.log(`Decision: ${result.decision_code}`);
  console.log(`Dispatchable: ${result.dispatchable}`);
  console.log(`Unit: ${result.unit.address}`);
  console.log(`Reasons: ${result.reasons.join(", ") || "(none)"}`);
  if (Array.isArray(result.validation_hints) && result.validation_hints.length > 0) {
    console.log(`validation_hints: ${result.validation_hints.join("; ")}`);
  }
  console.log(`Clusters: ${result.clusters.length}`);
  console.log(`Blast radius: ${result.blast_radius.level}`);
}

function getValidateWorkRecordDispatch(deps = {}) {
  return deps.validateWorkRecordDispatch ?? DEFAULT_VALIDATE_WORK_RECORD_DISPATCH;
}

function getValidateWorkRecordDispatchReport(deps = {}) {
  return deps.validateWorkRecordDispatchReport ?? DEFAULT_VALIDATE_WORK_RECORD_DISPATCH_REPORT;
}

function isTestRunnerProcess() {
  return (
    process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test=")) ||
    process.argv.includes("--test") ||
    process.env.NODE_TEST_CONTEXT !== undefined
  );
}

async function runStrict(argv, deps = {}) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki validate-dispatch [--unit <WK-0001|WK-0001#slice-id>] [--dir <path>] [--json] [--dispatch-role <implementation|read_only>] [--node-engine-admissibility] [--graph-state-json <json>] [--graph-impact-json <json>] [--graph-impact-json-file <path>] [--dependency-status-json <json>] [--dependency-status-json-file <path>] [--preparation-audit-json <json>] [--preparation-audit-json-file <path>]\n\n  --node-engine-admissibility  Evaluate Node Engine-exclusive implementation admissibility for a structurally dispatchable implementation unit. Sources the allow/deny decision only from the Node Engine pack path using launcher-minted env (NODE_ENGINE_SERVICE_URL/API_KEY/route/digest); missing/invalid config yields admissibility-undetermined and a non-launchable result with no local fallback. Omit for pure structural validation.\n\n  Strict runs exit with code 1 when the checked unit is non-dispatchable; --json still emits machine-readable JSON."
    );
    return 0;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const unitAddress = options.unit || positionals[0] || null;
  if (!unitAddress) {
    throw new Error("validate-dispatch requires --unit <WK-0001|WK-0001#slice-id>");
  }
  if ("policy-result-json" in options) {
    throw new Error(
      "--policy-result-json is not exposed by the strict CLI; the dispatch validator must compute policy from the canonical record"
    );
  }
  const result = await getValidateWorkRecordDispatch(deps)({
    dir: targetDir,
    unitAddress,
    dispatch_role: parseDispatchRoleOption(options),
    graph_state: parseJsonOption(options, "graph-state-json"),
    graph_impact: parseGraphImpactOption(options),
    dependency_statuses: parseDependencyStatusOption(options),
    preparation_audit: parsePreparationAuditOption(options),
    node_engine_admissibility: parseNodeEngineAdmissibilityOption(options)
  });

  if (options.json) {
    printJson(result);
  } else {
    printReadinessSummary(result);
  }

  const exitCode = result.dispatchable ? 0 : 1;
  if (exitCode !== 0 && !isTestRunnerProcess()) {
    process.exitCode = exitCode;
  }

  return exitCode;
}

async function runReport(argv, deps = {}) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki validate-dispatch report [--unit <WK-0001|WK-0001#slice-id>] [--dir <path>] [--json] [--dispatch-role <implementation|read_only>] [--node-engine-admissibility] [--graph-state-json <json>] [--graph-impact-json <json>] [--graph-impact-json-file <path>] [--dependency-status-json <json>] [--dependency-status-json-file <path>] [--preparation-audit-json <json>] [--preparation-audit-json-file <path>]"
    );
    return 0;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const unitAddress = options.unit || positionals[0] || null;
  if (!unitAddress) {
    throw new Error("validate-dispatch report requires --unit <WK-0001|WK-0001#slice-id>");
  }
  if ("policy-result-json" in options) {
    throw new Error(
      "--policy-result-json is not exposed by the report CLI; the dispatch validator must compute policy from the canonical record"
    );
  }
  const result = await getValidateWorkRecordDispatchReport(deps)({
    dir: targetDir,
    unitAddress,
    dispatch_role: parseDispatchRoleOption(options),
    graph_state: parseJsonOption(options, "graph-state-json"),
    graph_impact: parseGraphImpactOption(options),
    dependency_statuses: parseDependencyStatusOption(options),
    preparation_audit: parsePreparationAuditOption(options),
    node_engine_admissibility: parseNodeEngineAdmissibilityOption(options)
  });

  if (options.json) {
    printJson(result);
    return 0;
  }

  printReadinessSummary(result.readiness);
  return 0;
}

export async function runValidateDispatch(argv, deps = {}) {
  const [commandOrOption, ...rest] = argv;
  if (commandOrOption === undefined) {
    return await runStrict(rest, deps);
  }
  if (commandOrOption === "strict") {
    return await runStrict(rest, deps);
  }
  if (commandOrOption.startsWith("--")) {
    return await runStrict(argv, deps);
  }

  switch (commandOrOption) {
    case "report":
    case "report-only":
      return await runReport(rest, deps);
    case "help":
    case "--help":
    case "-h":
      console.log(
        "Usage: wiki validate-dispatch [strict|report] [--unit <WK-0001|WK-0001#slice-id>] [--dir <path>] [--json] [--dispatch-role <implementation|read_only>] [--node-engine-admissibility] [--graph-state-json <json>] [--graph-impact-json <json>] [--graph-impact-json-file <path>] [--dependency-status-json <json>] [--dependency-status-json-file <path>] [--preparation-audit-json <json>] [--preparation-audit-json-file <path>] [--policy-result-json <json>]"
      );
      return 0;
    default:
      throw new Error(`Unknown validate-dispatch subcommand: ${commandOrOption}`);
  }
}
