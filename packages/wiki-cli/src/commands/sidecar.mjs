import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  SidecarBuildRefusalError,
  buildSidecarIndex,
  getSidecarContextForPath,
  getSidecarGraphImpactDiff,
  getSidecarImpactPaths,
  getSidecarIndexStatus
} from "@agent-chassis/wiki-core";
import { getSidecarGraphImpactPaths } from "@agent-chassis/wiki-core/src/lib/sidecar-graph-impact.mjs";
import {
  getSidecarSymbolCallers,
  getSidecarSymbolCallees,
  getSidecarSymbolDefinition,
  getSidecarSymbolReferences
} from "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import { optionalOption, parseArgs, parseListOption, requireOption } from "../lib/cli.mjs";

function helpText(surfaceName = "sidecar") {
  const label = surfaceName === "code-index" ? "repo code index" : "sidecar code index";
  const graphCommand =
    surfaceName === "code-index"
      ? `  graph-impact-paths
           Return graph-backed ${label} impact context for one or more paths
  graph-impact-diff
           Return graph-backed ${label} impact context for a raw, parsed, or live git diff
  find-references
           Return SCIP-derived references for a symbol or path+line position
  definition
           Return SCIP-derived definition target(s) for a symbol or path+line position
  callers
           Return SCIP-derived callers for a symbol or path+line position
  callees
           Return SCIP-derived callees for a symbol or path+line position
`
      : "";
  const graphExample =
    surfaceName === "code-index"
      ? `  wiki ${surfaceName} graph-impact-paths --json --paths packages/app/src/service.mjs --dir /path/to/repo
  wiki ${surfaceName} graph-impact-diff --json --live-git --dir /path/to/repo
  wiki ${surfaceName} find-references --json --symbol "<scip-symbol>" --dir /path/to/repo
  wiki ${surfaceName} definition --json --path packages/app/src/service.mjs --line 12 --dir /path/to/repo
  wiki ${surfaceName} callers --json --symbol "<scip-symbol>" --dir /path/to/repo
  wiki ${surfaceName} callees --json --path packages/app/src/service.mjs --line 12 --dir /path/to/repo
`
      : "";
  return `Usage: wiki ${surfaceName} <command> [options]

Commands:
  build    Explicitly build the ${label}
  context-for-path
           Return scoped ${label} context for one path
${graphCommand}  impact-paths
           Return ${label} impact context for one or more paths
  rebuild  Explicitly rebuild the ${label}
  status   Report read-only ${label} status

Examples:
  wiki ${surfaceName} build --json --dir /path/to/repo
  wiki ${surfaceName} context-for-path --json --path packages/app/src/service.mjs --dir /path/to/repo
${graphExample}  wiki ${surfaceName} impact-paths --json --paths packages/app/src/service.mjs --dir /path/to/repo
  wiki ${surfaceName} rebuild --json --dir /path/to/repo
  wiki ${surfaceName} status --json --dir /path/to/repo
`;
}

function printStatusSummary(status, { surfaceName = "sidecar" } = {}) {
  const label = surfaceName === "code-index" ? "Code index" : "Sidecar";
  console.log(`${label} status: ${status.staleness}`);
  console.log(`Dirty state: ${status.dirty_state}`);
  console.log(`Cache path: ${status.cache_path}`);
  console.log(`Artifact path: ${status.artifact_path}`);
}

function printBuildSummary(result, { surfaceName = "sidecar" } = {}) {
  const label = surfaceName === "code-index" ? "Code index" : "Sidecar";
  console.log(`${label} ${result.build_action}: ${result.staleness}`);
  console.log(`Dirty state: ${result.dirty_state}`);
  console.log(`Cache path: ${result.cache_path}`);
  console.log(`Artifact path: ${result.artifact_path}`);
  console.log(`Indexed sources: ${result.source_count}`);
}

