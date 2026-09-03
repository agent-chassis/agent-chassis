#!/usr/bin/env node

import {
  CompiledValidatorCacheError,
  prepareCompiledValidatorCache
} from "../lib/compiled-validator-cache.mjs";

function parseArguments(argv) {
  const options = { mode: "ensure", json: false, cacheRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--verify") options.mode = "verify";
    else if (argument === "--ensure") options.mode = "ensure";
    else if (argument === "--json") options.json = true;
    else if (argument === "--cache-root") {
      options.cacheRoot = argv[index + 1] ?? null;
      index += 1;
      if (options.cacheRoot === null) throw new Error("--cache-root requires a directory");
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`unrecognized argument: ${argument}`);
  }
  return options;
}

const USAGE = [
  "usage: controlled-contract-prepare-validator-cache [--verify|--ensure]",
  "                                                   [--json] [--cache-root DIR]",
  "",
  "  --verify      refuse to generate; exit non-zero unless an exact artifact is",
  "                already published for the current cache identity",
  "  --ensure      generate and publish on a miss (default)",
  "  --json        emit the status record as JSON",
  "  --cache-root  diagnostics and test isolation only"
].join("\n");

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const status = await prepareCompiledValidatorCache({
    mode: options.mode,
    ...(options.cacheRoot === null ? {} : { cacheRoot: options.cacheRoot })
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }
  const reused = status.groups.filter(({ result }) => result === "hit").length;
  process.stdout.write([
    `mode              ${status.mode}`,
    `result            ${status.result}`,
    `cache root        ${status.cache_root}`,
    `artifact root     ${status.directory}`,
    `toolchain digest  ${status.toolchain_digest}`,
    `validator groups  ${status.group_count}`,
    `groups reused     ${reused}`,
    `groups compiled   ${status.group_count - reused}`,
    `published         ${status.published}`,
    `ajv loaded        ${status.ajv_module_loaded}`,
    `ajv compilations  ${status.ajv_compilations}`,
    ...(status.generation === null ? [] : [
      `generation ajv compilations  ${status.generation.ajv_compilations}`
    ]),
    ...status.groups.map(({ group_id, result, schema_digest }) =>
      `  ${result === "hit" ? "reused  " : "compiled"}  ${schema_digest.slice(0, 12)}  ${group_id}`)
  ].join("\n") + "\n");
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  const code = error instanceof CompiledValidatorCacheError ? error.code : "unexpected_error";
  process.stderr.write(`${code}: ${error.message}\n`);
  if (error instanceof CompiledValidatorCacheError) {
    process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  }
  process.exitCode = 1;
}
