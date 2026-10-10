

export const RECOVERABLE_DISPATCH_STATES = new Set([
  "recoverable_missing", "recoverable_stale", "recoverable_outdated"
]);

export function graphDerivationRequiredForDispatch(state) {
  return state === "fresh" || RECOVERABLE_DISPATCH_STATES.has(state);
}
