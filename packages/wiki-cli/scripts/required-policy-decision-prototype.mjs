

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { canonicalDigest } from "@agent-chassis/controlled-contract";
import { loadPinnedProofSelection } from "@agent-chassis/controlled-contract/proof-selection";
import { validateProfileSemanticsV1 } from "@agent-chassis/controlled-contract/verification-profile";
import { controlledContractContentDigest } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import { validateProfileSchemaV1 } from "../../controlled-contract/lib/verification-profile-schema-v1.mjs";
import { REQUIRED_POLICY_SCHEMA_VERSION, assessRequiredPolicies } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/required-policy-assessment.mjs";

export const DECISION_PATTERN_ENFORCEMENT_VERSION = "decision-required-patterns.prototype.v2";
export const POLICY_INVENTORY_VERSION = "required-policy-inventory.prototype.v1";
export const DRAFT_EXPERIMENT_USE = "draft_experiment";
const OUTPUT_SCHEMA_VERSION = "required-policy-decision-comparison.prototype.v2";
const ENFORCEMENT_FIELDS = Object.freeze(["schema_version", "rules", "policy"]);

const POLICY_SCHEMA_VERSION = "decision-required-properties.prototype.v1";
const POLICY_FIELDS = Object.freeze(["schema_version", "system", "properties", "structure"]);
const POLICY_PROPERTY_FIELDS = Object.freeze(["id", "clause", "requirement"]);
const POLICY_STRUCTURE_FIELDS = Object.freeze(["id", "clause", "text", "requirement"]);
const FACT_FIELDS = Object.freeze(["fact_id", "kind", "statement", "source"]);
const COVERAGE_FIELDS = Object.freeze(["aspect_id", "fact_id", "stated_by", "not_applicable", "unresolved_as"]);

const INTERFACE_WIDE = "interface";
const RULE_FIELDS = Object.freeze(["rule_id", "applies_to", "patterns", "clauses", "obligation_pattern_ids",
  "required_proof", "required_by_clauses"]);

const PROOF_PIN_FIELDS = Object.freeze(["proof_name", "proof_version", "profile_digest",
  "parameter_contract_digest", "admission_digest"]);
const PROOF_NOTE = "Authoring this support states the proof's required structure in the contract. It does not select, " +
  "execute or pass the proof, and the proof establishes nothing beyond its own assertion. A binding is taken from the " +
  "decision data as given; the comparison cannot tell whether it describes the interface correctly.";
const PATTERN_REFERENCE_FIELDS = Object.freeze(["path", "content_digest"]);

const PATTERN_FAMILIES = Object.freeze(["claim_patterns", "relation_patterns", "collection_patterns",
  "reference_binding_patterns", "binding_constraint_patterns", "resolver_fact_patterns", "evidence_patterns"]);
const INVENTORY_FIELDS = Object.freeze(["schema_version", "entries"]);
const ENTRY_FIELDS = Object.freeze(["input_id", "interface", "kind", "bindings", "boundary",
  "unresolved_requirements", "facts", "coverage", "part_of"]);
const UNRESOLVED_FIELDS = Object.freeze(["requirement_id", "clauses", "statement", "reason"]);
const EXIT = Object.freeze({ complete: 0, gaps: 1, refused: 2 });
const SCOPE_NOTE = "Prototype definition coverage only: the rules, the inventory, its boundary facts and its " +
  "bindings are supplied interpretations, not derived from the decision's text, discovered or authenticated; a " +
  "match establishes authored structure, not that a rule states the right meaning; no implementation " +
  "correctness, proof execution, policy decision or dispatch permission is established.";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.length > 0;

const contentIdentity = (value) => {
  const digest = canonicalDigest(value);
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
};
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export class DecisionPolicyRefusal extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
const refuse = (code, message, details) => { throw new DecisionPolicyRefusal(code, message, details); };

function closed(value, fields, code, field) {
  if (!isRecord(value)) refuse(code, `${field} must be an object`, { field });
  const unknown = Object.keys(value).filter((key) => !fields.includes(key)).sort();
  if (unknown.length > 0) refuse(code, `${field} carries unsupported member(s)`, {
    field: `${field}.${unknown[0]}`, unknown_fields: unknown, accepted_fields: [...fields] });
}