function printImpactSummary(result, { surfaceName = "sidecar" } = {}) {
  const label = surfaceName === "code-index" ? "Code index" : "Sidecar";
  console.log(`${label} ${result.query_kind}: ${result.staleness}`);
  console.log(`Dirty state: ${result.dirty_state}`);

  if (result.context_available === "compact" || result.context_available === "degraded") {
    console.log(`Context available: ${result.context_available}`);
    console.log(`Path: ${result.path || "(none)"}`);
    if (typeof result.loc === "number") {
      console.log(`LOC: ${result.loc}`);
    }
    console.log(`Canonical refs: ${result.canonical_ref_count ?? 0}`);
    console.log(`Related code paths: ${result.related_code_path_count ?? 0}`);
    console.log(`Likely tests: ${result.likely_test_count ?? 0}`);
    if (result.next_action) {
      console.log(`Next action: ${result.next_action}`);
    }
    return;
  }

  console.log(`Validated paths: ${(result.validated_paths || []).join(", ") || "(none)"}`);
  console.log(`Canonical refs: ${(result.canonical_refs || []).length}`);
  console.log(`Likely tests: ${(result.likely_tests || []).join(", ") || "(none)"}`);
}

function formatCanonicalRef(ref) {
  return [ref.id, ref.title].filter(Boolean).join(" - ") || ref.path || "(unknown)";
}

function printGraphImpactSummary(result, { surfaceName = "code-index" } = {}) {
  const label = surfaceName === "code-index" ? "Code index" : "Sidecar";
  const graphState = result.graph_state || {};
  const statusWarnings = result.derived_evidence.filter(
    (entry) =>
      entry.kind === "sidecar_status_hint" ||
      (entry.kind === "sidecar_path_validation" && entry.valid === false) ||
      entry.kind === "sidecar_graph_path_state"
  );

  console.log(`${label} ${result.query_kind}: ${result.staleness}`);
  console.log(`Dirty state: ${result.dirty_state}`);
  console.log(`Graph available: ${Boolean(graphState.graph_available)}`);
  console.log(`Graph edge source: ${graphState.edge_source || "unavailable"}`);
  console.log(`Dirty graph mode: ${graphState.dirty_graph_mode || "unavailable"}`);
  console.log(`Validated paths: ${result.validated_paths.join(", ") || "(none)"}`);
  console.log(`Invalid paths: ${result.invalid_paths.join(", ") || "(none)"}`);
  console.log(
    `Unavailable graph paths: ${(graphState.unavailable_paths || []).join(", ") || "(none)"}`
  );
  console.log(`Warnings: ${statusWarnings.length}`);
  for (const warning of statusWarnings.slice(0, 10)) {
    const subject = warning.input_path || warning.dimension || warning.kind;
    const message = warning.message || warning.reason || warning.code || "warning";
    console.log(`- ${subject}: ${message}`);
  }
  console.log(`Structural impacts: ${result.structural_impacts.length}`);
  for (const impact of result.structural_impacts.slice(0, 10)) {
    console.log(`- ${impact.kind} (${impact.severity}): ${impact.reason}`);
  }
  console.log(`Missing update hints: ${result.missing_update_hints.length}`);
  for (const hint of result.missing_update_hints.slice(0, 10)) {
    console.log(`- ${hint.kind} ${hint.missing_surface}: ${hint.reason}`);
  }
  console.log(`Canonical refs: ${result.canonical_refs.length}`);
  for (const ref of result.canonical_refs.slice(0, 5)) {
    console.log(`- ${formatCanonicalRef(ref)}`);
  }
}

function printGraphImpactDiffSummary(result, { surfaceName = "code-index" } = {}) {
  printGraphImpactSummary(result, { surfaceName });
  console.log(`Diff sources: ${result.input_diff_sources.map((entry) => entry.source).join(", ") || "(none)"}`);
  console.log(`Validated diff records: ${result.validated_diff_records.length}`);
  console.log(`Invalid diff records: ${result.invalid_diff_records.length}`);
  console.log(`Affected paths: ${result.affected_paths.join(", ") || "(none)"}`);
  for (const state of result.graph_state?.diff_path_states?.slice(0, 10) || []) {
    console.log(
      `- ${state.change_kind}: old=${state.old_state} ${state.old_path || "(absent)"} new=${state.new_state} ${state.new_path || "(absent)"}`
    );
  }
}

