import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  PROFILE_SCHEMA_VERSION_V034,
  evaluateVerificationProfileV034,
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  controlledComplementV034
} from "../../lib/native-contract-carrier-v034.mjs";
import { APPLICABILITY_MODES, OPERATORS } from "../../lib/vocabulary-v034.mjs";
import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "./proof-pack-adequacy-constants.mjs";

const PROOF_PACK_ADEQUACY_VERSION =
  "controlled-contract-proof-pack-adequacy.experimental.v0.1";
const PROOF_PACK_ADEQUACY_TOOL_VERSION =
  "controlled-contract-proof-pack-adequacy-check.experimental.v0.1";
const NEGATIVE_FIXTURE_VERSION =
  "controlled-contract-proof-pack-negative-fixture.experimental.v0.1";
const COVERAGE_WITNESS_INDEX_VERSION =
  "controlled-contract-proof-pack-coverage-witness-index.experimental.v0.1";
const VARIATION_INDEX_VERSION =
  "controlled-contract-proof-pack-variation-index.experimental.v0.1";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(moduleDirectory, "../../../..");
const sha256Pattern = "^[a-f0-9]{64}$";
const loadedProofPackSnapshots = new WeakSet();

function compareCodeUnits(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

const PROOF_PACK_ADEQUACY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: PROOF_PACK_ADEQUACY_VERSION,
  description: "Experimental release contract binding a proof pack to executable positive, negative, and limitation controls. It is not CCE authority or delivered evidence.",
  type: "object",
  required: [
    "schema_version",
    "profile_id",
    "profile_version",
    "profile_digest",
    "guarantee",
    "guarantee_digest",
    "required_positive_cases",
    "required_mutant_kills",
    "required_profile_rejections",
    "explicit_exclusions",
    "executable_module",
    "executable_module_digest",
    "executable_dependency_digests"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: [PROOF_PACK_ADEQUACY_VERSION] },
    profile_id: { type: "string", pattern: "^[a-z][a-z0-9.-]+$" },
    profile_version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    profile_digest: { type: "string", pattern: sha256Pattern },
    guarantee: { type: "string", minLength: 1 },
    guarantee_digest: { type: "string", pattern: sha256Pattern },
    required_positive_cases: { $ref: "#/$defs/control_ids" },
    required_mutant_kills: { $ref: "#/$defs/control_ids" },
    required_profile_rejections: { $ref: "#/$defs/control_ids" },
    explicit_exclusions: { $ref: "#/$defs/control_ids" },
    executable_module: {
      type: "string",
      pattern: "^packages/controlled-contract/.+\\.mjs$"
    },
    executable_module_digest: { type: "string", pattern: sha256Pattern },
    executable_dependency_digests: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "object",
        required: ["path", "sha256"],
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            pattern: "^packages/controlled-contract/.+\\.(?:mjs|json)$"
          },
          sha256: { type: "string", pattern: sha256Pattern }
        }
      }
    },
    negative_contract_fixtures: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["fixture_id", "path", "sha256"],
        additionalProperties: false,
        properties: {
          fixture_id: { $ref: "#/$defs/control_id" },
          path: {
            type: "string",
            pattern: "^packages/controlled-contract/.+\\.json$"
          },
          sha256: { type: "string", pattern: sha256Pattern }
        }
      }
    },
    coverage_witness_index: {
      type: "object",
      required: ["path", "sha256"],
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          pattern: "^packages/controlled-contract/.+\\.json$"
        },
        sha256: { type: "string", pattern: sha256Pattern }
      }
    },
    guarantee_critical_profile_surfaces: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "surface_id", "profile_json_pointer", "surface_digest", "coverage"
        ],
        additionalProperties: false,
        properties: {
          surface_id: { $ref: "#/$defs/control_id" },
          profile_json_pointer: {
            type: "string",
            pattern: "^/(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])+)*$"
          },
          surface_digest: { type: "string", pattern: sha256Pattern },
          coverage: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["weakening_class", "negative_fixture_ids"],
              additionalProperties: false,
              properties: {
                weakening_class: {
                  type: "string",
                  enum: [
                    "deletion", "modality_broadening", "type_broadening",
                    "cardinality_broadening", "relation_weakening",
                    "collection_weakening", "satisfaction_branch_broadening",
                    "binding_constraint_weakening",
                    "verification_method_broadening", "proposition_weakening",
                    "falsifier_weakening", "policy_weakening",
                    "population_membership_weakening", "stage_weakening"
                  ]
                },
                negative_fixture_ids: {
                  type: "array",
                  minItems: 1,
                  uniqueItems: true,
                  items: { $ref: "#/$defs/control_id" }
                }
              }
            }
          }
        }
      }
    },
    noncritical_profile_surfaces: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["surface_id", "profile_json_pointer", "surface_digest", "reason"],
        additionalProperties: false,
        properties: {
          surface_id: { $ref: "#/$defs/control_id" },
          profile_json_pointer: {
            type: "string",
            pattern: "^/(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])+)*$"
          },
          surface_digest: { type: "string", pattern: sha256Pattern },
          reason: {
            type: "string",
            enum: [
              "artifact_binding_not_guarantee_semantics",
              "empty_optional_mechanism",
              "schema_singleton_constant",
              "extension_only_stage_set",
              "redundant_with_contract_validity_invariant",
              "redundant_with_distinct_role_set",
              "independent_alternatives_schema_or_semantics_invalid",
              "independent_alternatives_strictly_strengthening",
              "no_valid_weaker_profile_value",
              "redundant_with_covered_semantic_surface"
            ]
          }
        }
      }
    }
  },
  dependentRequired: {
    negative_contract_fixtures: [
      "coverage_witness_index", "guarantee_critical_profile_surfaces",
      "noncritical_profile_surfaces"
    ],
    coverage_witness_index: [
      "negative_contract_fixtures", "guarantee_critical_profile_surfaces",
      "noncritical_profile_surfaces"
    ],
    guarantee_critical_profile_surfaces: [
      "negative_contract_fixtures", "coverage_witness_index",
      "noncritical_profile_surfaces"
    ],
    noncritical_profile_surfaces: [
      "negative_contract_fixtures", "coverage_witness_index",
      "guarantee_critical_profile_surfaces"
    ]
  },
  $defs: {
    control_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    control_ids: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }
    }
  }
};

const NEGATIVE_FIXTURE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: NEGATIVE_FIXTURE_VERSION,
  type: "object",
  required: [
    "schema_version", "fixture_id", "covers", "contract", "evaluation_input"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: [NEGATIVE_FIXTURE_VERSION] },
    fixture_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    covers: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["surface_id", "weakening_class"],
        additionalProperties: false,
        properties: {
          surface_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          weakening_class: {
            type: "string",
            enum: [
              "deletion", "modality_broadening", "type_broadening",
              "cardinality_broadening", "relation_weakening",
              "collection_weakening", "satisfaction_branch_broadening",
              "binding_constraint_weakening",
              "verification_method_broadening", "proposition_weakening",
              "falsifier_weakening", "policy_weakening",
              "population_membership_weakening", "stage_weakening"
            ]
          }
        }
      }
    },
    contract: { type: "object" },
    evaluation_input: { type: "object" },
    variations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["variant_id", "covers", "contract_patches", "evaluation_input_patches"],
        additionalProperties: false,
        properties: {
          variant_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          covers: { $ref: "#/properties/covers" },
          contract_patches: { $ref: "#/$defs/patches" },
          evaluation_input_patches: { $ref: "#/$defs/patches" }
        }
      }
    }
  },
  $defs: {
    patches: {
      type: "array",
      items: {
        type: "object",
        required: ["op", "path", "value"],
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: ["replace"] },
          path: {
            type: "string",
            pattern: "^/(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])+)*$"
          },
          value: {}
        }
      }
    }
  }
};

const COVERAGE_WITNESS_INDEX_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: COVERAGE_WITNESS_INDEX_VERSION,
  type: "object",
  required: ["schema_version", "profile_digest", "witnesses"],
  additionalProperties: false,
  properties: {
    schema_version: {
      type: "string", enum: [COVERAGE_WITNESS_INDEX_VERSION]
    },
    profile_digest: { type: "string", pattern: sha256Pattern },
    witnesses: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "surface_id", "weakening_class", "fixture_id", "variant_id",
          "weakened_profile_digest", "profile_patches"
        ],
        additionalProperties: false,
        properties: {
          surface_id: { $ref: "#/$defs/control_id" },
          weakening_class: { $ref: "#/$defs/weakening_class" },
          fixture_id: { $ref: "#/$defs/control_id" },
          variant_id: { $ref: "#/$defs/control_id" },
          weakened_profile_digest: { type: "string", pattern: sha256Pattern },
          profile_patches: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/patch" }
          }
        }
      }
    }
  },
  $defs: {
    control_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    weakening_class: {
      type: "string",
      enum: [
        "deletion", "modality_broadening", "type_broadening",
        "cardinality_broadening", "relation_weakening",
        "collection_weakening", "satisfaction_branch_broadening",
        "binding_constraint_weakening", "verification_method_broadening",
        "proposition_weakening", "falsifier_weakening", "policy_weakening",
        "population_membership_weakening", "stage_weakening"
      ]
    },
    patch: {
      type: "object",
      required: ["op", "path", "value"],
      additionalProperties: false,
      properties: {
        op: { type: "string", enum: ["replace"] },
        path: {
          type: "string",
          pattern: "^/(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])+)*$"
        },
        value: {}
      }
    }
  }
};

const PROOF_PACK_ADEQUACY_RUN_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: PROOF_PACK_ADEQUACY_RUN_VERSION,
  description: "Machine-readable observations returned by a proof pack's executable adequacy module.",
  type: "object",
  required: [
    "schema_version", "profile_id", "profile_version", "profile_digest",
    "guarantee_digest", "controls"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: [PROOF_PACK_ADEQUACY_RUN_VERSION] },
    profile_id: { type: "string", pattern: "^[a-z][a-z0-9.-]+$" },
    profile_version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    profile_digest: { type: "string", pattern: sha256Pattern },
    guarantee_digest: { type: "string", pattern: sha256Pattern },
    controls: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "control_id", "category", "implementation_outcome", "profile_satisfaction"
        ],
        additionalProperties: false,
        properties: {
          control_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          category: {
            type: "string",
            enum: ["positive", "mutant", "profile_rejection", "exclusion"]
          },
          implementation_outcome: {
            type: "string",
            enum: ["passed", "killed", "not_applicable", "boundary_demonstrated"]
          },
          profile_satisfaction: {
            type: "string",
            enum: ["satisfied", "unsatisfied", "invalid", "indeterminate", "not_evaluated"]
          }
        }
      }
    }
  }
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateProofPackAdequacy = ajv.compile(PROOF_PACK_ADEQUACY_SCHEMA);
const validateProofPackAdequacyRun = ajv.compile(PROOF_PACK_ADEQUACY_RUN_SCHEMA);
const validateNegativeFixture = ajv.compile(NEGATIVE_FIXTURE_SCHEMA);
const validateCoverageWitnessIndex = ajv.compile(COVERAGE_WITNESS_INDEX_SCHEMA);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(
    JSON.stringify(canonicalValue(value))
  ).digest("hex");
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function profileDigest(profile) {
  return canonicalDigest(profile);
}

function guaranteeDigest(guarantee) {
  return createHash("sha256").update(guarantee).digest("hex");
}

function resolveJsonPointer(document, pointer) {
  let value = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token) || Number(token) >= value.length) {
        return { found: false };
      }
      value = value[Number(token)];
    } else if (value !== null && typeof value === "object" &&
        Object.hasOwn(value, token)) {
      value = value[token];
    } else return { found: false };
  }
  return { found: true, value };
}

function profileRolesProvablyDistinct(profile, leftRole, rightRole, {
  allowDeclaredDistinctness
}) {
  const roles = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const leftTypes = new Set(roles.get(leftRole)?.allowed_type_terms ?? []);
  const rightTypes = new Set(roles.get(rightRole)?.allowed_type_terms ?? []);
  if (leftTypes.size > 0 && rightTypes.size > 0 &&
      [...leftTypes].every((term) => !rightTypes.has(term))) return true;
  const edges = new Map(profile.reference_roles.map(({ role }) => [role, new Set()]));
  for (const claim of profile.claim_patterns) {
    const template = claim.proposition_template;
    const operandRoles = template.operands.filter(({ kind }) => kind === "reference")
      .map(({ role }) => role);
    if (template.operator === "reference:precedes") {
      for (const role of operandRoles) edges.get(template.subject_role)?.add(role);
    }
    if (template.operator === "reference:follows") {
      for (const role of operandRoles) edges.get(role)?.add(template.subject_role);
    }
  }
  const reaches = (source, target) => {
    const pending = [source];
    const seen = new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(edges.get(current) ?? []));
    }
    return false;
  };
  if (reaches(leftRole, rightRole) || reaches(rightRole, leftRole)) return true;
  const declaredDistinct = (left, right) => profile.distinct_reference_role_sets.some(
    ({ roles: members }) => members.includes(left) && members.includes(right)
  );
  if (allowDeclaredDistinctness && declaredDistinct(leftRole, rightRole)) return true;
  const equalityTargets = (role) => profile.claim_patterns.flatMap(({ proposition_template }) =>
    proposition_template.operator === "reference:equals" &&
      proposition_template.subject_role === role
      ? proposition_template.operands.filter(({ kind }) => kind === "reference")
        .map(({ role: target }) => target)
      : []
  );
  const leftTargets = equalityTargets(leftRole);
  if (allowDeclaredDistinctness && leftTargets.length > 0 &&
      leftTargets.every((target) => declaredDistinct(target, rightRole))) return true;
  const rightTargets = equalityTargets(rightRole);
  return allowDeclaredDistinctness && rightTargets.length > 0 &&
    rightTargets.every((target) => declaredDistinct(target, leftRole));
}

