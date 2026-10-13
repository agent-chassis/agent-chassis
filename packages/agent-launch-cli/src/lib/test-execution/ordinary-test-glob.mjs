

import { globSync } from "node:fs";
import path from "node:path";

import { DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS, mintTestProofExecutionBudget } from "./confined-capture.mjs";
import { ORDINARY_TEST_RUN_CODES, ordinaryTargetDefect, runOrdinaryTestFile } from "./ordinary-test-runner.mjs";

export const ORDINARY_TEST_GLOB_RUN_SCHEMA_VERSION = "ordinary-test-glob-run.v1";

const PATTERN_CHARACTER = /[*?[\]{}]/u;

export function isOrdinaryTargetPattern(target) {
  return typeof target === "string" && PATTERN_CHARACTER.test(target);
}

export function expandOrdinaryTargetPattern(checkoutRoot, pattern) {
  return globSync(pattern, { cwd: checkoutRoot, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(checkoutRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

function stopReason(result) {
  if (result.run?.timed_out === true) return "timed_out";
  if (result.run?.cancelled === true) return "cancelled";
  if (result.status === "unconfirmed") return "unconfirmed";
  if (result.run?.cleanup_failed === true || result.cleanup_failed === true) return "cleanup_unsafe";
  return null;
}

function refused(pattern, code, message, detail) {
  return Object.freeze({ schema_version: ORDINARY_TEST_GLOB_RUN_SCHEMA_VERSION, status: "refused", ok: false,
    proof_credit: false, code, message, detail, recovery: null, pattern, files: Object.freeze([]), stopped: null });
}

export async function runOrdinaryTest(request, { targets = null } = {}) {
  if (request === null || typeof request !== "object" || !isOrdinaryTargetPattern(request.target)) {
    return runOrdinaryTestFile(request);
  }
  const pattern = request.target;
  const defect = ordinaryTargetDefect(pattern, { pattern: true });
  if (defect !== null) {
    return refused(pattern, ORDINARY_TEST_RUN_CODES.TARGET_INVALID,
      `the target must be one repository-relative file or pattern: ${defect}`, { target: pattern });
  }
  const matched = targets ?? expandOrdinaryTargetPattern(request.checkoutRoot, pattern);

  if (matched.some((target) => path.isAbsolute(target) || target.split("/").includes(".."))) {
    return refused(pattern, ORDINARY_TEST_RUN_CODES.TARGET_INVALID,
      `the target must be one repository-relative file or pattern: ${pattern} matches outside the checkout`,
      { target: pattern });
  }
  if (matched.length === 0) {
    return refused(pattern, ORDINARY_TEST_RUN_CODES.TARGET_NO_MATCH,
      `no regular file in the checkout matches ${pattern}`, { pattern });
  }
  const ownedBudget = request.budget === undefined || request.budget === null ? mintTestProofExecutionBudget({
    timeoutMs: request.timeoutMs ?? DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS }) : null;
  const budget = request.budget ?? ownedBudget;
  const files = matched.map((target) => ({ target, result: null }));
  const started = new Map();
  let stopped = null;
  try {
    for (const file of files) {
      stopped = budget.interruption();
      if (stopped !== null) break;
      file.result = await runOrdinaryTestFile({ ...request, target: file.target, budget }, started);
      stopped = stopReason(file.result);
      if (stopped !== null) break;
    }
  } finally {
    ownedBudget?.dispose();
  }
  const frozen = Object.freeze(files.map((file) => Object.freeze(file)));
  if (files.every(({ result }) => result?.status === "refused")) {
    const { code, message, detail, recovery } = files[0].result;
    return Object.freeze({ ...refused(pattern, code, message, detail), recovery: recovery ?? null, files: frozen });
  }
  const passed = ({ result }) => result?.status === "covered"
    ? files.find(({ target }) => target === result.covered_by).result.ok === true : result?.ok === true;
  return Object.freeze({ schema_version: ORDINARY_TEST_GLOB_RUN_SCHEMA_VERSION,
    status: stopped === null ? "completed" : "stopped", ok: stopped === null && files.every(passed),
    proof_credit: false, pattern, files: frozen, stopped });
}
