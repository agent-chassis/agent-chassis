

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { projectWorkRecordFreshness } from
  "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { buildWorkRecordEntryBodyReadCall } from
  "@agent-chassis/wiki-core/src/operations/work-record-entries.mjs";

import { settleWithinDeadline } from "./dispatch-monitor-call-deadline.mjs";
import { buildDispatchToolExceptionDetail, DISPATCH_FAILURE_ORIGINALS } from "./dispatch-tool-helpers.mjs";
import { parseWorkRecordUnitAddress, workRecordFreshnessSource } from "./work-record-write-route-helpers.mjs";
import { WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME } from "./work-record-entry-tools.mjs";

const ADVISORY_ROLES = new Set(["reviewer", "redteam"]);
const WK_UNIT_RE = /^WK-\d{4,}(?:#SLICE-\d{3,})?$/u;
const ORIGINAL_SOURCE_KIND = "original_managed_findings";

export const FINDINGS_CAPTURE_STATES = Object.freeze({
  CAPTURABLE: "capturable",
  CAPTURED: "captured",
  UNAVAILABLE: "unavailable"
});

const CAPTURABLE_PURPOSE = "The call saves these original findings as an immutable entry for " +
  "another assignment's material_refs. Until saved, the source exists only while its owning " +
  "backend retains this run. After a stale or uncertain save, observe this exact run's status " +
  "before creating again.";
const CAPTURED_PURPOSE = "These original findings are already saved on this unit; the call reads " +
  "that immutable entry for another assignment's material_refs.";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function unavailable(code, extra = {}) {
  return Object.freeze({ fact: Object.freeze({ state: FINDINGS_CAPTURE_STATES.UNAVAILABLE, code,
    ...extra }), call: null });
}

function completedFindings(status) {
  if (!isRecord(status) || status.terminal !== true || !ADVISORY_ROLES.has(status.role) ||
      typeof status.subject !== "string" || !WK_UNIT_RE.test(status.subject)) return null;
  const review = status.final_result?.advisory_review;
  if (!isRecord(review) || review.execution_status !== "completed") return null;
  const output = review.advisory_output;
  if (!isRecord(output) || output.available !== true || typeof output.text !== "string" ||
      typeof output.source_reference?.ref !== "string") return null;
  return Object.freeze({ text: output.text, ref: output.source_reference.ref });
}

function authenticatedProvenance(resolved, { status, findings, repository }) {
  const provenance = resolved?.provenance;
  if (resolved?.ok !== true || resolved.text !== findings.text || !isRecord(provenance) ||
      provenance.source_kind !== ORIGINAL_SOURCE_KIND || provenance.run_id !== status.run_id ||
      provenance.monitor_handle !== status.monitor_handle || provenance.subject !== status.subject ||
      provenance.repository !== repository) return null;
  return provenance;
}

function isMatchingCapture(version, { status, findings, repository }) {
  const sources = version?.provenance?.sources;
  if (!Array.isArray(sources) || sources.length !== 1 || !isRecord(version.content) ||
      Object.keys(version.content).length !== 1 || version.content.text !== findings.text) return false;
  const [source] = sources;
  return isRecord(source) && source.ref === findings.ref && source.source_kind === ORIGINAL_SOURCE_KIND &&
    source.run_id === status.run_id && source.monitor_handle === status.monitor_handle &&
    source.subject === status.subject && source.repository === repository;
}

function firstMatchingCapture(unit, match) {
  for (const entry of Array.isArray(unit?.sections?.entries) ? unit.sections.entries : []) {
    for (const version of Array.isArray(entry?.versions) ? entry.versions : []) {
      if (isMatchingCapture(version, match)) return { entryId: entry.id, versionId: version.id };
    }
  }
  return null;
}

async function validatedCall(requestContracts, tool, args) {
  const contract = requestContracts?.contractFor?.(tool) ?? null;
  if (contract === null) return { code: `${tool}_not_registered` };
  if (await contract.acceptsArguments(args) !== true) return { code: `${tool}_arguments_refused` };
  return { call: buildNextCall({ tool, arguments: args, recommended: true }) };
}

async function composeContinuation({ status, findings, workspace, resolveFindingsSource,
  callerSessionId, requestContracts }) {
  const unitAddress = parseWorkRecordUnitAddress(status.subject);
  const loaded = unitAddress === null ? null
    : await workRecordFreshnessSource(workspace.dir, status.subject)();
  const unit = loaded?.valid === true && isRecord(loaded.record)
    ? unitAddress.slice_id === null ? loaded.record
      : loaded.record.slices?.find((slice) => slice?.id === unitAddress.slice_id) ?? null
    : null;
  if (unit === null) {
    return unavailable("target_unit_unavailable", loaded?.diagnostics?.[0]?.code
      ? { cause_code: loaded.diagnostics[0].code } : {});
  }

  const existing = firstMatchingCapture(unit, { status, findings, repository: workspace.repo });
  if (existing !== null) {
    const read = buildWorkRecordEntryBodyReadCall({ repository: workspace.repo, unit: status.subject,
      entryId: existing.entryId, version: existing.versionId });
    const offered = await validatedCall(requestContracts, read.tool, read.arguments);
    return offered.call === undefined ? unavailable(offered.code)
      : Object.freeze({ fact: Object.freeze({ state: FINDINGS_CAPTURE_STATES.CAPTURED,
        purpose: CAPTURED_PURPOSE }), call: offered.call });
  }

  if (typeof resolveFindingsSource !== "function") return unavailable("findings_source_owner_unavailable");
  const resolved = await resolveFindingsSource({ reference: findings.ref, repository: workspace.repo,
    caller_session_id: callerSessionId });
  if (authenticatedProvenance(resolved, { status, findings, repository: workspace.repo }) === null) {
    return unavailable(`findings_source_${typeof resolved?.state === "string" && resolved.ok !== true
      ? resolved.state : "changed"}`);
  }
  const offered = await validatedCall(requestContracts, WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME, {
    repo: workspace.repo,
    unit: status.subject,
    title: `Original ${status.role} findings ${status.run_id}`,
    content: { ref: findings.ref },
    expected_source_digest: projectWorkRecordFreshness(loaded.source_digest)
  });
  return offered.call === undefined ? unavailable(offered.code)
    : Object.freeze({ fact: Object.freeze({ state: FINDINGS_CAPTURE_STATES.CAPTURABLE,
      purpose: CAPTURABLE_PURPOSE }), call: offered.call });
}

export async function buildFindingsMaterialContinuation({
  status,
  workspace,
  resolveFindingsSource,
  callerSessionId,
  requestContracts,
  deadline
}) {
  const findings = completedFindings(status);
  if (findings === null) return null;
  if (!isRecord(workspace) || typeof workspace.repo !== "string" || typeof workspace.dir !== "string") {
    return unavailable("workspace_unresolved");
  }
  try {
    const outcome = await settleWithinDeadline(composeContinuation({ status, findings, workspace,
      resolveFindingsSource, callerSessionId, requestContracts }), deadline);
    return outcome.settled ? outcome.value : unavailable("run_status_call_bound_elapsed");
  } catch (error) {
    return unavailable("findings_capture_guidance_failed", {
      detail: buildDispatchToolExceptionDetail("workspace_agent_run_status", error,
        { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION })
    });
  }
}