function readRules(decision, decisionUse) {
  const code = "decision_pattern_enforcement_invalid";
  if (!isRecord(decision) || decision.record_kind !== "decision" || !text(decision.id)) {
    refuse("decision_invalid", "the decision must be a decision record with an id", { field: "decision" });
  }
  if (decision.status !== "accepted" && decisionUse !== DRAFT_EXPERIMENT_USE) refuse(
    "decision_not_accepted", `${decision.id} is ${decision.status ?? "without a status"}, not accepted`, {
      decision_id: decision.id, decision_status: decision.status ?? null,
      repair: `Only an explicit ${DRAFT_EXPERIMENT_USE} use reads a decision that is not accepted.` });
  const enforcement = decision.enforcement;
  if (enforcement === undefined) refuse("decision_pattern_enforcement_missing",
    `${decision.id} carries no enforcement metadata`, { decision_id: decision.id, field: "enforcement" });
  closed(enforcement, ENFORCEMENT_FIELDS, code, "enforcement");
  if (enforcement.schema_version !== DECISION_PATTERN_ENFORCEMENT_VERSION) refuse(
    "decision_pattern_enforcement_unsupported",
    `enforcement.schema_version is not ${DECISION_PATTERN_ENFORCEMENT_VERSION}`, {
      decision_id: decision.id, field: "enforcement.schema_version",
      actual: enforcement.schema_version ?? null });
  if (!Array.isArray(enforcement.rules) || enforcement.rules.length === 0) refuse(code,
    "enforcement.rules must be a nonempty array", { field: "enforcement.rules" });
  const seen = new Set();
  return enforcement.rules.map((rule, index) => {
    const field = `enforcement.rules[${index}]`;
    closed(rule, RULE_FIELDS, code, field);
    if (!text(rule.rule_id) || seen.has(rule.rule_id)) refuse(code,
      `${field}.rule_id must be a unique nonempty string`, { field: `${field}.rule_id` });
    seen.add(rule.rule_id);
    if (!isRecord(rule.applies_to) || !text(rule.applies_to.inventory_kind) ||
        Object.keys(rule.applies_to).length !== 1) refuse(code,
      `${field}.applies_to must state exactly one inventory_kind`, { field: `${field}.applies_to` });
    if ((rule.patterns === undefined) === (rule.required_proof === undefined)) refuse(code,
      `${field} states exactly one of patterns and required_proof`, { field });
    if (rule.required_proof !== undefined) {

      const at = `${field}.required_proof`;
      closed(rule.required_proof, [...PROOF_PIN_FIELDS, "parameters"], code, at);
      for (const key of PROOF_PIN_FIELDS) if (!text(rule.required_proof[key])) refuse(code,
        `${at}.${key} must be a nonempty string`, { field: `${at}.${key}` });
      if (!isRecord(rule.required_proof.parameters)) refuse(code, `${at}.parameters must be an object`,
        { field: `${at}.parameters` });
      for (const [name, binding] of Object.entries(rule.required_proof.parameters)) {
        closed(binding, ["value", "from", "key"], code, `${at}.parameters.${name}`);
        const fixed = Object.hasOwn(binding, "value");
        if (fixed === (binding.from === "context") || (fixed && Object.hasOwn(binding, "key")) ||
            (!fixed && !text(binding.key))) refuse(code,
          `${at}.parameters.${name} must fix one value or bind one inventory key`, { field: `${at}.parameters.${name}`,
            repair: 'Supply { "value": <referent or member set> } or { "from": "context", "key": "<inventory binding>" }.' });
      }
      if (rule.clauses !== undefined || !Array.isArray(rule.required_by_clauses) || rule.required_by_clauses.length === 0 ||
          !rule.required_by_clauses.every(text)) refuse(code,
        `${field}.required_by_clauses names the decision clauses that require the proof's structure`,
        { field: `${field}.required_by_clauses` });
    } else {
    if (rule.required_by_clauses !== undefined) refuse(code, `${field}.required_by_clauses belongs to a required_proof rule`,
      { field: `${field}.required_by_clauses` });
    closed(rule.patterns, PATTERN_REFERENCE_FIELDS, code, `${field}.patterns`);

    if (!text(rule.patterns.path) || path.isAbsolute(rule.patterns.path) ||
        rule.patterns.path.split(/[\\/]/u).some((segment) => segment === ".." || segment === "")) refuse(
      "decision_pattern_sidecar_location_invalid",
      `${field}.patterns.path must be a relative location beside the decision`, { field: `${field}.patterns.path` });
    if (typeof rule.patterns.content_digest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(rule.patterns.content_digest)) refuse(code,
      `${field}.patterns.content_digest must be the sidecar's sha256 content digest`,
      { field: `${field}.patterns.content_digest` });
    if (!isRecord(rule.clauses) || Object.values(rule.clauses).some((clauses) =>
      !Array.isArray(clauses) || clauses.length === 0 || !clauses.every(text))) refuse(code,
      `${field}.clauses must map each pattern id to the decision clauses it implements`, { field: `${field}.clauses` });
    }
    if (!Array.isArray(rule.obligation_pattern_ids) || !rule.obligation_pattern_ids.every(text)) refuse(code,
      `${field}.obligation_pattern_ids must be an array of pattern ids`,
      { field: `${field}.obligation_pattern_ids` });
    return rule;
  });
}

function readInventory(inventory) {
  const code = "policy_inventory_invalid";
  closed(inventory, INVENTORY_FIELDS, code, "inventory");
  if (inventory.schema_version !== POLICY_INVENTORY_VERSION) refuse(code,
    `inventory.schema_version is not ${POLICY_INVENTORY_VERSION}`, { field: "inventory.schema_version" });
  if (!Array.isArray(inventory.entries)) refuse(code, "inventory.entries must be an array",
    { field: "inventory.entries" });
  const seen = new Set();
  return inventory.entries.map((entry, index) => {
    const field = `inventory.entries[${index}]`;
    closed(entry, ENTRY_FIELDS, code, field);
    for (const key of ["input_id", "interface", "kind"]) if (!text(entry[key])) refuse(code,
      `${field}.${key} must be a nonempty string`, { field: `${field}.${key}` });
    if (seen.has(entry.input_id)) refuse(code, `${field}.input_id repeats an inventory entry`,
      { field: `${field}.input_id`, input_id: entry.input_id });
    seen.add(entry.input_id);
    if (!isRecord(entry.bindings)) refuse(code, `${field}.bindings must be an object`,
      { field: `${field}.bindings` });

    if (entry.part_of !== undefined && (!text(entry.part_of) || !inventory.entries.some((other) =>
      isRecord(other) && other.input_id === entry.part_of && other.part_of === undefined && other !== entry))) refuse(code,
      `${field}.part_of must name another entry that is not itself part of one`, { field: `${field}.part_of` });

    if (entry.boundary !== undefined && !isRecord(entry.boundary)) refuse(code,
      `${field}.boundary must be an object`, { field: `${field}.boundary` });

    const unresolved = entry.unresolved_requirements ?? [];
    if (!Array.isArray(unresolved)) refuse(code, `${field}.unresolved_requirements must be an array`,
      { field: `${field}.unresolved_requirements` });
    const ids = new Set();
    for (const [position, item] of unresolved.entries()) {
      const at = `${field}.unresolved_requirements[${position}]`;
      closed(item, UNRESOLVED_FIELDS, code, at);
      for (const key of ["requirement_id", "statement", "reason"]) if (!text(item[key])) refuse(code,
        `${at}.${key} must be a nonempty string`, { field: `${at}.${key}` });
      if (!Array.isArray(item.clauses) || item.clauses.length === 0 || !item.clauses.every(text)) refuse(code,
        `${at}.clauses names the decision clauses that require it`, { field: `${at}.clauses` });
      if (ids.has(item.requirement_id)) refuse(code, `${at}.requirement_id repeats an unresolved requirement`,
        { field: `${at}.requirement_id`, requirement_id: item.requirement_id });
      ids.add(item.requirement_id);
    }
    return entry;
  });
}

