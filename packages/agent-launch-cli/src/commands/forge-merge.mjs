import { validateWorkRecord } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  buildDispatchRuntime,
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

function terminalReviewComplete(record) {
  const terminalReviews = Array.isArray(record?.slices)
    ? record.slices.filter((slice) => slice?.review_purpose === "terminal_whole_wk")
    : [];
  return record?.status === "review" && terminalReviews.length === 1 &&
    terminalReviews[0]?.work_kind === "review" && terminalReviews[0]?.status === "review";
}

export function createProductionForgeMergeDependencies({ env = process.env } = {}) {
  const provisioning = resolveDispatchWorktreeProvisioningConfig(env);
  if (provisioning === null) {
    throw new Error("forge merge requires launcher-minted workspace provisioning");
  }

  const runtime = buildDispatchRuntime(env);
  if (!runtime.dispatchBackend ||
      typeof runtime.dispatchBackend.resolveTerminalCandidatePublicationState !== "function") {
    throw new Error("forge merge trusted terminal-candidate resolver is unavailable");
  }
  return {
    mainRepo: provisioning.mainRepo,
    resolveTerminalCandidatePublicationState: async (wk) => {
      const retained = runtime.dispatchBackend.resolveTerminalCandidatePublicationState(wk);
      if (retained !== null) return retained;

      if (typeof runtime.dispatchBackend.recoverTerminalCandidate !== "function") return null;
      const recovered = await runtime.dispatchBackend.recoverTerminalCandidate(wk);
      if (!recovered?.binding || !recovered?.materialization) return null;
      return Object.freeze({
        binding: recovered.binding,
        materialization: recovered.materialization,
        advisory_review_evidence: recovered.validation_evidence ?? null,
        terminal_review_subject: recovered.binding.terminal_review_subject ?? null,
        terminal_review_contract_digest: recovered.binding.terminal_review_contract_digest ?? null
      });
    },
    validateWorkRecord: (record, options = {}) => {
      const valid = validateWorkRecord(record, {
        sourcePath: `wiki/work-records/${options.id}.json`,
        ...options
      }).length === 0;

      return valid && (!options.terminalComplete || terminalReviewComplete(record));
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
