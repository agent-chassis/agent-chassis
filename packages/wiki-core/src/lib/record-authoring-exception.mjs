

import { createRequire } from "node:module";

import { OBLIGATION_DRAFT_SCHEMA } from "@agent-chassis/controlled-contract/obligation-coverage";

export const RECORD_AUTHORING_EXCEPTION_KINDS = Object.freeze(["proof", "grammar", "controlled_acceptance"]);
export const RECORD_AUTHORING_EXCEPTION_ACTIONS = Object.freeze(["apply", "withdraw"]);
export const RECORD_AUTHORING_EXCEPTION_CODES = Object.freeze({
  INVALID: "record_authoring_exception_invalid",
  SUBJECT_UNKNOWN: "record_authoring_exception_subject_unknown",
  UNIT_UNSUPPORTED: "record_authoring_exception_unit_unsupported"
});

export const RECORD_AUTHORING_EXCEPTION_CONSEQUENCES = Object.freeze({
  proof: "Proof declined by the author. Tests may still be " +
    "written and run. Their results do not automatically establish this verification or grant controlled proof credit.",
  grammar: "Author-declared grammar exception recorded. This meaning remains unresolved and unenforced; the specification remains incomplete.",
  controlled_acceptance: "Controlled acceptance exempted by the author. The stated rationale has not been assessed for eligibility."
});

export const GRAMMAR_EXCEPTION_ENFORCEMENT = "NOT ENFORCED";

export const RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE = Object.freeze({
  rationale_provenance: "caller_authored_unassessed", rationale_assessment: "not_performed", assessed_by: null });

const rationale = Object.freeze({ type: "string", minLength: 1, maxLength: 8192, pattern: "^\\S(?:[\\s\\S]*\\S)?$",
  description: "The author's own reason, trimmed and nonempty. Recorded as written; never assessed." });

export const GRAMMAR_EXCEPTION_SUBJECT_PATTERN = "^u[1-9][0-9]{0,3}$";
const WORK_ITEM_PATTERN = "^WK-[0-9]{4,}$";

const SUBJECTS = Object.freeze({
  proof: Object.freeze({ schema: Object.freeze({ ...OBLIGATION_DRAFT_SCHEMA.$defs.obligation_id,
    description: "The id of one saved obligation of the selected unit." }),
  names: "one saved obligation of the selected unit, by its obligation id",
  read: Object.freeze({ contract: "obligations" }) }),
  grammar: Object.freeze({ schema: Object.freeze({ type: "string", pattern: GRAMMAR_EXCEPTION_SUBJECT_PATTERN,
    description: "The id (u1, u2, ...) of one saved unresolved meaning, as read at the supplied revision." }),
  names: "one saved unresolved meaning, by the id its read returns at the supplied revision; the id means nothing at any other revision",
  read: Object.freeze({ contract: "requirements" }) }),
  controlled_acceptance: Object.freeze({ schema: Object.freeze({ type: "string", pattern: WORK_ITEM_PATTERN,
    description: "The work item the selected unit belongs to." }),
  names: "the work item the selected unit belongs to, by its id",
  read: null })
});

const NOT_A_JUSTIFICATION = Object.freeze(["urgency", "convenience", "a failed test or proof",
  "missing executable support", "unavailable tooling", "a missing definition"]);
const MEANINGS = Object.freeze({
  proof: Object.freeze({
    applies_when: "No supported proof is appropriate for the verification this obligation intends.",
    keeps: "The obligation, its requirement and verification links and its criterion associations stay exactly as saved and stay applicable.",
    refused_when: "The obligation keeps a proof selection or a test case. Neither is removed for the caller: each is removed only by its own explicit removal.",
    withdraw: "Removes the decision and its reason. The obligation is then undecided; no proof is selected for it."
  }),
  grammar: Object.freeze({
    applies_when: "The intended meaning cannot be faithfully encoded in the supported grammar.",
    keeps: "The saved unresolved text and its reason stay word for word. No row, identity or expression is made for it, and the specification stays incomplete.",
    refused_when: "The subject is not an unresolved meaning saved at the supplied revision. Meaning not yet saved is first saved as unresolved draft meaning through changes.requirements.unresolved.",
    withdraw: "Removes the choice and its reason. The unresolved text stays saved and still keeps the specification incomplete."
  }),
  controlled_acceptance: Object.freeze({
    applies_when: "The author deliberately chooses whether controlled acceptance applies to this unit; an opt-out states a nonempty rationale whose merits are not assessed.",
    keeps: "Saved requirements, obligations and proofs are not deleted. The author's rationale is unassessed; this choice grants zero proof credit and waives no native tests, review or repository policy.",
    refused_when: "The subject is not the work item of the selected unit.",
    withdraw: "Restores required controlled acceptance. No requirement, obligation or proof is authored for the caller."
  })
});

const closed = (properties, required) => Object.freeze({ type: "object", additionalProperties: false, required,
  properties: Object.freeze(properties) });
const sourcePassages = Object.freeze({ type: "array", minItems: 1, maxItems: 64,
  description: "Caller-authored exact passages accounted for by this exception; choose user_requirement_occurrence where repeated. Omission saves an accounting draft with zero inferred passage coverage.",
  items: closed({ user_requirement: { type: "string", minLength: 1 },
    user_requirement_occurrence: { type: "integer", minimum: 1 } }, ["user_requirement"]) });