function resolveRequiredProof(rule, index, proofs) {
  const field = `enforcement.rules[${index}].required_proof`;
  const pin = Object.fromEntries(PROOF_PIN_FIELDS.map((key) => [key, rule.required_proof[key]]));
  const pack = isRecord(proofs) ? proofs[rule.rule_id] : undefined;
  if (!isRecord(pack) || !isRecord(pack.profile) || !isRecord(pack.parameter_contract)) refuse(
    "decision_required_proof_unresolved", `rule ${rule.rule_id} requires a proof whose definition was not resolved`,
    { rule_id: rule.rule_id, field, proof: pin, repair: "Resolve the decision's required proofs through loadDecisionProofDefinitions." });
  const actual = { proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
    profile_digest: pack.profile_digest, parameter_contract_digest: pack.parameter_contract_digest,
    admission_digest: pack.admission_digest };
  const differing = PROOF_PIN_FIELDS.filter((key) => actual[key] !== pin[key]);
  if (differing.length > 0) refuse("decision_required_proof_pin_mismatch",
    `the definition supplied for rule ${rule.rule_id} is not the one its pin names`,
    { rule_id: rule.rule_id, field: `${field}.${differing[0]}`, expected: pin, actual });

  const rolesOf = new Map(pack.parameter_contract.parameters.map((parameter) => [parameter.name, parameter.roles]));
  const undefinedParameters = Object.keys(rule.required_proof.parameters).filter((name) => !rolesOf.has(name)).sort();
  if (undefinedParameters.length > 0) refuse("decision_required_proof_parameter_unknown",
    `rule ${rule.rule_id} constrains a parameter ${pin.proof_name} does not define`,
    { rule_id: rule.rule_id, field: `${field}.parameters.${undefinedParameters[0]}`, unknown_parameters: undefinedParameters,
      accepted_parameters: [...rolesOf.keys()] });
  const bundle = pack.profile;
  const patternIds = PATTERN_FAMILIES.flatMap((family) => (bundle[family] ?? []).map((pattern) => pattern.pattern_id));
  const claimIds = bundle.claim_patterns.map((pattern) => pattern.pattern_id);
  const invalid = rule.obligation_pattern_ids.filter((id) => !claimIds.includes(id)).sort();
  if (invalid.length > 0) refuse("decision_pattern_obligation_target_invalid",
    `rule ${rule.rule_id} requires an obligation of something that is not a claim pattern of its proof`,
    { rule_id: rule.rule_id, field: `enforcement.rules[${index}].obligation_pattern_ids`, invalid_pattern_ids: invalid });
  return { bundle, proof: { pin, rolesOf },
    clauses: Object.fromEntries(patternIds.map((id) => [id, [...rule.required_by_clauses]])) };
}

function resolveRulePatterns(rule, index, sidecars, proofs) {
  if (rule.required_proof !== undefined) return resolveRequiredProof(rule, index, proofs);
  return { bundle: resolveSidecarPatterns(rule, index, sidecars), proof: null, clauses: rule.clauses };
}

function resolveSidecarPatterns(rule, index, sidecars) {
  const field = `enforcement.rules[${index}]`;
  const reference = { rule_id: rule.rule_id, path: rule.patterns.path };
  if (!isRecord(sidecars) || !Object.hasOwn(sidecars, rule.patterns.path)) refuse(
    "decision_pattern_sidecar_absent", `rule ${rule.rule_id} references a sidecar that was not supplied`,
    { ...reference, field: `${field}.patterns.path` });
  const bundle = sidecars[rule.patterns.path];
  const actual = isRecord(bundle) ? controlledContractContentDigest(bundle) : null;
  if (actual !== rule.patterns.content_digest) refuse("decision_pattern_sidecar_digest_mismatch",
    `the sidecar of rule ${rule.rule_id} is not the content the decision pins`,
    { ...reference, field: `${field}.patterns.content_digest`, expected: rule.patterns.content_digest, actual });
  if (!validateProfileSchemaV1(bundle)) refuse("decision_pattern_sidecar_invalid",
    `the sidecar of rule ${rule.rule_id} is not a schema-valid pattern bundle`, { ...reference,
      schema_errors: (validateProfileSchemaV1.errors ?? []).slice(0, 8).map((error) =>
        ({ pointer: error.instancePath, keyword: error.keyword, message: error.message })) });
  const semantic = validateProfileSemanticsV1(bundle);
  if (semantic.length > 0) refuse("decision_pattern_sidecar_invalid",
    `the sidecar of rule ${rule.rule_id} is not a semantically valid pattern bundle`,
    { ...reference, diagnostics: semantic.map((diagnostic) => diagnostic.code) });
  const patternIds = PATTERN_FAMILIES.flatMap((family) => (bundle[family] ?? []).map((pattern) => pattern.pattern_id));
  const unknown = Object.keys(rule.clauses).filter((id) => !patternIds.includes(id)).sort();
  if (unknown.length > 0) refuse("decision_pattern_attribution_unknown",
    `rule ${rule.rule_id} attributes clauses to a pattern its sidecar does not define`,
    { ...reference, field: `${field}.clauses.${unknown[0]}`, unknown_pattern_ids: unknown });
  const unattributed = patternIds.filter((id) => !Object.hasOwn(rule.clauses, id)).sort();
  if (unattributed.length > 0) refuse("decision_pattern_attribution_missing",
    `rule ${rule.rule_id} leaves a sidecar pattern without a decision clause`,
    { ...reference, field: `${field}.clauses`, unattributed_pattern_ids: unattributed });
  const claimIds = bundle.claim_patterns.map((pattern) => pattern.pattern_id);
  const invalid = rule.obligation_pattern_ids.filter((id) => !claimIds.includes(id)).sort();
  if (invalid.length > 0) refuse("decision_pattern_obligation_target_invalid",
    `rule ${rule.rule_id} requires an obligation of something that is not a claim pattern of its sidecar`,
    { ...reference, field: `${field}.obligation_pattern_ids`, invalid_pattern_ids: invalid });
  return bundle;
}

