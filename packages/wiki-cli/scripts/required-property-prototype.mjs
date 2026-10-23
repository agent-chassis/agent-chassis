

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { inspectParameterSource } from "@agent-chassis/controlled-contract/pack-parameters";
import { loadPinnedProofSelection } from "@agent-chassis/controlled-contract/proof-selection";
import { validateRecordByKind } from "@agent-chassis/wiki-core/src/lib/work-record-kind-registry.mjs";
import { loadPaidCapabilities } from "@agent-chassis/wiki-core/src/lib/paid-capability-loader.mjs";
const { requirementAuthoring } = await loadPaidCapabilities({ resolve: specifier => import.meta.resolve(specifier) });

const OUTPUT_SCHEMA_VERSION = "required-property-prototype.v1";
const ENFORCEMENT_SCHEMA_VERSION = "decision-required-properties.prototype.v1";
const EXIT = Object.freeze({ complete: 0, gaps: 1, refused: 2 });
const SCOPE_NOTE = "Design-time authored coverage only: no implementation proof is executed, " +
  "no dispatch permission is granted and no CCE enforcement is established.";
const EXAMPLE_NOTE = "Demo authored definitions are disposable in-memory examples built by the " +
  "semantic compiler. Their verification definitions are illustrative authoring, never executed proof.";
const PART_LABELS = Object.freeze({ authored_requirement: "authored requirement",
  same_subject_obligation: "same-subject obligation",
  qualifying_verification_support: "qualifying verification support",
  required_proof_selection: "required proof selection" });

const PROOF_PIN_FIELDS = Object.freeze(["proof_name", "proof_version", "profile_digest",
  "parameter_contract_digest", "admission_digest"]);
const BINDING_SOURCES = Object.freeze(["property_subject", "context"]);
const HELP = `Usage:
  node packages/wiki-cli/scripts/required-property-prototype.mjs --decision <decision.json> --input <input.json> [--json]
  node packages/wiki-cli/scripts/required-property-prototype.mjs --decision <decision.json> --demo [--example-verifications <file.json>] [--json]

Reports which properties required by an accepted decision's enforcement
metadata lack an authored requirement, a same-subject obligation or qualifying
verification support. A property may also require a pinned proof with bound
parameters ("required_proof"); the required selection is derived from the
decision and the subject, and is reported missing, mismatched or unresolved
even when no obligation was authored. ${SCOPE_NOTE}

Options:
  --decision <file>   Accepted decision JSON carrying enforcement metadata
                      (${ENFORCEMENT_SCHEMA_VERSION}).
  --input <file>      Authored input JSON:
                      { "wkId", "focus"?, "tags": [...], "context"?: { "<key>": { "type_term", "identity" } },
                        "contract": <native contract content or null>, "obligations": [...] }
                      "tags" must carry the decision's enforcement.system.unit_tag.
                      "context" supplies the referents a required proof binds
                      by key; a key it lacks stays an unresolved expectation.
  --demo              Assess five disposable in-memory scenarios against the
                      decision's own required properties: no authored support,
                      an unrelated complete obligation, complete definitions,
                      one obligation removed, one verification relationship removed,
                      and one required proof selection removed when the decision
                      requires a proof whose bindings resolve without context.
  --example-verifications <file>
                      Demo only: { "<property id>": <verification meaning> } used
                      as the example verification for the named properties
                      in place of the built-in generic example.
  --json              Print the structured result as JSON on stdout.
  --help              Print this help.

Exit codes:
  0  applicable and every required property is definition-complete
     (--demo: every scenario produced its expected assessment)
  1  applicable with definition gaps (--demo: a scenario deviated)
  2  invalid input, unsupported or invalid decision metadata, or a request
     the decision's system does not apply to
`;