const variant = (kind, action) => closed({ kind: Object.freeze({ const: kind }), action: Object.freeze({ const: action }),
  subject: SUBJECTS[kind].schema, ...(action === "apply" ? { rationale, ...(kind === "proof" ? {} : { source_passages: sourcePassages }) } : {}) },
["kind", "action", "subject", ...(action === "apply" ? ["rationale"] : [])]);

export const RECORD_AUTHORING_EXCEPTION_SCHEMA = Object.freeze({
  description: "One deliberate exception: apply or withdraw one kind on one existing saved subject. Never combined with changes.",
  oneOf: Object.freeze(RECORD_AUTHORING_EXCEPTION_KINDS.flatMap((kind) =>
    RECORD_AUTHORING_EXCEPTION_ACTIONS.map((action) => variant(kind, action))))
});

export function recordAuthoringExceptionSchema(kind = null) {
  if (kind === null) return RECORD_AUTHORING_EXCEPTION_SCHEMA;
  if (!RECORD_AUTHORING_EXCEPTION_KINDS.includes(kind)) {
    throw new TypeError(`record authoring exception kind must be one of: ${RECORD_AUTHORING_EXCEPTION_KINDS.join(", ")}`);
  }
  return Object.freeze({ description: RECORD_AUTHORING_EXCEPTION_SCHEMA.description,
    oneOf: Object.freeze(RECORD_AUTHORING_EXCEPTION_ACTIONS.map((action) => variant(kind, action))) });
}

export function describeRecordAuthoringException(kind) {
  const subject = SUBJECTS[kind];
  return Object.freeze({ kind, ...MEANINGS[kind], consequence: RECORD_AUTHORING_EXCEPTION_CONSEQUENCES[kind],
    ...(kind === "grammar" ? { enforcement: GRAMMAR_EXCEPTION_ENFORCEMENT } : {}),
    subject: Object.freeze({ names: subject.names, ...(subject.read === null ? {} : { read_selection: subject.read }) }),
    rationale: Object.freeze({ required_to: "apply", ...RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE,
      not_a_justification: NOT_A_JUSTIFICATION }),
    schema: recordAuthoringExceptionSchema(kind) });
}

const require = createRequire(import.meta.url);
let compiled = null;
function validator() {
  if (compiled === null) {
    const loaded = require("ajv");
    const Ajv = loaded.default ?? loaded;
    const ajv = new Ajv({ strict: false, allErrors: true });
    compiled = Object.freeze({ shape: ajv.compile(closed({ kind: { enum: [...RECORD_AUTHORING_EXCEPTION_KINDS] },
      action: { enum: [...RECORD_AUTHORING_EXCEPTION_ACTIONS] }, subject: {}, rationale: {}, source_passages: {} }, ["kind", "action", "subject"])),
    variants: new Map(RECORD_AUTHORING_EXCEPTION_KINDS.flatMap((kind) => RECORD_AUTHORING_EXCEPTION_ACTIONS.map((action) =>
      [`${kind}\u0000${action}`, ajv.compile(variant(kind, action))]))) });
  }
  return compiled;
}

const issue = (path, message, constraint) => Object.freeze({ code: RECORD_AUTHORING_EXCEPTION_CODES.INVALID,
  severity: "error", path, message: `${path} ${message}`, constraint });
function issuesOf(errors) {
  const byPath = new Map();
  for (const error of errors ?? []) {
    const unknown = error.keyword === "additionalProperties";
    const member = unknown ? error.params.additionalProperty
      : error.keyword === "required" ? error.params.missingProperty : null;
    const path = `exception${error.instancePath.replace(/\//gu, ".")}${member === null ? "" : `.${member}`}`;
    if (byPath.has(path)) continue;
    byPath.set(path, issue(path, unknown ? "is not an accepted member" : error.message,
      { keyword: error.keyword, ...error.params }));
  }
  return [...byPath.values()];
}

export function validateRecordAuthoringException(exception) {
  const { shape, variants } = validator();
  if (exception === null || typeof exception !== "object" || Array.isArray(exception)) {
    return Object.freeze([issue("exception", "must be an object", { keyword: "type", type: "object" })]);
  }
  if (!shape(exception)) return Object.freeze(issuesOf(shape.errors));
  const validate = variants.get(`${exception.kind}\u0000${exception.action}`);
  if (validate(exception)) return Object.freeze([]);
  return Object.freeze(issuesOf(validate.errors).map((entry) =>
    entry.path === "exception.rationale" && exception.action === "withdraw"
      ? issue(entry.path, "is not taken when withdrawing; a withdrawal states no reason", entry.constraint) : entry));
}

export function retiredExceptionMemberPaths(changes) {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return [];
  const paths = [];
  (Array.isArray(changes.obligations) ? changes.obligations : []).forEach((row, index) => {
    if (row !== null && typeof row === "object" && Object.hasOwn(row, "proof_opt_out")) {
      paths.push(`changes.obligations[${index}].proof_opt_out`);
    }
  });
  const acceptance = changes.controlled_acceptance;
  if (acceptance !== null && typeof acceptance === "object" && !Array.isArray(acceptance) &&
      (Object.hasOwn(acceptance, "rationale") || (Object.hasOwn(acceptance, "disposition") && acceptance.disposition !== "required"))) {
    paths.push("changes.controlled_acceptance");
  }
  return paths;
}
