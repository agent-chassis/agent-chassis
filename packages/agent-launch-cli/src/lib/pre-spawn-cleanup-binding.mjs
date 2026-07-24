const WRITABLE_FILE_PRECREATION_CLEANUP_SCHEMA_VERSION =
  "writable-file-precreation-cleanup.v1";

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