const UNRELATED_EXAMPLE_REQUIREMENT = Object.freeze({ nature: "behavior", modality: "MUST",
  subject: { declare: { type_term: "cc:artifact",
    identity: { kind: "profile_term", term: "example.unrelated-sibling" } } },
  behavior: { relation: "boolean:exists", objects: [{ boolean: true }] } });
const exampleVerification = (name) => ({ method: "test_execution",
  verifier: { declare: { type_term: "cc:test",
    identity: { kind: "profile_term", term: `example-verification.${name}` } } },
  observes: { relation: "boolean:exists", objects: [{ boolean: true }] },
  fails_when: { relation: "boolean:exists", objects: [{ boolean: false }] } });

class Refusal extends Error {
  constructor(code, message, details = {}, status = "invalid") {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

async function readJson(file, role) {
  const resolved = path.resolve(file);
  if (`${resolved.split(path.sep).join("/")}/`.includes("/wiki/contracts/")) {
    throw new Refusal(`${role}_path_refused`, `--${role} must not name a file under wiki/contracts`,
      { path: file, repair: "Supply a disposable JSON file outside wiki/contracts." });
  }
  let text;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    throw new Refusal(`${role}_unreadable`, `--${role} file cannot be read (${error.code ?? error.message})`,
      { path: file, cause: error.code ?? null, repair: `Supply a readable JSON file for --${role}.` });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Refusal(`${role}_json_invalid`, `--${role} file is not valid JSON`,
      { path: file, cause: error.message, repair: `Correct the JSON syntax of the --${role} file.` });
  }
}

function assertMembers(value, field, fields, code) {
  if (!isRecord(value)) throw new Refusal(code, `${field} must be an object`, { field,
    repair: `Supply an object carrying ${fields.join(", ")} at ${field}.` });
  const unknown = Object.keys(value).filter((key) => !fields.includes(key)).sort();
  if (unknown.length > 0) throw new Refusal(code, `${field} carries unsupported member(s)`, {
    field: `${field}.${unknown[0]}`, unknown_fields: unknown, accepted_fields: [...fields],
    repair: `Remove ${unknown.join(", ")} from ${field}.` });
}

function assertText(value, field, code) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Refusal(code,
    `${field} must be a nonempty string`, { field, repair: `Supply a nonempty string at ${field}.` });
  return value;
}

function readRequiredProof(rule, field, code) {
  if (rule === undefined) return null;
  assertMembers(rule, field, [...PROOF_PIN_FIELDS, "parameters"], code);
  const pin = Object.fromEntries(PROOF_PIN_FIELDS.map((key) =>
    [key, assertText(rule[key], `${field}.${key}`, code)]));
  if (!isRecord(rule.parameters)) throw new Refusal(code, `${field}.parameters must be an object`, {
    field: `${field}.parameters`, repair: "Key each constrained parameter by its name." });
  const parameters = Object.entries(rule.parameters).map(([name, binding]) => {
    const at = `${field}.parameters.${name}`;
    assertMembers(binding, at, ["value", "from", "key"], code);
    const fixed = Object.hasOwn(binding, "value");
    if (fixed === Object.hasOwn(binding, "from") || (fixed && Object.hasOwn(binding, "key")) ||
        (!fixed && (!BINDING_SOURCES.includes(binding.from) ||
          (binding.from === "context") !== Object.hasOwn(binding, "key")))) {
      throw new Refusal(code, `${at} must fix one value or bind one source`, { field: at,
        accepted_sources: [...BINDING_SOURCES],
        repair: 'Supply { "value": <referent> }, { "from": "property_subject" } or ' +
          '{ "from": "context", "key": "<context key>" }.' });
    }
    return { name, field: at, ...(fixed ? { value: structuredClone(binding.value) } : { from: binding.from,
      ...(binding.from === "context" ? { key: assertText(binding.key, `${at}.key`, code) } : {}) }) };
  });
  return { pin, parameters };
}

