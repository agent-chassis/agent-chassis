import Ajv2020 from "ajv/dist/2020.js";

import {
  NATIVE_CONTRACT_SCHEMA,
  operatorsByValueKind,
  validateAndResolveNativeContract
} from "../../lib/native-contract-carrier.mjs";

const AUTHORIZATION_VERSION = "controlled-contract-prototype-authorization.experimental.v0.2";
const EVALUATION_STAGES = Object.freeze(["pre_dispatch", "post_delivery"]);
const STAGE_RANK = Object.freeze({ pre_dispatch: 0, post_delivery: 1 });
const typeTerms = NATIVE_CONTRACT_SCHEMA.$defs.reference.properties.type_term.enum;

const obligationIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
};
const roleSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]*$"
};
const claimIdSchema = {
  type: "string",
  pattern: "^claim-[a-z0-9]+(?:-[a-z0-9]+)*$"
};

const templateOperandDefinitions = {
  template_reference_operand: {
    type: "object",
    required: ["kind", "role"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["reference"] },
      role: roleSchema
    }
  },
  template_boolean_operand: {
    type: "object",
    required: ["kind", "value"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["boolean"] },
      value: { type: "boolean" }
    }
  },
  template_number_operand: {
    type: "object",
    required: ["kind", "value"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["number"] },
      value: { type: "number" }
    }
  },
  template_range_operand: {
    type: "object",
    required: ["kind"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["range"] },
      minimum: { type: "number" },
      maximum: { type: "number" }
    },
    anyOf: [
      { required: ["minimum"], properties: { minimum: { type: "number" } } },
      { required: ["maximum"], properties: { maximum: { type: "number" } } }
    ]
  }
};

const templateBranches = Object.entries(operatorsByValueKind).map(
  ([valueKind, operators]) => ({
    properties: {
      operator: { type: "string", enum: operators },
      operands: {
        type: "array",
        minItems: 1,
        ...(valueKind === "range" ? { maxItems: 1 } : {}),
        items: { $ref: `#/$defs/template_${valueKind}_operand` }
      }
    }
  })
);

const propositionTemplateSchema = {
  type: "object",
  required: ["subject_role", "operator", "applicability_context", "operands"],
  additionalProperties: false,
  properties: {
    subject_role: roleSchema,
    operator: {
      type: "string",
      enum: Object.values(operatorsByValueKind).flat()
    },
    applicability_context: {
      type: "object",
      required: ["mode", "operand_roles"],
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: [
            "unconditional", "if", "unless", "when", "while", "where",
            "before", "after", "during", "until", "frozen_base", "counterfactual"
          ]
        },
        operand_roles: { type: "array", items: roleSchema }
      }
    },
    operands: { type: "array", minItems: 1 }
  },
  anyOf: templateBranches
};

const authoredClaimObligation = {
  type: "object",
  required: [
    "obligation_id", "required_by_stage", "satisfaction_mode", "claim_kind",
    "allowed_modalities", "proposition_template"
  ],
  additionalProperties: false,
  properties: {
    obligation_id: obligationIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    satisfaction_mode: { type: "string", enum: ["authored_claim"] },
    claim_kind: { type: "string", enum: ["behavior", "evidence", "verification"] },
    allowed_modalities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "string",
        enum: ["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"]
      }
    },
    proposition_template: propositionTemplateSchema
  }
};

const resolverFactObligation = {
  type: "object",
  required: ["obligation_id", "required_by_stage", "satisfaction_mode", "fact_key"],
  additionalProperties: false,
  properties: {
    obligation_id: obligationIdSchema,
    required_by_stage: { type: "string", enum: EVALUATION_STAGES },
    satisfaction_mode: { type: "string", enum: ["authoritative_resolver_fact"] },
    fact_key: obligationIdSchema
  }
};

const deliveredEvidenceObligation = {
  type: "object",
  required: ["obligation_id", "required_by_stage", "satisfaction_mode", "evidence_key"],
  additionalProperties: false,
  properties: {
    obligation_id: obligationIdSchema,
    required_by_stage: { type: "string", enum: ["post_delivery"] },
    satisfaction_mode: { type: "string", enum: ["delivered_evidence"] },
    evidence_key: obligationIdSchema
  }
};

const PROTOTYPE_POLICY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "controlled-contract-prototype-org-policy.experimental.v0.2",
  type: "object",
  required: [
    "policy_id", "policy_version", "reference_roles", "obligations",
    "require_all_mandatory_behaviors_verified", "require_zero_graph_diagnostics",
    "operative_residue_effect"
  ],
  additionalProperties: false,
  properties: {
    policy_id: { type: "string", pattern: "^[a-z][a-z0-9.-]+$" },
    policy_version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    reference_roles: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "allowed_type_terms"],
        additionalProperties: false,
        properties: {
          role: roleSchema,
          allowed_type_terms: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", enum: typeTerms }
          }
        }
      }
    },
    obligations: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          authoredClaimObligation,
          resolverFactObligation,
          deliveredEvidenceObligation
        ]
      }
    },
    require_all_mandatory_behaviors_verified: { type: "boolean" },
    require_zero_graph_diagnostics: { type: "boolean" },
    operative_residue_effect: {
      type: "string",
      enum: ["ignore", "review_required", "refuse"]
    }
  },
  $defs: templateOperandDefinitions
};

