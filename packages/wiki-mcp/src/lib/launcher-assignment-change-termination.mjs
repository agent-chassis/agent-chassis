import { fstatSync } from "node:fs";
import { structuredLog } from "./server-composition-helpers.mjs";
import { captureDiagnosticEvidence } from "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";

export const ASSIGNMENT_CHANGE_TERMINAL_EVENT = "wiki-mcp-launcher-assignment-change.v1";

export function createLauncherAssignmentChangeTermination({ fd, writer }) {
  if (!Number.isInteger(fd) || fd < 3) return null;
  return Object.freeze({
    assertAvailable() {
      if (writer.failure !== null) throw writer.failure;
      const stat = fstatSync(fd);

      if (!stat.isFIFO() && !stat.isSocket()) throw Object.assign(
        new Error("the private launcher lifecycle descriptor is not a pipe"),
        { code: "assignment_change_terminal_channel_invalid" });
    },
    terminate({ session, completion }) {
      const failure = writer.emit({ schema_version: ASSIGNMENT_CHANGE_TERMINAL_EVENT,
        assigned_unit: session.assignedUnit, launch_ref: session.credential.launchRef,
        run_id: session.credential.runId, retry_id: String(session.credential.retryId),
        request_id: completion.intent_id });

      void failure;
      return new Promise(() => {});
    }
  });
}

export async function holdAcceptedAssignmentChange({ termination, session, completion }) {
  try {
    await termination.terminate({ session, completion });
    throw Object.assign(new Error("launcher termination returned without stopping the worker"),
      { code: "assignment_change_terminal_returned" });
  } catch (error) {
    structuredLog({ level: "error", code: "assignment_change_termination_failed",
      request_id: completion.intent_id, assigned_unit: session.assignedUnit,
      accepted: true, pending_termination: true, cause: captureDiagnosticEvidence(error) });
    return new Promise(() => {});
  }
}