async function resolveRequiredProof(property, context) {
  const rule = property.requiredProof;
  if (rule === null) return undefined;
  const code = "decision_enforcement_invalid";
  let pack;
  try {
    pack = await loadPinnedProofSelection(rule.pin);
  } catch (error) {
    throw new Refusal(error?.code ?? code, `${property.id} requires a proof the definition owner refuses: ${
      error?.message ?? String(error)}`, { ...(isRecord(error?.details) ? error.details : {}),
      property_id: property.id, proof_name: rule.pin.proof_name,
      repair: "Pin the required proof to its exact admitted definition." });
  }
  const parameters = {};
  const unresolved = [];
  const defined = pack.parameter_contract.parameters.map(({ name }) => name);
  const undefinedParameter = (binding, cause = null) => new Refusal(code,
    `${binding.field} names a parameter ${rule.pin.proof_name} does not define`, {
      field: binding.field, property_id: property.id, parameter: binding.name, cause,
      accepted_parameters: defined,
      repair: "Constrain only parameters of the required proof's own parameter contract." });
  for (const binding of rule.parameters) {

    if (!defined.includes(binding.name)) throw undefinedParameter(binding);
    const supplied = binding.from === "context";
    const referent = binding.from === undefined ? binding.value
      : !supplied ? property.requirement.subject?.declare
        : Object.hasOwn(context, binding.key) ? context[binding.key] : undefined;
    if (supplied && referent === undefined) {
      unresolved.push(binding.name);
      continue;
    }
    const field = supplied ? `context.${binding.key}` : binding.field;
    const refuse = (message, details = {}) => new Refusal(supplied ? "input_invalid" : code, message, {
      field, property_id: property.id, parameter: binding.name, ...details,
      repair: 'Supply a referent { "type_term", "identity" } the named proof parameter admits.' });
    if (!isRecord(referent) || typeof referent.type_term !== "string" || !isRecord(referent.identity)) {
      throw refuse(`${field} does not supply a declared referent for ${binding.name}`);
    }
    let inspection;
    try {
      inspection = inspectParameterSource(pack.parameter_contract, binding.name, {
        explicit: referent.identity, canonical_references: [referent] });
    } catch (error) {
      throw undefinedParameter(binding, error?.code ?? null);
    }
    if (inspection.status !== "available") throw refuse(
      `${field} is not a referent ${binding.name} admits`, { parameter_status: inspection.status,
        reason: inspection.reason ?? null });
    parameters[binding.name] = structuredClone(referent.identity);
  }
  return { selection: { ...rule.pin, parameters }, unresolved_parameters: unresolved };
}

