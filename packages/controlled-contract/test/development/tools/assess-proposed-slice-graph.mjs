#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assessProposedSliceGraph
} from "../proposed-slice-graph-assessor.mjs";

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/assess-proposed-slice-graph.mjs \\
    --input <anonymous-planning-input.json> \\
    --proposal <proposed-slice-graph.json> \\
    --policy <assessment-policy.json>

The command assesses an orchestrator-proposed graph against exact anonymous
contract facts. It does not create slices, select a model, authorize dispatch,
or treat the optional anonymous comparison as a correctness oracle.`;
}

function parseArgs(argv) {
  const options = {
    input: null,
    proposal: null,
    policy: null,
    help: false
  };
  const next = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (!["--input", "--proposal", "--policy"].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    options[flag.slice(2)] = next(index, flag);
    index += 1;
  }
  if (!options.help) {
    for (const field of ["input", "proposal", "policy"]) {
      if (!options[field]) throw new Error(`--${field} is required`);
    }
  }
  return options;
}

async function readJson(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${label} ${filePath}: ${error.message}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const [input, proposal, policy] = await Promise.all([
    readJson(options.input, "input"),
    readJson(options.proposal, "proposal"),
    readJson(options.policy, "policy")
  ]);
  const result = assessProposedSliceGraph(input, proposal, policy);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { main, parseArgs, readJson, usage };