function printSymbolQuerySummary(result, { surfaceName = "code-index" } = {}) {
  const label = surfaceName === "code-index" ? "Code index" : "Sidecar";
  const scipState = result.scip_state || {};
  const isCallQuery = result.query_kind === "symbol_callers" || result.query_kind === "symbol_callees";
  console.log(`${label} ${result.query_kind}: ${result.staleness}`);
  console.log(`Dirty state: ${result.dirty_state}`);
  console.log(`SCIP available: ${Boolean(scipState.scip_available)}`);
  console.log(`SCIP graph available: ${Boolean(scipState.graph_available)}`);
  console.log(`SCIP status: ${scipState.status_reason || "unknown"}`);
  if (isCallQuery && Object.hasOwn(scipState, "call_graph_available")) {
    console.log(`SCIP call graph available: ${Boolean(scipState.call_graph_available)}`);
  }
  if (isCallQuery && scipState.call_graph_status_reason) {
    console.log(`SCIP call graph status: ${scipState.call_graph_status_reason}`);
  }
  if (isCallQuery && scipState.call_graph_unavailable_reason) {
    console.log(`SCIP call graph unavailable reason: ${scipState.call_graph_unavailable_reason}`);
  }
  console.log(`Symbol: ${result.symbol || "(unresolved)"}`);
  if (isCallQuery && result.symbol_resolution?.state) {
    console.log(`Symbol resolution: ${result.symbol_resolution.state}`);
  }
  if (isCallQuery && result.symbol_resolution?.status_reason) {
    console.log(`Symbol resolution status: ${result.symbol_resolution.status_reason}`);
  }
  if (isCallQuery && result.coverage?.call_graph_status_reason) {
    console.log(`Coverage call graph status: ${result.coverage.call_graph_status_reason}`);
  }
  console.log(`Definitions: ${(result.definitions || []).length}`);
  for (const definition of (result.definitions || []).slice(0, 10)) {
    console.log(`- ${definition.path || "(unknown)"}:${definition.line ?? "?"} ${definition.resolution?.state || "unknown"}`);
  }
  console.log(`References: ${(result.references || []).length}`);
  for (const reference of (result.references || []).slice(0, 10)) {
    console.log(`- ${reference.path || "(unknown)"}:${reference.line ?? "?"} ${reference.resolution?.state || "unknown"}`);
  }
  if (result.query_kind === "symbol_callers" || (result.callers || []).length > 0) {
    console.log(`Callers: ${(result.callers || []).length}`);
    for (const caller of (result.callers || []).slice(0, 10)) {
      console.log(
        `- ${caller.caller_symbol || "(unknown)"} -> ${caller.callee_symbol || "(unknown)"} ${caller.resolution?.state || "unknown"}`
      );
    }
  }
  if (result.query_kind === "symbol_callees" || (result.callees || []).length > 0) {
    console.log(`Callees: ${(result.callees || []).length}`);
    for (const callee of (result.callees || []).slice(0, 10)) {
      console.log(
        `- ${callee.caller_symbol || "(unknown)"} -> ${callee.callee_symbol || "(unknown)"} ${callee.resolution?.state || "unknown"}`
      );
    }
  }
}

async function runStatus(argv, { surfaceName = "sidecar" } = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(`Usage: wiki ${surfaceName} status --json [--dir <path>] [--cache-dir <path>]`);
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const status = await getSidecarIndexStatus({
    dir: targetDir,
    cacheDir: optionalOption(options, "cache-dir") || undefined
  });

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  printStatusSummary(status, { surfaceName });
}