function readDecision(decision, decisionPath) {
  const diagnostics = validateRecordByKind(decision);
  if (diagnostics.length > 0 || decision.record_kind !== "decision") {
    throw new Refusal("decision_record_invalid", "--decision is not a valid decision record", {
      path: decisionPath, record_kind: decision?.record_kind ?? null, diagnostics,
      repair: "Supply a decision JSON record that satisfies the decision record shape." });
  }
  if (decision.status !== "accepted") throw new Refusal("decision_not_accepted",
    `${decision.id} is '${decision.status}'; only an accepted decision supplies required properties`, {
      path: decisionPath, decision_id: decision.id, status: decision.status,
      repair: "Supply an accepted decision." });
  const code = "decision_enforcement_invalid";
  const { enforcement } = decision;
  if (!isRecord(enforcement)) throw new Refusal("decision_enforcement_missing",
    `${decision.id} carries no enforcement metadata`, { decision_id: decision.id, field: "enforcement",
      repair: `Supply a decision whose enforcement block is ${ENFORCEMENT_SCHEMA_VERSION}.` });
  if (enforcement.schema_version !== ENFORCEMENT_SCHEMA_VERSION) throw new Refusal(
    "decision_enforcement_unsupported", `${decision.id} enforcement metadata is not a supported version`, {
      decision_id: decision.id, field: "enforcement.schema_version",
      actual: enforcement.schema_version ?? null, supported: [ENFORCEMENT_SCHEMA_VERSION],
      repair: `Supply enforcement metadata of ${ENFORCEMENT_SCHEMA_VERSION}.` });
  assertMembers(enforcement, "enforcement", ["schema_version", "system", "properties"], code);
  assertMembers(enforcement.system, "enforcement.system", ["id", "unit_tag"], code);
  const system = { id: assertText(enforcement.system.id, "enforcement.system.id", code),
    unit_tag: assertText(enforcement.system.unit_tag, "enforcement.system.unit_tag", code) };
  if (!Array.isArray(enforcement.properties) || enforcement.properties.length === 0) {
    throw new Refusal(code, "enforcement.properties must be a nonempty array", {
      field: "enforcement.properties", repair: "Declare at least one required property." });
  }
  const seen = new Set();
  const properties = enforcement.properties.map((property, index) => {
    const field = `enforcement.properties[${index}]`;
    assertMembers(property, field, ["id", "clause", "requirement", "required_proof"], code);
    const id = assertText(property.id, `${field}.id`, code);
    if (seen.has(id)) throw new Refusal(code, `${field}.id repeats '${id}'`, { field: `${field}.id`,
      property_id: id, repair: "Give every required property a distinct id." });
    seen.add(id);
    if (!isRecord(property.requirement)) throw new Refusal(code, `${field}.requirement must be an object`, {
      field: `${field}.requirement`, repair: "Supply the semantic requirement the property requires." });
    return { id, clause: assertText(property.clause, `${field}.clause`, code),
      requirement: structuredClone(property.requirement),
      requiredProof: readRequiredProof(property.required_proof, `${field}.required_proof`, code) };
  });
  return { decision: { id: decision.id, title: decision.title, status: decision.status,
    path: decisionPath, enforcement_schema_version: ENFORCEMENT_SCHEMA_VERSION }, system, properties };
}

const provenanceOf = (source, property) => ({ decision_id: source.decision.id,
  decision_path: source.decision.path, system_id: source.system.id, clause: property.clause,
  property_id: property.id });
const requiredPopulation = async (source, context = {}) => Promise.all(source.properties.map(
  async (property) => {
    const requiredProof = await resolveRequiredProof(property, context);
    return { requirement: structuredClone(property.requirement), provenance: provenanceOf(source, property),
      ...(requiredProof === undefined ? {} : { requiredProof }) };
  }));

function preview(request) {
  try {
    return requirementAuthoring.previewRequiredProperties(request);
  } catch (error) {
    throw new Refusal(error?.code ?? "required_property_preview_failed", error?.message ?? String(error),
      isRecord(error?.details) ? error.details : {});
  }
}

function assessment(result) {
  return {
    status: result.definition_complete ? "complete" : "gaps",
    subject: result.subject,
    counts: result.counts,
    properties: result.properties.map((row) => ({
      sources: [row.provenance].flat(),
      claim_id: row.claim_id,
      definition_complete: row.definition_complete,
      missing_parts: row.missing_parts,
      authored_requirement: row.authored_requirement,
      same_subject_obligation: row.same_subject_obligation,
      qualifying_verification_support: row.qualifying_verification_support,
      obligation_ids: row.obligation_ids,
      required_proof_selection: row.required_proof_selection,
      required_proofs: row.required_proofs,
      diagnostics: row.diagnostics,
      uncertainty: row.uncertainty,
      repair: row.repair
    }))
  };
}