function readPolicy(decision) {
  const code = "decision_policy_invalid";
  const policy = decision.enforcement.policy;
  if (policy === undefined) return null;
  closed(policy, POLICY_FIELDS, code, "enforcement.policy");
  if (policy.schema_version !== POLICY_SCHEMA_VERSION) refuse(code,
    `enforcement.policy.schema_version is not ${POLICY_SCHEMA_VERSION}`, { field: "enforcement.policy.schema_version" });
  if (!isRecord(policy.system) || !text(policy.system.id)) refuse(code, "enforcement.policy.system.id must be a nonempty string",
    { field: "enforcement.policy.system.id" });
  const prefix = `${policy.system.id}.`;
  const termOf = (reference, field) => {
    const identity = reference?.declare?.identity;
    if (!isRecord(identity) || !text(identity.term) || !identity.term.startsWith(prefix)) refuse(code,
      `${field} must declare a referent of the ${policy.system.id} system`, { field });
    return identity.term.slice(prefix.length);
  };
  const statement = (entry, fields, field) => {
    closed(entry, fields, code, field);
    for (const key of fields.filter((name) => name !== "requirement")) if (!text(entry[key])) refuse(code,
      `${field}.${key} must be a nonempty string`, { field: `${field}.${key}` });
    const requirement = entry.requirement;
    if (!isRecord(requirement) || !isRecord(requirement.behavior) || !Array.isArray(requirement.behavior.objects) ||
        requirement.behavior.objects.length === 0) refuse(code, `${field}.requirement must state one controlled relation`,
      { field: `${field}.requirement` });
    return { relation: requirement.behavior.relation, subject: termOf(requirement.subject, `${field}.requirement.subject`),
      objects: requirement.behavior.objects.map((object, index) =>
        termOf(object?.referent, `${field}.requirement.behavior.objects[${index}]`)) };
  };
  if (!Array.isArray(policy.properties) || !Array.isArray(policy.structure)) refuse(code,
    "enforcement.policy.properties and enforcement.policy.structure must be arrays", { field: "enforcement.policy" });

  const categoryClause = new Map();
  for (const [index, property] of policy.properties.entries()) {
    const field = `enforcement.policy.properties[${index}]`;
    const read = statement(property, POLICY_PROPERTY_FIELDS, field);
    if (read.relation !== "reference:complete_against") refuse(code,
      `${field} must state reference:complete_against`, { field: `${field}.requirement.behavior.relation` });
    for (const category of read.objects) categoryClause.set(category, property.clause);
  }
  const memberOf = new Map();
  const target = new Map();
  for (const [index, entry] of policy.structure.entries()) {
    const field = `enforcement.policy.structure[${index}]`;
    const read = statement(entry, POLICY_STRUCTURE_FIELDS, field);
    if (read.relation === "reference:includes") {
      if (categoryClause.get(read.subject) !== entry.clause) refuse(code,
        `${field} gives members to a category the decision does not declare under that clause`,
        { field: `${field}.requirement.subject`, category: read.subject });
      for (const aspect of read.objects) {
        if (memberOf.has(aspect)) refuse(code, `${field} names an aspect that is already a member of a category`,
          { field, aspect_id: aspect });
        memberOf.set(aspect, { clause: entry.clause });
      }
    } else if (read.relation === "reference:targets") {
      if (read.objects.length !== 1 || !read.objects[0].startsWith("applies-to.") || target.has(read.subject)) refuse(code,
        `${field} must state once what one aspect is required of`, { field, aspect_id: read.subject });
      target.set(read.subject, { applies_to: read.objects[0].slice("applies-to.".length), requires: entry.text,
        clause: entry.clause });
    } else refuse(code, `${field} must state reference:includes or reference:targets`,
      { field: `${field}.requirement.behavior.relation` });
  }

  const loose = [...new Set([...memberOf.keys(), ...target.keys()])].filter((aspect) =>
    memberOf.get(aspect)?.clause !== target.get(aspect)?.clause).sort(compare);
  if (loose.length > 0 || memberOf.size === 0) refuse(code,
    "every aspect is a member of one category and states once what it is required of, under one clause",
    { field: "enforcement.policy.structure", aspect_ids: loose });
  return [...memberOf.keys()].map((aspect) => ({ aspect_id: aspect, clause: target.get(aspect).clause,
    requires: target.get(aspect).requires, applies_to: target.get(aspect).applies_to }));
}

function policyCoverage(aspects, entries, rules, bundles, decisionId) {
  const code = "policy_coverage_invalid";
  const patternsOf = new Map(entries.map((entry) => [entry.input_id, new Set(rules.flatMap((rule, index) =>
    rule.applies_to.inventory_kind !== entry.kind ? [] : bundles[index].claim_patterns.map((pattern) => pattern.pattern_id)))]));
  const interfaces = [];
  const cells = [];
  const unresolved = [];
  for (const [position, entry] of entries.entries()) {

    if (entry.part_of !== undefined) continue;
    const at = `inventory.entries[${position}]`;
    const input = { input_id: entry.input_id, interface: entry.interface };
    const facts = entry.facts ?? [];
    if (!Array.isArray(facts)) refuse(code, `${at}.facts must be an array`, { field: `${at}.facts` });
    const factById = new Map();
    for (const [index, fact] of facts.entries()) {
      closed(fact, FACT_FIELDS, code, `${at}.facts[${index}]`);
      for (const key of FACT_FIELDS) if (!text(fact[key])) refuse(code,
        `${at}.facts[${index}].${key} must be a nonempty string`, { field: `${at}.facts[${index}].${key}` });
      if (factById.has(fact.fact_id)) refuse(code, `${at}.facts[${index}].fact_id repeats a fact`,
        { field: `${at}.facts[${index}].fact_id` });
      factById.set(fact.fact_id, fact);
    }

    const consumers = entry.boundary?.independent_consumers;
    const classification = Array.isArray(consumers) && consumers.length > 0 ? "shared"
      : Array.isArray(consumers) && text(entry.boundary.private_reason) ? "private" : "unclassified";
    interfaces.push({ ...input, boundary_classification: classification });
    if (classification === "unclassified") unresolved.push({ input, requirement_id: "policy:boundary-classification",
      statement: "whether independently implemented consumers rely on this boundary",
      reason: "unclassified: the boundary facts name no independent consumer and give no reason it is private",
      required_by: { decision_id: decisionId, clauses: ["1", "4"] } });

    if (classification === "private") continue;
    const coverage = entry.coverage ?? [];
    if (!Array.isArray(coverage)) refuse(code, `${at}.coverage must be an array`, { field: `${at}.coverage` });
    const classified = new Map();
    for (const [index, item] of coverage.entries()) {
      const field = `${at}.coverage[${index}]`;
      closed(item, COVERAGE_FIELDS, code, field);
      const aspect = aspects.find((candidate) => candidate.aspect_id === item.aspect_id);
      if (aspect === undefined) refuse(code, `${field}.aspect_id names no aspect of the decision's policy`,
        { field: `${field}.aspect_id`, aspect_id: item.aspect_id ?? null });
      const factId = item.fact_id ?? null;
      if ((aspect.applies_to === INTERFACE_WIDE) !== (factId === null) ||
          (factId !== null && factById.get(factId)?.kind !== aspect.applies_to)) refuse(code,
        `${field}.fact_id must name a supplied ${aspect.applies_to} fact, or be absent for an interface-wide aspect`,
        { field: `${field}.fact_id`, aspect_id: aspect.aspect_id, fact_id: factId });
      const key = `${aspect.aspect_id}\u0000${factId ?? ""}`;
      if (classified.has(key)) refuse(code, `${field} classifies a cell twice`, { field, aspect_id: aspect.aspect_id, fact_id: factId });
      if ([item.stated_by, item.not_applicable, item.unresolved_as].filter((value) => value !== undefined).length !== 1) {
        refuse(code, `${field} states exactly one of stated_by, not_applicable and unresolved_as`, { field });
      }
      if (item.unresolved_as !== undefined && !(entry.unresolved_requirements ?? []).some((known) =>
        known.requirement_id === item.unresolved_as)) refuse(code,
        `${field}.unresolved_as names no unresolved requirement of this entry`,
        { field: `${field}.unresolved_as`, requirement_id: item.unresolved_as });
      if (item.stated_by !== undefined) {
        if (!Array.isArray(item.stated_by) || item.stated_by.length === 0) refuse(code,
          `${field}.stated_by must name at least one pattern`, { field: `${field}.stated_by` });
        for (const reference of item.stated_by) {
          if (!isRecord(reference) || !patternsOf.get(reference.input_id)?.has(reference.pattern_id)) refuse(code,
            `${field}.stated_by names a claim pattern no rule requires of that input`,
            { field: `${field}.stated_by`, input_id: reference?.input_id ?? null, pattern_id: reference?.pattern_id ?? null });
        }
      } else if (item.not_applicable !== undefined && !isRecord(item.not_applicable)) refuse(code,
        `${field}.not_applicable must be an object`, { field: `${field}.not_applicable` });
      classified.set(key, item);
    }
    const required = aspects.flatMap((aspect) => aspect.applies_to === INTERFACE_WIDE ? [{ aspect, fact: null }]
      : (() => {
        const ofKind = facts.filter((fact) => fact.kind === aspect.applies_to);

        return ofKind.length === 0 ? [{ aspect, fact: null, unsupplied: true }] : ofKind.map((fact) => ({ aspect, fact }));
      })());
    for (const { aspect, fact, unsupplied = false } of required) {
      const item = classified.get(`${aspect.aspect_id}\u0000${fact?.fact_id ?? ""}`);
      const base = { input, aspect_id: aspect.aspect_id, clause: aspect.clause, requires: aspect.requires,
        fact_id: fact?.fact_id ?? null };
      const excluded = item?.not_applicable;
      if (!unsupplied && item?.stated_by !== undefined) {
        cells.push({ ...base, status: "stated", stated_by: structuredClone(item.stated_by) });
        continue;
      }
      if (!unsupplied && excluded !== undefined && text(excluded.reason) && text(excluded.source)) {
        cells.push({ ...base, status: "not_applicable", reason: excluded.reason, source: excluded.source });
        continue;
      }

      if (!unsupplied && item?.unresolved_as !== undefined) {
        cells.push({ ...base, status: "unresolved", unresolved_as: item.unresolved_as });
        continue;
      }
      const reason = unsupplied ? `unclassified: no ${aspect.applies_to} fact was supplied for this interface`
        : excluded !== undefined ? "nonapplicability_unsupported: an exclusion needs a reason and the source that shows it"
          : "unclassified: no rule pattern states it and no reason excludes it";
      cells.push({ ...base, status: "unresolved", reason });
      unresolved.push({ input, requirement_id: `policy:${aspect.aspect_id}${fact === null ? "" : `:${fact.fact_id}`}`,
        statement: `${aspect.requires}${fact === null ? "" : `, for ${fact.statement}`}`, reason,
        required_by: { decision_id: decisionId, clauses: [aspect.clause] } });
    }
  }
  return { interfaces, cells, unresolved };
}

