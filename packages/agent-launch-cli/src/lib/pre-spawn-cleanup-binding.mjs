import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

import { boundedCleanupFailure, withSecondaryCleanupFailure } from "./launch-failure-cause.mjs";
import { rollbackPreparedWorkerDirectories } from "./launch-isolation-worker-scope.mjs";

const WRITABLE_FILE_PRECREATION_CLEANUP_SCHEMA_VERSION =
  "writable-file-precreation-cleanup.v1";

export const PRECREATION_CLEANUP_IDENTITY_DRIFT_REASON =
  "writable_file_precreation_cleanup_identity_drift";

function sameManagedUnitSubject(subject, attemptBinding) {
  if (typeof subject !== "string" || subject.length === 0) return false;
  const selected = attemptBinding?.selected_unit_address;
  const unit = attemptBinding?.unit_address;
  return subject === selected || subject === unit ||
    (typeof selected === "string" && selected.length > 0 &&
      typeof unit === "string" && unit.endsWith(`/${subject.replace("#", "/")}`));
}

export function bindAttemptOwnedPreSpawnCleanup({
  bwrapPlan,
  role,
  subject,
  runId
} = {}) {
  const capability = bwrapPlan?.writableFilePrecreationCleanup ?? null;
  const authority = bwrapPlan?.workerScopeAuthority ?? null;
  if (role !== "worker" || (capability == null && authority == null)) return null;
  let invoked = false;
  let cleanupResult = null;
  const cleanupOnce = () => {
    if (invoked) return cleanupResult;
    invoked = true;
    if (capability == null) return null;
    cleanupResult = capability.cleanup();
    return cleanupResult;
  };
  const binding = capability?.attempt_binding;
  const entriesValid = Array.isArray(capability?.entries) &&
    Object.isFrozen(capability.entries) &&
    capability.entries.every((entry) => entry && typeof entry === "object" && Object.isFrozen(entry));
  const valid = capability && typeof capability === "object" && Object.isFrozen(capability) &&
    capability.schema_version === WRITABLE_FILE_PRECREATION_CLEANUP_SCHEMA_VERSION &&
    typeof capability.attempt_id === "string" && capability.attempt_id.length > 0 &&
    typeof capability.cleanup === "function" && Object.isFrozen(capability.cleanup) &&
    entriesValid && binding && typeof binding === "object" && Object.isFrozen(binding) &&
    authority && typeof authority === "object" && Object.isFrozen(authority) &&
    typeof runId === "string" && runId.length > 0 &&
    binding.unit_address === authority.unit_address &&
    binding.selected_unit_address === authority.selected_unit?.address &&
    binding.source_digest === authority.source_digest &&
    sameManagedUnitSubject(subject, binding);
  return Object.freeze({
    attempt_id: capability?.attempt_id ?? null,
    run_id: typeof runId === "string" ? runId : null,
    unit_address: binding?.unit_address ?? null,
    valid,
    cleanupOnce
  });
}

function stillReleasableDirectory(entry) {
  try {
    const stat = lstatSync(entry.real);
    return stat.isDirectory() && !stat.isSymbolicLink() &&
      String(stat.dev) === entry.identity.dev && String(stat.ino) === entry.identity.ino &&
      readdirSync(entry.real).length === 0;
  } catch {
    return false;
  }
}

function retainedDirectoryFailure(entries, repo) {
  const retained = entries.filter(stillReleasableDirectory);
  if (retained.length === 0) return null;
  const error = new Error(`${retained.length} attempt-owned empty directories could not be removed`);
  error.code = "attempt_owned_directory_retained";
  error.detail = Object.freeze({
    failures: retained.map((entry) => Object.freeze({
      code: "attempt_owned_directory_retained",
      message: `retained ${typeof repo === "string" ? path.relative(repo, entry.real) : "<host-path>"}`
    }))
  });
  return error;
}

function cleanupFailureEvidence(controller, reason, error) {
  return Object.freeze({
    reason,
    attempt_id: controller?.attempt_id ?? null,
    run_id: controller?.run_id ?? null,
    unit_address: controller?.unit_address ?? null,
    ...boundedCleanupFailure(error)
  });
}