function contractValidityRedundancyIsProven(profile, pointer) {
  if (pointer === "/distinct_reference_role_sets") return profile.distinct_reference_role_sets
    .every(({ roles }) => roles.every((left, index) => roles.slice(index + 1).every(
      (right) => profileRolesProvablyDistinct(profile, left, right, {
        allowDeclaredDistinctness: false
      })
    )));
  if (pointer === "/reference_binding_patterns") return profile.reference_binding_patterns
    .every(({ comparison, roles }) => comparison === "distinct_references" &&
      roles.every((left, index) => roles.slice(index + 1).every(
        (right) => profileRolesProvablyDistinct(profile, left, right, {
          allowDeclaredDistinctness: true
        })
      )));
  return false;
}

const claimKinds = ["behavior", "evidence", "verification"];
const evaluationStages = ["pre_dispatch", "post_delivery"];
const verificationMethods = NATIVE_CONTRACT_SCHEMA_V034.$defs.verification_claim
  .properties.verification_method.enum;

function claimNestedSemanticDescriptors(profile) {
  const descriptors = [];
  const add = (claim, claimIndex, suffix, tail, kind, extra = {}) => descriptors.push({
    surface_id: `claim-${claim.pattern_id}-${suffix}`,
    profile_json_pointer: `/claim_patterns/${claimIndex}/${tail}`,
    kind,
    claim_index: claimIndex,
    claim_pattern_id: claim.pattern_id,
    ...extra
  });
  profile.claim_patterns.forEach((claim, claimIndex) => {
    add(claim, claimIndex, "required-stage", "required_by_stage", "required_stage");
    add(claim, claimIndex, "claim-kind", "claim_kind", "claim_kind");
    add(claim, claimIndex, "modalities", "allowed_modalities", "modalities");
    for (const [property, prefix] of [
      ["proposition_template", "proposition"],
      ["falsifying_proposition_template", "falsifier"]
    ]) {
      const template = claim[property];
      if (!template) continue;
      const base = `${property}`;
      add(claim, claimIndex, `${prefix}-subject`, `${base}/subject_role`,
        "reference_role", { template: prefix, leaf: "subject_role" });
      add(claim, claimIndex, `${prefix}-operator`, `${base}/operator`, "operator",
        { template: prefix, leaf: "operator" });
      add(claim, claimIndex, `${prefix}-applicability-mode`,
        `${base}/applicability_context/mode`, "applicability_mode",
        { template: prefix, leaf: "applicability_mode" });
      add(claim, claimIndex, `${prefix}-applicability-operands`,
        `${base}/applicability_context/operand_roles`, "applicability_roles",
        { template: prefix, leaf: "applicability_roles" });
      template.operands.forEach((operand, operandIndex) => {
        const leaves = operand.kind === "reference"
          ? ["role"]
          : Object.keys(operand).filter((key) => key !== "kind").sort(compareCodeUnits);
        for (const leaf of leaves) {
          const idLeaf = leaf.replaceAll("_", "-");
          add(claim, claimIndex, `${prefix}-operand-${operandIndex}-${idLeaf}`,
            `${base}/operands/${operandIndex}/${leaf}`,
            leaf === "role" ? "reference_role" : `operand_${leaf}`, {
              template: prefix, leaf, operand_index: operandIndex,
              operand_kind: operand.kind
            });
        }
      });
    }
    if (claim.verification_methods) add(
      claim, claimIndex, "verification-methods", "verification_methods",
      "verification_methods"
    );
  });
  return descriptors;
}

function profileWithReplacement(profile, pointer, value) {
  const candidate = structuredClone(profile);
  const tokens = pointer.slice(1).split("/").map(
    (token) => token.replaceAll("~1", "/").replaceAll("~0", "~")
  );
  let parent = candidate;
  for (const token of tokens.slice(0, -1)) {
    parent = Array.isArray(parent) ? parent[Number(token)] : parent[token];
  }
  const final = tokens.at(-1);
  if (Array.isArray(parent)) parent[Number(final)] = structuredClone(value);
  else parent[final] = structuredClone(value);
  return candidate;
}

function profileWithSemanticAlternative(profile, descriptor, value) {
  const candidate = profileWithReplacement(
    profile, descriptor.profile_json_pointer, value
  );
  const claim = candidate.claim_patterns[descriptor.claim_index];
  if (descriptor.kind !== "modalities" || claim.claim_kind !== "verification") {
    return candidate;
  }
  const addedModalities = value.filter(
    (modality) => !profile.claim_patterns[descriptor.claim_index]
      .allowed_modalities.includes(modality)
  );
  for (const relation of candidate.relation_patterns) {
    if (relation.role !== "verifies" ||
        relation.source_claim_pattern_id !== claim.pattern_id) continue;
    const target = candidate.claim_patterns.find(
      ({ pattern_id: id }) => id === relation.target_claim_pattern_id
    );
    if (!target) continue;
    target.allowed_modalities = [...new Set([
      ...target.allowed_modalities, ...addedModalities
    ])];
  }
  return candidate;
}

function independentAlternativeValues(profile, descriptor, current) {
  const roleIds = profile.reference_roles.map(({ role }) => role);
  let values;
  if (descriptor.kind === "required_stage") values = evaluationStages;
  else if (descriptor.kind === "claim_kind") values = claimKinds;
  else if (descriptor.kind === "modalities") {
    values = ["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"]
      .filter((modality) => !current.includes(modality))
      .map((modality) => [...current, modality]);
  } else if (descriptor.kind === "reference_role") values = roleIds;
  else if (descriptor.kind === "operator") values = OPERATORS.map(({ term }) => term);
  else if (descriptor.kind === "applicability_mode") {
    values = APPLICABILITY_MODES.map(({ term }) => term);
  }
  else if (descriptor.kind === "verification_methods") {
    values = verificationMethods.filter((method) => !current.includes(method)).map(
      (method) => [...current, method]
    );
  } else if (descriptor.kind === "applicability_roles") {
    values = [];
    if (current.length === 0) values.push(...roleIds.map((role) => [role]));
    for (let index = 0; index < current.length; index += 1) {
      values.push(current.filter((_, candidateIndex) => candidateIndex !== index));
      for (const role of roleIds) if (role !== current[index]) {
        const replacement = [...current];
        replacement[index] = role;
        values.push(replacement);
      }
    }
    for (const role of roleIds) if (!current.includes(role)) values.push([...current, role]);
  } else if (descriptor.kind === "operand_value_role") {
    values = profile.number_roles.map(({ role }) => role);
  } else if (["operand_minimum", "operand_maximum", "operand_value"].includes(
    descriptor.kind
  ) && typeof current === "number") {
    values = [0, 1, 2, current - 1, current + 1].filter(Number.isSafeInteger)
      .filter((value) => value >= 0);
  } else if (typeof current === "boolean") values = [false, true];
  else values = [];
  const seen = new Set();
  return values.filter((value) => {
    const digest = canonicalDigest(value);
    if (digest === canonicalDigest(current) || seen.has(digest)) return false;
    seen.add(digest);
    return true;
  });
}

function fixtureRestrictedToCoverage(fixture, surfaceId, weakeningClass) {
  if (fixture.variations === undefined) return fixture;
  const variations = fixture.variations.filter(({ covers }) => covers.some(
    ({ surface_id: id, weakening_class: candidateClass }) =>
      id === surfaceId && candidateClass === weakeningClass
  ));
  return {
    ...fixture,
    covers: fixture.covers.filter(
      ({ surface_id: id, weakening_class: candidateClass }) =>
        id === surfaceId && candidateClass === weakeningClass
    ),
    variations
  };
}

function assessNegativeFixtureSemanticDiscrimination(profile, adequacy, fixtures) {
  const diagnostics = [];
  const descriptors = new Map(claimNestedSemanticDescriptors(profile).map(
    (descriptor) => [descriptor.profile_json_pointer, descriptor]
  ));
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
  for (const surface of adequacy.guarantee_critical_profile_surfaces ?? []) {
    const descriptor = descriptors.get(surface.profile_json_pointer);
    if (!descriptor) continue;
    const selected = resolveJsonPointer(profile, surface.profile_json_pointer);
    if (!selected.found) continue;
    const candidates = independentAlternativeValues(profile, descriptor, selected.value)
      .map((value) => profileWithSemanticAlternative(profile, descriptor, value))
      .filter((candidate) => validateProfileSchemaV034(candidate) &&
        validateProfileSemanticsV034(candidate).length === 0);
    if (candidates.length === 0) continue;
    for (const coverage of surface.coverage) {
      for (const fixtureId of coverage.negative_fixture_ids) {
        const fixture = fixtureById.get(fixtureId);
        if (!fixture) continue;
        const isolated = fixtureRestrictedToCoverage(
          fixture, surface.surface_id, coverage.weakening_class
        );
        if (isolated.variations !== undefined && isolated.variations.length === 0) {
          diagnostics.push({
            code: "negative_fixture_discrimination_missing",
            fixture_id: fixtureId,
            surface_id: surface.surface_id,
            weakening_class: coverage.weakening_class,
            reason: "no_tagged_variation"
          });
          continue;
        }
        const reboundOutcomes = candidates.map((candidate) => {
          const assessment = evaluateNegativeContractFixtures(candidate, [isolated], {
            variation_mode: "indexed"
          });
          return assessment.results[0]?.outcome;
        });
        if (reboundOutcomes.includes("survived") || reboundOutcomes.every(
          (outcome) => outcome === "malformed"
        )) continue;
        diagnostics.push({
          code: "negative_fixture_discrimination_missing",
          fixture_id: fixtureId,
          surface_id: surface.surface_id,
          weakening_class: coverage.weakening_class,
          reason: "no_valid_rebound_profile_admits_fixture"
        });
      }
    }
  }
  return diagnostics;
}

function falsifierRedundancyIsProven(profile, descriptor, classifiedPointers) {
  if (descriptor.template !== "falsifier") return false;
  const claim = profile.claim_patterns[descriptor.claim_index];
  const relations = profile.relation_patterns.filter(
    ({ role, source_claim_pattern_id: source }) =>
      role === "verifies" && source === claim.pattern_id
  );
  if (relations.length === 0) return false;
  if (["applicability_mode", "applicability_roles"].includes(descriptor.leaf)) {
    if (!classifiedPointers.has("/falsifier_condition_bindings")) return false;
    return relations.every((relation) => {
      const binding = profile.falsifier_condition_bindings.find(
        ({ relation_pattern_id: id }) => id === relation.pattern_id
      );
      return binding && canonicalDigest(binding.applicability_context) === canonicalDigest(
        claim.falsifying_proposition_template.applicability_context
      );
    });
  }
  if (descriptor.leaf !== "operator") return false;
  return relations.every((relation) => {
    const targetIndex = profile.claim_patterns.findIndex(
      ({ pattern_id: id }) => id === relation.target_claim_pattern_id
    );
    if (targetIndex < 0 || !classifiedPointers.has(
      `/claim_patterns/${targetIndex}/proposition_template/operator`
    )) return false;
    const target = profile.claim_patterns[targetIndex];
    const targetOperator = target.proposition_template.operator;
    if (target.allowed_modalities.every((modality) =>
      ["MUST_NOT", "SHOULD_NOT"].includes(modality)) &&
        canonicalDigest(target.proposition_template) === canonicalDigest(
          claim.falsifying_proposition_template
        )) return true;
    const complement = controlledComplementV034(targetOperator);
    return complement.kind === "operator" &&
      complement.term === claim.falsifying_proposition_template.operator;
  });
}

function expectedNestedNoncriticalReason(profile, descriptor, classifiedPointers) {
  if (falsifierRedundancyIsProven(profile, descriptor, classifiedPointers)) {
    return "redundant_with_covered_semantic_surface";
  }
  const selected = resolveJsonPointer(profile, descriptor.profile_json_pointer);
  const alternatives = independentAlternativeValues(profile, descriptor, selected.value);
  const validAlternatives = alternatives.filter((value) => {
    const candidate = profileWithReplacement(
      profile, descriptor.profile_json_pointer, value
    );
    return validateProfileSchemaV034(candidate) &&
      validateProfileSemanticsV034(candidate).length === 0;
  });
  if (validAlternatives.length === 0) {
    return "independent_alternatives_schema_or_semantics_invalid";
  }
  if (descriptor.kind === "operand_minimum" && selected.value === 0 &&
      validAlternatives.every((value) => value > selected.value)) {
    return "independent_alternatives_strictly_strengthening";
  }
  return null;
}

function noValidWeakerProfileValue(profile, pointer, selectedValue) {
  if (pointer === "/number_roles" && Array.isArray(selectedValue)) {
    return selectedValue.every((role) => {
      if (role.number_type !== "integer" || role.minimum !== 0 ||
          role.maximum !== undefined) return false;
      const uses = profile.claim_patterns.filter((pattern) =>
        pattern.proposition_template.operands.some(
          ({ kind, value_role: valueRole }) =>
            kind === "number" && valueRole === role.role
        )
      );
      return uses.length > 0 && uses.every(
        ({ proposition_template: template }) =>
          template.operator === "number:has_cardinality"
      );
    });
  }
  const collectionLeaf = pointer.match(
    /^\/collection_patterns\/(\d+)\/(match_mode|required_by_stage)$/u
  );
  if (!collectionLeaf) return false;
  const collection = profile.collection_patterns[Number(collectionLeaf[1])];
  if (!collection) return false;
  if (collectionLeaf[2] === "match_mode") {
    return collection.match_mode === "subsequence" ||
      collection.collection_kind === "closed_set";
  }
  return profile.evaluation_stages.every(
    (stage) => stage === collection.required_by_stage
  );
}