export function requiredPoliciesFromDecision({ decision, sidecars, proofs = {}, inventory, scope, decisionUse = null }) {
  const rules = readRules(decision, decisionUse);
  const resolved = rules.map((rule, index) => resolveRulePatterns(rule, index, sidecars, proofs));
  const bundles = resolved.map((entry) => entry.bundle);
  const entries = readInventory(inventory);
  const aspects = readPolicy(decision);
  const coverage = aspects === null ? null : policyCoverage(aspects, entries, rules, bundles, decision.id);
  if (!isRecord(scope) || !text(scope.unit) || !(scope.focus === null || text(scope.focus))) refuse(
    "policy_scope_invalid", "scope states the exact unit and focus the instances apply to", { field: "scope" });
  const decisionDigest = contentIdentity(decision);
  const policies = [];
  const recommendations = [];
  const ruleFacts = rules.map((rule, index) => {
    const bundle = bundles[index];
    const { proof, clauses } = resolved[index];
    const applicable = entries.filter((entry) => entry.kind === rule.applies_to.inventory_kind);
    const roles = bundle.reference_roles.map(({ role }) => role);
    for (const entry of applicable) {

      let bindings;
      if (proof === null) {
        const unknown = Object.keys(entry.bindings).filter((role) => !roles.includes(role)).sort();
        if (unknown.length > 0) refuse("policy_inventory_binding_role_unknown",
          `inventory entry ${entry.input_id} binds a role rule ${rule.rule_id} does not define`, {
            input_id: entry.input_id, rule_id: rule.rule_id, unknown_roles: unknown, accepted_roles: roles });
        bindings = Object.fromEntries(roles.map((role) => [role, structuredClone(entry.bindings[role] ?? null)]));
      } else {
        const byParameter = Object.fromEntries([...proof.rolesOf.keys()].map((name) => {
          const binding = rule.required_proof.parameters[name];
          return [name, binding === undefined ? null : Object.hasOwn(binding, "value") ? structuredClone(binding.value)
            : structuredClone(entry.bindings[binding.key] ?? null)];
        }));
        bindings = Object.fromEntries(roles.map((role) => [role, null]));
        for (const [name, value] of Object.entries(byParameter)) for (const role of proof.rolesOf.get(name)) bindings[role] = value;
        recommendations.push({ policy_id: `${decision.id}/${rule.rule_id}/${entry.input_id}`,
          input: { input_id: entry.input_id, interface: entry.interface }, rule_id: rule.rule_id,
          clauses: [...rule.required_by_clauses], proof: structuredClone(proof.pin), parameter_bindings: byParameter,
          unknown_parameters: Object.keys(byParameter).filter((name) => byParameter[name] === null).sort(compare) });
      }
      policies.push({
        schema_version: REQUIRED_POLICY_SCHEMA_VERSION,
        policy_id: `${decision.id}/${rule.rule_id}/${entry.input_id}`,
        status: decision.status ?? null,

        provenance: { decision_id: decision.id, rule_id: rule.rule_id, clauses: structuredClone(clauses),
          ...(proof === null ? {} : { proof: structuredClone(proof.pin) }),
          input: { input_id: entry.input_id, interface: entry.interface, kind: entry.kind } },
        scope: { unit: scope.unit, focus: scope.focus },
        profile: structuredClone(bundle),
        bindings,
        obligation_pattern_ids: [...rule.obligation_pattern_ids]
      });
    }
    return { rule_id: rule.rule_id, inventory_kind: rule.applies_to.inventory_kind,
      ...(proof === null ? { patterns: { path: rule.patterns.path, content_digest: rule.patterns.content_digest,
        profile_id: bundle.profile_id ?? null } } : { required_proof: structuredClone(proof.pin) }),
      clauses: [...new Set(Object.values(clauses).flat())].sort(compare),
      input_ids: applicable.map((entry) => entry.input_id).sort(compare) };
  });
  const kinds = new Set(rules.map((rule) => rule.applies_to.inventory_kind));
  return { policies, decision: { id: decision.id, status: decision.status ?? null, use: decisionUse,
    accepted: decision.status === "accepted", content_digest: decisionDigest },
  rules: ruleFacts.sort((left, right) => compare(left.rule_id, right.rule_id)),
  proof_recommendations: recommendations,
  inventory: { content_digest: contentIdentity(inventory),
    entries_without_rule: entries.filter((entry) => !kinds.has(entry.kind))
      .map((entry) => entry.input_id).sort(compare) },
  boundaries: entries.filter((entry) => entry.boundary !== undefined).map((entry) => ({ input_id: entry.input_id,
    interface: entry.interface, boundary: structuredClone(entry.boundary) }))
    .sort((left, right) => compare(left.input_id, right.input_id)),

  policy_coverage: coverage === null ? null : { aspects: aspects.length, interfaces: coverage.interfaces,
    cells: coverage.cells },

  unresolved_requirements: [...entries.flatMap((entry) => (entry.unresolved_requirements ?? []).map((item) => ({
    input: { input_id: entry.input_id, interface: entry.interface }, requirement_id: item.requirement_id,
    statement: item.statement, reason: item.reason,
    required_by: { decision_id: decision.id, clauses: [...item.clauses] } }))), ...(coverage?.unresolved ?? [])]
    .sort((left, right) => compare(`${left.input.input_id}/${left.requirement_id}`,
      `${right.input.input_id}/${right.requirement_id}`)) };
}