async function assessInput(source, input, inputPath) {
  if (!isRecord(input)) throw new Refusal("input_invalid", "--input must be a JSON object", {
    path: inputPath, repair: "Supply { wkId, focus, tags, contract, obligations }." });

  if (Object.hasOwn(input, "requiredProperties")) throw new Refusal("input_invalid",
    "requiredProperties is derived from the decision and must not be supplied", {
      field: "requiredProperties", repair: "Remove requiredProperties from the --input file." });
  const { tags, context = {}, ...request } = input;
  if (!isRecord(context)) throw new Refusal("input_invalid", "context must be an object keyed by binding key", {
    field: "context", repair: 'Supply { "<key>": { "type_term", "identity" } } or omit context.' });
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
    throw new Refusal("input_invalid", "tags must be an array of nonempty strings", { field: "tags",
      repair: `List the unit's explicit system tags, for example ["${source.system.unit_tag}"].` });
  }
  if (!tags.includes(source.system.unit_tag)) throw new Refusal("system_not_applicable",
    `${source.decision.id} applies to units tagged '${source.system.unit_tag}'; the input carries no such tag`, {
      decision_id: source.decision.id, system: source.system, tags,
      uncertainty: "nothing was assessed; this is neither complete coverage nor a gap",
      repair: `Add '${source.system.unit_tag}' to tags only if the unit is part of that system.` },
    "not_applicable");

  const result = preview({ ...request, requiredProperties: await requiredPopulation(source, context) });
  return { ...assessment(result), assessment: result };
}

async function demo(source, overrides) {
  const subject = { wkId: "WK-DEMO", focus: "required-property-demo" };
  const required = await requiredPopulation(source);
  const ids = source.properties.map(({ id }) => id);
  const unknown = Object.keys(overrides).filter((id) => !ids.includes(id)).sort();
  if (unknown.length > 0) throw new Refusal("example_verifications_invalid",
    "--example-verifications names properties the decision does not declare", {
      unknown_property_ids: unknown, accepted_property_ids: ids,
      repair: "Key each example verification by a declared property id." });
  const run = (requiredProperties, contract = null, obligations = []) =>
    preview({ ...subject, requiredProperties, contract, obligations });

  const resolved = (entry) => entry.requiredProof !== undefined &&
    entry.requiredProof.unresolved_parameters.length === 0;
  const example = (requirement, name) => ({ provenance: { example: true, name },
    requirement: { ...structuredClone(requirement),
      verification: structuredClone(overrides[name] ?? requirement.verification ?? exampleVerification(name)) } });
  const exampleObligation = (name, claimId, entry) => ({ obligation_id: `OBL-EXAMPLE-${name}`,
    statement: `Example obligation for ${name} (illustrative authoring, not executed proof)`,
    controlled_contract_node_ids: [claimId],
    ...(entry !== undefined && resolved(entry) ? { selection: structuredClone(entry.requiredProof.selection) } : {}) });

  const claims = required.map((entry) => run([entry]).properties[0].claim_id);
  const complete = structuredClone(run(source.properties.map((property) =>
    example(property.requirement, property.id))).prospective_contract);
  const obligations = source.properties.map((property, index) =>
    exampleObligation(property.id, claims[index], required[index]));
  const unrelated = example(UNRELATED_EXAMPLE_REQUIREMENT, "unrelated-sibling");
  const unrelatedSeed = run([unrelated]);
  const unrelatedContract = structuredClone(unrelatedSeed.prospective_contract);
  const unrelatedObligations = [exampleObligation("unrelated-sibling", unrelatedSeed.properties[0].claim_id)];
  const withoutVerification = { ...complete, relations: complete.relations.filter((relation) =>
    !(relation.role === "verifies" && relation.target_claim_id === claims[0])) };
  const total = new Set(claims).size;

  const open = new Set(claims.filter((_, index) => required[index].requiredProof !== undefined &&
    !resolved(required[index])));
  const completable = total - open.size;

  const requiring = new Set(claims.filter((_, index) => required[index].requiredProof !== undefined));
  const reopened = (part, index = 0) => ({ property_id: ids[index], claim_id: claims[index],
    missing_parts: [...new Set([part, ...(open.has(claims[index]) || (part === "same_subject_obligation" &&
      requiring.has(claims[index])) ? ["required_proof_selection"] : [])])] });
  const lost = (index) => open.has(claims[index]) ? 0 : 1;
  const proved = required.findIndex(resolved);
  const scenarios = [
    ["no-authored-support", "No authored support", null, [], 0, null],
    ["unrelated-complete-obligation", "An unrelated complete obligation", unrelatedContract,
      unrelatedObligations, 0, null],
    ["complete-authored-definitions", "Complete authored definitions", complete, obligations, completable, null],

    ["one-obligation-removed", `One obligation removed (${ids[0]})`, complete,
      obligations.filter((row) => !row.controlled_contract_node_ids.includes(claims[0])),
      completable - lost(0), reopened("same_subject_obligation")],
    ["one-verification-removed", `One verification relationship removed (${ids[0]})`,
      withoutVerification, obligations, completable - lost(0), reopened("qualifying_verification_support")],
    ...(proved === -1 ? [] : [["one-proof-selection-removed",
      `One required proof selection removed (${ids[proved]})`, complete, obligations.map((row) =>
        row.controlled_contract_node_ids.includes(claims[proved])
          ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "selection")) : row),
      completable - lost(proved), reopened("required_proof_selection", proved)]])
  ].map(([id, title, contract, rows, expectedComplete, expectedReopened]) => {
    const result = assessment(run(required, contract, rows));
    const target = result.properties.find((row) => row.claim_id === (expectedReopened ?? {}).claim_id);
    return { id, title, ...result,
      expected: { required: total, definition_complete: expectedComplete, reopened: expectedReopened },
      as_expected: result.counts.required === total &&
        result.counts.definition_complete === expectedComplete && (expectedReopened === null ||
          JSON.stringify(target.missing_parts) === JSON.stringify(expectedReopened.missing_parts)) };
  });

  const unrelatedAlone = run([unrelated], unrelatedContract, unrelatedObligations).counts;
  return { status: scenarios.every((scenario) => scenario.as_expected) ? "demo_as_expected" : "demo_deviated",
    subject: { wk_id: subject.wkId, focus: subject.focus }, example_note: EXAMPLE_NOTE,
    unrelated_example: { requirement: structuredClone(UNRELATED_EXAMPLE_REQUIREMENT),
      assessed_alone: unrelatedAlone },
    scenarios };
}

