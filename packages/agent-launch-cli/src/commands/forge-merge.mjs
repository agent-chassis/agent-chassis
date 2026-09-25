import { validateWorkRecord } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  assertDispatchRuntimeTestComposition,
  buildDispatchRuntime,
  DISPATCH_RUNTIME_HANDOFF_TEST_COMPOSITION_FIELDS,
  createTerminalCandidateCoordinator,
  createWkForgeHandoffAuthenticationObserver,
  resolveDispatchWorktreeProvisioningConfig
} from "../../../wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { trustedWkForgeMerge } from "../lib/wk-forge-merge.mjs";

const WK_RE = /^WK-\d{4}$/u;

const USAGE = "Usage: agent-launch forge-merge WK-####";

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
  const provisioning = resolveDispatchWorktreeProvisioningConfig(env, {
    testWorktreeRoot: composition?.worktreeRoot ?? null
  });
  if (provisioning === null) {
    throw new Error("forge merge requires launcher-minted workspace provisioning");
  }

  const runtime = buildDispatchRuntime(env, { testComposition: composition });
  if (!runtime.dispatchBackend) {
    throw new Error("forge merge trusted launcher runtime is unavailable");
  }
  const terminalCandidateCoordinator = createTerminalCandidateCoordinator({
    mainRepo: provisioning.mainRepo,
    worktreeRoot: provisioning.worktreeRoot
  });
  return {
    mainRepo: provisioning.mainRepo,

    resolveAuthenticatedWkForgeHandoff: createWkForgeHandoffAuthenticationObserver({
      mainRepo: provisioning.mainRepo,
      terminalCandidateCoordinator
    }),
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

export async function runForgeMerge(argv, io = {}, dependencies = null, { env = process.env } = {}) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    output(io, USAGE);
    return;
  }
  if (argv.length !== 1 || !WK_RE.test(argv[0])) {
    errorOutput(io, USAGE);
    throw new Error("forge-merge accepts exactly one WK id");
  }
  const wk = argv[0];
  const composed = dependencies ?? createProductionForgeMergeDependencies({ env });
  const operation = composed.operation ?? trustedWkForgeMerge;
  const result = await operation({
    mainRepo: composed.mainRepo,
    assignedUnit: wk,
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
