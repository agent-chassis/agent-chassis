

import { createHash } from "node:crypto";

import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";

export function classifyReadOnlySubject(role, subject) {
  if (typeof subject !== "string" || subject.length === 0) {
    return {
      ok: false,
      error: `codex-${role}: subject is required (${role === "review"
        ? "WK-#### or WK-#####slice-id"
        : "WK-####, WK-#####slice-id, or IN-####"})`
    };
  }
  if (subject.startsWith("WK-")) {
    const parsed = parseWorkRecordUnitAddress(subject);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `codex-${role}: invalid WK unit address ${subject}: ${(parsed.diagnostics?.[0]?.message) ?? "parse error"}`
      };
    }
    return {
      ok: true,
      kind: "work_record",
      unit_address: parsed.value.address,
      record_id: parsed.value.record_id,
      slice_id: parsed.value.slice_id
    };
  }
  if (role === "redteam" && /^IN-[0-9]+$/.test(subject)) {
    return { ok: true, kind: "initiative", subject };
  }
  const expected = role === "review"
    ? "WK id like WK-0348 or WK-0348#slice-id"
    : "subject id like WK-0348, WK-0348#slice-id, or IN-0004";
  return { ok: false, error: `codex-${role}: expected ${expected}, got: ${subject}` };
}

function computeReadOnlySha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function buildReadOnlyRolePreparationAudit({ role, profile, unitAddress, repoRoot, now }) {
  const sourceDigests = [];
  const unitDigest = computeReadOnlySha256Hex(unitAddress ?? "");
  if (unitDigest) {
    sourceDigests.push({ kind: "synthetic_wrapper_unit_address", ref: unitAddress, digest: `sha256:${unitDigest}` });
  }
  if (typeof repoRoot === "string" && repoRoot.length > 0) {
    sourceDigests.push({
      kind: "synthetic_wrapper_repo_root",
      ref: repoRoot,
      digest: `sha256:${computeReadOnlySha256Hex(repoRoot)}`
    });
  }
  return {
    required: false,
    actor: {
      kind: "tool",
      id: `agent-chassis:codex-role:${role}:${profile ?? "default"}`
    },
    source_digests: sourceDigests,
    evaluated_at: now
  };
}

export async function loadReviewerSubjectScope({ repo, recordId, sliceId }) {
  let loaded;
  try {
    loaded = await loadWorkRecordById({ dir: repo, id: recordId });
  } catch {
    return null;
  }
  if (!loaded || !loaded.record) {
    return null;
  }
  const record = loaded.record;
  const selectedSlice = sliceId && Array.isArray(record.slices)
    ? record.slices.find((entry) => entry && entry.id === sliceId) || null
    : null;
  if (sliceId && !selectedSlice) {
    return null;
  }
  const selectedUnit = selectedSlice ?? record;
  return {
    record_id: recordId,
    slice_id: sliceId ?? null,
    title: typeof selectedUnit.title === "string" ? selectedUnit.title : (record.title ?? null),
    write_scope: Array.isArray(selectedUnit.write_scope) ? selectedUnit.write_scope : [],
    repo_paths: Array.isArray(selectedUnit.repo_paths) ? selectedUnit.repo_paths : []
  };
}