const PROTOTYPE_AUTHORIZATION_INPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "evaluation_stage", "obligation_bindings", "reference_bindings",
    "resolver_facts", "delivered_evidence"
  ],
  additionalProperties: false,
  properties: {
    evaluation_stage: { type: "string", enum: EVALUATION_STAGES },
    obligation_bindings: {
      type: "array",
      items: {
        type: "object",
        required: ["obligation_id", "claim_id"],
        additionalProperties: false,
        properties: {
          obligation_id: obligationIdSchema,
          claim_id: claimIdSchema
        }
      }
    },
    reference_bindings: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "reference_id"],
        additionalProperties: false,
        properties: {
          role: roleSchema,
          reference_id: { $ref: "#/$defs/reference_id" }
        }
      }
    },
    resolver_facts: {
      type: "array",
      items: {
        type: "object",
        required: ["fact_key", "satisfied"],
        additionalProperties: false,
        properties: {
          fact_key: obligationIdSchema,
          satisfied: { type: "boolean" }
        }
      }
    },
    delivered_evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["evidence_key", "satisfied"],
        additionalProperties: false,
        properties: {
          evidence_key: obligationIdSchema,
          satisfied: { type: "boolean" }
        }
      }
    }
  },
  $defs: {
    reference_id: NATIVE_CONTRACT_SCHEMA.$defs.reference_id
  }
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validatePolicy = ajv.compile(PROTOTYPE_POLICY_SCHEMA);
const validateAuthorizationInput = ajv.compile(PROTOTYPE_AUTHORIZATION_INPUT_SCHEMA);