function propertyLines(rows) {
  return rows.flatMap((row) => {
    const origin = row.sources.map((source) => source.decision_id === undefined ? JSON.stringify(source)
      : `${source.decision_id} clause ${source.clause} ${source.property_id}`).join(" + ");
    const codes = [...new Set(row.diagnostics.map((diagnostic) => diagnostic.code))];
    return [
      `  [${row.definition_complete ? "COMPLETE" : "MISSING "}] ${origin} (${row.claim_id})`,
      ...(row.definition_complete ? [] : [`      missing: ${row.missing_parts.map((part) =>
        PART_LABELS[part] ?? part).join(", ")}`]),
      ...row.required_proofs.map((proof) => `      required proof (${proof.status}): ${
        proof.selection.proof_name} ${proof.selection.proof_version}${
        proof.unresolved_parameters.length === 0 ? "" : `; unresolved: ${proof.unresolved_parameters.join(", ")}`}${
        proof.mismatches.length === 0 ? "" : `; ${[...new Set(proof.mismatches.map((entry) =>
          entry.field === undefined ? entry.code : `${entry.code} ${entry.field}`))].join(", ")}`}`),
      ...(codes.length === 0 ? [] : [`      diagnostics: ${codes.join(", ")}`])
    ];
  });
}

const countLine = ({ required, definition_complete: complete, missing }) =>
  `required ${required} | definition-complete ${complete} | missing ${missing}`;

