export const WORKER_EFFECTIVE_WRITE_SCOPE_INVALID =
  "launcher_effective_write_scope_invalid";

export function selectWorkerLifecycleFromEffectiveWriteScope(effectiveWriteScope) {
  if (!Array.isArray(effectiveWriteScope) || !Object.isFrozen(effectiveWriteScope) ||
      effectiveWriteScope.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw Object.assign(new Error(
      "worker lifecycle requires an authenticated immutable write_scope array"
    ), { code: WORKER_EFFECTIVE_WRITE_SCOPE_INVALID });
  }
  return "implementation";
}