function duplicateValues(entries, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) {
    const value = entry[key];
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function canonical(value) {
  return JSON.stringify(value);
}

function resolveTemplate(template, referenceByRole) {
  const missingRoles = new Set();
  const resolveRole = (role) => {
    const referenceId = referenceByRole.get(role);
    if (!referenceId) missingRoles.add(role);
    return referenceId ?? null;
  };
  const proposition = {
    subject_reference_id: resolveRole(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(resolveRole)
    },
    operands: template.operands.map((operand) => operand.kind === "reference"
      ? { kind: "reference", reference_id: resolveRole(operand.role) }
      : structuredClone(operand))
  };
  return { proposition, missing_roles: [...missingRoles].sort() };
}

function propositionMatchesTemplate(proposition, resolvedTemplate) {
  if (!proposition) return false;
  return proposition.subject_reference_id === resolvedTemplate.subject_reference_id &&
    proposition.operator === resolvedTemplate.operator &&
    canonical(proposition.applicability_context) ===
      canonical(resolvedTemplate.applicability_context) &&
    canonical(proposition.operands) === canonical(resolvedTemplate.operands);
}

function indeterminate(
  policy,
  diagnostics,
  policyValid = true,
  policyErrors = [],
  evaluationStage = null
) {
  return {
    authorization_version: AUTHORIZATION_VERSION,
    authority: {
      kind: "prototype_local",
      authoritative: false,
      policy_id: policy?.policy_id ?? null,
      policy_version: policy?.policy_version ?? null
    },
    evaluation_stage: EVALUATION_STAGES.includes(evaluationStage) ? evaluationStage : null,
    policy_valid: policyValid,
    policy_errors: policyErrors,
    decision: "indeterminate",
    facts: null,
    diagnostics
  };
}

function evaluatePrototypeAuthorization({
  contract,
  policy,
  evaluation_stage,
  obligation_bindings,
  reference_bindings,
  resolver_facts,
  delivered_evidence
}) {
  if (!validatePolicy(policy)) return indeterminate(
    policy,
    [{ code: "invalid_prototype_policy" }],
    false,
    structuredClone(validatePolicy.errors),
    evaluation_stage
  );

  const authorizationInput = {
    evaluation_stage,
    obligation_bindings,
    reference_bindings,
    resolver_facts,
    delivered_evidence
  };
  if (!validateAuthorizationInput(authorizationInput)) return indeterminate(
    policy,
    [{
      code: "invalid_authorization_input",
      input_errors: structuredClone(validateAuthorizationInput.errors)
    }],
    true,
    [],
    evaluation_stage
  );

  const contractEvaluation = validateAndResolveNativeContract(contract);
  if (!contractEvaluation.schema_valid) return indeterminate(
    policy,
    [{
      code: "contract_schema_invalid",
      schema_errors: contractEvaluation.schema_errors
    }],
    true,
    [],
    evaluation_stage
  );

  const diagnostics = [];
  const claimById = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const propositionById = new Map(
    contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
  );
  const contractReferenceById = new Map(
    contract.references.map((reference) => [reference.reference_id, reference])
  );
  const policyRoleByName = new Map(
    policy.reference_roles.map((role) => [role.role, role])
  );
  const referenceByRole = new Map();
  const bindingByObligation = new Map();
  const resolverFactByKey = new Map();
  const evidenceByKey = new Map();
  const activeObligations = policy.obligations.filter(
    (obligation) => STAGE_RANK[obligation.required_by_stage] <= STAGE_RANK[evaluation_stage]
  );
  const activeReferenceRoles = new Set();
  for (const obligation of activeObligations) {
    if (obligation.satisfaction_mode !== "authored_claim") continue;
    activeReferenceRoles.add(obligation.proposition_template.subject_role);
    for (const role of obligation.proposition_template.applicability_context.operand_roles) {
      activeReferenceRoles.add(role);
    }
    for (const operand of obligation.proposition_template.operands) {
      if (operand.kind === "reference") activeReferenceRoles.add(operand.role);
    }
  }

  for (const obligationId of duplicateValues(policy.obligations, "obligation_id")) {
    diagnostics.push({ code: "duplicate_policy_obligation", obligation_id: obligationId });
  }
  for (const role of duplicateValues(policy.reference_roles, "role")) {
    diagnostics.push({ code: "duplicate_policy_reference_role", role });
  }
  for (const role of duplicateValues(reference_bindings, "role")) {
    diagnostics.push({ code: "duplicate_reference_binding", role });
  }
  for (const obligationId of duplicateValues(obligation_bindings, "obligation_id")) {
    diagnostics.push({ code: "duplicate_obligation_binding", obligation_id: obligationId });
  }
  for (const factKey of duplicateValues(resolver_facts, "fact_key")) {
    diagnostics.push({ code: "duplicate_resolver_fact", fact_key: factKey });
  }
  for (const evidenceKey of duplicateValues(delivered_evidence, "evidence_key")) {
    diagnostics.push({ code: "duplicate_delivered_evidence", evidence_key: evidenceKey });
  }

  for (const binding of reference_bindings) {
    referenceByRole.set(binding.role, binding.reference_id);
    const role = policyRoleByName.get(binding.role);
    const reference = contractReferenceById.get(binding.reference_id);
    if (!role) diagnostics.push({ code: "unknown_policy_reference_role", role: binding.role });
    if (!reference) diagnostics.push({
      code: "dangling_policy_reference_binding",
      role: binding.role,
      reference_id: binding.reference_id
    });
    if (role && reference && !role.allowed_type_terms.includes(reference.type_term)) {
      diagnostics.push({
        code: "policy_reference_type_mismatch",
        role: binding.role,
        reference_id: binding.reference_id,
        actual_type_term: reference.type_term,
        allowed_type_terms: [...role.allowed_type_terms]
      });
    }
  }
  for (const role of activeReferenceRoles) {
    if (!referenceByRole.has(role)) diagnostics.push({
      code: "missing_policy_reference_binding",
      role
    });
  }
  for (const binding of obligation_bindings) bindingByObligation.set(
    binding.obligation_id,
    binding
  );
  for (const fact of resolver_facts) resolverFactByKey.set(fact.fact_key, fact);
  for (const evidence of delivered_evidence) evidenceByKey.set(evidence.evidence_key, evidence);

  const policyObligationIds = new Set(policy.obligations.map(({ obligation_id }) => obligation_id));
  for (const binding of obligation_bindings) {
    if (!policyObligationIds.has(binding.obligation_id)) diagnostics.push({
      code: "unknown_policy_obligation",
      obligation_id: binding.obligation_id
    });
  }

  const satisfiedObligationIds = new Set();
  const authoredBindingCompleteIds = new Set();
  for (const obligation of activeObligations) {
    if (obligation.satisfaction_mode === "authored_claim") {
      const binding = bindingByObligation.get(obligation.obligation_id);
      if (!binding) {
        diagnostics.push({
          code: "required_obligation_unbound",
          obligation_id: obligation.obligation_id
        });
        continue;
      }
      const claim = claimById.get(binding.claim_id);
      if (!claim) {
        diagnostics.push({
          code: "dangling_obligation_claim",
          obligation_id: obligation.obligation_id,
          claim_id: binding.claim_id
        });
        continue;
      }
      if (claim.kind !== obligation.claim_kind) {
        diagnostics.push({
          code: "obligation_claim_kind_mismatch",
          obligation_id: obligation.obligation_id,
          claim_id: binding.claim_id,
          expected_kind: obligation.claim_kind,
          actual_kind: claim.kind
        });
        continue;
      }
      if (!obligation.allowed_modalities.includes(claim.modality)) {
        diagnostics.push({
          code: "obligation_claim_modality_mismatch",
          obligation_id: obligation.obligation_id,
          claim_id: binding.claim_id,
          actual_modality: claim.modality,
          allowed_modalities: [...obligation.allowed_modalities]
        });
        continue;
      }
      const resolved = resolveTemplate(obligation.proposition_template, referenceByRole);
      if (resolved.missing_roles.length > 0) {
        diagnostics.push({
          code: "obligation_template_unresolved",
          obligation_id: obligation.obligation_id,
          missing_roles: resolved.missing_roles
        });
        continue;
      }
      const proposition = propositionById.get(claim.proposition_id);
      if (!propositionMatchesTemplate(proposition, resolved.proposition)) {
        diagnostics.push({
          code: "obligation_proposition_mismatch",
          obligation_id: obligation.obligation_id,
          claim_id: claim.claim_id,
          proposition_id: claim.proposition_id
        });
        continue;
      }
      authoredBindingCompleteIds.add(obligation.obligation_id);
      satisfiedObligationIds.add(obligation.obligation_id);
      continue;
    }

    if (obligation.satisfaction_mode === "authoritative_resolver_fact") {
      const fact = resolverFactByKey.get(obligation.fact_key);
      if (!fact?.satisfied) diagnostics.push({
        code: "required_resolver_fact_unsatisfied",
        obligation_id: obligation.obligation_id,
        fact_key: obligation.fact_key
      });
      else satisfiedObligationIds.add(obligation.obligation_id);
      continue;
    }

    const evidence = evidenceByKey.get(obligation.evidence_key);
    if (!evidence?.satisfied) diagnostics.push({
      code: "required_delivered_evidence_unsatisfied",
      obligation_id: obligation.obligation_id,
      evidence_key: obligation.evidence_key
    });
    else satisfiedObligationIds.add(obligation.obligation_id);
  }

  if (policy.require_all_mandatory_behaviors_verified) {
    for (const claimId of contractEvaluation.facts.uncovered_mandatory_behavior_claim_ids) {
      diagnostics.push({ code: "policy_requires_verified_behavior", claim_id: claimId });
    }
  }
  if (policy.require_zero_graph_diagnostics) {
    for (const diagnostic of contractEvaluation.diagnostics) diagnostics.push({
      code: "policy_rejects_graph_diagnostic",
      graph_diagnostic: diagnostic
    });
  }

  let decision = diagnostics.length === 0 ? "allow" : "refuse";
  const operativeResidueCount = contractEvaluation.facts.operative_residue_count;
  if (operativeResidueCount > 0 && policy.operative_residue_effect !== "ignore") {
    diagnostics.push({
      code: "operative_residue_present",
      count: operativeResidueCount,
      configured_effect: policy.operative_residue_effect
    });
    if (decision === "allow") decision = policy.operative_residue_effect;
  }

  const requiredObligationIds = activeObligations
    .map(({ obligation_id }) => obligation_id)
    .sort();
  const authoredObligationIds = activeObligations
    .filter(({ satisfaction_mode }) => satisfaction_mode === "authored_claim")
    .map(({ obligation_id }) => obligation_id)
    .sort();
  const satisfiedIds = requiredObligationIds.filter((id) => satisfiedObligationIds.has(id));
  const unsatisfiedIds = requiredObligationIds.filter((id) => !satisfiedObligationIds.has(id));

  return {
    authorization_version: AUTHORIZATION_VERSION,
    authority: {
      kind: "prototype_local",
      authoritative: false,
      policy_id: policy.policy_id,
      policy_version: policy.policy_version
    },
    evaluation_stage,
    policy_valid: true,
    policy_errors: [],
    decision,
    facts: {
      required_obligation_ids: requiredObligationIds,
      satisfied_obligation_ids: satisfiedIds,
      unsatisfied_obligation_ids: unsatisfiedIds,
      required_authored_claims_satisfied: authoredObligationIds.every(
        (id) => authoredBindingCompleteIds.has(id)
      ),
      required_obligations_satisfied: unsatisfiedIds.length === 0,
      uncovered_mandatory_behavior_claim_ids:
        contractEvaluation.facts.uncovered_mandatory_behavior_claim_ids,
      operative_residue_count: operativeResidueCount
    },
    diagnostics
  };
}

export {
  AUTHORIZATION_VERSION,
  EVALUATION_STAGES,
  PROTOTYPE_AUTHORIZATION_INPUT_SCHEMA,
  PROTOTYPE_POLICY_SCHEMA,
  evaluatePrototypeAuthorization
};
