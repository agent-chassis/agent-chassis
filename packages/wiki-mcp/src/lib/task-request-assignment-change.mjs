import { holdAcceptedAssignmentChange } from "./launcher-assignment-change-termination.mjs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { captureAssignmentChangeContext } from './task-request-assignment-change-context.mjs';
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { verifyExactSliceCommitBinding } from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { recordManagedCompletion, readManagedCompletion } from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { pendingDeliveryReceiptForSession, pendingDeliveryCompletionReleaseForSession } from "./task-deliver-work-result.mjs";
import { retainAssignmentChange } from "./task-request-assignment-change-result.mjs";
import { assignmentChangeInputFailure, assignmentChangeCompletionRefusal, assignmentChangeOwnerFailure }
  from "./task-request-assignment-change-response.mjs";

export const ASSIGNMENT_CHANGE_INPUT_SCHEMA = z.object({
  assignment_fact: z.object({ kind: z.enum(["missing", "contradictory"]), statement: z.string().describe("The missing or contradictory frozen assignment fact.") }).strict().describe("Identify whether a frozen assignment fact is missing or contradictory and state it."),
  evidence: z.array(z.object({ description: z.string(), references: z.array(z.string()) }).strict()).describe("Supporting observations and inert path or result references."),
  prevents: z.string().describe("What the gap prevents you from completing."),
  requested_change: z.string().describe("Exact correction or access needed and why; for scope gaps name every missing path and its reason."),
  completed_work: z.array(z.string()).describe("Completed work handed to the coordinator; acceptance ends this process with no final report."),
  remaining_work: z.array(z.string()).describe("Unfinished work handed to the coordinator for its revision decision.")
}).strict();

export function createRequestAssignmentChangeSurface({ workspace, sessionEnv, responseEnv = sessionEnv, assignmentChangeTermination = null }) {
  const env = { ...sessionEnv }, responses = { ...responseEnv };
  async function inputFailure(args, validationError) {
    let session;
    try { session = resolveLauncherRunState(env); }
    catch (error) { return assignmentChangeOwnerFailure({ error, stage: "authentication" }); }
    return assignmentChangeInputFailure({ args, validationError,
      subject: session.role === "worker" && session.credential !== null ? session.assignedUnit : null });
  }
  return { inputSchema: ASSIGNMENT_CHANGE_INPUT_SCHEMA, inputFailure, async prepare(input) {
    let session, retained = null, prior = null, decision = null, stage = "authentication";
    try {
      session = resolveLauncherRunState(env);
      if (session.role !== "worker" || session.credential === null) throw Object.assign(
        new Error("request_assignment_change requires the authenticated current worker binding"), { code: "assignment_change_worker_binding_required" });
      stage = "input_validation";
      const parsed = ASSIGNMENT_CHANGE_INPUT_SCHEMA.safeParse(input);
      if (!parsed.success) return inputFailure(input, parsed.error);
      stage = "binding_resolution";
      const credential = session.credential;
      const mainRepo = path.resolve(workspace.dir);
      const binding = resolveWorktreeBinding({ mainRepo, launchRef: credential.launchRef,
        runId: credential.runId, retryId: credential.retryId });
      verifyExactSliceCommitBinding({ binding, mainRepo, assignedUnit: session.assignedUnit,
        launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId });
      const observed = readManagedCompletion({ mainRepo, subject: session.assignedUnit, sliceBinding: binding });
      if (!observed.ok) throw Object.assign(new Error(observed.refusal?.reason ?? observed.code), { code: observed.code, cause: observed });
      prior = observed.completion;
      stage = "frozen_assignment";
      const historical = observed.completion?.alternative === "assignment_change_requested";
      const context = historical ? null : captureAssignmentChangeContext({ env, session, binding,
        dispatchTuple: observed.dispatch_tuple });
      const request = parsed.data;
      stage = "terminal_capability";
      if (assignmentChangeTermination === null) throw Object.assign(
        new Error("this exact worker attempt has no private launcher terminal capability"),
        { code: "assignment_change_terminal_capability_unavailable" });
      assignmentChangeTermination.assertAvailable();
      stage = "original_retention";
      if (!historical) retained = retainAssignmentChange({ workspace, session, binding,
        responseEnv: responses, request, assignment: context.assignment });
      const completion = { alternative: "assignment_change_requested", intent_id: randomUUID(),
        request_digest: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        assignment_digest: historical ? observed.completion.assignment_digest : context.digest, credential,
        ...(retained ?? {}) };
      stage = "journal_acceptance";
      const accepted = recordManagedCompletion({ mainRepo, subject: session.assignedUnit, sliceBinding: binding, completion });
      decision = accepted;
      const selected = accepted.completion;
      if (!accepted.ok && accepted.code === "completion_delivery_intent_exists") {
        const pending = pendingDeliveryReceiptForSession({ workspace, sessionEnv: env, responseEnv: responses });
        const release = pending === null ? pendingDeliveryCompletionReleaseForSession({ workspace,
          sessionEnv: env, responseEnv: responses, intent: accepted.completion }) : null;
        return assignmentChangeCompletionRefusal({ decision: accepted, subject: session.assignedUnit, retained, pending, release });
      }
      if (!accepted.ok) return assignmentChangeCompletionRefusal({ decision: accepted, subject: session.assignedUnit, retained });

      return holdAcceptedAssignmentChange({ termination: assignmentChangeTermination, session, completion: selected });
    } catch (error) {
      return assignmentChangeOwnerFailure({ error, stage, subject: session?.assignedUnit ?? null,
        retained: retained !== null, prior: decision?.completion ?? prior });
    }
  } };
}
