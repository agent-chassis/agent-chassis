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
  const allFindings = Array.isArray(fullLint?.findings) ? fullLint.findings : [];
  const allProblems = Array.isArray(fullLint?.problems) ? fullLint.problems : [];
  const allWarnings = Array.isArray(fullLint?.warnings) ? fullLint.warnings : [];

  const normalizedMax = normalizeMaxFindings(maxFindings);
  const explicitMax = normalizedMax !== null;
  const effectiveMax = explicitMax ? normalizedMax : defaultMaxFindings;

  const findingCountTotal = allFindings.length;
  const cappedFindings = allFindings.slice(0, effectiveMax);
  const cappedProblems = allProblems.slice(0, effectiveMax);
  const cappedWarnings = allWarnings.slice(0, effectiveMax);
  const findingsReturned = cappedFindings.length;
  const findingsTruncated = findingsReturned < findingCountTotal;

  const errorCount = allProblems.length;
  const warningCount = allWarnings.length;

  const nextAction =
    explicitMax && findingsTruncated
      ? `findings truncated to max_findings=${effectiveMax} of ${findingCountTotal} total; rerun this lint route with a higher max_findings (for example max_findings:${findingCountTotal}) to retrieve the remaining findings for repair`
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
  if (cappedProblems.length > 0) {
    result.problems = cappedProblems;
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