function validateGenericCoverageDeclaration(profile, adequacy) {
  const fixtures = adequacy.negative_contract_fixtures;
  const surfaces = adequacy.guarantee_critical_profile_surfaces;
  const noncriticalSurfaces = adequacy.noncritical_profile_surfaces;
  if (fixtures === undefined && surfaces === undefined && noncriticalSurfaces === undefined) return;
  const fixtureIds = new Set();
  const fixturePaths = new Set();
  for (const fixture of fixtures) {
    if (fixtureIds.has(fixture.fixture_id)) throw new ProofPackAdequacyError(
      "negative_fixture_id_ambiguous", "negative fixture ids must be unique",
      { fixture_id: fixture.fixture_id }
    );
    if (fixturePaths.has(fixture.path)) throw new ProofPackAdequacyError(
      "negative_fixture_path_ambiguous", "one fixture path may have only one identity",
      { path: fixture.path }
    );
    fixtureIds.add(fixture.fixture_id);
    fixturePaths.add(fixture.path);
  }
  const surfaceIds = new Set();
  const pointers = new Set();
  const mappedFixtures = new Set();
  for (const surface of surfaces) {
    if (surfaceIds.has(surface.surface_id)) throw new ProofPackAdequacyError(
      "critical_surface_id_ambiguous", "critical surface ids must be unique",
      { surface_id: surface.surface_id }
    );
    if (pointers.has(surface.profile_json_pointer)) throw new ProofPackAdequacyError(
      "critical_surface_pointer_ambiguous",
      "one profile surface may have only one coverage declaration",
      { profile_json_pointer: surface.profile_json_pointer }
    );
    surfaceIds.add(surface.surface_id);
    pointers.add(surface.profile_json_pointer);
    const selected = resolveJsonPointer(profile, surface.profile_json_pointer);
    if (!selected.found) throw new ProofPackAdequacyError(
      "critical_surface_missing", "a declared critical profile surface does not exist",
      { surface_id: surface.surface_id, profile_json_pointer: surface.profile_json_pointer }
    );
    const actualSurfaceDigest = canonicalDigest(selected.value);
    if (actualSurfaceDigest !== surface.surface_digest) throw new ProofPackAdequacyError(
      "critical_surface_digest_mismatch",
      "a critical surface declaration is stale for the candidate profile",
      {
        surface_id: surface.surface_id,
        declared_digest: surface.surface_digest,
        actual_digest: actualSurfaceDigest
      }
    );
    const classes = new Set();
    for (const coverage of surface.coverage) {
      if (classes.has(coverage.weakening_class)) throw new ProofPackAdequacyError(
        "critical_surface_weakening_class_ambiguous",
        "a weakening class may occur once per critical surface",
        { surface_id: surface.surface_id, weakening_class: coverage.weakening_class }
      );
      classes.add(coverage.weakening_class);
      for (const fixtureId of coverage.negative_fixture_ids) {
        if (!fixtureIds.has(fixtureId)) throw new ProofPackAdequacyError(
          "critical_surface_fixture_missing",
          "critical surface coverage names an undeclared fixture",
          { surface_id: surface.surface_id, fixture_id: fixtureId }
        );
        mappedFixtures.add(fixtureId);
      }
    }
  }
  for (const fixtureId of fixtureIds) if (!mappedFixtures.has(fixtureId)) {
    throw new ProofPackAdequacyError(
      "negative_fixture_unmapped", "every negative fixture must cover a critical surface",
      { fixture_id: fixtureId }
    );
  }
  const artifactBindingPointers = new Set([
    "/schema_version", "/profile_id", "/profile_version", "/contract_schema_version",
    "/vocabulary_version", "/vocabulary_signature_digest", "/vocabulary_algebra_digest",
    "/vocabulary_definitions_digest", "/vocabulary_complete_digest"
  ]);
  const optionalMechanismPointers = new Set([
    "/number_roles", "/distinct_reference_role_sets", "/reference_binding_patterns",
    "/collection_patterns",
    "/reference_role_count_bindings", "/resolver_fact_patterns", "/evidence_patterns"
  ]);
  const noncriticalPointers = new Set();
  for (const surface of noncriticalSurfaces) {
    if (surfaceIds.has(surface.surface_id)) throw new ProofPackAdequacyError(
      "profile_surface_id_ambiguous", "critical and noncritical surface ids must be unique",
      { surface_id: surface.surface_id }
    );
    if (pointers.has(surface.profile_json_pointer) ||
        noncriticalPointers.has(surface.profile_json_pointer)) {
      throw new ProofPackAdequacyError(
        "profile_surface_pointer_ambiguous",
        "one profile surface may have only one criticality classification",
        { profile_json_pointer: surface.profile_json_pointer }
      );
    }
    surfaceIds.add(surface.surface_id);
    noncriticalPointers.add(surface.profile_json_pointer);
    const selected = resolveJsonPointer(profile, surface.profile_json_pointer);
    if (!selected.found) throw new ProofPackAdequacyError(
      "noncritical_surface_missing", "a declared noncritical profile surface does not exist",
      { surface_id: surface.surface_id, profile_json_pointer: surface.profile_json_pointer }
    );
    const actualDigest = canonicalDigest(selected.value);
    if (actualDigest !== surface.surface_digest) throw new ProofPackAdequacyError(
      "noncritical_surface_digest_mismatch",
      "a noncritical surface declaration is stale for the candidate profile",
      { surface_id: surface.surface_id, declared_digest: surface.surface_digest,
        actual_digest: actualDigest }
    );
    if (surface.reason === "artifact_binding_not_guarantee_semantics" &&
        !artifactBindingPointers.has(surface.profile_json_pointer)) {
      throw new ProofPackAdequacyError(
        "noncritical_surface_reason_invalid", "artifact-binding reason is restricted",
        { surface_id: surface.surface_id, reason: surface.reason }
      );
    }
    if (surface.reason === "schema_singleton_constant" &&
        surface.profile_json_pointer !== "/verification_falsifier_policy") {
      throw new ProofPackAdequacyError(
        "noncritical_surface_reason_invalid", "singleton reason is restricted",
        { surface_id: surface.surface_id, reason: surface.reason }
      );
    }
    if (surface.reason === "extension_only_stage_set" &&
        (surface.profile_json_pointer !== "/evaluation_stages" ||
          !Array.isArray(selected.value) || selected.value.length !== 1 ||
          selected.value[0] !== "pre_dispatch")) {
      throw new ProofPackAdequacyError(
        "noncritical_surface_reason_invalid",
        "stage-set reason requires the immutable current pre-dispatch stage set",
        { surface_id: surface.surface_id, reason: surface.reason }
      );
    }
    if (surface.reason === "empty_optional_mechanism" &&
        (!optionalMechanismPointers.has(surface.profile_json_pointer) ||
          !Array.isArray(selected.value) || selected.value.length !== 0)) {
      throw new ProofPackAdequacyError(
        "noncritical_surface_reason_invalid",
        "empty-mechanism reason requires a recognized empty mechanism array",
        { surface_id: surface.surface_id, reason: surface.reason }
      );
    }
    if (surface.reason === "no_valid_weaker_profile_value" &&
        !noValidWeakerProfileValue(
          profile, surface.profile_json_pointer, selected.value
        )) {
      throw new ProofPackAdequacyError(
        "noncritical_surface_reason_invalid",
        "no-weaker-value reason requires a mechanically closed weakening domain",
        { surface_id: surface.surface_id, reason: surface.reason }
      );
    }
    if (surface.reason === "redundant_with_distinct_role_set") {
      const bindings = selected.value;
      const sets = profile.distinct_reference_role_sets.map(({ roles }) => new Set(roles));
      if (surface.profile_json_pointer !== "/reference_binding_patterns" ||
          !Array.isArray(bindings) || bindings.length === 0 ||
          bindings.some(({ comparison, roles }) => comparison !== "distinct_references" ||
            !sets.some((roleSet) => roles.every((role) => roleSet.has(role))))) {
        throw new ProofPackAdequacyError(
          "noncritical_surface_reason_invalid",
          "distinct-role redundancy must be mechanically established for every binding",
          { surface_id: surface.surface_id, reason: surface.reason }
        );
      }
    }
    if (surface.reason === "redundant_with_contract_validity_invariant" &&
        !["/distinct_reference_role_sets", "/reference_binding_patterns"].includes(
          surface.profile_json_pointer
        ) || surface.reason === "redundant_with_contract_validity_invariant" &&
        !contractValidityRedundancyIsProven(profile, surface.profile_json_pointer)) {
      throw new ProofPackAdequacyError(
        "noncritical_surface_reason_invalid", "contract-validity reason is restricted",
        { surface_id: surface.surface_id, reason: surface.reason }
      );
    }
  }
  const semanticTopLevel = [
    "evaluation_stages", "reference_roles", "number_roles", "distinct_reference_role_sets",
    "reference_binding_patterns", "reference_role_count_bindings", "claim_patterns",
    "relation_patterns", "falsifier_condition_bindings", "collection_patterns",
    "resolver_fact_patterns", "evidence_patterns", "satisfaction_expression"
  ];
  for (const key of semanticTopLevel) {
    if (!Object.hasOwn(profile, key)) continue;
    const pointer = `/${key}`;
    const critical = [...pointers].some(
      (declared) => declared === pointer || declared.startsWith(`${pointer}/`)
    );
    if (!critical && !noncriticalPointers.has(pointer)) throw new ProofPackAdequacyError(
      "profile_surface_classification_missing",
      "every semantic profile field must be classified; absence never implies noncriticality",
      { profile_json_pointer: pointer }
    );
  }
  const classifiedTopLevel = new Set([
    ...artifactBindingPointers,
    "/verification_falsifier_policy",
    ...semanticTopLevel.map((key) => `/${key}`)
  ]);
  for (const key of Object.keys(profile)) if (!classifiedTopLevel.has(`/${key}`)) {
    throw new ProofPackAdequacyError(
      "profile_surface_taxonomy_unknown",
      "an unknown profile field has no generic semantic classification",
      { profile_json_pointer: `/${key}` }
    );
  }
  for (const pointer of artifactBindingPointers) if (Object.hasOwn(profile, pointer.slice(1)) &&
      !noncriticalPointers.has(pointer)) throw new ProofPackAdequacyError(
    "profile_surface_classification_missing",
    "artifact-binding fields require an explicit validated noncritical declaration",
    { profile_json_pointer: pointer }
  );
  const declaredCoverage = new Set();
  for (const surface of surfaces) for (const coverage of surface.coverage) {
    declaredCoverage.add(`${surface.profile_json_pointer}\0${coverage.weakening_class}`);
  }
  const nestedDescriptors = claimNestedSemanticDescriptors(profile);
  const nestedByPointer = new Map(nestedDescriptors.map(
    (descriptor) => [descriptor.profile_json_pointer, descriptor]
  ));
  const criticalByPointer = new Map(surfaces.map(
    (surface) => [surface.profile_json_pointer, surface]
  ));
  const noncriticalByPointer = new Map(noncriticalSurfaces.map(
    (surface) => [surface.profile_json_pointer, surface]
  ));
  const classifiedPointers = new Set([
    ...criticalByPointer.keys(), ...noncriticalByPointer.keys()
  ]);
  const nestedReasons = new Set([
    "independent_alternatives_schema_or_semantics_invalid",
    "independent_alternatives_strictly_strengthening",
    "redundant_with_covered_semantic_surface"
  ]);
  for (const surface of noncriticalSurfaces) if (nestedReasons.has(surface.reason) &&
      !nestedByPointer.has(surface.profile_json_pointer)) {
    throw new ProofPackAdequacyError(
      "noncritical_surface_reason_invalid",
      "nested semantic reasons are restricted to derived claim semantic leaves",
      { surface_id: surface.surface_id, reason: surface.reason }
    );
  }
  for (const descriptor of nestedDescriptors) {
    const critical = criticalByPointer.get(descriptor.profile_json_pointer);
    const noncritical = noncriticalByPointer.get(descriptor.profile_json_pointer);
    const classification = critical ?? noncritical;
    if (!classification) throw new ProofPackAdequacyError(
      "nested_profile_surface_classification_missing",
      "every derived nested claim semantic leaf requires an exact classification",
      { profile_json_pointer: descriptor.profile_json_pointer,
        expected_surface_id: descriptor.surface_id }
    );
    if (classification.surface_id !== descriptor.surface_id) {
      throw new ProofPackAdequacyError(
        "nested_profile_surface_id_mismatch",
        "nested claim semantic surface ids are derived from stable pattern identity",
        { profile_json_pointer: descriptor.profile_json_pointer,
          expected_surface_id: descriptor.surface_id,
          actual_surface_id: classification.surface_id }
      );
    }
    if (critical) continue;
    const expectedReason = expectedNestedNoncriticalReason(
      profile, descriptor, classifiedPointers
    );
    if (expectedReason === null) throw new ProofPackAdequacyError(
      "nested_profile_surface_critical_coverage_missing",
      "a nested semantic leaf has an independently valid non-strengthening alternative",
      { profile_json_pointer: descriptor.profile_json_pointer,
        surface_id: descriptor.surface_id }
    );
    if (noncritical.reason !== expectedReason) throw new ProofPackAdequacyError(
      "noncritical_surface_reason_invalid",
      "the declared nested semantic reason does not match the mechanically derived reason",
      { profile_json_pointer: descriptor.profile_json_pointer,
        surface_id: descriptor.surface_id, declared_reason: noncritical.reason,
        expected_reason: expectedReason }
    );
  }
  const requireCoverage = (pointer, weakeningClass) => {
    if (noncriticalByPointer.has(pointer)) return;
    if (!declaredCoverage.has(`${pointer}\0${weakeningClass}`)) {
      throw new ProofPackAdequacyError(
        "critical_surface_coverage_missing",
        "a mechanically guarantee-relevant profile surface lacks required coverage",
        { profile_json_pointer: pointer, weakening_class: weakeningClass }
      );
    }
  };
  requireCoverage("/claim_patterns", "deletion");
  profile.claim_patterns.forEach((_, index) => requireCoverage(
    `/claim_patterns/${index}/allowed_modalities`, "modality_broadening"
  ));
  profile.claim_patterns.forEach((pattern, index) => {
    if (!pattern.allowed_modalities.includes("MUST")) return;
    requireCoverage(
      `/claim_patterns/${index}/proposition_template/operator`,
      "proposition_weakening"
    );
  });
  profile.reference_roles.forEach((role, index) => {
    requireCoverage(`/reference_roles/${index}/allowed_type_terms`, "type_broadening");
    if (role.cardinality !== "exactly_one") return;
    const mutant = structuredClone(profile);
    mutant.reference_roles[index].cardinality = "one_or_more";
    if (validateProfileSemanticsV034(mutant).length === 0) requireCoverage(
      `/reference_roles/${index}/cardinality`, "cardinality_broadening"
    );
  });
  if (profile.relation_patterns.length > 0) requireCoverage(
    "/relation_patterns", "relation_weakening"
  );
  if (profile.collection_patterns.length > 0) requireCoverage(
    "/collection_patterns", "collection_weakening"
  );
  profile.collection_patterns.forEach((_, index) => {
    requireCoverage(`/collection_patterns/${index}/collection_kind`, "collection_weakening");
    requireCoverage(`/collection_patterns/${index}/match_mode`, "collection_weakening");
    requireCoverage(
      `/collection_patterns/${index}/candidate_quantifier`,
      "population_membership_weakening"
    );
    requireCoverage(`/collection_patterns/${index}/collection_purpose`, "collection_weakening");
    requireCoverage(
      `/collection_patterns/${index}/member_claim_pattern_ids`,
      "population_membership_weakening"
    );
    requireCoverage(`/collection_patterns/${index}/required_by_stage`, "stage_weakening");
  });
  if (profile.reference_binding_patterns.length > 0 &&
      !noncriticalPointers.has("/reference_binding_patterns")) requireCoverage(
    "/reference_binding_patterns", "binding_constraint_weakening"
  );
  if (profile.distinct_reference_role_sets.length > 0 &&
      !noncriticalPointers.has("/distinct_reference_role_sets")) requireCoverage(
    "/distinct_reference_role_sets", "binding_constraint_weakening"
  );
  if ((profile.reference_role_count_bindings?.length ?? 0) > 0) requireCoverage(
    "/reference_role_count_bindings", "binding_constraint_weakening"
  );
  if (profile.falsifier_condition_bindings.length > 0) requireCoverage(
    "/falsifier_condition_bindings", "falsifier_weakening"
  );
  requireCoverage("/satisfaction_expression", "satisfaction_branch_broadening");
}