function expectedMeaning(policy) {
  const { profile, bindings } = policy;
  const one = (role, bound) => bound === null ? `<${role}: binding unavailable>`
    : `${bound.type_term} "${Object.entries(bound.identity)
      .filter(([key]) => key !== "kind").map(([, value]) => typeof value === "string" ? value : JSON.stringify(value))
      .join(" ")}"`;

  const members = (role) => [...new Set(bindings[role].map((member) => one(role, member)))].sort(compare);
  const referent = (role) => {
    const bound = bindings[role] ?? null;
    if (!Array.isArray(bound)) return one(role, bound);
    return bound.length === 0 ? "no members" : members(role).join(", ");
  };
  const operand = (value) => value.kind === "reference" ? referent(value.role)
    : value.kind === "range" ? `[${value.minimum ?? "-inf"}, ${value.maximum ?? "+inf"}]`
      : value.value_role !== undefined ? `<${value.kind} ${value.value_role}>` : String(value.value);
  const statement = (template) => [referent(template.subject_role), template.operator,
    template.operands.map(operand).join(", "),
    ...(template.applicability_context.mode === "unconditional" ? []
      : [template.applicability_context.mode, template.applicability_context.operand_roles.map(referent).join(", ")])
  ].join(" ");
  const claims = new Map(profile.claim_patterns.map((pattern) => [pattern.pattern_id,
    `${pattern.claim_kind} claim (${pattern.allowed_modalities.join(" or ")}): ${statement(pattern.proposition_template)}` +
    (pattern.falsifying_proposition_template === undefined ? ""
      : `; falsified when ${statement(pattern.falsifying_proposition_template)}`)]));
  const claim = (id) => `[${claims.get(id) ?? `claim pattern ${id}`}]`;
  const relations = new Map(profile.relation_patterns.map((pattern) => [pattern.pattern_id,
    `${pattern.role} relationship from ${claim(pattern.source_claim_pattern_id)} to ${claim(pattern.target_claim_pattern_id)}`]));
  const collections = new Map((profile.collection_patterns ?? []).map((pattern) => [pattern.pattern_id,
    `${pattern.collection_kind} collection${pattern.collection_purpose === undefined ? ""
      : ` "${pattern.collection_purpose}"`} of ${pattern.member_claim_pattern_ids.map(claim).join(" and ")}`]));

  const setOf = (role) => Array.isArray(bindings[role]) ? `{${referent(role)}}` : referent(role);
  const scope = (pattern) => (pattern.applicability_context?.mode ?? "unconditional") === "unconditional" ? ""
    : ` ${pattern.applicability_context.mode} ${pattern.applicability_context.operand_roles.map(referent).join(", ")}`;
  const comparisons = { complete_population: ([population, member]) =>
    `closed population ${referent(population)} whose declared members are exactly ${setOf(member)}`,
  same_reference: ([left, right]) => `${referent(left)} and ${referent(right)} denoting the same referent`,
  distinct_references: ([left, right]) => `${referent(left)} and ${referent(right)} denoting distinct referents` };
  const referenceBindings = new Map((profile.reference_binding_patterns ?? []).map((pattern) => [pattern.pattern_id,
    `${comparisons[pattern.comparison](pattern.roles)}${scope(pattern)}`]));
  const count = (pattern) => pattern.minimum !== undefined && pattern.minimum === pattern.maximum
    ? `exactly ${pattern.minimum}` : [pattern.minimum === undefined ? null : `at least ${pattern.minimum}`,
      pattern.maximum === undefined ? null : `at most ${pattern.maximum}`,
      pattern.binding_presence === undefined ? null : `binding ${pattern.binding_presence}`].filter(Boolean).join(" and ");
  const bindingConstraints = new Map((profile.binding_constraint_patterns ?? []).map((pattern) => [pattern.pattern_id,
    `${count(pattern)} declared referent(s) for ${pattern.role}: ${pattern.role_kind === "reference"
      ? setOf(pattern.role) : `<number ${pattern.role}>`}`]));
  return { pattern: (row) => claims.get(row.pattern_id) ?? relations.get(row.pattern_id) ??
    collections.get(row.pattern_id) ?? referenceBindings.get(row.pattern_id) ??
    bindingConstraints.get(row.pattern_id) ?? `${row.pattern_kind} pattern ${row.pattern_id}`,
  obligation: (row) => `same-subject obligation naming ${claim(row.pattern_id)}` };
}

const LEAD = Object.freeze({
  missing: (what) => `Your contract is missing ${what}`,
  affected: (what, row) => `Your contract declares ${what}, but it is not valid support (` +
    `${row.structural_diagnostics.join(", ")})`,
  unresolved: (what, row) => `It could not be determined whether your contract has ${what} (` +
    `${row.reasons.join(", ")})` });

