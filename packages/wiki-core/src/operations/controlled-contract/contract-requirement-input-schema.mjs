

import { buildStableTestProofBindingTemplate, VERIFICATION_BUNDLE_VOCABULARY } from
  "@agent-chassis/controlled-contract";

import {
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE
} from "../../lib/controlled-contract-tools.mjs";
import {
  buildControlledContractRuntimeTestTemplate,
  projectControlledContractRuntimeTestAuthoring
} from "./contract-requirement-runtime-proof.mjs";
import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS } from "./contract-requirement-vocabulary.mjs";

const UPSERT_TOOL_NAME = "workspace_controlled_contract_obligation_coverage_upsert";

function drift(message) {
  throw new Error(`controlled-contract requirement input declaration: ${message}`);
}

const enumOf = (values) => ({ type: "string", enum: [...values] });
const constOf = (value) => ({ type: "string", const: value });
const anyOf = (branches) => branches.length === 1 ? branches[0] : { anyOf: branches };
const objectWith = (node, properties, required = node.required ?? []) => ({
  ...node, properties: { ...node.properties, ...properties }, required: [...required]
});
const without = (node, key) => ({ ...node,
  properties: Object.fromEntries(Object.entries(node.properties).filter(([name]) => name !== key)),
  required: (node.required ?? []).filter((name) => name !== key) });

function declaredReferent(referent, vocabulary) {
  const select = referent.oneOf.find((branch) => branch.required.includes("select"));
  const declare = referent.oneOf.find((branch) => branch.required.includes("declare"));
  if (select === undefined || declare === undefined) drift("referent has no select/declare branches");
  const structuralIdentities = declare.properties.declare.properties.identity.oneOf;
  const identity = { oneOf: vocabulary.identity_kinds.map(({ kind, required_fields: required,
    optional_fields: optional }) => {
    const branch = structuralIdentities.find((candidate) => {
      const fields = candidate.required.filter((field) => field !== "kind");
      return fields.length === required.length && required.every((field) => fields.includes(field)) &&
        optional.every((field) => Object.hasOwn(candidate.properties, field));
    });
    if (branch === undefined) drift(`identity kind ${kind} has no structural identity shape`);
    return { type: "object", additionalProperties: false, required: ["kind", ...required],
      properties: { kind: constOf(kind), ...Object.fromEntries([...required, ...optional]
        .map((field) => [field, branch.properties[field]])) } };
  }) };
  return { oneOf: [select, objectWith(declare, { declare: objectWith(declare.properties.declare, {
    type_term: enumOf(vocabulary.type_terms), identity }) })] };
}

function declaredStatement(statement, referent, structuralReferent, vocabulary) {
  const applies = statement.properties.applies;
  const context = applies.properties.context;
  const modesByContext = new Map();
  for (const mode of vocabulary.applicability_modes) {
    const key = `${mode.minimum_context}:${mode.maximum_context}`;
    modesByContext.set(key, [...(modesByContext.get(key) ?? []), mode]);
  }
  const contextFree = vocabulary.applicability_modes
    .filter(({ maximum_context: maximum }) => maximum === 0).map(({ mode }) => mode);
  const appliesFor = (admitted) => anyOf([...modesByContext.values()]
    .map((modes) => modes.filter(({ mode }) => admitted.includes(mode)))
    .filter((modes) => modes.length > 0)
    .map((modes) => {
      const { minimum_context: minimum, maximum_context: maximum } = modes[0];
      return objectWith(applies, {
        mode: enumOf(modes.map(({ mode }) => mode)),
        context: { ...context, items: referent, ...(minimum > 0 ? { minItems: minimum } : {}),
          maxItems: maximum === null ? context.maxItems : Math.min(maximum, context.maxItems) }
      }, minimum > 0 ? ["mode", "context"] : ["mode"]);
    }));
  const objects = statement.properties.objects.items.oneOf;
  const objectFor = (kind) => {
    if (kind === "reference") {
      const branch = objects.find((candidate) => candidate.properties.referent === structuralReferent);
      if (branch === undefined) drift("reference operands have no referent object shape");
      return objectWith(branch, { referent });
    }
    const branch = objects.find((candidate) => candidate.required.includes(kind));
    if (branch === undefined) drift(`operand kind ${kind} has no object shape`);
    if (kind !== "range") return branch;
    const range = branch.properties.range;
    return anyOf(Object.keys(range.properties).map((bound) =>
      objectWith(branch, { range: objectWith(range, {}, [bound]) })));
  };

  const declaredModes = vocabulary.applicability_modes.map(({ mode }) => mode);
  const admittedModes = (detail) => detail.applicability_modes ?? declaredModes;
  const signatures = new Map();
  for (const detail of vocabulary.relation_details) {
    const key = JSON.stringify([detail.operand_kind, detail.minimum_operands, detail.maximum_operands,
      [...admittedModes(detail)].sort()]);
    signatures.set(key, { detail, terms: [...(signatures.get(key)?.terms ?? []), detail.term] });
  }
  return anyOf([...signatures.values()].map(({ detail, terms }) => ({
    ...statement,
    required: ["relation", "objects",
      ...(admittedModes(detail).some((mode) => contextFree.includes(mode)) ? [] : ["applies"])],
    properties: {
      relation: enumOf(terms),
      applies: appliesFor(admittedModes(detail)),
      objects: { ...statement.properties.objects, minItems: detail.minimum_operands,
        ...(detail.maximum_operands === null ? {} : { maxItems: detail.maximum_operands }),
        items: objectFor(detail.operand_kind) }
    }
  })));
}