function validateFixtureCoverageBindings(adequacy, fixtures) {
  const declared = new Set();
  for (const surface of adequacy.guarantee_critical_profile_surfaces ?? []) {
    for (const coverage of surface.coverage) {
      for (const fixtureId of coverage.negative_fixture_ids) declared.add(
        `${fixtureId}\0${surface.surface_id}\0${coverage.weakening_class}`
      );
    }
  }
  const carried = new Set();
  for (const fixture of fixtures) {
    for (const coverage of fixture.covers) {
      const key = `${fixture.fixture_id}\0${coverage.surface_id}\0${coverage.weakening_class}`;
      if (carried.has(key)) throw new ProofPackAdequacyError(
        "negative_fixture_coverage_ambiguous",
        "a fixed fixture may carry one copy of a coverage binding",
        { fixture_id: fixture.fixture_id, ...coverage }
      );
      carried.add(key);
    }
    if (fixture.variations !== undefined) {
      const variantIds = new Set();
      const variantCoverage = new Set();
      for (const variant of fixture.variations) {
        if (variantIds.has(variant.variant_id)) throw new ProofPackAdequacyError(
          "negative_fixture_variant_id_ambiguous",
          "variation ids must be unique within a fixed fixture",
          { fixture_id: fixture.fixture_id, variant_id: variant.variant_id }
        );
        variantIds.add(variant.variant_id);
        for (const coverage of variant.covers) variantCoverage.add(
          `${coverage.surface_id}\0${coverage.weakening_class}`
        );
      }
      const wrapperCoverage = new Set(fixture.covers.map(
        (coverage) => `${coverage.surface_id}\0${coverage.weakening_class}`
      ));
      for (const key of wrapperCoverage) if (!variantCoverage.has(key)) {
        throw new ProofPackAdequacyError(
          "negative_fixture_variant_coverage_missing",
          "every variation-fixture coverage binding needs an independently tagged variant",
          { fixture_id: fixture.fixture_id, binding: key.split("\0") }
        );
      }
      for (const key of variantCoverage) if (!wrapperCoverage.has(key)) {
        throw new ProofPackAdequacyError(
          "negative_fixture_variant_coverage_undeclared",
          "variation coverage must be declared by its containing fixed fixture",
          { fixture_id: fixture.fixture_id, binding: key.split("\0") }
        );
      }
    }
  }
  for (const key of declared) if (!carried.has(key)) throw new ProofPackAdequacyError(
    "negative_fixture_coverage_binding_mismatch",
    "declared critical-surface coverage is absent from the fixed fixture bytes",
    { binding: key.split("\0") }
  );
  for (const key of carried) if (!declared.has(key)) throw new ProofPackAdequacyError(
    "negative_fixture_coverage_binding_mismatch",
    "fixed fixture bytes carry undeclared critical-surface coverage",
    { binding: key.split("\0") }
  );
}

function coverageBindingKey({ surface_id: surfaceId, weakening_class: weakeningClass,
  fixture_id: fixtureId }) {
  return `${fixtureId}\0${surfaceId}\0${weakeningClass}`;
}

function validateCoverageWitnessBindings(profile, adequacy, fixtures, witnessIndex) {
  if (witnessIndex.profile_digest !== profileDigest(profile)) {
    throw new ProofPackAdequacyError(
      "coverage_witness_profile_digest_mismatch",
      "coverage witness index is stale for the candidate profile",
      {
        declared_profile_digest: witnessIndex.profile_digest,
        actual_profile_digest: profileDigest(profile)
      }
    );
  }
  const expected = new Map();
  const surfacePointers = new Map();
  for (const surface of adequacy.guarantee_critical_profile_surfaces ?? []) {
    surfacePointers.set(surface.surface_id, surface.profile_json_pointer);
    for (const coverage of surface.coverage) {
      for (const fixtureId of coverage.negative_fixture_ids) {
        const binding = {
          surface_id: surface.surface_id,
          weakening_class: coverage.weakening_class,
          fixture_id: fixtureId
        };
        expected.set(coverageBindingKey(binding), binding);
      }
    }
  }
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
  const carried = new Map();
  for (const witness of witnessIndex.witnesses) {
    const key = coverageBindingKey(witness);
    if (carried.has(key)) throw new ProofPackAdequacyError(
      "coverage_witness_binding_ambiguous",
      "one coverage binding may have only one rebound witness",
      { binding: key.split("\0") }
    );
    carried.set(key, witness);
    const fixture = fixtureById.get(witness.fixture_id);
    if (!fixture) throw new ProofPackAdequacyError(
      "coverage_witness_fixture_missing",
      "coverage witness names an undeclared fixed fixture",
      { fixture_id: witness.fixture_id }
    );
    const variants = fixture.variations ?? [{ variant_id: fixture.fixture_id,
      covers: fixture.covers }];
    const variant = variants.find(({ variant_id: id }) => id === witness.variant_id);
    if (!variant || !variant.covers.some(
      ({ surface_id: surfaceId, weakening_class: weakeningClass }) =>
        surfaceId === witness.surface_id && weakeningClass === witness.weakening_class
    )) throw new ProofPackAdequacyError(
      "coverage_witness_variant_mismatch",
      "coverage witness must name a fixture variant carrying the same binding",
      {
        fixture_id: witness.fixture_id,
        variant_id: witness.variant_id,
        surface_id: witness.surface_id,
        weakening_class: witness.weakening_class
      }
    );
    const surfacePointer = surfacePointers.get(witness.surface_id);
    if (surfacePointer === undefined) throw new ProofPackAdequacyError(
      "coverage_witness_surface_undeclared",
      "coverage witness names an undeclared critical profile surface",
      { surface_id: witness.surface_id }
    );
    if (!witness.profile_patches.some(({ path: patchPath }) =>
      patchPath === surfacePointer || surfacePointer.startsWith(`${patchPath}/`) ||
        patchPath.startsWith(`${surfacePointer}/`)
    )) throw new ProofPackAdequacyError(
      "coverage_witness_surface_patch_missing",
      "coverage witness must patch the exact profile surface it claims",
      { surface_id: witness.surface_id, profile_json_pointer: surfacePointer }
    );
    const patchPaths = witness.profile_patches.map(({ path: patchPath }) => patchPath);
    for (let left = 0; left < patchPaths.length; left += 1) {
      for (let right = left + 1; right < patchPaths.length; right += 1) {
        if (patchPaths[left].startsWith(`${patchPaths[right]}/`) ||
            patchPaths[right].startsWith(`${patchPaths[left]}/`)) {
          throw new ProofPackAdequacyError(
            "coverage_witness_patch_overlap",
            "coverage witness patches must be independently removable",
            {
              fixture_id: witness.fixture_id,
              variant_id: witness.variant_id,
              patch_paths: [patchPaths[left], patchPaths[right]]
            }
          );
        }
      }
    }
  }
  for (const [key] of expected) if (!carried.has(key)) {
    throw new ProofPackAdequacyError(
      "coverage_witness_binding_missing",
      "every critical-surface fixture binding requires one rebound witness",
      { binding: key.split("\0") }
    );
  }
  for (const [key] of carried) if (!expected.has(key)) {
    throw new ProofPackAdequacyError(
      "coverage_witness_binding_undeclared",
      "coverage witness carries an undeclared critical-surface binding",
      { binding: key.split("\0") }
    );
  }
}

class ProofPackAdequacyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofPackAdequacyError";
    this.code = code;
    this.details = details;
  }
}

function parseJsonSource(text, filePath, label) {
  try {
    return {
      value: JSON.parse(text),
      sha256: createHash("sha256").update(text).digest("hex"),
      source_base64: Buffer.from(text).toString("base64")
    };
  } catch (error) {
    throw new ProofPackAdequacyError(
      `${label}_invalid_json`, `invalid JSON in ${label} ${filePath}: ${error.message}`
    );
  }
}

async function readJsonSource(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new ProofPackAdequacyError(
      `${label}_missing`, `cannot read ${label} ${filePath}: ${error.message}`
    );
  }
  return parseJsonSource(text, filePath, label);
}

async function resolveDeclaredPath(repositoryRoot, declaredPath, label) {
  const segments = declaredPath.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) throw new ProofPackAdequacyError(
    `${label}_parent_segment_forbidden`,
    `${label} must not contain a parent-directory segment`,
    { declared_path: declaredPath }
  );
  const resolved = path.resolve(repositoryRoot, declaredPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ProofPackAdequacyError(
      `${label}_outside_repository`, `${label} resolves outside the repository root`,
      { declared_path: declaredPath }
    );
  }
  const allowedRoot = await realpath(path.join(repositoryRoot, "packages/controlled-contract"));
  let resolvedRealPath;
  try {
    await access(resolved);
    resolvedRealPath = await realpath(resolved);
  } catch (error) {
    throw new ProofPackAdequacyError(
      `${label}_missing`, `${label} is unavailable: ${error.message}`,
      { declared_path: declaredPath }
    );
  }
  const allowedRelative = path.relative(allowedRoot, resolvedRealPath);
  if (allowedRelative === ".." || allowedRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(allowedRelative)) throw new ProofPackAdequacyError(
    `${label}_outside_controlled_contract`,
    `${label} resolves outside packages/controlled-contract`,
    { declared_path: declaredPath }
  );
  return resolvedRealPath;
}

async function verifyExecutableDigest(filePath, declaredDigest, label, declaredPath) {
  let handle;
  let bytes;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const [openedStat, currentRealPath, currentPathStat] = await Promise.all([
      handle.stat(),
      realpath(filePath),
      stat(filePath)
    ]);
    if (currentRealPath !== filePath || openedStat.dev !== currentPathStat.dev ||
        openedStat.ino !== currentPathStat.ino) throw new ProofPackAdequacyError(
      `${label}_snapshot_path_changed`,
      `${label} path identity changed while its bytes were captured`,
      { declared_path: declaredPath }
    );
    bytes = await handle.readFile();
  } catch (error) {
    if (error instanceof ProofPackAdequacyError) throw error;
    throw new ProofPackAdequacyError(
      `${label}_missing`, `${label} is unreadable: ${error.message}`,
      { declared_path: declaredPath }
    );
  } finally {
    await handle?.close();
  }
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== declaredDigest) throw new ProofPackAdequacyError(
    `${label}_digest_mismatch`, `${label} content does not match its declared digest`,
    {
      declared_path: declaredPath,
      declared_digest: declaredDigest,
      actual_digest: actualDigest
    }
  );
  return {
    path: declaredPath,
    sha256: actualDigest,
    source_base64: bytes.toString("base64")
  };
}

