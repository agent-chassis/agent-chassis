

import { assessProofObligationAccounting } from "@agent-chassis/controlled-contract/proof-contract";

import { GRAMMAR_EXCEPTION_ENFORCEMENT, RECORD_AUTHORING_EXCEPTION_CONSEQUENCES,
  RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE } from "../../lib/record-authoring-exception.mjs";
import { inspectWorkRecordProofPosture } from "../../lib/work-record-proof-posture.mjs";

export const AUTHORING_EXCEPTION_SUMMARY_LIMITS = Object.freeze({ subjects: 8, text_scalars: 240 });

const rationaleOf = (value) => typeof value === "string" && value.length > 0 ? { rationale: value }
  : { rationale: null, rationale_state: "not_recorded" };

const DECLINED_ACCOUNTING = Object.freeze({ accounting: "opted_out", proofs_executed: 0, credit_granted: 0 });

function proofDecisions(resolved, obligationId) {
  const rows = (resolved.source?.content?.obligations ?? []).filter((row) =>
    obligationId === undefined || row.obligation_id === obligationId);
  const decided = rows.map((row) => ({ row, decision: assessProofObligationAccounting(row).decision }));
  const of = (decision) => decided.filter((entry) => entry.decision === decision).map(({ row }) => row);
  const declined = of("opted_out");
  return { scope: obligationId === undefined ? "whole_unit" : "selected_obligation", obligations: rows.length,
    selected: of("selected").length, declined: declined.length, undecided: of("undecided").length,
    ...(declined.length === 0 ? {} : { ...DECLINED_ACCOUNTING, consequence: RECORD_AUTHORING_EXCEPTION_CONSEQUENCES.proof,

      declined_obligations: declined.map((row) => ({ obligation_id: row.obligation_id,
        ...rationaleOf(row.proof_opt_out_rationale) })) }),
    ...(of("undecided").length === 0 ? {} : { undecided_obligation_ids: of("undecided").map((row) => row.obligation_id) }) };
}

function grammarResidue(resolved) {
  const unresolved = resolved.contract?.content?.authored_requirements?.unresolved ?? [];
  const excepted = unresolved.map((entry, index) => ({ entry, id: `u${index + 1}` }))
    .filter(({ entry }) => typeof entry !== "string" && entry.grammar_exception !== undefined);
  return { unresolved_meanings: unresolved.length, exceptions: excepted.length,

    ...(unresolved.length === 0 ? {} : { specification: "incomplete" }),
    ...(excepted.length === 0 ? {} : { enforcement: GRAMMAR_EXCEPTION_ENFORCEMENT,
      consequence: RECORD_AUTHORING_EXCEPTION_CONSEQUENCES.grammar,
      excepted_meanings: excepted.map(({ entry, id }) => ({ id, text: entry.text,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }), ...rationaleOf(entry.grammar_exception.rationale) })) }) };
}

function wholeUnitExemption(resolved) {
  const posture = inspectWorkRecordProofPosture(resolved.record, { expectedRecordId: resolved.wkId });
  const disposition = posture.present && posture.valid ? posture.disposition : null;
  return { unit: resolved.wkId, disposition, exempted: disposition === "opted_out",
    ...(disposition !== "opted_out" ? {} : { ...rationaleOf(posture.proof_posture?.classification_rationale ?? null),
      ...RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE,
      consequence: RECORD_AUTHORING_EXCEPTION_CONSEQUENCES.controlled_acceptance }) };
}

export function assessAuthoringExceptions(resolved, { obligationId } = {}) {
  return { complete: true, proof: proofDecisions(resolved, obligationId), grammar: grammarResidue(resolved),
    controlled_acceptance: wholeUnitExemption(resolved) };
}

const bounded = (text) => {
  const scalars = [...text];
  return scalars.length <= AUTHORING_EXCEPTION_SUMMARY_LIMITS.text_scalars ? { value: text, complete: true }
    : { value: scalars.slice(0, AUTHORING_EXCEPTION_SUMMARY_LIMITS.text_scalars).join(""), complete: false };
};

function boundedSubject(subject) {
  const cut = [];
  const entries = Object.entries(subject).map(([member, value]) => {
    if (typeof value !== "string" || !["text", "rationale"].includes(member)) return [member, value];
    const { value: shown, complete } = bounded(value);
    if (!complete) cut.push(member);
    return [member, shown];
  });
  return { ...Object.fromEntries(entries), ...(cut.length === 0 ? {} : { truncated_members: cut }) };
}

function boundedList(list, member) {
  if (list === undefined) return { members: {}, complete: true };
  const shown = list.slice(0, AUTHORING_EXCEPTION_SUMMARY_LIMITS.subjects)
    .map((subject) => typeof subject === "string" ? subject : boundedSubject(subject));
  const omitted = list.length - shown.length;
  return { members: { [member]: shown, ...(omitted === 0 ? {} : { [`${member}_omitted`]: omitted }) },
    complete: omitted === 0 && shown.every((subject) => subject.truncated_members === undefined) };
}

export function boundAuthoringExceptions(exceptions) {
  if (exceptions === undefined || exceptions === null) return exceptions;
  const { proof, grammar, controlled_acceptance: acceptance } = exceptions;
  const declined = boundedList(proof.declined_obligations, "declined_obligations");
  const undecided = boundedList(proof.undecided_obligation_ids, "undecided_obligation_ids");
  const excepted = boundedList(grammar.excepted_meanings, "excepted_meanings");
  const exemption = boundedSubject(acceptance);
  return {
    complete: exceptions.complete === true && declined.complete && undecided.complete && excepted.complete &&
      exemption.truncated_members === undefined,
    proof: { ...proof, ...declined.members, ...undecided.members },
    grammar: { ...grammar, ...excepted.members },
    controlled_acceptance: exemption };
}
