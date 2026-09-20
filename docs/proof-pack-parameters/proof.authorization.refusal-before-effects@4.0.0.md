# proof.authorization.refusal-before-effects@4.0.0

<!-- Generated from validated package metadata. -->

Given one declared operation attempt, one declared refusal event, one declared authority, one declared unauthorized subject, one declared reusable operation, and one complete caller-supplied protected-effect list bound to an exact declared cardinality, this pack establishes only in the declared controlled graph that: the attempt performs the operation and uses the subject; the authority does not authorize that subject for the operation; the refusal rejects that exact attempt; the attempt precedes a protected-interval witness which precedes the refusal; before that refusal the same attempt neither writes nor mutates any listed protected effect; and the verification reads the exact attempt, refusal, operation, and every listed protected effect, with a positive same-attempt, same-population, same-refusal pre-refusal write or mutation as the corresponding falsifier.

Profile digest: e5cfc6aec27a79ce6e0c165bbf29ea676b9a0a5a62093c0ed43e44116c968c0b. Parameter digest: 469b78bae23cf25fec3598b15b833b0d50ab4f0e91f3c3e0e5145a13d224fd7e.

Admission digest: 6e6c579d82d47d400fac87ed39d9abb4b7cb2b38b3f59f17abc96eba64858863.

Roles: 10/10 accounted; 0 owned gaps. Semantic parameters: 9; internal roles: 1.

## Guarantee and exclusions

Given one declared operation attempt, one declared refusal event, one declared authority, one declared unauthorized subject, one declared reusable operation, and one complete caller-supplied protected-effect list bound to an exact declared cardinality, this pack establishes only in the declared controlled graph that: the attempt performs the operation and uses the subject; the authority does not authorize that subject for the operation; the refusal rejects that exact attempt; the attempt precedes a protected-interval witness which precedes the refusal; before that refusal the same attempt neither writes nor mutates any listed protected effect; and the verification reads the exact attempt, refusal, operation, and every listed protected effect, with a positive same-attempt, same-population, same-refusal pre-refusal write or mutation as the corresponding falsifier.

- cce-consequences
- completeness-beyond-declared-protected-effect-population
- evidence-authority
- pack-applicability
- production-path-discovery
- truthful-grounding

## Parameters

### operation

Declare operation for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/0",
      "value": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation",
          "cc:capability",
          "cc:command"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "subject-unauthorized-for-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-observes-exact-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "operation"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "attempt",
          "protected_interval",
          "refusal"
        ]
      }
    }
  ]
}
```

### attempt

Declare attempt for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/1",
      "value": {
        "role": "attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "attempt-uses-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "no-protected-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "write-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "mutation-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "refusal-rejects-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "attempt-precedes-protected-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-observes-exact-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "operation"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "no-protected-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "attempt",
          "protected_interval",
          "refusal"
        ]
      }
    }
  ]
}
```

### subject

Declare subject for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/2",
      "value": {
        "role": "subject",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "attempt-uses-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "subject-unauthorized-for-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "subject",
          "authority"
        ]
      }
    }
  ]
}
```

### authority

Declare authority for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/3",
      "value": {
        "role": "authority",
        "allowed_type_terms": [
          "cc:authority"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "subject-unauthorized-for-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "subject",
          "authority"
        ]
      }
    }
  ]
}
```

### refusal

Declare refusal for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/4",
      "value": {
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "no-protected-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "write-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "mutation-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "refusal-rejects-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "protected-interval-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_interval",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-observes-exact-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "operation"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "no-protected-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "attempt",
          "protected_interval",
          "refusal"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "write-verification-target",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "mutation-verification-target",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal"
          ]
        }
      }
    }
  ]
}
```

### protected_interval

Declare protected interval for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: bounded_observation.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/5",
      "value": {
        "role": "protected_interval",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "attempt-precedes-protected-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "protected-interval-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_interval",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "attempt",
          "protected_interval",
          "refusal"
        ]
      }
    }
  ]
}
```

### protected_effect_population

Declare protected effect population for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/6",
      "value": {
        "role": "protected_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "mutation-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "protected-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_effect_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "protected-effect-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_effect_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "protected_effect_count"
            }
          ]
        }
      }
    }
  ]
}
```

### protected_effects

Declare protected effects for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/7",
      "value": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:resource",
          "cc:configuration",
          "cc:state",
          "cc:artifact"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "no-protected-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "write-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "mutation-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "protected-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_effect_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-observes-exact-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "operation"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "no-protected-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "protected_effects",
        "number_role": "protected_effect_count"
      }
    }
  ]
}
```

### verification

Declare verification for proof.authorization.refusal-before-effects. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/8",
      "value": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "write-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "mutation-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-observes-exact-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "operation"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| operation | semantic_parameter | operation |  |
| attempt | semantic_parameter | attempt |  |
| subject | semantic_parameter | subject |  |
| authority | semantic_parameter | authority |  |
| refusal | semantic_parameter | refusal |  |
| protected_interval | semantic_parameter | protected_interval |  |
| protected_effect_population | semantic_parameter | protected_effect_population |  |
| protected_effects | semantic_parameter | protected_effects |  |
| verification | semantic_parameter | verification |  |
| protected_effect_count | complete_population_count | protected_effects |  |