async function materializeCapturedModuleGraph(repositoryRoot, captures) {
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "proof-pack-snapshot-"));
  try {
    for (const capture of captures) {
      const targetPath = path.join(snapshotRoot, capture.path);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(capture.source_base64, "base64"));
    }

    const dependencyTree = path.join(repositoryRoot, "node_modules");
    try {
      await access(dependencyTree);
      await symlink(dependencyTree, path.join(snapshotRoot, "node_modules"), "dir");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return snapshotRoot;
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function tokenizeModuleSource(source, declaredPath) {
  const tokens = [];
  let index = 0;
  const fail = (code, message, offset = index) => {
    throw new ProofPackAdequacyError(code, message, {
      declared_path: declaredPath,
      source_offset: offset
    });
  };
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && !["\n", "\r"].includes(source[index])) index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const start = index;
      index = source.indexOf("*/", index + 2);
      if (index === -1) fail(
        "executable_module_syntax_unsupported", "unterminated block comment", start
      );
      index += 2;
      continue;
    }
    if (character === "/") {
      const previous = tokens.at(-1);
      const regexMayStart = previous === undefined ||
        (previous.type === "punctuator" && "([{:;,=!&|?+-*%^~<>".includes(previous.value)) ||
        (previous.type === "identifier" && [
          "return", "case", "throw", "yield", "await"
        ].includes(previous.value));
      if (regexMayStart) {
        const start = index;
        let inCharacterClass = false;
        let escaped = false;
        index += 1;
        while (index < source.length) {
          const current = source[index];
          if (!escaped && current === "[") inCharacterClass = true;
          if (!escaped && current === "]") inCharacterClass = false;
          if (!escaped && current === "/" && !inCharacterClass) break;
          if (!escaped && ["\n", "\r"].includes(current)) fail(
            "executable_module_syntax_unsupported", "unterminated regular expression", start
          );
          escaped = !escaped && current === "\\";
          if (current !== "\\") escaped = false;
          index += 1;
        }
        if (source[index] !== "/") fail(
          "executable_module_syntax_unsupported", "unterminated regular expression", start
        );
        index += 1;
        while (index < source.length && /[A-Za-z]/u.test(source[index])) index += 1;
        tokens.push({ type: "regex", value: null, offset: start });
        continue;
      }
    }
    if (character === "'" || character === '"') {
      const quote = character;
      const start = index;
      let value = "";
      let containsEscape = false;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (["\n", "\r"].includes(source[index])) fail(
          "executable_module_syntax_unsupported", "unterminated string literal", start
        );
        if (source[index] === "\\") {
          containsEscape = true;
          const escaped = source[index + 1];
          if (escaped === undefined) fail(
            "executable_module_syntax_unsupported", "unterminated string escape", start
          );
          const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };
          value += escapes[escaped] ?? escaped;
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (source[index] !== quote) fail(
        "executable_module_syntax_unsupported", "unterminated string literal", start
      );
      index += 1;
      tokens.push({ type: "string", value, offset: start, containsEscape });
      continue;
    }
    if (character === "`") {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < source.length) {
        if (!escaped && source[index] === "`") break;
        escaped = !escaped && source[index] === "\\";
        if (source[index] !== "\\") escaped = false;
        index += 1;
      }
      if (source[index] !== "`") fail(
        "executable_module_syntax_unsupported", "unterminated template literal", start
      );
      index += 1;
      if (/\bimport\s*\(/u.test(source.slice(start, index))) {
        fail(
          "executable_dynamic_import_unsupported",
          "adequacy executable closure must not contain dynamic import expressions",
          start
        );
      }
      tokens.push({ type: "template", value: null, offset: start });
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index), offset: start });
      continue;
    }
    tokens.push({ type: "punctuator", value: character, offset: index });
    index += 1;
  }
  return tokens;
}

function staticModuleSpecifiers(source, declaredPath) {
  const tokens = tokenizeModuleSource(source, declaredPath);
  const specifiers = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || !["import", "export"].includes(token.value)) continue;
    const next = tokens[index + 1];
    if (token.value === "import" && next?.value === ".") continue;
    if (token.value === "import" && next?.value === "(") {
      throw new ProofPackAdequacyError(
        "executable_dynamic_import_unsupported",
        "adequacy executable closure must not contain dynamic import expressions",
        { declared_path: declaredPath, source_offset: token.offset }
      );
    }
    if (token.value === "import" && next?.type === "string") {
      specifiers.push(next.value);
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const candidate = tokens[cursor];
      if (candidate.value === ";") break;
      if (candidate.type === "identifier" && candidate.value === "from") {
        const specifier = tokens[cursor + 1];
        if (specifier?.type !== "string") throw new ProofPackAdequacyError(
          "executable_module_syntax_unsupported",
          "static ESM import/export source must be a string literal",
          { declared_path: declaredPath, source_offset: candidate.offset }
        );
        specifiers.push(specifier.value);
        break;
      }
    }
  }
  return specifiers;
}

function staticModuleResources(source, declaredPath) {
  const tokens = tokenizeModuleSource(source, declaredPath);
  const resources = [];
  const isImportMetaUrl = (argument) =>
    argument.length === 5 &&
    argument.map(({ value }) => value).join("\u0000") ===
      "import\u0000.\u0000meta\u0000.\u0000url";
  const containsImportMetaUrl = (argument) => argument.some((_token, index) =>
    isImportMetaUrl(argument.slice(index, index + 5))
  );
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index].value !== "new" || tokens[index + 1]?.value !== "URL" ||
        tokens[index + 2]?.value !== "(") continue;
    const argumentsList = [[]];
    const delimiters = [")"];
    let closeIndex = null;
    for (let cursor = index + 3; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      const expectedCloser = delimiters.at(-1);
      if (["(", "[", "{"].includes(token.value)) {
        delimiters.push({ "(": ")", "[": "]", "{": "}" }[token.value]);
        argumentsList.at(-1).push(token);
        continue;
      }
      if ([")", "]", "}"].includes(token.value)) {
        if (token.value !== expectedCloser) throw new ProofPackAdequacyError(
          "executable_module_syntax_unsupported",
          "static URL expression has mismatched delimiters",
          { declared_path: declaredPath, source_offset: token.offset }
        );
        delimiters.pop();
        if (delimiters.length === 0) {
          closeIndex = cursor;
          break;
        }
        argumentsList.at(-1).push(token);
        continue;
      }
      if (token.value === "," && delimiters.length === 1) {
        argumentsList.push([]);
        continue;
      }
      argumentsList.at(-1).push(token);
    }
    if (closeIndex === null) throw new ProofPackAdequacyError(
      "executable_module_syntax_unsupported",
      "unterminated static URL expression",
      { declared_path: declaredPath, source_offset: tokens[index].offset }
    );
    if (!isImportMetaUrl(argumentsList[1] ?? [])) {
      if (containsImportMetaUrl(argumentsList[1] ?? [])) {
        throw new ProofPackAdequacyError(
          "executable_resource_literal_invalid",
          "static module resource base must be exactly import.meta.url",
          { declared_path: declaredPath, source_offset: tokens[index].offset }
        );
      }
      continue;
    }
    const literal = argumentsList[0];
    if (argumentsList.length !== 2 || literal.length !== 1 ||
        literal[0].type !== "string" || literal[0].containsEscape) {
      throw new ProofPackAdequacyError(
        "executable_resource_literal_invalid",
        "static module resource must use one plain string literal with import.meta.url",
        { declared_path: declaredPath, source_offset: tokens[index].offset }
      );
    }
    resources.push({ specifier: literal[0].value, source_offset: literal[0].offset });
    index = closeIndex;
  }
  return resources;
}

function resolveStaticModuleResource(importerPath, { specifier, source_offset: sourceOffset }) {
  const detail = { importer_path: importerPath, specifier, source_offset: sourceOffset };
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    throw new ProofPackAdequacyError(
      "executable_resource_escaping",
      "static module resources must use relative POSIX paths",
      detail
    );
  }
  if (specifier.includes("\\") || specifier.includes("?") || specifier.includes("#") ||
      specifier.includes("%") || /[\u0000-\u001f\u007f]/u.test(specifier)) {
    throw new ProofPackAdequacyError(
      "executable_resource_unsupported",
      "static module resources must use plain relative POSIX paths",
      detail
    );
  }
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(importerPath), specifier
  ));
  if (!resolved.startsWith("packages/controlled-contract/")) {
    throw new ProofPackAdequacyError(
      "executable_resource_escaping",
      "static module resources must resolve under packages/controlled-contract",
      { ...detail, resolved_path: resolved }
    );
  }
  return resolved;
}

function resolveLocalModuleSpecifier(importerPath, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    if (specifier.startsWith("/") || specifier.startsWith("file:")) {
      throw new ProofPackAdequacyError(
        "executable_import_escaping",
        "adequacy executable closure must not use absolute or file URL imports",
        { importer_path: importerPath, specifier }
      );
    }
    return null;
  }
  if (specifier.includes("?") || specifier.includes("#") || specifier.includes("\\")) {
    throw new ProofPackAdequacyError(
      "executable_import_unsupported",
      "local adequacy imports must be plain relative POSIX module paths",
      { importer_path: importerPath, specifier }
    );
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier));
  if (!resolved.startsWith("packages/controlled-contract/") || !resolved.endsWith(".mjs")) {
    throw new ProofPackAdequacyError(
      "executable_import_escaping",
      "local adequacy imports must resolve to .mjs files under packages/controlled-contract",
      { importer_path: importerPath, specifier, resolved_path: resolved }
    );
  }
  return resolved;
}

async function captureExecutableModuleClosure(repositoryRoot, executableSnapshot,
  dependencyDeclarations) {
  const declarations = new Map(dependencyDeclarations.map((entry) => [entry.path, entry]));
  const captures = new Map([[executableSnapshot.path, executableSnapshot]]);
  const pending = [executableSnapshot];
  while (pending.length > 0) {
    const capture = pending.shift();
    const source = Buffer.from(capture.source_base64, "base64").toString("utf8");
    for (const specifier of staticModuleSpecifiers(source, capture.path)) {
      const importedPath = resolveLocalModuleSpecifier(capture.path, specifier);
      if (importedPath === null || captures.has(importedPath)) continue;
      const declaration = declarations.get(importedPath);
      if (!declaration) throw new ProofPackAdequacyError(
        "executable_dependency_undeclared",
        "every local module in the executable static import closure must be digest-declared",
        { importer_path: capture.path, imported_path: importedPath }
      );
      const importedRealPath = await resolveDeclaredPath(
        repositoryRoot, importedPath, "executable_dependency"
      );
      const importedCapture = await verifyExecutableDigest(
        importedRealPath, declaration.sha256, "executable_dependency", importedPath
      );
      captures.set(importedPath, importedCapture);
      pending.push(importedCapture);
    }
    for (const resource of staticModuleResources(source, capture.path)) {
      const resourcePath = resolveStaticModuleResource(capture.path, resource);
      if (captures.has(resourcePath)) continue;
      const declaration = declarations.get(resourcePath);
      if (!declaration) throw new ProofPackAdequacyError(
        "executable_dependency_undeclared",
        "every static local resource loaded by the executable closure must be digest-declared",
        { importer_path: capture.path, imported_path: resourcePath }
      );
      const resourceRealPath = await resolveDeclaredPath(
        repositoryRoot, resourcePath, "executable_dependency"
      );
      captures.set(resourcePath, await verifyExecutableDigest(
        resourceRealPath, declaration.sha256, "executable_dependency", resourcePath
      ));
    }
  }
  const closureDependencyPaths = [...captures.keys()]
    .filter((declaredPath) => declaredPath !== executableSnapshot.path)
    .sort(compareCodeUnits);
  const declaredPaths = [...declarations.keys()].sort(compareCodeUnits);
  if (JSON.stringify(declaredPaths) !== JSON.stringify(closureDependencyPaths)) {
    throw new ProofPackAdequacyError(
      "executable_dependency_closure_mismatch",
      "executable dependency declarations must exactly equal the static local import closure",
      { declared_paths: declaredPaths, closure_paths: closureDependencyPaths }
    );
  }
  if (JSON.stringify(dependencyDeclarations.map(({ path: declaredPath }) => declaredPath)) !==
      JSON.stringify(declaredPaths)) throw new ProofPackAdequacyError(
    "executable_dependency_declaration_noncanonical",
    "executable dependency declarations must be sorted by path",
    { declared_paths: dependencyDeclarations.map(({ path: declaredPath }) => declaredPath) }
  );
  return [...captures.values()].sort((left, right) => compareCodeUnits(left.path, right.path));
}