async function runBuild(argv, { rebuild = false, surfaceName = "sidecar" } = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      `Usage: wiki ${surfaceName} ${rebuild ? "rebuild" : "build"} --json [--dir <path>] [--cache-dir <path>]`
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  let result;
  try {
    result = await buildSidecarIndex({
      dir: targetDir,
      cacheDir: optionalOption(options, "cache-dir") || undefined,
      rebuild
    });
  } catch (error) {
    if (options.json && error instanceof SidecarBuildRefusalError && error.envelope) {
      console.log(JSON.stringify(error.envelope, null, 2));
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printBuildSummary(result, { surfaceName });
}

async function runImpactPaths(argv, { surfaceName = "sidecar" } = {}) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(
      `Usage: wiki ${surfaceName} impact-paths --json [--dir <path>] [--cache-dir <path>] [--paths <path,path>] [path ...]`
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const paths = [...parseListOption(options, "paths"), ...positionals];
  const result = await getSidecarImpactPaths({
    dir: targetDir,
    cacheDir: optionalOption(options, "cache-dir") || undefined,
    paths,
    includeSuppressed: Boolean(options["include-suppressed"])
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printImpactSummary(result, { surfaceName });
}

async function runGraphImpactPaths(argv, { surfaceName = "code-index" } = {}) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(
      `Usage: wiki ${surfaceName} graph-impact-paths --json [--dir <path>] [--cache-dir <path>] [--paths <path,path>] [path ...]`
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const paths = [...parseListOption(options, "paths"), ...positionals];
  const result = await getSidecarGraphImpactPaths({
    dir: targetDir,
    cacheDir: optionalOption(options, "cache-dir") || undefined,
    paths,
    includeSuppressed: Boolean(options["include-suppressed"])
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printGraphImpactSummary(result, { surfaceName });
}

async function runGraphImpactDiff(argv, { surfaceName = "code-index" } = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      `Usage: wiki ${surfaceName} graph-impact-diff --json [--dir <path>] [--cache-dir <path>] [--patch <text>] [--patch-file <path>] [--diff-records-json <json>] [--live-git]`
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const diffRecordsJson = optionalOption(options, "diff-records-json");
  const patchFile = optionalOption(options, "patch-file");
  let patchText = optionalOption(options, "patch") || null;
  if (patchFile) {
    patchText = await readFile(path.resolve(String(patchFile)), "utf8");
  }
  const diffRecords = diffRecordsJson ? JSON.parse(diffRecordsJson) : null;
  const result = await getSidecarGraphImpactDiff({
    dir: targetDir,
    cacheDir: optionalOption(options, "cache-dir") || undefined,
    patchText,
    diffRecords,
    liveGit: Boolean(options["live-git"]),
    includeSuppressed: Boolean(options["include-suppressed"])
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printGraphImpactDiffSummary(result, { surfaceName });
}

async function runContextForPath(argv, { surfaceName = "sidecar" } = {}) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(
      `Usage: wiki ${surfaceName} context-for-path --json [--dir <path>] [--cache-dir <path>] [--verbose] --path <path>`
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const inputPath = optionalOption(options, "path") || positionals[0] || null;

  const result = await getSidecarContextForPath({
    dir: targetDir,
    cacheDir: optionalOption(options, "cache-dir") || undefined,
    path: inputPath || requireOption(options, "path", "context-for-path requires --path <path>"),
    includeSuppressed: Boolean(options["include-suppressed"]),
    verbose: Boolean(options.verbose)
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printImpactSummary(result, { surfaceName });
}

function parseSymbolQueryArgs(argv, command) {
  const { positionals, options } = parseArgs(argv);
  const symbol = optionalOption(options, "symbol") || positionals[0] || null;
  const inputPath = optionalOption(options, "path");
  const line = optionalOption(options, "line");
  const character = optionalOption(options, "character");
  const targetDir = path.resolve(String(options.dir || "."));
  if (options.help) {
    return { help: true };
  }
  if (!symbol && (!inputPath || !line)) {
    throw new Error(
      `${command} requires either --symbol <symbol> or --path <path> --line <line>`
    );
  }
  return {
    options,
    query: {
      dir: targetDir,
      cacheDir: optionalOption(options, "cache-dir") || undefined,
      symbol,
      path: inputPath,
      line,
      character
    }
  };
}

async function runFindReferences(argv, { surfaceName = "code-index" } = {}) {
  const parsed = parseSymbolQueryArgs(argv, "find-references");
  if (parsed.help) {
    console.log(
      `Usage: wiki ${surfaceName} find-references --json [--dir <path>] [--cache-dir <path>] (--symbol <symbol> | --path <path> --line <line> [--character <char>])`
    );
    return;
  }

  const result = await getSidecarSymbolReferences(parsed.query);
  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSymbolQuerySummary(result, { surfaceName });
}

async function runDefinition(argv, { surfaceName = "code-index" } = {}) {
  const parsed = parseSymbolQueryArgs(argv, "definition");
  if (parsed.help) {
    console.log(
      `Usage: wiki ${surfaceName} definition --json [--dir <path>] [--cache-dir <path>] (--symbol <symbol> | --path <path> --line <line> [--character <char>])`
    );
    return;
  }

  const result = await getSidecarSymbolDefinition(parsed.query);
  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSymbolQuerySummary(result, { surfaceName });
}

async function runCallers(argv, { surfaceName = "code-index" } = {}) {
  const parsed = parseSymbolQueryArgs(argv, "callers");
  if (parsed.help) {
    console.log(
      `Usage: wiki ${surfaceName} callers --json [--dir <path>] [--cache-dir <path>] (--symbol <symbol> | --path <path> --line <line> [--character <char>])`
    );
    return;
  }

  const result = await getSidecarSymbolCallers(parsed.query);
  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSymbolQuerySummary(result, { surfaceName });
}

async function runCallees(argv, { surfaceName = "code-index" } = {}) {
  const parsed = parseSymbolQueryArgs(argv, "callees");
  if (parsed.help) {
    console.log(
      `Usage: wiki ${surfaceName} callees --json [--dir <path>] [--cache-dir <path>] (--symbol <symbol> | --path <path> --line <line> [--character <char>])`
    );
    return;
  }

  const result = await getSidecarSymbolCallees(parsed.query);
  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSymbolQuerySummary(result, { surfaceName });
}

export async function runSidecar(argv, { surfaceName = "sidecar" } = {}) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(helpText(surfaceName));
      return;
    case "build":
      await runBuild(rest, { surfaceName });
      return;
    case "context-for-path":
      await runContextForPath(rest, { surfaceName });
      return;
    case "graph-impact-paths":
      if (surfaceName !== "code-index") {
        throw new Error(
          "graph-impact-paths is available under wiki code-index only; WK-0081 did not add a legacy sidecar alias"
        );
      }
      await runGraphImpactPaths(rest, { surfaceName });
      return;
    case "graph-impact-diff":
      if (surfaceName !== "code-index") {
        throw new Error(
          "graph-impact-diff is available under wiki code-index only; WK-0085 did not add a legacy sidecar alias"
        );
      }
      await runGraphImpactDiff(rest, { surfaceName });
      return;
    case "find-references":
      if (surfaceName !== "code-index") {
        throw new Error(
          "find-references is available under wiki code-index only; WK-1230#SLICE-006 did not add a legacy sidecar alias"
        );
      }
      await runFindReferences(rest, { surfaceName });
      return;
    case "definition":
      if (surfaceName !== "code-index") {
        throw new Error(
          "definition is available under wiki code-index only; WK-1230#SLICE-006 did not add a legacy sidecar alias"
        );
      }
      await runDefinition(rest, { surfaceName });
      return;
    case "callers":
      if (surfaceName !== "code-index") {
        throw new Error(
          "callers is available under wiki code-index only; WK-1259#SLICE-008 did not add a legacy sidecar alias"
        );
      }
      await runCallers(rest, { surfaceName });
      return;
    case "callees":
      if (surfaceName !== "code-index") {
        throw new Error(
          "callees is available under wiki code-index only; WK-1259#SLICE-008 did not add a legacy sidecar alias"
        );
      }
      await runCallees(rest, { surfaceName });
      return;
    case "impact-paths":
      await runImpactPaths(rest, { surfaceName });
      return;
    case "rebuild":
      await runBuild(rest, { rebuild: true, surfaceName });
      return;
    case "status":
      await runStatus(rest, { surfaceName });
      return;
    default:
      throw new Error(`Unknown ${surfaceName} command: ${command}\n\n${helpText(surfaceName)}`);
  }
}
