

import { deriveLauncherOwnedDispatchWorktreeRoot } from
  "../../../agent-launch-core/src/lib/launcher-owned-worktree-root.mjs";
import { withControlledContractAuthorityExclusion } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import { TERMINAL_WK_CANDIDATE_CODES, readTerminalWkCandidateMetadata } from
  "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { createTerminalCandidateCoordinator } from "./dispatch-terminal-candidate-coordinator.mjs";

export const TERMINAL_CANDIDATE_NOT_SELECTED_CODE = "run_test.terminal_candidate_not_selected.v1";

const ABSENT = Object.freeze({ status: "absent" });

export async function observeTerminalCandidateOwnership({ mainRepo, commit, worktreeRoot = null }) {
  let metadata;
  try {
    metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate: commit });
  } catch (error) {
    if (error?.code === TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID) return ABSENT;
    throw error;
  }
  const wkId = metadata.canonical_wk_id;
  try {
    const coordinator = createTerminalCandidateCoordinator({ mainRepo,
      worktreeRoot: worktreeRoot ?? deriveLauncherOwnedDispatchWorktreeRoot(mainRepo) });
    const observed = await withControlledContractAuthorityExclusion({ repoRoot: mainRepo, wkId,
      run: (authorityContext) => coordinator.observeTerminalCandidateUnderAuthority({ wkId, authorityContext }) });
    if (observed?.binding?.candidate !== commit) {
      throw Object.assign(new Error(`${wkId} selects a different terminal candidate than the requested commit`),
        { code: TERMINAL_CANDIDATE_NOT_SELECTED_CODE });
    }
    return Object.freeze({ status: "owned", worktree_path: observed.materialization.checkout_path,
      owner: Object.freeze({ kind: "terminal_candidate", wk_id: wkId }) });
  } catch (error) {
    return Object.freeze({ status: "refused", error });
  }
}