async function loadProofPack(packDirectory, {
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  profileSource = null
} = {}) {
  const directory = path.resolve(packDirectory);
  const profilePath = path.join(directory, "profile.json");
  const adequacyPath = path.join(directory, "adequacy.json");
  if (profileSource !== null && path.resolve(profileSource.path) !== profilePath) {
    throw new ProofPackAdequacyError(
      "proof_pack_profile_source_mismatch",
      "preloaded profile source must identify the pack's canonical profile.json"
    );
  }
  const [profileDocument, adequacyDocument] = await Promise.all([
    profileSource === null
      ? readJsonSource(profilePath, "profile")
      : Promise.resolve(parseJsonSource(profileSource.text, profilePath, "profile")),
    readJsonSource(adequacyPath, "adequacy")
  ]);
  const profile = profileDocument.value;
  const adequacy = adequacyDocument.value;
  if (profile.schema_version !== PROFILE_SCHEMA_VERSION_V034) {
    throw new ProofPackAdequacyError(
      "proof_pack_profile_schema_unsupported",
      `proof pack loader does not support ${profile.schema_version ?? "an absent schema"}`
    );
  }
  if (!validateProfileSchemaV034(profile)) throw new ProofPackAdequacyError(
    "proof_pack_profile_schema_invalid", "proof pack profile is schema-invalid",
    { errors: structuredClone(validateProfileSchemaV034.errors ?? []) }
  );
  const profileSemanticsDiagnostics = validateProfileSemanticsV034(profile);
  if (profileSemanticsDiagnostics.length > 0) throw new ProofPackAdequacyError(
    "proof_pack_profile_semantics_invalid", "proof pack profile is semantically invalid",
    { diagnostics: profileSemanticsDiagnostics }
  );
  if (!validateProofPackAdequacy(adequacy)) throw new ProofPackAdequacyError(
    "adequacy_schema_invalid", "adequacy declaration is schema-invalid",
    { errors: structuredClone(validateProofPackAdequacy.errors ?? []) }
  );
  if (adequacy.profile_id !== profile.profile_id ||
      adequacy.profile_version !== profile.profile_version) {
    throw new ProofPackAdequacyError(
      "adequacy_profile_identity_mismatch",
      "adequacy declaration does not identify its sibling profile",
      {
        declared_profile_id: adequacy.profile_id,
        declared_profile_version: adequacy.profile_version,
        actual_profile_id: profile.profile_id,
        actual_profile_version: profile.profile_version
      }
    );
  }
  const digest = profileDigest(profile);
  if (adequacy.profile_digest !== digest) throw new ProofPackAdequacyError(
    "adequacy_profile_digest_mismatch",
    "adequacy declaration is stale for its sibling profile",
    { declared_profile_digest: adequacy.profile_digest, actual_profile_digest: digest }
  );
  const declaredGuaranteeDigest = guaranteeDigest(adequacy.guarantee);
  if (adequacy.guarantee_digest !== declaredGuaranteeDigest) {
    throw new ProofPackAdequacyError(
      "adequacy_guarantee_digest_mismatch",
      "adequacy guarantee changed without updating its bound digest",
      {
        declared_guarantee_digest: adequacy.guarantee_digest,
        actual_guarantee_digest: declaredGuaranteeDigest
      }
    );
  }
  validateGenericCoverageDeclaration(profile, adequacy);
  const negativeFixtureSnapshots = [];
  const negativeFixtures = [];
  for (const declaration of adequacy.negative_contract_fixtures ?? []) {
    const fixturePath = await resolveDeclaredPath(
      repositoryRoot, declaration.path, "negative_fixture"
    );
    const fixtureDocument = await readJsonSource(fixturePath, "negative_fixture");
    if (fixtureDocument.sha256 !== declaration.sha256) throw new ProofPackAdequacyError(
      "negative_fixture_digest_mismatch",
      "negative fixture content does not match its declared digest",
      {
        fixture_id: declaration.fixture_id,
        declared_digest: declaration.sha256,
        actual_digest: fixtureDocument.sha256
      }
    );
    if (!validateNegativeFixture(fixtureDocument.value)) throw new ProofPackAdequacyError(
      "negative_fixture_schema_invalid", "negative fixture wrapper is schema-invalid",
      {
        fixture_id: declaration.fixture_id,
        errors: structuredClone(validateNegativeFixture.errors ?? [])
      }
    );
    if (fixtureDocument.value.fixture_id !== declaration.fixture_id) {
      throw new ProofPackAdequacyError(
        "negative_fixture_identity_mismatch",
        "negative fixture bytes do not carry their declared identity",
        {
          declared_fixture_id: declaration.fixture_id,
          actual_fixture_id: fixtureDocument.value.fixture_id
        }
      );
    }
    negativeFixtureSnapshots.push({
      path: declaration.path,
      sha256: fixtureDocument.sha256,
      source_base64: fixtureDocument.source_base64
    });
    negativeFixtures.push(fixtureDocument.value);
  }
  validateFixtureCoverageBindings(adequacy, negativeFixtures);
  let coverageWitnessIndex = null;
  let coverageWitnessSnapshot = null;
  if (adequacy.coverage_witness_index !== undefined) {
    const witnessPath = await resolveDeclaredPath(
      repositoryRoot, adequacy.coverage_witness_index.path, "coverage_witness_index"
    );
    const witnessDocument = await readJsonSource(
      witnessPath, "coverage_witness_index"
    );
    if (witnessDocument.sha256 !== adequacy.coverage_witness_index.sha256) {
      throw new ProofPackAdequacyError(
        "coverage_witness_digest_mismatch",
        "coverage witness index does not match its declared digest",
        {
          declared_digest: adequacy.coverage_witness_index.sha256,
          actual_digest: witnessDocument.sha256
        }
      );
    }
    if (!validateCoverageWitnessIndex(witnessDocument.value)) {
      throw new ProofPackAdequacyError(
        "coverage_witness_schema_invalid",
        "coverage witness index is schema-invalid",
        { errors: structuredClone(validateCoverageWitnessIndex.errors ?? []) }
      );
    }
    coverageWitnessIndex = witnessDocument.value;
    coverageWitnessSnapshot = {
      path: adequacy.coverage_witness_index.path,
      sha256: witnessDocument.sha256,
      source_base64: witnessDocument.source_base64
    };
    validateCoverageWitnessBindings(
      profile, adequacy, negativeFixtures, coverageWitnessIndex
    );
  }
  const executableModulePath = await resolveDeclaredPath(
    repositoryRoot, adequacy.executable_module, "executable_module"
  );
  const executableModuleSnapshot = await verifyExecutableDigest(
    executableModulePath,
    adequacy.executable_module_digest,
    "executable_module",
    adequacy.executable_module
  );
  const dependencyPathSet = new Set([adequacy.executable_module]);
  for (const dependency of adequacy.executable_dependency_digests) {
    if (dependencyPathSet.has(dependency.path)) throw new ProofPackAdequacyError(
      "executable_dependency_duplicate",
      "an executable dependency path may be declared only once",
      { declared_path: dependency.path }
    );
    dependencyPathSet.add(dependency.path);
  }
  const executableSnapshots = await captureExecutableModuleClosure(
    repositoryRoot,
    executableModuleSnapshot,
    adequacy.executable_dependency_digests
  );
  const repositoryProfilePath = path.relative(path.resolve(repositoryRoot), profilePath)
    .replaceAll("\\", "/");
  const executableProfileSnapshot = executableSnapshots.find(
    ({ path: declaredPath }) => declaredPath === repositoryProfilePath
  );
  if (executableProfileSnapshot && executableProfileSnapshot.sha256 !== profileDocument.sha256) {
    throw new ProofPackAdequacyError(
      "proof_pack_profile_snapshot_changed",
      "profile path identity or bytes changed while the executable closure was captured",
      {
        profile_path: repositoryProfilePath,
        profile_sha256: profileDocument.sha256,
        executable_resource_sha256: executableProfileSnapshot.sha256
      }
    );
  }
  const dependencyPaths = executableSnapshots
    .filter(({ path: declaredPath }) => declaredPath !== adequacy.executable_module)
    .map(({ path: declaredPath }) => path.resolve(repositoryRoot, declaredPath));
  const pack = deepFreeze({
    directory,
    profile_path: profilePath,
    adequacy_path: adequacyPath,
    repository_root: path.resolve(repositoryRoot),
    executable_module_path: executableModulePath,
    executable_dependency_paths: dependencyPaths,
    executable_snapshots: executableSnapshots,
    negative_fixture_snapshots: negativeFixtureSnapshots,
    negative_fixtures: negativeFixtures,
    coverage_witness_snapshot: coverageWitnessSnapshot,
    coverage_witness_index: coverageWitnessIndex,
    profile,
    adequacy,
    profile_sha256: profileDocument.sha256,
    profile_source_base64: profileDocument.source_base64,
    adequacy_sha256: adequacyDocument.sha256,
    adequacy_digest: canonicalDigest(adequacy),
    profile_digest: digest
  });
  loadedProofPackSnapshots.add(pack);
  return pack;
}

const categoryDeclarations = [
  ["positive", "required_positive_cases"],
  ["mutant", "required_mutant_kills"],
  ["profile_rejection", "required_profile_rejections"],
  ["exclusion", "explicit_exclusions"]
];

function validateControlOutcome(control, diagnostics) {
  if (control.category === "positive" &&
      (control.implementation_outcome !== "passed" ||
        control.profile_satisfaction !== "satisfied")) diagnostics.push({
    code: "adequacy_positive_control_failed", control_id: control.control_id
  });
  if (control.category === "mutant" &&
      (control.implementation_outcome !== "killed" ||
        control.profile_satisfaction === "satisfied")) diagnostics.push({
    code: "adequacy_mutant_survived", control_id: control.control_id
  });
  if (control.category === "profile_rejection" &&
      (control.implementation_outcome !== "not_applicable" ||
        control.profile_satisfaction === "satisfied")) diagnostics.push({
    code: "adequacy_profile_rejection_failed", control_id: control.control_id
  });
  if (control.category === "exclusion" &&
      control.implementation_outcome !== "boundary_demonstrated") diagnostics.push({
    code: "adequacy_exclusion_not_demonstrated", control_id: control.control_id
  });
}

