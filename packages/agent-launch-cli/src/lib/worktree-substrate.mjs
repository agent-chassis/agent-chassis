

export {
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WorktreeSubstrateError,
  defaultRunGit,
  perWkBranchRef,
  perWkWorktreePath,
  worktreeIdentityStoreDir
} from "./worktree-substrate-primitives.mjs";

export {
  defaultWriteBindingFile,
  resolveWorktreeBinding,
  resolveWorktreePath,
  resolveVerifiedWorktreeBinding,
  resolveVerifiedSparseExactUnitBinding
} from "./worktree-substrate-identity.mjs";

export {
  sliceBranchRef,
  sliceWorktreePath,
  deriveExactUnitName,
  resolveIndependentUnitBase,
  resolveWkBranchTipBase,
  normalizeSparseConeDirs,
  allocateExactUnitWorktree,
  allocateSparseExactUnitWorktree
} from "./worktree-substrate-exact-unit.mjs";

export {
  integrationBranchRef,
  integrationWorktreePath,
  allocateIntegrationWorktree,
  allocatePerWkWorktree
} from "./worktree-substrate-integration-legacy.mjs";
