

const ORCHESTRATOR_ADVISORY_DISPOSITIONS = new Set(["accept", "reject", "defer"]);

export const ADVISORY_DISPOSITION_JUDGMENTS = Object.freeze([...ORCHESTRATOR_ADVISORY_DISPOSITIONS]);

export function normalizeAdvisoryDispositions(dispositions, evidence) {
  if (dispositions === undefined) return Object.freeze([]);
  if (!Array.isArray(dispositions)) return null;
  const findingIdsByRun = new Map(evidence.reviews.map((review) => [
    review.run_id,
    new Set((review.findings ?? []).map((finding) => finding.id))
  ]));
  const normalized = [];
  const seen = new Set();
  for (const entry of dispositions) {
    const keys = entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.keys(entry).sort() : [];
    if (keys.join("|") !== "disposition|finding_id|review_run_id" ||
        typeof entry.review_run_id !== "string" ||
        typeof entry.finding_id !== "string" ||
        !ORCHESTRATOR_ADVISORY_DISPOSITIONS.has(entry.disposition) ||
        !findingIdsByRun.get(entry.review_run_id)?.has(entry.finding_id)) {
      return null;
    }
    const key = `${entry.review_run_id}\u0000${entry.finding_id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    normalized.push(Object.freeze({
      review_run_id: entry.review_run_id,
      finding_id: entry.finding_id,
      disposition: entry.disposition
    }));
  }
  return Object.freeze(normalized);
}

const positive = (value) => Number.isSafeInteger(value) && value > 0;
const SAVED_DISPOSITION_KEYS = new Set(["id", "review_run_id", "entry", "selection", "disposition", "rationale"]);

export function validateWorkRecordDispositions(value, { path = "sections.dispositions" } = {}) {
  if (value === undefined) return [];
  const issue = (message, at = path) => ({ code: "work_record_dispositions_invalid", severity: "error", message, path: at });
  if (!Array.isArray(value)) return [issue("dispositions must be an array")];
  const diagnostics = [];
  const ids = new Set();
  for (const [index, row] of value.entries()) {
    const at = `${path}[${index}]`;
    const plain = row !== null && typeof row === "object" && !Array.isArray(row);
    if (!plain || Object.keys(row).some((key) => !SAVED_DISPOSITION_KEYS.has(key))) {
      diagnostics.push(issue("a disposition row is a closed object", at));
      continue;
    }
    const { entry, selection } = row;
    const extent = selection !== null && typeof selection === "object" && !Array.isArray(selection);
    const selected = extent && (Object.keys(selection).join("|") === "finding_id"
      ? typeof selection.finding_id === "string" && selection.finding_id.length > 0
      : Object.keys(selection).sort().join("|") === "length|offset" &&
        Number.isSafeInteger(selection.offset) && selection.offset >= 0 && positive(selection.length));
    if (!positive(row.id) || ids.has(row.id) || typeof row.review_run_id !== "string" || row.review_run_id.length === 0 ||
        entry === null || typeof entry !== "object" || Object.keys(entry).sort().join("|") !== "entry_id|version_id" ||
        !positive(entry.entry_id) || !positive(entry.version_id) || !selected ||
        !ORCHESTRATOR_ADVISORY_DISPOSITIONS.has(row.disposition) ||
        (Object.hasOwn(row, "rationale") && typeof row.rationale !== "string")) {
      diagnostics.push(issue("a disposition row needs a unique id, its run, captured entry version, one selection and a judgment", at));
    }
    ids.add(row.id);
  }
  return diagnostics;
}