function assessAdequacyRun(pack, observations) {
  const diagnostics = [];
  if (!validateProofPackAdequacyRun(observations)) return [{
    code: "adequacy_run_schema_invalid",
    errors: structuredClone(validateProofPackAdequacyRun.errors ?? [])
  }];
  try {
    validateGenericCoverageDeclaration(pack.profile, pack.adequacy);
  } catch (error) {
    if (!(error instanceof ProofPackAdequacyError)) throw error;
    diagnostics.push({
      code: "adequacy_profile_surface_binding_invalid",
      cause_code: error.code,
      details: structuredClone(error.details)
    });
  }
  for (const field of [
    "profile_id", "profile_version", "profile_digest", "guarantee_digest"
  ]) {
    const expected = field === "profile_digest"
      ? pack.profile_digest
      : field === "guarantee_digest"
        ? pack.adequacy.guarantee_digest
        : pack.profile[field];
    if (observations[field] !== expected) diagnostics.push({
      code: "adequacy_run_binding_mismatch",
      field,
      expected,
      actual: observations[field]
    });
  }
  const controlsById = new Map();
  for (const control of observations.controls) {
    if (controlsById.has(control.control_id)) diagnostics.push({
      code: "adequacy_control_duplicate", control_id: control.control_id
    });
    controlsById.set(control.control_id, control);
  }
  const declaredIds = new Set();
  for (const [category, field] of categoryDeclarations) {
    for (const controlId of pack.adequacy[field]) {
      declaredIds.add(controlId);
      const control = controlsById.get(controlId);
      if (!control) {
        diagnostics.push({
          code: "adequacy_control_not_executed", category, control_id: controlId
        });
        continue;
      }
      if (control.category !== category) diagnostics.push({
        code: "adequacy_control_category_mismatch",
        control_id: controlId,
        expected: category,
        actual: control.category
      });
      validateControlOutcome(control, diagnostics);
    }
  }
  for (const controlId of controlsById.keys()) if (!declaredIds.has(controlId)) {
    diagnostics.push({ code: "adequacy_control_undeclared", control_id: controlId });
  }
  return diagnostics.sort((left, right) => {
    const leftKey = `${left.code}\0${left.control_id ?? ""}`;
    const rightKey = `${right.code}\0${right.control_id ?? ""}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function applyFixedReplacementPatches(base, patches, fixtureId, variantId, label) {
  const result = structuredClone(base);
  const seen = new Set();
  for (const patch of patches) {
    if (seen.has(patch.path)) throw new ProofPackAdequacyError(
      "negative_fixture_variant_patch_conflict",
      "one variation may replace a fixed path only once",
      { fixture_id: fixtureId, variant_id: variantId, label, path: patch.path }
    );
    seen.add(patch.path);
    const tokens = patch.path.slice(1).split("/").map(
      (token) => token.replaceAll("~1", "/").replaceAll("~0", "~")
    );
    let parent = result;
    for (const token of tokens.slice(0, -1)) {
      if (Array.isArray(parent)) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(token) || Number(token) >= parent.length) {
          throw new ProofPackAdequacyError(
            "negative_fixture_variant_patch_missing",
            "variation patch path must resolve inside its fixed base",
            { fixture_id: fixtureId, variant_id: variantId, label, path: patch.path }
          );
        }
        parent = parent[Number(token)];
      } else if (parent !== null && typeof parent === "object" &&
          Object.hasOwn(parent, token)) parent = parent[token];
      else throw new ProofPackAdequacyError(
        "negative_fixture_variant_patch_missing",
        "variation patch path must resolve inside its fixed base",
        { fixture_id: fixtureId, variant_id: variantId, label, path: patch.path }
      );
    }
    const finalToken = tokens.at(-1);
    const key = Array.isArray(parent) && /^(?:0|[1-9][0-9]*)$/u.test(finalToken)
      ? Number(finalToken)
      : finalToken;
    if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, key)) {
      throw new ProofPackAdequacyError(
        "negative_fixture_variant_patch_missing",
        "variation replacement must target an existing fixed value",
        { fixture_id: fixtureId, variant_id: variantId, label, path: patch.path }
      );
    }
    if (canonicalDigest(parent[key]) === canonicalDigest(patch.value)) {
      throw new ProofPackAdequacyError(
        "negative_fixture_variant_patch_noop",
        "variation replacement must change its fixed base value",
        { fixture_id: fixtureId, variant_id: variantId, label, path: patch.path }
      );
    }
    parent[key] = structuredClone(patch.value);
  }
  return result;
}

function expandFixedFixtureVariations(fixture) {
  if (fixture.variations === undefined) return [{
    variant_id: fixture.fixture_id,
    contract: structuredClone(fixture.contract),
    evaluation_input: structuredClone(fixture.evaluation_input)
  }];
  return fixture.variations.map((variant) => ({
    variant_id: variant.variant_id,
    contract: applyFixedReplacementPatches(
      fixture.contract, variant.contract_patches,
      fixture.fixture_id, variant.variant_id, "contract"
    ),
    evaluation_input: applyFixedReplacementPatches(
      fixture.evaluation_input, variant.evaluation_input_patches,
      fixture.fixture_id, variant.variant_id, "evaluation_input"
    )
  }));
}

function selectIndexedSemanticVariations(profile, fixture, expanded) {
  if (fixture.variations === undefined) return {
    selected: expanded.map((_, index) => index), mechanicallyRejected: []
  };
  const groups = new Map();
  for (let index = 0; index < fixture.variations.length; index += 1) {
    const variant = fixture.variations[index];
    if (variant.covers.length !== 1 ||
        variant.covers[0].weakening_class !== "proposition_weakening") return {
      selected: expanded.map((_, candidateIndex) => candidateIndex), mechanicallyRejected: []
    };
    const group = groups.get(variant.covers[0].surface_id) ?? [];
    group.push(index);
    groups.set(variant.covers[0].surface_id, group);
  }
  const selected = new Set();
  const mechanicallyRejected = [];
  for (const [surfaceId, indexes] of groups) {
    const patternMatches = profile.claim_patterns.filter(
      ({ pattern_id: id }) => surfaceId.startsWith(`claim-${id}-`)
    ).sort((left, right) => right.pattern_id.length - left.pattern_id.length);
    const pattern = patternMatches[0];
    if (!pattern || (patternMatches[1] &&
        patternMatches[1].pattern_id.length === pattern.pattern_id.length)) {
      throw new ProofPackAdequacyError(
      "negative_fixture_variant_surface_missing",
      "semantic-variation surface must resolve unambiguously to one candidate claim pattern",
      { fixture_id: fixture.fixture_id, surface_id: surfaceId }
      );
    }
    const claimId = `claim-${pattern.pattern_id}`;
    const claim = fixture.contract.claims.find(({ claim_id: id }) => id === claimId);
    const propositionIndex = fixture.contract.propositions.findIndex(
      ({ proposition_id: id }) => id === claim?.proposition_id
    );
    if (propositionIndex < 0) throw new ProofPackAdequacyError(
      "negative_fixture_variant_target_missing",
      "semantic variation must target its fixed base claim proposition",
      { fixture_id: fixture.fixture_id, surface_id: surfaceId }
    );
    const claimIndex = fixture.contract.claims.findIndex(
      ({ claim_id: id }) => id === claimId
    );
    const roleReferences = new Map(fixture.evaluation_input.reference_bindings.map(
      ({ role, reference_ids: ids }) => [role, ids]
    ));
    const suffix = surfaceId.slice(`claim-${pattern.pattern_id}-`.length);
    let targetPath;
    let candidateValues;
    let alternateTargetPath = null;
    let alternateCandidateValues = [];
    if (suffix === "claim-kind") {
      targetPath = `/claims/${claimIndex}/kind`;
      candidateValues = [pattern.claim_kind];
    } else if (suffix === "verification-methods") {
      targetPath = `/claims/${claimIndex}/verification_method`;
      candidateValues = pattern.verification_methods ?? [];
    } else if (suffix === "proposition-operator") {
      targetPath = `/propositions/${propositionIndex}/operator`;
      candidateValues = [pattern.proposition_template.operator];
    } else if (suffix === "proposition-subject") {
      targetPath = `/propositions/${propositionIndex}/subject_reference_id`;
      candidateValues = roleReferences.get(pattern.proposition_template.subject_role) ?? [];
    } else if (suffix === "proposition-applicability-mode") {
      targetPath = `/propositions/${propositionIndex}/applicability_context/mode`;
      candidateValues = [pattern.proposition_template.applicability_context.mode];
    } else if (suffix === "proposition-applicability-operands") {
      targetPath =
        `/propositions/${propositionIndex}/applicability_context/operand_reference_ids`;
      candidateValues = [pattern.proposition_template.applicability_context.operand_roles
        .flatMap((role) => roleReferences.get(role) ?? [])];
    } else {
      const propositionOperand = suffix.match(/^proposition-operand-(\d+)-role$/u);
      const falsifierOperand = suffix.match(/^falsifier-operand-(\d+)-role$/u);
      const falsifierIndex = fixture.contract.propositions.findIndex(
        ({ proposition_id: id }) => id === claim?.falsifying_proposition_id
      );
      if (propositionOperand) {
        const operandIndex = Number(propositionOperand[1]);
        targetPath = `/propositions/${propositionIndex}/operands/${operandIndex}/reference_id`;
        candidateValues = roleReferences.get(
          pattern.proposition_template.operands[operandIndex]?.role
        ) ?? [];
        alternateTargetPath = `/propositions/${propositionIndex}/operands`;
        const expandedOperands = pattern.proposition_template.operands.flatMap((operand) => {
          if (operand.kind !== "reference") return [structuredClone(operand)];
          return (roleReferences.get(operand.role) ?? []).map((referenceId) => ({
            kind: "reference", reference_id: referenceId
          }));
        });
        alternateCandidateValues = [expandedOperands];
      } else if (suffix === "falsifier-subject" && falsifierIndex >= 0) {
        targetPath = `/propositions/${falsifierIndex}/subject_reference_id`;
        candidateValues = roleReferences.get(
          pattern.falsifying_proposition_template?.subject_role
        ) ?? [];
      } else if (suffix === "falsifier-applicability-mode" && falsifierIndex >= 0) {
        targetPath = `/propositions/${falsifierIndex}/applicability_context/mode`;
        candidateValues = [
          pattern.falsifying_proposition_template?.applicability_context.mode
        ];
      } else if (suffix === "falsifier-applicability-operands" && falsifierIndex >= 0) {
        targetPath =
          `/propositions/${falsifierIndex}/applicability_context/operand_reference_ids`;
        candidateValues = [pattern.falsifying_proposition_template?.applicability_context
          .operand_roles.flatMap((role) => roleReferences.get(role) ?? [])];
      } else if (falsifierOperand && falsifierIndex >= 0) {
        const operandIndex = Number(falsifierOperand[1]);
        targetPath = `/propositions/${falsifierIndex}/operands/${operandIndex}/reference_id`;
        candidateValues = roleReferences.get(
          pattern.falsifying_proposition_template?.operands[operandIndex]?.role
        ) ?? [];
      } else {
        const propositionLiteral = suffix.match(
          /^proposition-operand-(\d+)-(minimum|maximum|value|value-role)$/u
        );
        if (!propositionLiteral) return {
          selected: expanded.map((_, candidateIndex) => candidateIndex),
          mechanicallyRejected: []
        };
        const operandIndex = Number(propositionLiteral[1]);
        const leaf = propositionLiteral[2] === "value-role"
          ? "value_role"
          : propositionLiteral[2];
        targetPath = `/propositions/${propositionIndex}/operands/${operandIndex}/${leaf}`;
        candidateValues = [pattern.proposition_template.operands[operandIndex]?.[leaf]];
      }
    }
    const values = new Set();
    for (const index of indexes) {
      const variant = fixture.variations[index];
      const bindingPatch = variant.evaluation_input_patches[0];
      const bindings = bindingPatch?.value;
      const bindingIds = new Set(Array.isArray(bindings)
        ? bindings.map(({ pattern_id: id }) => id)
        : []);
      if (variant.evaluation_input_patches.length !== 1 ||
          bindingPatch?.path !== "/claim_pattern_bindings" ||
          !Array.isArray(bindings) || bindings.length === 0 ||
          bindingIds.size !== bindings.length ||
          !bindings.some(({ pattern_id: id, claim_id: boundClaimId }) =>
            id === pattern.pattern_id && boundClaimId === claimId) ||
          bindings.some(({ pattern_id: id, claim_id: boundClaimId }) =>
            typeof id !== "string" || boundClaimId !== `claim-${id}`)) {
        throw new ProofPackAdequacyError(
        "negative_fixture_variant_binding_missing",
          "indexed semantic variants require exact canonical claim-pattern bindings",
        { fixture_id: fixture.fixture_id, variant_id: variant.variant_id }
        );
      }
      const targetPatches = variant.contract_patches.filter(
        ({ path: patchPath }) => patchPath === targetPath ||
          (alternateTargetPath !== null && patchPath === alternateTargetPath)
      );
      const operatorCoupling = suffix === "proposition-operator";
      if (targetPatches.length !== 1 ||
          (!operatorCoupling && variant.contract_patches.length !== 1) ||
          (operatorCoupling && ![1, 2].includes(variant.contract_patches.length))) {
        throw new ProofPackAdequacyError(
          "negative_fixture_variant_target_ambiguous",
          "indexed semantic variants require one controlled target replacement",
          { fixture_id: fixture.fixture_id, variant_id: variant.variant_id }
        );
      }
      if (operatorCoupling && variant.contract_patches.length === 2) {
        const complement = controlledComplementV034(targetPatches[0].value);
        const coupledPatch = variant.contract_patches.find(
          ({ path: patchPath }) => patchPath !== targetPath
        );
        const eligibleFalsifierPaths = profile.relation_patterns.filter(
          ({ target_claim_pattern_id: id }) => id === pattern.pattern_id
        ).flatMap(({ source_claim_pattern_id: sourceId }) => {
          const sourceClaim = fixture.contract.claims.find(
            ({ claim_id: id }) => id === `claim-${sourceId}`
          );
          const coupledIndex = fixture.contract.propositions.findIndex(
            ({ proposition_id: id }) => id === sourceClaim?.falsifying_proposition_id
          );
          return coupledIndex < 0 ? [] : [`/propositions/${coupledIndex}/operator`];
        });
        if (complement.kind !== "operator" ||
            coupledPatch?.value !== complement.term ||
            !eligibleFalsifierPaths.includes(coupledPatch?.path)) {
          throw new ProofPackAdequacyError(
            "negative_fixture_variant_coupling_invalid",
            "a coupled operator variation must replace one related falsifier with the controlled complement",
            { fixture_id: fixture.fixture_id, variant_id: variant.variant_id }
          );
        }
      }
      const value = canonicalDigest(targetPatches[0].value);
      if (values.has(value)) throw new ProofPackAdequacyError(
        "negative_fixture_variant_value_ambiguous",
        "one operator value class may occur once per base and semantic surface",
        { fixture_id: fixture.fixture_id, surface_id: surfaceId, value }
      );
      values.add(value);
      const comparableValues = targetPatches[0].path === alternateTargetPath
        ? alternateCandidateValues
        : candidateValues;
      if (comparableValues.some((candidateValue) =>
        canonicalDigest(candidateValue) === value)) selected.add(index);
    }
    selected.add(indexes[0]);
  }
  for (let index = 0; index < expanded.length; index += 1) if (!selected.has(index)) {
    mechanicallyRejected.push({
      variant_id: expanded[index].variant_id,
      outcome: "rejected",
      rejection_basis: "explicit_binding_semantic_value_mismatch",
      expanded_digest: canonicalDigest({
        contract: expanded[index].contract,
        evaluation_input: expanded[index].evaluation_input
      })
    });
  }
  return { selected: [...selected].sort((left, right) => left - right),
    mechanicallyRejected };
}

function evaluateNegativeContractFixtures(profile, fixtures, {
  variation_mode: variationMode = "indexed"
} = {}) {
  const diagnostics = [];
  const results = [];
  if (!Array.isArray(fixtures)) return {
    diagnostics: [{
      code: "negative_fixtures_malformed",
      reason: "fixtures_must_be_array",
      actual_type: fixtures === null ? "null" : typeof fixtures
    }],
    results
  };
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const fixtureId = fixture !== null && typeof fixture === "object" &&
        typeof fixture.fixture_id === "string"
      ? fixture.fixture_id
      : `fixture-index-${index}`;
    if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture) ||
        typeof fixture.fixture_id !== "string" || fixture.fixture_id.length === 0 ||
        fixture.contract === null || typeof fixture.contract !== "object" ||
        Array.isArray(fixture.contract) ||
        fixture.evaluation_input === null || typeof fixture.evaluation_input !== "object" ||
        Array.isArray(fixture.evaluation_input)) {
      diagnostics.push({
        code: "negative_fixture_malformed",
        fixture_id: fixtureId,
        fixture_index: index,
        reason: "fixture_shape_invalid"
      });
      results.push({ fixture_id: fixtureId, outcome: "malformed" });
      continue;
    }
    let expanded;
    try {
      expanded = expandFixedFixtureVariations(fixture);
    } catch (error) {
      diagnostics.push({
        code: error instanceof ProofPackAdequacyError
          ? error.code
          : "negative_fixture_evaluation_failed",
        fixture_id: fixtureId,
        message: error instanceof Error ? error.message : String(error)
      });
      results.push({ fixture_id: fixtureId, outcome: "malformed" });
      continue;
    }
    if (!["indexed", "full_census"].includes(variationMode)) {
      diagnostics.push({
        code: "negative_fixture_variation_mode_invalid",
        fixture_id: fixtureId,
        variation_mode: variationMode
      });
      results.push({ fixture_id: fixtureId, outcome: "malformed" });
      continue;
    }
    let selection;
    try {
      selection = variationMode === "full_census"
        ? { selected: expanded.map((_, candidateIndex) => candidateIndex),
            mechanicallyRejected: [] }
        : selectIndexedSemanticVariations(profile, fixture, expanded);
    } catch (error) {
      if (!(error instanceof ProofPackAdequacyError)) throw error;
      diagnostics.push({ code: error.code, fixture_id: fixtureId, ...error.details });
      results.push({ fixture_id: fixtureId, outcome: "malformed" });
      continue;
    }
    const variantResults = [...selection.mechanicallyRejected];
    for (const variantIndex of selection.selected) {
      const variant = expanded[variantIndex];
      let evaluation;
      try {
        evaluation = evaluateVerificationProfileV034({
          contract: structuredClone(variant.contract),
          profile: structuredClone(profile),
          evaluation_input: structuredClone(variant.evaluation_input)
        });
      } catch (error) {
        variantResults.push({
          variant_id: variant.variant_id,
          outcome: "malformed",
          message: error instanceof Error ? error.message : String(error),
          expanded_digest: canonicalDigest({
            contract: variant.contract, evaluation_input: variant.evaluation_input
          })
        });
        continue;
      }
      const structurallyValid = evaluation.profile_valid && evaluation.input_valid &&
        evaluation.contract_valid;
      variantResults.push({
        variant_id: variant.variant_id,
        outcome: !structurallyValid
          ? "malformed"
          : evaluation.satisfaction === "unsatisfied" ||
              evaluation.satisfaction === "invalid"
            ? "rejected"
            : evaluation.satisfaction === "satisfied"
              ? "survived"
              : "ambiguous",
        profile_satisfaction: evaluation.satisfaction,
        expanded_digest: canonicalDigest({
          contract: variant.contract, evaluation_input: variant.evaluation_input
        })
      });
    }
    variantResults.sort((left, right) => compareCodeUnits(left.variant_id, right.variant_id));
    const outcome = variantResults.some(({ outcome: value }) => value === "malformed")
      ? "malformed"
      : variantResults.some(({ outcome: value }) => value === "survived")
        ? "survived"
        : variantResults.some(({ outcome: value }) => value === "ambiguous")
          ? "ambiguous"
          : "rejected";
    results.push({
      fixture_id: fixtureId,
      outcome,
      ...(fixture.variations === undefined
        ? { profile_satisfaction: variantResults[0].profile_satisfaction }
        : {
            variation_assessment: {
              index_version: VARIATION_INDEX_VERSION,
              mode: variationMode,
              total_expanded_variants: expanded.length,
              structurally_discharged_count: selection.mechanicallyRejected.length,
              evaluated_count: selection.selected.length
            },
            variant_results: variantResults
          })
    });
    if (outcome !== "rejected") diagnostics.push({
      code: outcome === "survived"
        ? "negative_fixture_satisfied"
        : outcome === "malformed"
          ? "negative_fixture_malformed"
          : "negative_fixture_ambiguous",
      fixture_id: fixtureId,
      ...(fixture.variations === undefined
        ? { profile_satisfaction: variantResults[0].profile_satisfaction }
        : {
            variant_ids: variantResults.filter(
              ({ outcome: value }) => value === outcome
            ).map(({ variant_id: id }) => id)
          })
    });
  }
  return { diagnostics, results };
}

function assessCoverageWitnessIndex(profile, adequacy, fixtures, witnessIndex) {
  if (witnessIndex === null || witnessIndex === undefined) return {
    diagnostics: [], results: []
  };
  const diagnostics = [];
  const results = [];
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
  const surfacePointers = new Map(
    (adequacy.guarantee_critical_profile_surfaces ?? []).map(
      ({ surface_id: id, profile_json_pointer: pointer }) => [id, pointer]
    )
  );
  for (const witness of witnessIndex.witnesses) {
    const result = {
      surface_id: witness.surface_id,
      weakening_class: witness.weakening_class,
      fixture_id: witness.fixture_id,
      variant_id: witness.variant_id,
      weakened_profile_digest: witness.weakened_profile_digest
    };
    let candidate;
    try {
      candidate = applyFixedReplacementPatches(
        profile, witness.profile_patches, "coverage-witness-index",
        witness.variant_id, "profile"
      );
    } catch (error) {
      diagnostics.push({
        code: error instanceof ProofPackAdequacyError
          ? error.code
          : "coverage_witness_profile_patch_failed",
        ...result,
        message: error instanceof Error ? error.message : String(error)
      });
      results.push({ ...result, outcome: "malformed" });
      continue;
    }
    const actualDigest = profileDigest(candidate);
    if (actualDigest !== witness.weakened_profile_digest) diagnostics.push({
      code: "coverage_witness_weakened_profile_digest_mismatch",
      ...result,
      actual_weakened_profile_digest: actualDigest
    });
    const surfacePointer = surfacePointers.get(witness.surface_id);
    const originalSurface = resolveJsonPointer(profile, surfacePointer);
    const weakenedSurface = resolveJsonPointer(candidate, surfacePointer);
    if (!originalSurface.found || !weakenedSurface.found ||
        canonicalDigest(originalSurface.value) === canonicalDigest(weakenedSurface.value)) {
      diagnostics.push({
        code: "coverage_witness_surface_unchanged",
        ...result,
        profile_json_pointer: surfacePointer
      });
      results.push({ ...result, outcome: "malformed" });
      continue;
    }
    if (!validateProfileSchemaV034(candidate)) {
      diagnostics.push({
        code: "coverage_witness_profile_schema_invalid",
        ...result,
        errors: structuredClone(validateProfileSchemaV034.errors ?? [])
      });
      results.push({ ...result, outcome: "malformed" });
      continue;
    }
    const semanticDiagnostics = validateProfileSemanticsV034(candidate);
    if (semanticDiagnostics.length > 0) {
      diagnostics.push({
        code: "coverage_witness_profile_semantics_invalid",
        ...result,
        diagnostics: semanticDiagnostics
      });
      results.push({ ...result, outcome: "malformed" });
      continue;
    }
    const fixture = fixtureById.get(witness.fixture_id);
    const isolated = fixture.variations === undefined
      ? fixture
      : {
          ...fixture,
          covers: fixture.covers.filter(
            ({ surface_id: surfaceId, weakening_class: weakeningClass }) =>
              surfaceId === witness.surface_id &&
              weakeningClass === witness.weakening_class
          ),
          variations: fixture.variations.filter(
            ({ variant_id: id }) => id === witness.variant_id
          )
        };
    const assessment = evaluateNegativeContractFixtures(candidate, [isolated], {
      variation_mode: "full_census"
    });
    const outcome = assessment.results[0]?.outcome ?? "malformed";
    results.push({ ...result, outcome });
    if (outcome !== "survived") diagnostics.push({
      code: "coverage_witness_did_not_survive",
      ...result,
      outcome
    });
    if (outcome !== "survived") continue;
    const restoredSurfaceCandidate = profileWithReplacement(
      candidate, surfacePointer, originalSurface.value
    );
    const restoredSurfaceSchemaValid =
      validateProfileSchemaV034(restoredSurfaceCandidate);
    const restoredSurfaceSemanticDiagnostics = restoredSurfaceSchemaValid
      ? validateProfileSemanticsV034(restoredSurfaceCandidate)
      : [];
    if (restoredSurfaceSchemaValid &&
        restoredSurfaceSemanticDiagnostics.length === 0) {
      const restoredSurfaceAssessment = evaluateNegativeContractFixtures(
        restoredSurfaceCandidate, [isolated], { variation_mode: "full_census" }
      );
      const restoredSurfaceOutcome =
        restoredSurfaceAssessment.results[0]?.outcome ?? "malformed";
      if (restoredSurfaceOutcome === "survived") diagnostics.push({
        code: "coverage_witness_surface_not_load_bearing",
        ...result,
        profile_json_pointer: surfacePointer
      });
    }
    for (let patchIndex = 0;
      patchIndex < witness.profile_patches.length;
      patchIndex += 1) {
      const retainedPatches = witness.profile_patches.filter(
        (_, candidateIndex) => candidateIndex !== patchIndex
      );
      let ablatedOutcome = "malformed";
      try {
        const ablated = applyFixedReplacementPatches(
          profile, retainedPatches, "coverage-witness-ablation",
          witness.variant_id, "profile"
        );
        if (validateProfileSchemaV034(ablated) &&
            validateProfileSemanticsV034(ablated).length === 0) {
          const ablatedAssessment = evaluateNegativeContractFixtures(
            ablated, [isolated], { variation_mode: "full_census" }
          );
          ablatedOutcome = ablatedAssessment.results[0]?.outcome ?? "malformed";
        }
      } catch {
        ablatedOutcome = "malformed";
      }
      if (ablatedOutcome === "survived") diagnostics.push({
        code: "coverage_witness_patch_not_load_bearing",
        ...result,
        patch_index: patchIndex,
        patch_path: witness.profile_patches[patchIndex].path
      });
    }
  }
  return { diagnostics, results };
}

async function runLoadedProofPackAdequacy(pack, {
  variationMode = "indexed"
} = {}) {
  if (!loadedProofPackSnapshots.has(pack)) throw new ProofPackAdequacyError(
    "proof_pack_snapshot_unrecognized",
    "adequacy execution requires the exact immutable snapshot returned by loadProofPack"
  );
  const captures = [
    ...pack.executable_snapshots,
    ...(pack.negative_fixture_snapshots ?? [])
  ];
  const profileRelativePath = path.relative(pack.repository_root, pack.profile_path);
  if (profileRelativePath !== ".." &&
      !profileRelativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(profileRelativePath) &&
      !captures.some(({ path: capturedPath }) => capturedPath === profileRelativePath)) {
    captures.push({
      path: profileRelativePath,
      sha256: pack.profile_sha256,
      source_base64: pack.profile_source_base64
    });
  }
  const snapshotRoot = await materializeCapturedModuleGraph(
    pack.repository_root,
    captures
  );
  let observations;
  try {
    const snapshotModulePath = path.join(
      snapshotRoot,
      pack.adequacy.executable_module
    );
    const moduleUrl = `${pathToFileURL(snapshotModulePath).href}` +
      `?profile_digest=${pack.profile_digest}`;
    const executable = await import(moduleUrl);
    if (typeof executable.runProofPackAdequacyControls !== "function") {
      throw new ProofPackAdequacyError(
        "adequacy_export_missing",
        "adequacy executable module must export runProofPackAdequacyControls"
      );
    }
    observations = await executable.runProofPackAdequacyControls({
      profile: structuredClone(pack.profile),
      profile_digest: pack.profile_digest
    });
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
  const diagnostics = assessAdequacyRun(pack, observations);
  const negativeFixtureAssessment = evaluateNegativeContractFixtures(
    pack.profile, pack.negative_fixtures ?? [], { variation_mode: variationMode }
  );
  diagnostics.push(...negativeFixtureAssessment.diagnostics);
  const coverageWitnessAssessment = assessCoverageWitnessIndex(
    pack.profile, pack.adequacy, pack.negative_fixtures ?? [],
    pack.coverage_witness_index
  );
  diagnostics.push(...coverageWitnessAssessment.diagnostics);
  const negativeFixtureResults = negativeFixtureAssessment.results;
  diagnostics.sort((left, right) => compareCodeUnits(
    `${left.code}\0${left.fixture_id ?? left.control_id ?? ""}`,
    `${right.code}\0${right.fixture_id ?? right.control_id ?? ""}`
  ));
  return {
    tool_version: PROOF_PACK_ADEQUACY_TOOL_VERSION,
    authority: { kind: "experimental_local", authoritative: false },
    pack: {
      profile_id: pack.profile.profile_id,
      profile_version: pack.profile.profile_version,
      profile_digest: pack.profile_digest,
      guarantee_digest: pack.adequacy.guarantee_digest,
      adequacy_digest: pack.adequacy_digest
    },
    passed: diagnostics.length === 0,
    control_count: observations?.controls?.length ?? 0,
    negative_fixture_count: negativeFixtureResults.length,
    coverage_witness_count: coverageWitnessAssessment.results.length,
    diagnostics,
    observations,
    negative_fixture_results: negativeFixtureResults,
    coverage_witness_results: coverageWitnessAssessment.results
  };
}

async function runProofPackAdequacy(packDirectory, options = {}) {
  const { variationMode = "indexed", ...loadOptions } = options;
  const pack = await loadProofPack(packDirectory, loadOptions);
  return runLoadedProofPackAdequacy(pack, { variationMode });
}

export {
  COVERAGE_WITNESS_INDEX_SCHEMA,
  COVERAGE_WITNESS_INDEX_VERSION,
  DEFAULT_REPOSITORY_ROOT,
  PROOF_PACK_ADEQUACY_RUN_SCHEMA,
  PROOF_PACK_ADEQUACY_RUN_VERSION,
  PROOF_PACK_ADEQUACY_SCHEMA,
  PROOF_PACK_ADEQUACY_TOOL_VERSION,
  PROOF_PACK_ADEQUACY_VERSION,
  ProofPackAdequacyError,
  assessAdequacyRun,
  assessCoverageWitnessIndex,
  assessNegativeFixtureSemanticDiscrimination,
  canonicalDigest,
  claimNestedSemanticDescriptors,
  evaluateNegativeContractFixtures,
  guaranteeDigest,
  loadProofPack,
  profileDigest,
  runLoadedProofPackAdequacy,
  runProofPackAdequacy,
  validateGenericCoverageDeclaration,
  validateCoverageWitnessIndex,
  validateProofPackAdequacy,
  validateProofPackAdequacyRun
};
