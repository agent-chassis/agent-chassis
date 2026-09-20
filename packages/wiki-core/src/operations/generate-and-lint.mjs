import path from "node:path";
import { createWorkRecordCorpusSnapshot } from "../lib/work-record-corpus-snapshot.mjs";
import { loadCanonicalState, resolveContractContext } from "../lib/wiki.mjs";
import {
  buildGeneratedViewsFromCanonicalState,
  generateViewsFromBuild,
  resolveOperationDate
} from "./generate.mjs";
import { lintRepoFromCapturedCorpus } from "./lint.mjs";
import { buildLintNextAction } from "./lint-shared.mjs";

export const LINT_COMPACT_FINDINGS_LIMIT = 20;

export function normalizeMaxFindings(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

export function buildLintFindingsResponse(
  fullLint,
  { maxFindings = null, defaultMaxFindings = LINT_COMPACT_FINDINGS_LIMIT } = {}
) {
  if (
    !Array.isArray(fullLint?.findings) ||
    !Array.isArray(fullLint?.problems) ||
    !Array.isArray(fullLint?.warnings)
  ) {
    throw new Error("lint findings response requires complete consistent producer arrays");
  }

  const allFindings = fullLint.findings;
  const allProblems = fullLint.problems;
  const allWarnings = fullLint.warnings;
  let problemIndex = 0;
  for (const finding of allFindings) {
    if (finding?.severity !== "error") {
      continue;
    }
    if (problemIndex >= allProblems.length || allProblems[problemIndex] !== finding.message) {
      throw new Error("lint findings response requires complete consistent producer arrays");
    }
    problemIndex += 1;
  }
  if (problemIndex !== allProblems.length) {
    throw new Error("lint findings response requires complete consistent producer arrays");
  }

  const normalizedMax = normalizeMaxFindings(maxFindings);
  const effectiveMax = normalizedMax !== null ? normalizedMax : defaultMaxFindings;

  const findingCountTotal = allFindings.length;
  const cappedFindings = allFindings.slice(0, effectiveMax);
  const cappedWarnings = allWarnings.slice(0, effectiveMax);
  const findingsReturned = cappedFindings.length;
  const findingsTruncated = findingsReturned < findingCountTotal;

  const errorCount = allProblems.length;
  const warningCount = allWarnings.length;

  const nextAction =
    findingsTruncated
      ? `before repair, rerun this same lint route with max_findings:${findingCountTotal} (at least finding_count_total) to retrieve all ${findingCountTotal} findings and the complete warning list; this response contains only the ordered prefix and may not identify every error`
      : buildLintNextAction({ errorCount, warningCount, findingsTruncated });

  const result = {
    ok: errorCount === 0,
    valid: errorCount === 0,
    warning_count: warningCount,
    error_count: errorCount,
    finding_count_total: findingCountTotal,
    findings_returned: findingsReturned,
    findings_truncated: findingsTruncated,
    max_findings: effectiveMax,
    next_action: nextAction
  };

  if (cappedFindings.length > 0) {
    result.findings = cappedFindings;
  }
  if (cappedWarnings.length > 0) {
    result.warnings = cappedWarnings;
  }

  return result;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  createWorkRecordCorpusSnapshot,
  resolveContractContext,
  loadCanonicalState,
  buildGeneratedViewsFromCanonicalState,
  generateViewsFromBuild,
  lintRepoFromCapturedCorpus
});

async function generateAndLintImpl({
  dir = ".",
  profile = null,
  extensionNamespaces = null,
  verbose = false,
  includeAllFindings = false,
  include_all_findings = false,
  max_findings = null,
  maxFindings = null,
  clock = null,
  instrumentation = null
} = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const targetDir = path.resolve(String(dir));
  const context = await dependencies.resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const operationDate = resolveOperationDate(clock);
  const snapshot = await dependencies.createWorkRecordCorpusSnapshot({
    dir: targetDir,
    instrumentation
  });
  try {
    if (typeof instrumentation?.increment === "function") {
      instrumentation.increment("canonical_state_load_count", 1);
    }
    const canonicalState = await dependencies.loadCanonicalState(targetDir, {
      extensionNamespaces: context.extensionNamespaces,
      workRecords: snapshot.loads
    });
    const generatedBuild = await dependencies.buildGeneratedViewsFromCanonicalState({
      targetDir,
      context,
      canonicalState,
      operationDate,
      instrumentation
    });
    const generated = await dependencies.generateViewsFromBuild(generatedBuild);

    const lint = await dependencies.lintRepoFromCapturedCorpus({
      dir: targetDir,
      profile,
      extensionNamespaces,
      includeAllFindings: true,
      instrumentation
    }, {
      context,
      operationDate,
      workRecordSnapshot: snapshot,
      canonicalState,
      generatedBuild
    });

    const includeFullOutput =
      verbose === true || includeAllFindings === true || include_all_findings === true;

    const compactResult = buildLintFindingsResponse(lint, {
      maxFindings: maxFindings ?? max_findings
    });

    if (includeFullOutput) {
      return {
        ...compactResult,
        targetDir: generated.targetDir,
        generated,
        lint
      };
    }

    return compactResult;
  } finally {
    snapshot.release();
  }
}

export async function generateAndLint(options = {}) {
  return generateAndLintImpl(options, DEFAULT_DEPENDENCIES);
}

export async function generateAndLintWithDependencies(options = {}, dependencies = {}) {
  return generateAndLintImpl(options, { ...DEFAULT_DEPENDENCIES, ...dependencies });
}