function render(report) {
  const { decision, system } = report;
  const lines = [`Required-property prototype: ${decision.id} (${decision.status}) ${decision.title}`,
    `System ${system.id}, unit tag ${system.unit_tag}`];
  if (report.scenarios !== undefined) {
    lines.push(report.example_note, "");
    for (const [index, scenario] of report.scenarios.entries()) {
      lines.push(`Scenario ${index + 1}/${report.scenarios.length} ${scenario.id}: ${scenario.title}`,
        `  ${countLine(scenario.counts)}  [${scenario.as_expected ? "as expected" : "DEVIATED"}]`,
        ...propertyLines(scenario.properties), "");
    }
    lines.push(report.status === "demo_as_expected"
      ? "Demo result: every scenario produced its expected assessment."
      : "Demo result: at least one scenario deviated from its expected assessment.");
  } else {
    lines.push(`Subject ${report.subject.wk_id}${report.subject.focus === null ? "" : `#${report.subject.focus}`}`,
      countLine(report.counts), ...propertyLines(report.properties),
      report.status === "complete" ? "Result: every required property is definition-complete."
        : "Result: required properties have definition gaps.");
  }
  return [...lines, SCOPE_NOTE].join("\n");
}

function renderRefusal(report) {
  const { error } = report;
  const detail = [["field", error.details.field], ["repair", error.details.repair]]
    .filter(([, value]) => typeof value === "string").map(([name, value]) => `  ${name}: ${value}`);
  return [`${report.status === "not_applicable" ? "Not applicable" : "Refused"} (${error.code}): ${error.message}`,
    ...detail].join("\n");
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    decision: { type: "string" }, input: { type: "string" }, demo: { type: "boolean", default: false },
    "example-verifications": { type: "string" }, json: { type: "boolean", default: false },
    help: { type: "boolean", default: false } } });
  if (values.help) return { help: true };
  const usage = (message) => new Refusal("usage_invalid", message, { repair: "Run with --help for usage." });
  if (values.decision === undefined) throw usage("--decision <decision.json> is required");
  if ((values.input === undefined) === !values.demo) throw usage("supply exactly one of --input <input.json> or --demo");
  if (values["example-verifications"] !== undefined && !values.demo) {
    throw usage("--example-verifications applies to --demo only");
  }
  const source = readDecision(await readJson(values.decision, "decision"), values.decision);
  const header = { schema_version: OUTPUT_SCHEMA_VERSION, mode: values.demo ? "demo" : "input",
    decision: source.decision, system: source.system, scope_note: SCOPE_NOTE };
  if (!values.demo) return { ...header, ...await assessInput(source, await readJson(values.input, "input"), values.input) };
  const overrides = values["example-verifications"] === undefined ? {}
    : await readJson(values["example-verifications"], "example-verifications");
  if (!isRecord(overrides)) throw new Refusal("example_verifications_invalid",
    "--example-verifications must be a JSON object keyed by property id", {
      repair: "Supply { \"<property id>\": <verification meaning> }." });
  return { ...header, ...await demo(source, overrides) };
}

const json = process.argv.includes("--json");
let report;
try {
  report = await main(process.argv.slice(2));
} catch (error) {
  const refusal = error instanceof Refusal ? error
    : new Refusal(typeof error?.code === "string" && error.code.startsWith("ERR_PARSE_ARGS")
      ? "usage_invalid" : "prototype_failed", error?.message ?? String(error),
    { repair: "Run with --help for usage." });
  report = { schema_version: OUTPUT_SCHEMA_VERSION, status: refusal.status,
    error: { code: refusal.code, message: refusal.message, details: refusal.details } };
}
if (report.help) {
  process.stdout.write(HELP);
} else {
  const refused = report.error !== undefined;
  process.exitCode = refused ? EXIT.refused
    : ["complete", "demo_as_expected"].includes(report.status) ? EXIT.complete : EXIT.gaps;
  report.exit_code = process.exitCode;
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (refused) process.stderr.write(`${renderRefusal(report)}\n`);
  else process.stdout.write(`${render(report)}\n`);
}
