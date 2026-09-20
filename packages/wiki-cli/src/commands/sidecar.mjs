import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  SidecarIndexEnsureError,
  buildSidecarIndex,
  getSidecarContextForPath,
  getSidecarIndexStatus,
  getSidecarQueryImpact
} from "@agent-chassis/wiki-core";
import {
  getSidecarSymbolCallers,
  getSidecarSymbolCallees,
  getSidecarSymbolDefinition,
  getSidecarSymbolReferences
} from "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import { optionalOption, parseArgs } from "../lib/cli.mjs";

const HELP_TEXT = `Usage: wiki code-index <command> [options]

Commands:
  build    Prepare the repo code index now (queries refresh it automatically)
  context-for-path
           Return committed repo code index context for one path
  impact
           Return committed impact for paths, a patch, parsed diff records or the live Git diff
  find-references
           Return SCIP references and definitions with committed source for a symbol or path+line
  definition
           Return SCIP definition target(s) with committed source for a symbol or path+line
  callers
           Return SCIP callers with committed call-site source for a symbol or path+line
  callees
           Return SCIP callees with committed call-site source for a symbol or path+line
  rebuild  Force a clean rebuild of the repo code index
  status   Report read-only repo code index status

Query output: --json or --verbose prints the complete answer; plain output lists every population.

Examples:
  wiki code-index build --json --dir /path/to/repo
  wiki code-index context-for-path --json --path packages/app/src/service.mjs --dir /path/to/repo
  wiki code-index impact --json --paths packages/app/src/service.mjs --dir /path/to/repo
  wiki code-index impact --json --live-git --dir /path/to/repo
  wiki code-index find-references --json --symbol "<scip-symbol>" --dir /path/to/repo
  wiki code-index definition --json --path packages/app/src/service.mjs --line 12 --dir /path/to/repo
  wiki code-index callers --json --symbol "<scip-symbol>" --dir /path/to/repo
  wiki code-index callees --json --path packages/app/src/service.mjs --line 12 --dir /path/to/repo
  wiki code-index rebuild --json --dir /path/to/repo
  wiki code-index status --json --dir /path/to/repo
`;

function printStatusSummary(status) {
  console.log(`Code index status: ${status.staleness}`);
  console.log(`Dirty state: ${status.dirty_state}`);
  console.log(`Cache path: ${status.cache_path}`);
  console.log(`Artifact path: ${status.artifact_path}`);
}

function printBuildSummary(result) {
  console.log(`Code index ${result.build_action}: ${result.staleness}`);
  console.log(`Dirty state: ${result.dirty_state}`);
  console.log(`Cache path: ${result.cache_path}`);
  console.log(`Artifact path: ${result.artifact_path}`);
  console.log(`Indexed sources: ${result.source_count}`);
}

const PLAIN_OBJECT_FIELDS = ["input", "impact_state", "source", "symbol_resolution", "scip_state",
  "call_attribution", "graph_state", "counts"];