function declaredRuntimeTest(runtimeTest, referent, { strategy, isDefault, answers },
  providerBoundaryKinds) {
  const required = new Set();
  const leaves = new Map([["boundary.kind", enumOf(providerBoundaryKinds)]]);
  for (const answer of answers) {
    if (answer.field === "falsifier.strategy") {
      leaves.set(answer.field, constOf(strategy));
      if (!isDefault) required.add(answer.field);
      continue;
    }
    required.add(answer.field);
    leaves.set(answer.field, answer.field === "boundary.subjects" ? null
      : Array.isArray(answer.values) && answer.values.length > 0 ? enumOf(answer.values) : null);
  }
  const project = (node, prefix) => {
    const keys = Object.keys(node.properties).filter((key) => {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      return leaves.has(path) || [...leaves.keys()].some((field) => field.startsWith(`${path}.`));
    });
    for (const field of leaves.keys()) {
      const [head] = prefix === "" ? field.split(".") : field.slice(prefix.length + 1).split(".");
      if ((prefix === "" || field.startsWith(`${prefix}.`)) && !Object.hasOwn(node.properties, head)) {
        drift(`runtime-test field ${field} has no authoritative shape`);
      }
    }
    return { ...node,
      properties: Object.fromEntries(keys.map((key) => {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        const child = node.properties[key];
        if (path === "boundary.subjects") return [key, { ...child, items: referent }];
        if (leaves.has(path)) return [key, leaves.get(path) ?? child];
        return [key, project(child, path)];
      })),
      required: keys.filter((key) => {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        return required.has(path) || [...required].some((field) => field.startsWith(`${path}.`)) ||
          (node.required ?? []).includes(key);
      }) };
  };
  return project(runtimeTest, "");
}

export function controlledContractRuntimeTestAuthoringVariants({
  buildTemplate = buildStableTestProofBindingTemplate,
  strategies = VERIFICATION_BUNDLE_VOCABULARY.providers.falsifier_execution.falsifier_strategies,
  verificationId = "claim-requirement-input-declaration"
} = {}) {
  const build = (strategy) => buildControlledContractRuntimeTestTemplate(buildTemplate,
    { contract: null, verificationId, strategy }, "verification.runtime_test");
  const defaultStrategy = build(undefined).binding.falsifiers[0].strategy;
  return strategies.map((strategy) => {
    const template = build(strategy);
    return { strategy, isDefault: strategy === defaultStrategy, template,
      answers: projectControlledContractRuntimeTestAuthoring([template]).answers };
  });
}

