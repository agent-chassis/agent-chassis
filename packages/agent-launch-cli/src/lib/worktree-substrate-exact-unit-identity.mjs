

import path from "node:path";

import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WK_ID_RE,
  SLICE_ID_RE,
  fail,
  parseUnitAddress,
  assertInitiativeId,
  assertAbsolutePath,
  revParse,
  perWkBranchRef,
  perWkWorktreePath,
  defaultRunGit
} from "./worktree-substrate-primitives.mjs";

export function sliceBranchRef(initiative, wkId, sliceId) {
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  if (typeof sliceId !== "string" || !SLICE_ID_RE.test(sliceId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SLICE_ID,
      `slice id must match ^SLICE-\\d{3}$ (normalized upper-case), got: ${JSON.stringify(sliceId)}`
    );
  }
  return `slice/${initiative}/${wkId}/${sliceId}`;
}

export function sliceWorktreePath(worktreeRoot, initiative, wkId, sliceId) {
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  if (typeof sliceId !== "string" || !SLICE_ID_RE.test(sliceId)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_SLICE_ID,
      `slice id must match ^SLICE-\\d{3}$ (normalized upper-case), got: ${JSON.stringify(sliceId)}`
    );
  }
  return path.join(root, `slice-${initiative}-${wkId}-${sliceId}`);
}

export function deriveExactUnitName({ unitAddress, worktreeRoot }) {
  const parsed = parseUnitAddress(unitAddress);
  const outputBranch =
    parsed.kind === "wk"
      ? perWkBranchRef(parsed.initiative, parsed.wkId)
      : sliceBranchRef(parsed.initiative, parsed.wkId, parsed.sliceId);
  const worktreePath =
    parsed.kind === "wk"
      ? perWkWorktreePath(worktreeRoot, parsed.initiative, parsed.wkId)
      : sliceWorktreePath(worktreeRoot, parsed.initiative, parsed.wkId, parsed.sliceId);
  return Object.freeze({
    kind: parsed.kind,
    unit_address: parsed.unitAddress,
    initiative: parsed.initiative,
    wk_id: parsed.wkId,
    slice_id: parsed.sliceId,
    output_branch: outputBranch,
    worktree_path: worktreePath
  });
}

export function resolveIndependentUnitBase({ mainRepo, base = "main", deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  if (typeof base !== "string" || base.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "base must be a non-empty string");
  }
  const baseSha = revParse(runGit, repo, base);
  return Object.freeze({ base_ref: base, base_sha: baseSha });
}

export function resolveWkBranchTipBase({ mainRepo, unitAddress, deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  const parsed = parseUnitAddress(unitAddress);
  if (parsed.kind !== "slice") {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS, "WK-tip base resolution requires a slice unit_address");
  }
  const baseRef = perWkBranchRef(parsed.initiative, parsed.wkId);
  return Object.freeze({ base_ref: baseRef, base_sha: revParse(runGit, repo, baseRef) });
}