```json
{
  "roles": [
    {
      "role": "operation",
      "kind": "semantic_parameter",
      "parameter": "operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation",
          "cc:capability",
          "cc:command"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt",
      "kind": "semantic_parameter",
      "parameter": "attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "subject",
      "kind": "semantic_parameter",
      "parameter": "subject",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "subject",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority",
      "kind": "semantic_parameter",
      "parameter": "authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority",
        "allowed_type_terms": [
          "cc:authority"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "refusal",
      "kind": "semantic_parameter",
      "parameter": "refusal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "protected_interval",
      "kind": "semantic_parameter",
      "parameter": "protected_interval",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_interval",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "protected_effect_population",
      "kind": "semantic_parameter",
      "parameter": "protected_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/6",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "protected_effects",
      "kind": "semantic_parameter",
      "parameter": "protected_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:resource",
          "cc:configuration",
          "cc:state",
          "cc:artifact"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "protected_effect_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "protected_effects"
      ],
      "rule_refs": [
        "/claim_patterns/7",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effect_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "operation",
          "attempt",
          "protected_interval",
          "refusal"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "subject",
          "authority"
        ]
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "protected_effects",
        "number_role": "protected_effect_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "attempt-uses-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "subject-unauthorized-for-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "refusal-rejects-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "attempt-precedes-protected-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "protected-interval-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_interval",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "protected-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_effect_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "protected-effect-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_effect_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "verification-observes-exact-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "operation"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "no-protected-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "no-protected-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "write-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "mutation-prohibition-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "write-verification-target",
        "role": "verifies",
        "source_claim_pattern_id": "write-prohibition-verification",
        "target_claim_pattern_id": "no-protected-write-before-refusal"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "mutation-verification-target",
        "role": "verifies",
        "source_claim_pattern_id": "mutation-prohibition-verification",
        "target_claim_pattern_id": "no-protected-mutation-before-refusal"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "write-verification-target",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "mutation-verification-target",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal"
          ]
        }
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "profile_proof_population",
        "member_claim_pattern_ids": [
          "attempt-performs-operation",
          "attempt-uses-subject",
          "subject-unauthorized-for-operation",
          "refusal-rejects-attempt",
          "attempt-precedes-protected-interval",
          "protected-interval-precedes-refusal",
          "verification-observes-exact-proof-subjects"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "attempt-performs-operation"
          },
          {
            "pattern": "attempt-uses-subject"
          },
          {
            "pattern": "subject-unauthorized-for-operation"
          },
          {
            "pattern": "refusal-rejects-attempt"
          },
          {
            "pattern": "attempt-precedes-protected-interval"
          },
          {
            "pattern": "protected-interval-precedes-refusal"
          },
          {
            "pattern": "protected-effect-population-membership"
          },
          {
            "pattern": "protected-effect-population-cardinality"
          },
          {
            "pattern": "verification-observes-exact-proof-subjects"
          },
          {
            "pattern": "no-protected-write-before-refusal"
          },
          {
            "pattern": "no-protected-mutation-before-refusal"
          },
          {
            "pattern": "write-prohibition-verification"
          },
          {
            "pattern": "mutation-prohibition-verification"
          },
          {
            "pattern": "write-verification-target"
          },
          {
            "pattern": "mutation-verification-target"
          },
          {
            "pattern": "proof-population"
          }
        ]
      }
    }
  ]
}
```

## Construction, dependencies and capabilities

```json
{
  "construction": {
    "capability": "construction",
    "semantic_inputs": [
      "operation",
      "attempt",
      "subject",
      "authority",
      "refusal",
      "protected_interval",
      "protected_effect_population",
      "protected_effects",
      "verification"
    ],
    "declaration_outputs": [],
    "required_observations": [],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.authorization.refusal-before-effects.",
      "source": "lib/proof-authoring-skeleton.mjs",
      "consequence": "Do not infer independent construction or supporting packs; work record must retain this unresolved construction fact."
    }
  },
  "capabilities": [
    {
      "id": "construction",
      "kind": "constructor",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/proof-authoring-skeleton.mjs: general binding assistance requires an existing populated native contract.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "No named proof.authorization.refusal-before-effects constructor maps semantic inputs to the complete native graph.",
        "source": "lib/proof-authoring-skeleton.mjs",
        "consequence": "work record must report unavailable construction; binding by compatible type does not establish a source mapping."
      },
      "implementation_version": null
    },
    {
      "id": "canonical-source",
      "kind": "canonical_resolver",
      "state": "declared_requirement",
      "identity": null,
      "evidence": "work record owns canonical instance source resolution; metadata does not resolve a WK.",
      "evidence_kind": "requirement",
      "gap": null,
      "implementation_version": null
    },
    {
      "id": "observation",
      "kind": "observation_acquisition",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/verification-profile-runtime.mjs validates bound declarations; it is not a general observation acquisition provider.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "No general observation acquisition mapping for proof.authorization.refusal-before-effects.",
        "source": "lib/verification-profile-runtime.mjs",
        "consequence": "Required observations remain unavailable until their actual owner supplies acquired evidence."
      },
      "implementation_version": null
    },
    {
      "id": "evaluation",
      "kind": "evaluation",
      "state": "implemented",
      "identity": "@agent-chassis/controlled-contract#evaluateVerificationProfileV1",
      "evidence": "lib/verification-profile-v1.mjs: incumbent exact profile evaluation; certification is distinct from implementation truth.",
      "evidence_kind": "static",
      "gap": null,
      "implementation_version": "1.0.0"
    }
  ]
}
```

Metadata is a declaration. It does not acquire observations or certify implementation truth.