function printQueryResult(result, options) {
  if (options.json || options.verbose) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Code index ${result.query_kind}: ${result.staleness}`);
  console.log(`Dirty state: ${result.dirty_state}`);
  console.log(`Committed head: ${result.index_head ?? "(none)"}`);
  for (const field of PLAIN_OBJECT_FIELDS) {
    if (result[field] && typeof result[field] === "object") {
      console.log(`${field}: ${JSON.stringify(result[field])}`);
    }
  }
  for (const [field, value] of Object.entries(result)) {
    if (!Array.isArray(value)) continue;
    console.log(`${field}: ${value.length}`);
    for (const entry of value) {
      console.log(`- ${typeof entry === "string" ? entry : JSON.stringify(entry)}`);
    }
  }
}

function parseQueryArgs(argv, command, { values, booleans, positionals: allowPositionals }) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      if (!allowPositionals) throw new Error(`${command} does not accept positional argument ${token}`);
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    if (Object.hasOwn(options, key)) throw new Error(`${command} accepts --${key} at most once`);
    if (booleans.has(key)) {
      if (equals !== -1) throw new Error(`${command} --${key} does not take a value`);
      options[key] = true;
    } else if (values.has(key)) {
      if (equals !== -1) {
        options[key] = token.slice(equals + 1);
      } else if (index + 1 < argv.length) {
        options[key] = argv[index + 1];
        index += 1;
      } else {
        throw new Error(`${command} --${key} requires a value`);
      }
    } else {
      throw new Error(`${command} does not accept --${key}`);
    }
  }
  return { options, positionals };
}

const TRANSPORT_VALUES = ["dir", "cache-dir"];
const TRANSPORT_BOOLEANS = ["json", "help", "verbose"];

function transportQuery(options) {
  return {
    dir: path.resolve(String(options.dir ?? ".")),
    ...(Object.hasOwn(options, "cache-dir") ? { cacheDir: options["cache-dir"] } : {}),
    ...(options["include-suppressed"] === true ? { includeSuppressed: true } : {})
  };
}

async function runStatus(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log("Usage: wiki code-index status --json [--dir <path>] [--cache-dir <path>]");
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

  printStatusSummary(status);
}

async function runBuild(argv, { rebuild = false } = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      `Usage: wiki code-index ${rebuild ? "rebuild" : "build"} --json [--dir <path>] [--cache-dir <path>]`
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
    if (options.json && error instanceof SidecarIndexEnsureError) {
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

  printBuildSummary(result);
}

const IMPACT_SUBJECT_OPTIONS = ["patch", "patch-file", "diff-records-json", "live-git"];

async function runImpact(argv) {
  const { options, positionals } = parseQueryArgs(argv, "impact", {
    values: new Set([...TRANSPORT_VALUES, "paths", "patch", "patch-file", "diff-records-json"]),
    booleans: new Set([...TRANSPORT_BOOLEANS, "include-suppressed", "live-git"]),
    positionals: true
  });
  if (options.help) {
    console.log(
      "Usage: wiki code-index impact [--json | --verbose] [--dir <path>] [--cache-dir <path>] [--include-suppressed] (--paths <path,path> [path ...] | --patch <text> | --patch-file <path> | --diff-records-json <json> | --live-git)"
    );
    return;
  }
  const subjects = [
    ...(Object.hasOwn(options, "paths") || positionals.length > 0 ? ["paths"] : []),
    ...IMPACT_SUBJECT_OPTIONS.filter((key) => Object.hasOwn(options, key))
  ];
  if (subjects.length !== 1) {
    throw new Error("impact requires exactly one of --paths/positional paths, --patch, --patch-file, " +
      `--diff-records-json or --live-git${subjects.length > 1 ? `; received ${subjects.join(", ")}` : ""}`);
  }
  const query = transportQuery(options);
  if (subjects[0] === "paths") {
    query.paths = [...String(options.paths ?? "").split(",").map((value) => value.trim())
      .filter(Boolean), ...positionals];
  } else if (subjects[0] === "patch") {
    query.patchText = options.patch;
  } else if (subjects[0] === "patch-file") {
    query.patchText = await readFile(path.resolve(String(options["patch-file"])), "utf8");
  } else if (subjects[0] === "diff-records-json") {
    try {
      query.diffRecords = JSON.parse(options["diff-records-json"]);
    } catch (error) {
      throw new Error(`impact --diff-records-json must be valid JSON: ${error.message}`);
    }
  } else {
    query.liveGit = true;
  }
  printQueryResult(await getSidecarQueryImpact(query), options);
}

async function runContextForPath(argv) {
  const { options, positionals } = parseQueryArgs(argv, "context-for-path", {
    values: new Set([...TRANSPORT_VALUES, "path"]),
    booleans: new Set([...TRANSPORT_BOOLEANS, "include-suppressed"]),
    positionals: true
  });
  if (options.help) {
    console.log(
      "Usage: wiki code-index context-for-path [--json | --verbose] [--dir <path>] [--cache-dir <path>] [--include-suppressed] --path <path>"
    );
    return;
  }
  const pathCount = positionals.length + (Object.hasOwn(options, "path") ? 1 : 0);
  if (pathCount !== 1) {
    throw new Error("context-for-path requires exactly one path via --path <path> or one positional path");
  }
  const result = await getSidecarContextForPath({ ...transportQuery(options),
    path: options.path ?? positionals[0] });
  printQueryResult(result, options);
}

const NAVIGATION_OPTIONS = {
  values: new Set([...TRANSPORT_VALUES, "symbol", "path", "line", "character"]),
  booleans: new Set(TRANSPORT_BOOLEANS),
  positionals: true
};

const NAVIGATION_QUERIES = Object.freeze({
  "find-references": getSidecarSymbolReferences,
  definition: getSidecarSymbolDefinition,
  callers: getSidecarSymbolCallers,
  callees: getSidecarSymbolCallees
});

async function runNavigation(command, argv) {
  const { options, positionals } = parseQueryArgs(argv, command, NAVIGATION_OPTIONS);
  if (options.help) {
    console.log(
      `Usage: wiki code-index ${command} [--json | --verbose] [--dir <path>] [--cache-dir <path>] (--symbol <symbol> [--path <path> for a local symbol] | --path <path> --line <line> [--character <char>])`
    );
    return;
  }
  if (positionals.length > 1 || (positionals.length === 1 && Object.hasOwn(options, "symbol"))) {
    throw new Error(`${command} accepts at most one positional symbol and only without --symbol`);
  }
  const query = { dir: path.resolve(String(options.dir ?? ".")) };
  const symbol = Object.hasOwn(options, "symbol") ? options.symbol : positionals[0];
  for (const [key, value] of [["symbol", symbol], ["path", options.path], ["line", options.line],
    ["character", options.character], ["cacheDir", options["cache-dir"]]]) {
    if (value !== undefined) query[key] = value;
  }
  printQueryResult(await NAVIGATION_QUERIES[command](query), options);
}

export async function runSidecar(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP_TEXT);
      return;
    case "build":
      await runBuild(rest);
      return;
    case "context-for-path":
      await runContextForPath(rest);
      return;
    case "impact":
      await runImpact(rest);
      return;
    case "find-references":
    case "definition":
    case "callers":
    case "callees":
      await runNavigation(command, rest);
      return;
    case "rebuild":
      await runBuild(rest, { rebuild: true });
      return;
    case "status":
      await runStatus(rest);
      return;
    default:
      throw new Error(`Unknown code-index command: ${command}\n\n${HELP_TEXT}`);
  }
}
