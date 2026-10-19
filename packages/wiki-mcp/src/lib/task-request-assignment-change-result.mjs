
import path from "node:path";
import { createDeliveryOriginals } from "./task-deliver-work-result.mjs";
import { findManagedDeliveryReceipt } from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { managedTestAuthorityAuthenticated, managedTestAuthorityIdentity } from "./managed-test-source-context.mjs";
import { getResponseSpillConfig } from "./mcp-response.mjs";
import { readSelectedResponseEvidence, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";

export const ASSIGNMENT_CHANGE_TOOL = "request_assignment_change";

export function retainAssignmentChange({ workspace, session, binding, responseEnv, request, assignment }) {
  const originals = createDeliveryOriginals({ workspace, binding, credential: session.credential,
    assignedUnit: session.assignedUnit, responseEnv, producer: ASSIGNMENT_CHANGE_TOOL });
  const original = originals.retain({ original: { request, assignment,
    identity: { unit: session.assignedUnit, binding } } });
  const { evidence } = readSelectedResponseEvidence(original, { env: responseEnv,
    expected: { route: ASSIGNMENT_CHANGE_TOOL, repository: workspace.repo, unit: session.assignedUnit } });
  return { original: evidence, storage: { state_dir: getResponseSpillConfig(responseEnv).stateDir } };
}

export function readAssignmentChange({ workspace, sessionEnv, responseEnv, result, allowMissing = false }) {
  const session = resolveLauncherRunState(sessionEnv);
  if (!["worker", "orchestrator"].includes(session.role) ||
      !managedTestAuthorityAuthenticated(managedTestAuthorityIdentity(session))) {
    throw selectedResponseQueryInvalidError(ASSIGNMENT_CHANGE_TOOL, "session_not_authenticated_result_reader");
  }
  const found = findManagedDeliveryReceipt({ mainRepo: path.resolve(workspace.dir), refId: result.ref_id,
    subject: session.role === "worker" ? session.assignedUnit : null, assignmentChange: true });
  if (found === null && allowMissing) return null;
  if (found === null) throw selectedResponseQueryInvalidError(ASSIGNMENT_CHANGE_TOOL, "accepted_request_link_unavailable");
  const { completion, dispatchTuple } = found;
  const credential = session.role === "worker" ? session.credential : completion.credential;
  const binding = resolveWorktreeBinding({ mainRepo: path.resolve(workspace.dir),
    launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId });
  const env = { ...responseEnv, WIKI_MCP_RESPONSE_STATE_DIR: completion.storage.state_dir };
  const originals = createDeliveryOriginals({ workspace, binding, credential,
    assignedUnit: dispatchTuple.assigned_unit, responseEnv: env, producer: ASSIGNMENT_CHANGE_TOOL });
  return originals.read({ result }, { recorded: completion.original,
    project: value => ({ ...value, responseEnv: env, completion }) });
}