export function declareControlledContractObligationCoverageUpsertInputSchema({
  inputSchema = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA,
  guidance = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE,
  runtimeTestAuthoring = controlledContractRuntimeTestAuthoringVariants()
} = {}) {
  const structural = inputSchema.properties.contract_requirements;
  const requirement = structural.properties.requirements.items;
  const verification = requirement.properties.verification;
  const vocabulary = guidance.vocabulary;
  const rules = guidance.conditional_verification_requirements;
  const mandatoryRule = rules.find(({ requires }) => requires.includes("verification"));
  const runtimeRule = rules.find(({ requires }) => requires.includes("verification.runtime_test"));
  if (mandatoryRule === undefined || runtimeRule === undefined) drift("conditional verification rules are missing");
  const rebinding = guidance.required_object_shapes.requirement_rebinding;
  const rebindField = rebinding.field.split(".").at(-1);
  if (!Object.hasOwn(requirement.properties, rebindField) ||
      !rebinding.requires.every((field) => Object.hasOwn(requirement.properties, field))) {
    drift("requirement rebinding names no authoritative field");
  }
  if (!Object.hasOwn(structural.properties, guidance.required_object_shapes.requirement_retirement.field)) {
    drift("requirement retirement names no authoritative field");
  }

  const referent = declaredReferent(requirement.properties.subject, vocabulary);
  const statement = declaredStatement(requirement.properties.behavior, referent,
    requirement.properties.subject, vocabulary);
  const runtimeTests = runtimeTestAuthoring.map((variant) => declaredRuntimeTest(
    verification.properties.runtime_test, referent, variant,
    guidance.native_runtime_test_vocabulary.provider_bound_boundary_kinds));
  const testMethod = runtimeRule.when["verification.method"];
  const verificationFields = { verifier: referent, observes: statement, fails_when: statement };

  const declaredVerification = anyOf([
    ...runtimeTests.map((runtimeTest) => objectWith(verification, { ...verificationFields,
      method: constOf(testMethod), runtime_test: runtimeTest },
    [...verification.required, "runtime_test"])),
    without(objectWith(verification, { ...verificationFields,
      method: enumOf(vocabulary.verification_methods) }),
    "runtime_test")
  ]);
  const mandatory = mandatoryRule.when.modality_in;
  const requirementFields = { subject: referent, behavior: statement, verification: declaredVerification };
  const modalityVariants = [
    [{ nature: enumOf([mandatoryRule.when.nature]), modality: enumOf(mandatory) }, ["verification"]],
    [{ nature: enumOf(vocabulary.claim_natures),
      modality: enumOf(vocabulary.modalities.filter((modality) => !mandatory.includes(modality))) }, []],
    [{ nature: enumOf(vocabulary.claim_natures.filter((nature) => nature !== mandatoryRule.when.nature)),
      modality: enumOf(mandatory) }, ["nature"]]
  ].filter(([fields]) => fields.nature.enum.length > 0 && fields.modality.enum.length > 0);
  const requirements = modalityVariants.flatMap(([fields, required]) => {
    const variant = objectWith(requirement, { ...requirementFields, ...fields },
      [...requirement.required, ...required]);
    return [without(variant, rebindField),
      objectWith(variant, {}, [...variant.required, ...rebinding.requires])];
  });
  const listItems = (name, field, values) => ({ ...structural.properties[name],
    items: objectWith(structural.properties[name].items, { [field]: enumOf(values) }) });
  const contractRequirements = objectWith(structural, {
    requirements: { ...structural.properties.requirements, items: { anyOf: requirements } },
    unrepresentable_meaning: listItems("unrepresentable_meaning", "reason", vocabulary.residue_reasons),
    notes: listItems("notes", "kind", vocabulary.note_kinds)
  });

  const typeTerm = referent.oneOf[1].properties.declare.properties.type_term;
  const obligations = inputSchema.properties.obligations;
  const caseSchema = obligations.items.properties.case;
  const component = caseSchema.properties.component;
  const sharedComponent = { ...component, oneOf: component.oneOf.map((branch) => {
    const term = branch.properties?.type_term;
    return term?.enum !== undefined && term.type === typeTerm.type &&
      JSON.stringify(term.enum) === JSON.stringify(typeTerm.enum)
      ? objectWith(branch, { type_term: typeTerm }) : branch;
  }) };
  if (!sharedComponent.oneOf.some((branch) => branch.properties?.type_term === typeTerm)) {
    drift("case component type terms differ from the declared referent type terms");
  }
  const declaredObligations = { ...obligations, items: objectWith(obligations.items, {
    case: objectWith(caseSchema, { component: sharedComponent }) }) };
  return Object.freeze({ ...inputSchema,

    description: "Supply one or more of contract_requirements (1-" +
      `${CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer} requirements + ` +
      "retire_claim_ids; notes never alone), controlled_acceptance or obligations. " +
      "expected_content_digest is the current content_digest of " +
      "workspace_controlled_contract_obligation_coverage_query, null only if it is null. " +
      `See workspace_tools_describe({tool_name:${JSON.stringify(UPSERT_TOOL_NAME)},verbose:true}).`,
    properties: { ...inputSchema.properties, contract_requirements: contractRequirements,
      obligations: declaredObligations } });
}

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_DECLARED_INPUT_SCHEMA =
  declareControlledContractObligationCoverageUpsertInputSchema();
