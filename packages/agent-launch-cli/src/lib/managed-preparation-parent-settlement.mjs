import { synchronizeOwnedWorktreeCheckout } from "./owned-worktree-checkout.mjs";

export function capturePreparationParent({ binding, runGit, attempt }) {
  const status = runGit({ repo: binding.worktree_path,
    args: ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"] });
  return { binding, attempt, before_tip: binding.wk_tip_sha, expected_tip: binding.wk_tip_sha,
    usable: status?.ok === true && status.stdout === "", shared: false,
    observation: status?.ok === true ? null : status };
}

export function recordPreparationAdvance(parent, { previous, tip, owned }) {
  if (!parent || tip === parent.expected_tip) return;
  if (!owned || previous !== parent.expected_tip) parent.shared = true;
  parent.expected_tip = tip;
}

export async function settlePreparationParent({ repo, parent, runGit }) {
  if (!parent) return { state: "not_started" };
  try {
    const ref = `refs/heads/${parent.binding.output_branch}`;
    const read = runGit({ repo, args: ["show-ref", "--verify", "--hash", ref] });
    const observed = read?.ok === true ? read.stdout.trim() : null;
    const facts = { attempt: parent.attempt, parent_ref: ref, before_tip: parent.before_tip,
      expected_tip: parent.expected_tip, observed_tip: observed, worktree_path: parent.binding.worktree_path };
    if (!parent.usable || parent.shared || observed !== parent.expected_tip) {
      return { ...facts, state: "retained", limitation: !parent.usable
        ? "parent_not_proven_usable_before_preparation" : parent.shared
          ? "concurrent_ref_winner_is_not_attempt_owned" : "parent_ref_moved_after_preparation",
        ...(read?.ok === true ? {} : { cause: read }),
        recovery: "reconcile the reported parent state through its owning lifecycle; no automatic retry or reset" };
    }
    try {
      const checkout = await synchronizeOwnedWorktreeCheckout({ mainRepo: repo,
        worktreePath: parent.binding.worktree_path, branchRef: ref, targetSha: observed,
        floorSha: parent.before_tip, mutation: "index_and_files" });
      return { ...facts, state: checkout.clean === true ? "usable" : "retained", checkout,
        ...(checkout.clean === true ? {} : { limitation: "parent_changed_during_settlement" }) };
    } catch (error) {
      return { ...facts, state: "retained", limitation: "parent_settlement_refused",
        cause: { code: error.code ?? null, message: error.message, detail: error.detail ?? null },
        recovery: "correct the reported checkout cause through its owner; real edits and newer commits were preserved" };
    }
  } catch (error) {
    return { state: "retained", attempt: parent.attempt, worktree_path: parent.binding.worktree_path,
      expected_tip: parent.expected_tip, limitation: "parent_settlement_observation_failed",
      cause: { code: error.code ?? null, message: error.message, detail: error.detail ?? null } };
  }
}
