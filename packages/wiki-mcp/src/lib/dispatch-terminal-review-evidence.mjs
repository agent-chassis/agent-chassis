

import { lifecycleError } from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "../../../agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import { verifyTerminalWkCandidateObjectBinding } from
  "../../../agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export async function verifyTerminalCandidateCycle({ terminalCandidate, runGit }) {
  if (!terminalCandidate || typeof terminalCandidate !== "object" ||
      !terminalCandidate.binding || !terminalCandidate.materialization) {
    throw lifecycleError(
      "agent_launch.terminal_candidate.missing_binding.v1",
      "terminal candidate lifecycle state is absent or incomplete"
    );
  }
  await verifyTerminalWkCandidateObjectBinding({ binding: terminalCandidate.binding, runGit });
  assertTerminalCandidateMaterialization(terminalCandidate.materialization, terminalCandidate.binding);
  await verifyTerminalCandidateCheckout({
    binding: terminalCandidate.binding,
    candidateRoot: terminalCandidate.materialization.candidate_root,
    runGit
  });
  return terminalCandidate;
}
