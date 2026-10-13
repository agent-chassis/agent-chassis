

import { createHash } from "node:crypto";

import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";

export const REQUIREMENT_SOURCE_FIELD = "sections.user_requirements";
export const REQUIREMENT_SOURCE_LOCATION_UNIT = "utf16_code_units";
export const REQUIREMENT_SOURCE_STATES = Object.freeze({ absent: "absent", current: "current", stale: "stale" });
export const REQUIREMENT_SOURCE_CODES = Object.freeze({
  OCCURRENCE_WITHOUT_PASSAGE: "controlled_contract_requirement_source_occurrence_without_passage",
  SOURCE_TEXT_ABSENT: "controlled_contract_requirement_source_text_absent",
  PASSAGE_NOT_FOUND: "controlled_contract_requirement_source_passage_not_found",
  OCCURRENCE_REQUIRED: "controlled_contract_requirement_source_occurrence_required",
  OCCURRENCE_OUT_OF_RANGE: "controlled_contract_requirement_source_occurrence_out_of_range"
});

const LISTED_MATCHES = 16;

const fail = (code, message, details) => { throw new ControlledContractToolError(code, message, { changed: false, path: details.field, ...details }); };

export const requirementSourceDigest = text => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

export function requirementSourceMatches(text, passage) {
  const starts = [];
  for (let from = text.indexOf(passage); from !== -1; from = text.indexOf(passage, from + 1)) starts.push(from);
  return starts;
}

export function resolveRequirementSourceLink({ wkId, text, passage, occurrence, field }) {
  const at = member => `${field}.${member}`;
  if (passage === undefined) {
    if (occurrence !== undefined) fail(REQUIREMENT_SOURCE_CODES.OCCURRENCE_WITHOUT_PASSAGE,
      `${at("user_requirement_occurrence")} chooses an occurrence of a passage the row does not state`,
      { field: at("user_requirement_occurrence"), correction: `supply ${at("user_requirement")} with the exact passage, or omit ${at("user_requirement_occurrence")}` });
    return null;
  }
  if (typeof text !== "string" || text.length === 0) fail(REQUIREMENT_SOURCE_CODES.SOURCE_TEXT_ABSENT,
    `${at("user_requirement")} names a passage, and ${wkId} has no saved ${REQUIREMENT_SOURCE_FIELD} text to find it in`,
    { field: at("user_requirement"), source: { wk_id: wkId, field: REQUIREMENT_SOURCE_FIELD },
      correction: `save the source text in the same request as changes.user_requirements on ${wkId}, or omit ${at("user_requirement")}` });
  const starts = requirementSourceMatches(text, passage);
  const source = { wk_id: wkId, field: REQUIREMENT_SOURCE_FIELD, digest: requirementSourceDigest(text) };
  const located = starts.slice(0, LISTED_MATCHES).map((start, index) => ({ occurrence: index + 1, start, end: start + passage.length }));
  const matches = { match_count: starts.length, matches: located, location_unit: REQUIREMENT_SOURCE_LOCATION_UNIT, source };
  if (starts.length === 0) fail(REQUIREMENT_SOURCE_CODES.PASSAGE_NOT_FOUND,
    `${at("user_requirement")} is not a passage of ${wkId} ${REQUIREMENT_SOURCE_FIELD}; the text is compared exactly, with no trimming, case folding or normalization`,
    { field: at("user_requirement"), ...matches,
      correction: `copy the passage exactly from ${wkId} ${REQUIREMENT_SOURCE_FIELD} as this save leaves it, or omit ${at("user_requirement")}` });
  if (occurrence === undefined && starts.length > 1) fail(REQUIREMENT_SOURCE_CODES.OCCURRENCE_REQUIRED,
    `${at("user_requirement")} occurs ${starts.length} times in ${wkId} ${REQUIREMENT_SOURCE_FIELD}; state which one this requirement represents`,
    { field: at("user_requirement_occurrence"), ...matches, accepted_occurrences: { minimum: 1, maximum: starts.length },
      correction: `supply ${at("user_requirement_occurrence")} from 1 to ${starts.length}; "matches" lists where each occurrence starts and ends` });
  const chosen = occurrence ?? 1;
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > starts.length) fail(REQUIREMENT_SOURCE_CODES.OCCURRENCE_OUT_OF_RANGE,
    `${at("user_requirement_occurrence")} is ${JSON.stringify(chosen)}, and the passage occurs ${starts.length} time${starts.length === 1 ? "" : "s"} in ${wkId} ${REQUIREMENT_SOURCE_FIELD}`,
    { field: at("user_requirement_occurrence"), rejected_value: chosen, ...matches, accepted_occurrences: { minimum: 1, maximum: starts.length },
      correction: starts.length === 1 ? `supply ${at("user_requirement_occurrence")} 1 or omit it` : `supply ${at("user_requirement_occurrence")} from 1 to ${starts.length}` });
  const start = starts[chosen - 1];
  return Object.freeze({ user_requirement: passage, user_requirement_occurrence: chosen, source: Object.freeze(source),
    location: Object.freeze({ unit: REQUIREMENT_SOURCE_LOCATION_UNIT, start, end: start + passage.length }) });
}

export function describeRequirementSourceLink(stored, text) {
  if (stored === undefined || stored === null) return Object.freeze({ state: REQUIREMENT_SOURCE_STATES.absent });
  const current = typeof text === "string" && requirementSourceDigest(text) === stored.source.digest;
  return Object.freeze({ state: current ? REQUIREMENT_SOURCE_STATES.current : REQUIREMENT_SOURCE_STATES.stale,
    user_requirement: stored.user_requirement, user_requirement_occurrence: stored.user_requirement_occurrence,
    source: Object.freeze({ ...stored.source }), location: Object.freeze({ ...stored.location }),
    ...(current ? {} : { current_source_digest: typeof text === "string" ? requirementSourceDigest(text) : null,
      correction: "resubmit the row with user_requirement (and its occurrence where the passage repeats) to link it to the current text" }) });
}