export function compareContractToDecision({ decision, sidecars, proofs = {}, inventory, subject, contract, obligations,
  selection = { scope: "whole_unit" }, decisionUse = null }) {
  const derived = requiredPoliciesFromDecision({ decision, sidecars, proofs, inventory, decisionUse,
    scope: { unit: subject?.unit, focus: subject?.focus ?? null } });
  const assessment = assessRequiredPolicies({ policies: derived.policies, subject, contract, obligations,
    selection });
  const policyById = new Map(derived.policies.map((policy) => [policy.policy_id, policy]));
  const attribution = derived.decision.accepted ? decision.id
    : `${decision.id} (${derived.decision.status ?? "no status"}, not accepted policy)`;
  const totals = { definitions: {}, obligations: {} };
  const findings = [];

  const populationEqualities = [];
  const inputs = assessment.policies.map((entry) => {
    const { input, rule_id: ruleId, clauses } = entry.provenance;
    const expected = expectedMeaning(policyById.get(entry.policy_id));
    for (const [family, counts] of [["definitions", entry.counts.expectations],
      ["obligations", entry.counts.obligations]]) {
      for (const [key, count] of Object.entries(counts)) totals[family][key] = (totals[family][key] ?? 0) + count;
    }

    const report = (row, kind, what, through = null) => {
      if (row.status === "supported") return;
      const own = clauses[row.pattern_id];
      findings.push({ status: row.status, kind, what, input: { input_id: input.input_id,
        interface: input.interface }, unit: subject.unit, focus: subject.focus ?? null,
      required_by: { decision_id: decision.id, rule_id: ruleId, clauses: own,
        ...(entry.provenance.proof === undefined ? {} : { proof: structuredClone(entry.provenance.proof) }),
        ...(through === null ? {} : { through_claim_pattern_id: through }) },
      reasons: row.reasons, structural_diagnostics: row.structural_diagnostics ?? [],
      pattern_id: row.pattern_id,
      message: `${LEAD[row.status](what, row)} for ${input.interface} (${subject.unit}` +
          `${subject.focus === null || subject.focus === undefined ? "" : `, focus ${subject.focus}`}), required by ` +
          `${attribution} clause ${own.join(", ")}, rule ${ruleId}.` });
    };
    for (const row of entry.expectations) {
      report(row, row.pattern_kind, expected.pattern(row));
      if ((row.population_sources?.equated_reference_ids ?? []).length > 0) populationEqualities.push({
        input: { input_id: input.input_id, interface: input.interface }, pattern_id: row.pattern_id,
        status: row.status, what: expected.pattern(row), ...structuredClone(row.population_sources),
        required_by: { decision_id: decision.id, rule_id: ruleId, clauses: clauses[row.pattern_id] } });
    }
    for (const row of entry.obligation_support) report(row, "obligation", expected.obligation(row), row.pattern_id);
    return { input_id: input.input_id, interface: input.interface, rule_id: ruleId,
      assessed: entry.status === "assessed", not_assessed_reason: entry.reason,
      complete: entry.definition_coverage_complete };
  });

  const supportOf = new Map(assessment.policies.flatMap((entry) => [...entry.expectations, ...entry.obligation_support]
    .map((row) => [`${entry.provenance.input.input_id}\u0000${row.pattern_id}\u0000${Object.hasOwn(row, "join")}`, row.status])));
  const supported = (reference) => [false, true].every((obligation) => {
    const status = supportOf.get(`${reference.input_id}\u0000${reference.pattern_id}\u0000${obligation}`);
    return status === undefined ? !obligation : status === "supported";
  });
  const policyCoverageResult = derived.policy_coverage === null ? null : { ...derived.policy_coverage,
    cells: derived.policy_coverage.cells.map((cell) => cell.status !== "stated" ? cell
      : { ...cell, support: cell.stated_by.every(supported) ? "supported" : "not_supported" }) };
  const assessed = assessment.policies.find((entry) => entry.authored_contract !== null) ?? null;
  return { schema_version: OUTPUT_SCHEMA_VERSION, scope_note: SCOPE_NOTE,

    status: assessment.whole_unit_definition_coverage.complete !== true ? "incomplete"
      : derived.unresolved_requirements.length > 0 ? "unresolved_requirements_remain" : "complete",
    decision: derived.decision, subject: structuredClone(subject), rules: derived.rules,
    inventory: derived.inventory, boundaries: derived.boundaries, policy_coverage: policyCoverageResult,
    unresolved_requirements: derived.unresolved_requirements, inputs, totals,

    proof_recommendations: derived.proof_recommendations.map(({ policy_id: policyId, ...recommendation }) => {
      const mine = findings.filter((finding) => finding.input.input_id === recommendation.input.input_id &&
        finding.required_by.rule_id === recommendation.rule_id);
      const of = (status) => mine.filter((finding) => finding.status === status).map((finding) =>
        ({ kind: finding.kind, pattern_id: finding.pattern_id, what: finding.what, reasons: finding.reasons }));
      return { ...recommendation, decision_id: decision.id, decision_status: derived.decision.status,
        required_structure: assessment.policies.find((entry) => entry.policy_id === policyId).counts,
        missing: of("missing"), not_valid_support: of("affected"), unresolved: of("unresolved"),

        fit: recommendation.unknown_parameters.length === 0 ? "all_parameters_bound" : "partial",
        action: recommendation.unknown_parameters.length > 0
          ? `Partial fit, not a complete repair: ${recommendation.unknown_parameters.length} of ` +
            `${Object.keys(recommendation.parameter_bindings).length} parameters of ${recommendation.proof.proof_name}@${
              recommendation.proof.proof_version} have no binding in the decision data. The missing items are authored ` +
            "support for the bound part only. The unresolved items are prerequisites of the proof that the decision data " +
            "does not establish for this input; do not author interface facts to satisfy them."
          : mine.length === 0 ? "none: the proof's required structure is authored for this input"
            : `Author the missing structure for ${recommendation.proof.proof_name}@${recommendation.proof.proof_version} ` +
              "with the bindings above.",
        note: PROOF_NOTE };
    }),
    authored_contract: assessed === null ? null : structuredClone(assessed.authored_contract),
    population_equalities: populationEqualities, findings };
}

const HELP = `Usage:
  node packages/wiki-cli/scripts/required-policy-decision-prototype.mjs \\
    --decision <decision.json> --inventory <inventory.json> --input <input.json> [--draft-experiment] [--json]

Prototype only. Says what a directly supplied authored contract is missing that
a decision's executable rules require of each inventoried input.
  --decision          Decision JSON carrying ${DECISION_PATTERN_ENFORCEMENT_VERSION} enforcement;
                      each rule's pattern sidecar is read from beside this file
  --inventory         ${POLICY_INVENTORY_VERSION} JSON: the supplied inputs and their bindings
  --input             { "unit", "focus", "contract": <native contract or null>, "obligations": [...] }
  --draft-experiment  Required to read a decision that is not accepted
  --json              Print the comparison result as JSON instead of text
Exit: 0 complete, 1 incomplete or unresolved requirements remain, 2 refused.
${SCOPE_NOTE}
`;

