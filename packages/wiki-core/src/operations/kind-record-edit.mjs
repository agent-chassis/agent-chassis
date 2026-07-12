

import os from "node:os";

import {
  loadKindRecordById,
  writeValidatedKindRecord
} from "../lib/kind-record-store.mjs";
import {
  ratify,
  reject,
  setScalar,
  setSection,
  unratify
} from "../lib/kind-record-edit.mjs";

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function resolveActor() {
  return os.userInfo().username;
}

function refusal(diagnostics, sourceDigest = null) {
  return {
    ok: false,
    written: false,
    source_digest: sourceDigest,
    changedFields: [],
    diagnostics: Array.isArray(diagnostics) ? diagnostics : []
  };
}

async function editKindRecord({ repoRoot = ".", id, expectedSourceDigest = null, applyPlan } = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    return refusal([
      { code: "invalid_id", severity: "error", message: "id must be a non-empty string", path: "id" }
    ]);
  }

  const loaded = await loadKindRecordById({ repoRoot, id });

  if (!loaded.record) {
    return refusal(loaded.diagnostics || [], loaded.source_digest || null);
  }

  if (loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return refusal(loaded.diagnostics, loaded.source_digest || null);
  }

  const actor = resolveActor();
  const now = todayDateString();

  const plan = applyPlan(loaded.record, actor, now);
  if (!plan.ok) {
    return refusal(plan.diagnostics || [], loaded.source_digest || null);
  }

  const effectiveExpected =
    expectedSourceDigest !== null && expectedSourceDigest !== undefined
      ? expectedSourceDigest
      : loaded.source_digest || null;

  const writeResult = await writeValidatedKindRecord({
    repoRoot,
    record: plan.updatedRecord,
    expectedSourceDigest: effectiveExpected
  });

  return {
    ok: Boolean(writeResult.ok),
    written: Boolean(writeResult.written),
    source_digest: writeResult.source_digest ?? null,
    changedFields: writeResult.written ? plan.changedFields : [],
    diagnostics: writeResult.diagnostics || [],
    ...(writeResult.current_source_digest !== undefined
      ? { current_source_digest: writeResult.current_source_digest }
      : {}),
    ...(writeResult.expected_source_digest !== undefined
      ? { expected_source_digest: writeResult.expected_source_digest }
      : {}),
    ...(writeResult.canonical_record_path
      ? { canonical_record_path: writeResult.canonical_record_path }
      : {}),
    ...(writeResult.canonical_markdown_path
      ? { canonical_markdown_path: writeResult.canonical_markdown_path }
      : {})
  };
}

export async function amendKindRecordSection({
  repoRoot = ".",
  id,
  section,
  value,
  expectedSourceDigest = null
} = {}) {
  return editKindRecord({
    repoRoot,
    id,
    expectedSourceDigest,
    applyPlan: (record, actor, now) => setSection({ record, section, value, actor, now })
  });
}

export async function amendKindRecordScalar({
  repoRoot = ".",
  id,
  field,
  value,
  expectedSourceDigest = null
} = {}) {
  return editKindRecord({
    repoRoot,
    id,
    expectedSourceDigest,
    applyPlan: (record, actor, now) => setScalar({ record, field, value, actor, now })
  });
}

export async function ratifyDecisionRecord({
  repoRoot = ".",
  id,
  expectedSourceDigest = null
} = {}) {
  return editKindRecord({
    repoRoot,
    id,
    expectedSourceDigest,
    applyPlan: (record, actor, now) => ratify({ record, actor, now })
  });
}

export async function unratifyDecisionRecord({
  repoRoot = ".",
  id,
  expectedSourceDigest = null
} = {}) {
  return editKindRecord({
    repoRoot,
    id,
    expectedSourceDigest,
    applyPlan: (record, actor, now) => unratify({ record, actor, now })
  });
}

export async function rejectDecisionRecord({
  repoRoot = ".",
  id,
  expectedSourceDigest = null
} = {}) {
  return editKindRecord({
    repoRoot,
    id,
    expectedSourceDigest,
    applyPlan: (record, actor, now) => reject({ record, actor, now })
  });
}
