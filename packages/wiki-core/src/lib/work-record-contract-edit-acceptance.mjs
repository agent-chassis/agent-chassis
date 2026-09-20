

import { canonicalizeWorkRecordReadScope } from "./work-record-schema.mjs";
import { projectWorkRecordTestProofValidation } from "./work-record-test-proof-bindings.mjs";
import {
  cloneJson,
  collectJsonDiffPaths,
  createDiagnostic,
  jsonEqual
} from "./work-record-contract-edit-shared.mjs";

const PERSISTED_DIFF_DIAGNOSTIC_PATH_LIMIT = 5;
const PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT = 96;

export const ACCEPTANCE_NARRATIVE_INPUT_INVALID = "acceptance_narrative_input_invalid";
const NARRATIVE_ACTIONS = Object.freeze(["replace", "append"]);

function mechanicalDiagnostic(code, message, path, details = {}) {
  return {
    ...createDiagnostic(code, message, { path }),
    authority_limb: "mechanical_failure",
    ...details
  };
}

function narrativeInputRefusal(message, path) {
  return {
    ok: false,
    diagnostic: mechanicalDiagnostic(ACCEPTANCE_NARRATIVE_INPUT_INVALID, message, path)
  };
}

function isExecutableShaped(entry) {
  return entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
    (Object.hasOwn(entry, "operation") || Object.hasOwn(entry, "target"));
}

function checkNarrativeItem(item, path) {
  const itemRoot = "$item";
  const projection = projectWorkRecordTestProofValidation({
    selectedUnit: { acceptance: { validation: [item] } },
    path: itemRoot
  });
  if (projection.status === "valid" && projection.entry_kinds[0] === "note") return null;
  if (isExecutableShaped(item)) {
    return narrativeInputRefusal(
      `${path} is an executable validation entry; ordinary acceptance input accepts only note ` +
        "strings or {note, verification_ids}. Executable node_test bindings are authored through " +
        "controlled-contract obligation coverage cases.",
      path
    );
  }
  const issue = projection.diagnostics[0];
  const atInput = (text) => text.replaceAll(`${itemRoot}[0]`, path);
  return narrativeInputRefusal(
    issue ? atInput(issue.message) : `${path} must be a nonblank note string or {note, verification_ids}`,
    issue ? atInput(issue.path) : path
  );
}

export function planAcceptanceNarrativeValidation({
  current = [],
  requested,
  action = "replace",
  path = "acceptance.validation",
  storedPath = "acceptance.validation"
} = {}) {
  if (!NARRATIVE_ACTIONS.includes(action)) {
    return narrativeInputRefusal(
      `acceptance note action must be one of: ${NARRATIVE_ACTIONS.join(", ")}`,
      path
    );
  }
  if (action === "replace" && !Array.isArray(requested)) {
    return narrativeInputRefusal(`${path} must be an array of acceptance notes`, path);
  }
  const items = action === "append" ? [requested] : requested;
  for (const [index, item] of items.entries()) {
    const refused = checkNarrativeItem(item, action === "append" ? path : `${path}[${index}]`);
    if (refused) return refused;
  }

  const stored = projectWorkRecordTestProofValidation({
    selectedUnit: { acceptance: { validation: current } },
    path: storedPath
  });
  if (stored.status !== "valid") {
    const [issue] = stored.diagnostics;
    return {
      ok: false,
      diagnostic: mechanicalDiagnostic(issue.code, issue.message, issue.path, {
        state: "corrupt_stored_validation"
      })
    };
  }
  const storedNotes = current.filter((_entry, index) => stored.entry_kinds[index] === "note");
  if (action === "append") {
    if (storedNotes.some((note) => jsonEqual(note, requested))) {
      return { ok: true, changed: false, validation: cloneJson(current) };
    }
    return { ok: true, changed: true, validation: [...cloneJson(current), cloneJson(requested)] };
  }
  if (jsonEqual(storedNotes, items)) {
    return { ok: true, changed: false, validation: cloneJson(current) };
  }
  const executables = current.filter((_entry, index) => stored.entry_kinds[index] === "executable");
  return { ok: true, changed: true, validation: [...cloneJson(items), ...cloneJson(executables)] };
}

function boundPersistedDiffPaths(diffPaths) {
  return diffPaths
    .slice(0, PERSISTED_DIFF_DIAGNOSTIC_PATH_LIMIT)
    .map((entry) =>
      entry.length <= PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT
        ? entry
        : `${entry.slice(0, PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT - 3)}...`
    );
}

export function guardInitiativeAssignmentPersistedDiff(baseRecord, candidateRecord) {
  const persistedBase = cloneJson(baseRecord);
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const diffPaths = collectJsonDiffPaths(persistedBase, normalizedCandidate);
  if (diffPaths.length === 1 && diffPaths[0] === "initiative") {
    return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
  }

  const changedPaths = boundPersistedDiffPaths(diffPaths);
  const firstDisallowedPath = diffPaths.find((entry) => entry !== "initiative") ?? diffPaths[0];
  const firstPath = firstDisallowedPath
    ? boundPersistedDiffPaths([firstDisallowedPath])[0]
    : null;
  const diagnostic = {
    ...createDiagnostic(
      "initiative_assignment_persisted_diff_guard_failed",
      firstPath
        ? `initiative assignment would persist changes outside its one-scalar contract: ${changedPaths.join(", ")}`
        : "initiative assignment did not produce the required one-scalar persisted change",
      { path: firstPath }
    ),
    changed_paths: changedPaths,
    changed_paths_truncated: diffPaths.length > changedPaths.length
  };

  return {
    ok: false,
    normalizedCandidate: null,
    diffPaths,
    diagnostic
  };
}