async function readJson(file, role) {
  try {
    return JSON.parse(await readFile(path.resolve(file), "utf8"));
  } catch (error) {
    return refuse("input_unreadable", `--${role} ${file} is not readable JSON: ${error.message}`, { role });
  }
}

export async function loadDecisionProofDefinitions({ decision }) {
  const proofs = {};
  const rules = Array.isArray(decision?.enforcement?.rules) ? decision.enforcement.rules : [];
  for (const rule of rules) {
    if (!isRecord(rule?.required_proof) || !text(rule.rule_id)) continue;
    const pin = Object.fromEntries(PROOF_PIN_FIELDS.map((key) => [key, rule.required_proof[key]]));
    try {
      proofs[rule.rule_id] = await loadPinnedProofSelection(pin);
    } catch (error) {
      refuse(error?.code ?? "decision_required_proof_unresolved",
        `rule ${rule.rule_id} requires a proof the definition owner refuses: ${error?.message ?? String(error)}`,
        { ...(isRecord(error?.details) ? error.details : {}), rule_id: rule.rule_id, proof: pin,
          repair: "Pin the required proof to its exact admitted definition." });
    }
  }
  return proofs;
}

export async function loadDecisionPatternSidecars({ decision, decisionPath }) {
  const sidecars = {};
  const rules = Array.isArray(decision?.enforcement?.rules) ? decision.enforcement.rules : [];
  for (const location of new Set(rules.map((rule) => rule?.patterns?.path).filter(text))) {
    if (path.isAbsolute(location) || location.split(/[\\/]/u).includes("..")) continue;
    let bytes;
    try {
      bytes = await readFile(path.resolve(path.dirname(decisionPath), location), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      refuse("decision_pattern_sidecar_unreadable", `sidecar ${location} could not be read: ${error.message}`,
        { path: location });
    }
    try {
      sidecars[location] = JSON.parse(bytes);
    } catch (error) {
      refuse("decision_pattern_sidecar_unreadable", `sidecar ${location} is not JSON: ${error.message}`,
        { path: location });
    }
  }
  return sidecars;
}

function render(result) {
  const { definitions, obligations } = result.totals;
  const structural = result.authored_contract?.structural_diagnostics ?? [];
  return [
    `${result.decision.id} (${result.decision.status ?? "no status"}${result.decision.accepted ? "" : "; draft experiment, not accepted policy"}) ` +
      `against ${result.subject.unit}${result.subject.focus === null ? "" : `, focus ${result.subject.focus}`}: ${result.status}`,
    ...result.inputs.map((input) => `  ${input.interface} [${input.input_id}]: ${input.complete ? "complete"
      : input.assessed ? "incomplete" : `not assessed (${input.not_assessed_reason})`}`),
    ...result.inventory.entries_without_rule.map((id) => `  ${id}: no rule of this decision applies`),
    `  required definitions ${definitions.required ?? 0}: supported ${definitions.supported ?? 0}, missing ` +
      `${definitions.missing ?? 0}, affected ${definitions.affected ?? 0}, unresolved ${definitions.unresolved ?? 0}`,
    `  required obligations ${obligations.required ?? 0}: supported ${obligations.supported ?? 0}, missing ` +
      `${obligations.missing ?? 0}, unresolved ${obligations.unresolved ?? 0}`,
    ...(result.authored_contract === null ? [] : [`  authored contract graph: ${
      result.authored_contract.structurally_valid ? "valid" : `invalid (${[...new Set(structural.map(({ code }) => code))].join(", ")})`}`]),
    ...result.population_equalities.map((entry) => `  note: ${entry.what} for ${entry.input.interface} is read ` +
      `through reference equality with ${entry.equated_reference_ids.join(", ")} (${entry.status})`),
    ...result.proof_recommendations.map((item) => `  proof ${item.proof.proof_name}@${item.proof.proof_version} ` +
      `(${item.fit === "partial" ? "partial fit" : "all parameters bound"}) required by ` +
      `${item.decision_id} clause ${item.clauses.join(", ")} for ${item.input.interface}: ${item.missing.length} missing, ` +
      `${item.not_valid_support.length} not valid support, ${item.unresolved.length} unresolved` +
      `${item.unknown_parameters.length === 0 ? "" : `; unknown bindings: ${item.unknown_parameters.join(", ")}`}`),
    ...result.findings.map((finding) => `- ${finding.message}`),
    ...result.unresolved_requirements.map((item) => `- Unresolved, and not assessed: ${item.statement} for ` +
      `${item.input.interface} (${item.reason}), required by ${result.decision.id} clause ${item.required_by.clauses.join(", ")}.`),
    result.scope_note
  ].join("\n");
}

async function run(argv) {
  const { values } = parseArgs({ args: argv, strict: true, options: { decision: { type: "string" },
    inventory: { type: "string" }, input: { type: "string" }, "draft-experiment": { type: "boolean" },
    json: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) return { help: true };
  for (const role of ["decision", "inventory", "input"]) if (!text(values[role])) refuse("usage_invalid",
    `--${role} is required`, { role });
  const input = await readJson(values.input, "input");
  if (!isRecord(input) || !text(input.unit) || !Array.isArray(input.obligations)) refuse("input_invalid",
    "--input must carry unit, focus, contract and obligations", { field: "input" });
  const [wkId, selectedUnit = null] = input.unit.split("#");
  const decision = await readJson(values.decision, "decision");
  return compareContractToDecision({ decision,
    sidecars: await loadDecisionPatternSidecars({ decision, decisionPath: path.resolve(values.decision) }),
    proofs: await loadDecisionProofDefinitions({ decision }),
    inventory: await readJson(values.inventory, "inventory"),
    subject: { unit: input.unit, wk_id: wkId, selected_unit: selectedUnit, focus: input.focus ?? null },
    contract: input.contract ?? null, obligations: input.obligations,
    decisionUse: values["draft-experiment"] ? DRAFT_EXPERIMENT_USE : null });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    result = await run(process.argv.slice(2));
  } catch (error) {
    result = { schema_version: OUTPUT_SCHEMA_VERSION, status: "refused",
      error: { code: error?.code ?? "prototype_failed", message: error?.message ?? String(error),
        details: error?.details ?? null } };
  }
  if (result.help) process.stdout.write(HELP);
  else {
    process.exitCode = result.status === "complete" ? EXIT.complete
      : ["incomplete", "unresolved_requirements_remain"].includes(result.status) ? EXIT.gaps : EXIT.refused;
    process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(result, null, 2)}\n`
      : result.status === "refused" ? `refused: ${result.error.code}: ${result.error.message}\n`
        : `${render(result)}\n`);
  }
}