export function compensatePreSpawnRefusal(controller, refusal, { directories = [], repo = null } = {}) {
  if (controller === null || controller === undefined) return refusal;
  let failure = null;
  try {
    controller.cleanupOnce();
    failure = retainedDirectoryFailure(directories, repo);
  } catch (error) {
    failure = error;
  }
  return failure === null
    ? refusal
    : withSecondaryCleanupFailure(refusal, "precreation_cleanup_failure",
      cleanupFailureEvidence(controller, "writable_file_precreation_cleanup_failed", failure));
}

function isTerminalObservation(probed) {
  return probed !== null && typeof probed === "object" &&
    probed.final_result !== null && typeof probed.final_result === "object";
}

function attachExitEvidence(probed, field, evidence) {
  const exit = probed.exit !== null && typeof probed.exit === "object"
    ? probed.exit
    : { code: null, signal: null };
  const finalResult = probed.final_result;
  const missing = finalResult?.kind === "missing_result" ? finalResult.missing_result ?? {} : null;
  return {
    ...probed,
    exit: { ...exit, [field]: evidence },
    ...(missing === null ? {} : {
      final_result: {
        ...finalResult,
        missing_result: {
          ...missing,
          detail: { ...(missing.detail !== null && typeof missing.detail === "object" ? missing.detail : {}), [field]: evidence }
        }
      }
    })
  };
}

export function createAttemptPrecreatedResourceOwner({ role, subject, runId } = {}) {
  let adopted = false;
  let controller = null;
  let directories = Object.freeze([]);
  let repo = null;
  let ownershipRefusal = null;
  let settledAs = null;
  let childRelease = null;

  const releaseAfterChild = () => {
    if (childRelease !== null) return childRelease;
    let failure = null;
    try {
      rollbackPreparedWorkerDirectories(directories);
      failure = retainedDirectoryFailure(directories, repo);
    } catch (error) {
      failure = error;
    }
    childRelease = Object.freeze({
      failure: failure === null
        ? null
        : cleanupFailureEvidence(controller, "attempt_precreated_directory_release_failed", failure)
    });
    return childRelease;
  };

  return Object.freeze({
    adopt(bwrapPlan) {
      if (adopted) throw new Error("an attempt adopts exactly one sandbox plan");
      adopted = true;

      if (bwrapPlan?.workerScopeAuthority === null || bwrapPlan?.workerScopeAuthority === undefined) return;
      controller = bindAttemptOwnedPreSpawnCleanup({ bwrapPlan, role, subject, runId });
      if (controller === null) return;
      const entries = bwrapPlan.writableFilePrecreationCleanup?.entries;
      directories = Object.freeze(Array.isArray(entries) ? entries.filter((entry) => entry?.kind === "directory") : []);
      repo = typeof bwrapPlan.repo === "string" ? bwrapPlan.repo : null;
      if (controller.valid !== true) {
        ownershipRefusal = Object.freeze({
          attempt_id: controller.attempt_id,
          run_id: controller.run_id,
          unit_address: controller.unit_address
        });
        const error = new Error("precreated resources are not bound to this attempt");
        error.code = PRECREATION_CLEANUP_IDENTITY_DRIFT_REASON;
        error.detail = ownershipRefusal;
        throw error;
      }
    },
    get ownershipRefusal() {
      return ownershipRefusal;
    },

    settle(result, child = null) {
      if (controller === null || settledAs !== null) return result;
      if (result?.accepted !== true) {
        settledAs = "refused";
        return compensatePreSpawnRefusal(controller, result, { directories, repo });
      }
      settledAs = "accepted";
      if (typeof result.probe !== "function") return result;
      if (child !== null && typeof child?.once === "function") {
        child.once("exit", releaseAfterChild);
        child.once("close", releaseAfterChild);
        if (typeof child.exitCode === "number" || typeof child.signalCode === "string") releaseAfterChild();
      }
      const observedTermination = () => {
        try {
          return result.hasObservedChildTermination?.() === true;
        } catch {
          return false;
        }
      };
      const innerProbe = result.probe;
      return {
        ...result,
        probe: async () => {
          const probed = await innerProbe();
          if (observedTermination()) releaseAfterChild();
          if (!isTerminalObservation(probed)) return probed;
          if (childRelease === null) {

            return attachExitEvidence(probed, "precreation_cleanup_deferred", Object.freeze({
              reason: "child_termination_not_observed",
              attempt_id: controller.attempt_id,
              run_id: controller.run_id,
              unit_address: controller.unit_address
            }));
          }
          return childRelease.failure === null
            ? probed
            : attachExitEvidence(probed, "precreation_cleanup_failure", childRelease.failure);
        }
      };
    }
  });
}
