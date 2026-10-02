import path from "node:path";

import { validateWorkRecord } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  assertDispatchRuntimeTestComposition,
  DISPATCH_RUNTIME_HANDOFF_TEST_COMPOSITION_FIELDS
} from "../../../wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { createProductionHandoffObserverComposition } from
  "../lib/production-handoff-observer-composition.mjs";
import { trustedWkForgeMerge } from "../lib/wk-forge-merge.mjs";

const WK_RE = /^WK-\d{4}$/u;

const USAGE = "Usage: agent-launch forge-merge WK-#### [--checkout <path>]";

function output(io, value) {
  (io?.stdout ?? process.stdout).write(`${value}\n`);
}

function errorOutput(io, value) {
  (io?.stderr ?? process.stderr).write(`${value}\n`);
}

function render(result) {
  return JSON.stringify(result, null, 2);
}

export function createProductionForgeMergeDependencies({
  env = process.env,
  testComposition = null
} = {}) {
  const composition = assertDispatchRuntimeTestComposition(testComposition);
  if (composition !== null &&
      DISPATCH_RUNTIME_HANDOFF_TEST_COMPOSITION_FIELDS.some((field) => Object.hasOwn(composition, field))) {
    throw new TypeError("forge merge test composition does not accept forge handoff dependencies");
  }
  const { mainRepo, resolveAuthenticatedWkForgeHandoff } =
    createProductionHandoffObserverComposition({ env, composition, command: "forge merge" });
  return {
    mainRepo,

    resolveAuthenticatedWkForgeHandoff,
    validateWorkRecord: (record, options = {}) => {
      const { closeoutReady = false, ...schemaOptions } = options;
      const valid = validateWorkRecord(record, {
        sourcePath: `wiki/work-records/${options.id}.json`,
        ...schemaOptions
      }).length === 0;

      return valid && (!closeoutReady || record?.status === "review");
    }
  };
}

function parseArguments(argv, cwd) {
  if (argv.length === 1 && WK_RE.test(argv[0])) return { wk: argv[0], checkout: null };
  if (argv.length === 3 && WK_RE.test(argv[0]) && argv[1] === "--checkout" && argv[2].length > 0) {
    return { wk: argv[0], checkout: path.resolve(cwd, argv[2]) };
  }
  return null;
}

export async function runForgeMerge(argv, io = {}, dependencies = null, {
  env = process.env, cwd = process.cwd()
} = {}) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    output(io, USAGE);
    return;
  }
  const parsed = parseArguments(argv, cwd);
  if (parsed === null) {
    errorOutput(io, USAGE);
    throw new Error("forge-merge accepts exactly one WK id and an optional --checkout <path>");
  }
  const composed = dependencies ?? createProductionForgeMergeDependencies({ env });
  const operation = composed.operation ?? trustedWkForgeMerge;
  const result = await operation({
    mainRepo: composed.mainRepo,
    assignedUnit: parsed.wk,
    ...(parsed.checkout === null ? {} : { checkout: parsed.checkout }),
    deps: composed
  });
  output(io, render(result));
  if (result?.ok !== true) {
    const error = new Error(result.detail?.reason ?? "forge merge refused");
    error.result = result;
    throw error;
  }
  return result;
}
