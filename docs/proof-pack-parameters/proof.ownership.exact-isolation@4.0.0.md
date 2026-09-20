# proof.ownership.exact-isolation@4.0.0

<!-- Generated from validated package metadata. -->

Given one grounded owned resource, legitimate owner, distinct foreign subject, legitimate authority, reusable operation, refused foreign attempt, protected interval, complete authority-state observations before the foreign attempt and after refusal, and a distinct later valid attempt and expected successful result: the resource is assigned to the legitimate owner; the authority authorizes that owner but not the foreign subject for the operation; the foreign attempt targets the exact resource and is refused before writing or mutating it; the authority state after refusal equals its state before the attempt; and the later attempt uses the same authority, owner, operation, and resource and reaches the expected result state.

Profile digest: 9446d388315a4c607f7b3fd4b0b28c066f866d34215b129eb7ac8c9295f777cd. Parameter digest: 1dce9d21d4fe40221981092258ff72cf3f7349a26c6214ad2bd7f71988d4793e.

Admission digest: 113feeab0197dc985b2c35d96f028db499680d3547a86a3ddf33ee9d08702092.

Roles: 26/26 accounted; 3 owned gaps. Semantic parameters: 23; internal roles: 3.

## Guarantee and exclusions

Given one grounded owned resource, legitimate owner, distinct foreign subject, legitimate authority, reusable operation, refused foreign attempt, protected interval, complete authority-state observations before the foreign attempt and after refusal, and a distinct later valid attempt and expected successful result: the resource is assigned to the legitimate owner; the authority authorizes that owner but not the foreign subject for the operation; the foreign attempt targets the exact resource and is refused before writing or mutating it; the authority state after refusal equals its state before the attempt; and the later attempt uses the same authority, owner, operation, and resource and reaches the expected result state.

- concurrent-owner-access
- delivered-evidence-authenticity
- external-authorization-policy
- ownership-discovery-completeness
- pack-applicability
- resources-outside-owned-resource
- truthful-identity-and-observation-grounding

## Parameters

### operation

Declare operation for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "authority-authorizes-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "authority-does-not-authorize-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "later-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "foreign-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "operation",
          "owned_resource",
          "legitimate_authority"
        ]
      }
    }
  ]
}
```

### owned_resource

Declare owned resource for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "owned_resource",
        "allowed_type_terms": [
          "cc:resource",
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "resource-owned-by-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "owned_resource",
          "operator": "reference:has_property",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "no-foreign-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "write-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-foreign-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "mutation-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "later-attempt-targets-same-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "foreign-attempt-targets-owned-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "operation",
          "owned_resource",
          "legitimate_authority"
        ]
      }
    }
  ]
}
```

### legitimate_owner

Declare legitimate owner for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "legitimate_owner",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "resource-owned-by-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "owned_resource",
          "operator": "reference:has_property",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "authority-authorizes-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-attempt-uses-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "legitimate_owner",
          "foreign_subject"
        ]
      }
    }
  ]
}
```

### foreign_subject

Declare foreign subject for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "foreign_subject",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "authority-does-not-authorize-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "foreign-attempt-uses-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "legitimate_owner",
          "foreign_subject"
        ]
      }
    }
  ]
}
```

### legitimate_authority

Declare legitimate authority for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "legitimate_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "authority-authorizes-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "authority-does-not-authorize-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumption_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "authority-state-before-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "operation",
          "owned_resource",
          "legitimate_authority"
        ]
      }
    }
  ]
}
```

### foreign_attempt

Declare foreign attempt for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/5",
      "value": {
        "role": "foreign_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "authority-observation-before-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_observation_before",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "no-foreign-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "write-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "write-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-foreign-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "mutation-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "mutation-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "foreign-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "foreign-attempt-targets-owned-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "foreign-attempt-uses-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "foreign-attempt-precedes-protected-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
        "pattern_id": "refusal-rejects-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "protected_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "authority-state-before-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "foreign_attempt",
          "protected_interval",
          "refusal",
          "later_valid_attempt",
          "later_valid_result"
        ]
      }
    }
  ]
}
```

### protected_interval

Declare protected interval for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/6",
      "value": {
        "role": "protected_interval",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "foreign-attempt-precedes-protected-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
      "ref": "/claim_patterns/7",
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
        "pattern_id": "refusal-rejects-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "protected_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "foreign_attempt",
          "protected_interval",
          "refusal",
          "later_valid_attempt",
          "later_valid_result"
        ]
      }
    }
  ]
}
```

### refusal

Declare refusal for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/7",
      "value": {
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "no-foreign-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "write-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-foreign-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "mutation-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "authority-observation-after-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_observation_after",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "legitimate-authority-unconsumed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "nonconsumption-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_observation_before"
            },
            {
              "kind": "reference",
              "role": "authority_observation_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "refusal-precedes-later-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "later-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
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
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-attempt-uses-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "later-attempt-targets-same-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
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
        "pattern_id": "refusal-rejects-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "protected_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "foreign_attempt",
          "protected_interval",
          "refusal",
          "later_valid_attempt",
          "later_valid_result"
        ]
      }
    }
  ]
}
```

### authority_state_before

Declare authority state before for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_state_before",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "authority-observation-before-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_observation_before",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "legitimate-authority-unconsumed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumption_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "authority-state-before-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "authority_state_before",
          "authority_state_after_refusal",
          "later_result_state",
          "expected_success_state"
        ]
      }
    }
  ]
}
```

### authority_state_after_refusal

Declare authority state after refusal for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/9",
      "value": {
        "role": "authority_state_after_refusal",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "authority-observation-after-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_observation_after",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "legitimate-authority-unconsumed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumption_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "authority_state_before",
          "authority_state_after_refusal",
          "later_result_state",
          "expected_success_state"
        ]
      }
    }
  ]
}
```

### later_valid_attempt

Declare later valid attempt for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/12",
      "value": {
        "role": "later_valid_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "refusal-precedes-later-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "later-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
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
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-attempt-uses-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "later-attempt-targets-same-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "later-attempt-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "later-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "later-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "foreign_attempt",
          "protected_interval",
          "refusal",
          "later_valid_attempt",
          "later_valid_result"
        ]
      }
    }
  ]
}
```

### later_valid_result

Declare later valid result for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/13",
      "value": {
        "role": "later_valid_result",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "later-attempt-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "later-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "later-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "result-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "later-valid-attempt-succeeds",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "later-success-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "later-success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "foreign_attempt",
          "protected_interval",
          "refusal",
          "later_valid_attempt",
          "later_valid_result"
        ]
      }
    }
  ]
}
```

### later_result_state

Declare later result state for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/14",
      "value": {
        "role": "later_result_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "later-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "result-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "later-valid-attempt-succeeds",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "later-success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "authority_state_before",
          "authority_state_after_refusal",
          "later_result_state",
          "expected_success_state"
        ]
      }
    }
  ]
}
```

### expected_success_state

Declare expected success state for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/15",
      "value": {
        "role": "expected_success_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "expected-state-conforms-to-success",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "later-valid-attempt-succeeds",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "later-success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "authority_state_before",
          "authority_state_after_refusal",
          "later_result_state",
          "expected_success_state"
        ]
      }
    }
  ]
}
```

### success_criterion

Declare success criterion for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/17",
      "value": {
        "role": "success_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "expected-state-conforms-to-success",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    }
  ]
}
```

### write_verification

Declare write verification for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/18",
      "value": {
        "role": "write_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "write-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "write-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "write_verification",
          "mutation_verification",
          "nonconsumption_verification",
          "later_success_verification"
        ]
      }
    }
  ]
}
```

### mutation_verification

Declare mutation verification for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/19",
      "value": {
        "role": "mutation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "mutation-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "mutation-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "write_verification",
          "mutation_verification",
          "nonconsumption_verification",
          "later_success_verification"
        ]
      }
    }
  ]
}
```

### nonconsumption_verification

Declare nonconsumption verification for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/20",
      "value": {
        "role": "nonconsumption_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "nonconsumption-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_observation_before"
            },
            {
              "kind": "reference",
              "role": "authority_observation_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumption_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "write_verification",
          "mutation_verification",
          "nonconsumption_verification",
          "later_success_verification"
        ]
      }
    }
  ]
}
```

### later_success_verification

Declare later success verification for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/21",
      "value": {
        "role": "later_success_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "later-success-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "later-success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "write_verification",
          "mutation_verification",
          "nonconsumption_verification",
          "later_success_verification"
        ]
      }
    }
  ]
}
```

### foreign_write_condition

Declare foreign write condition for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/22",
      "value": {
        "role": "foreign_write_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "write-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "foreign_write_condition",
          "foreign_mutation_condition",
          "authority_consumption_condition",
          "later_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "write-verifies-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "foreign_write_condition"
          ]
        }
      }
    }
  ]
}
```

### foreign_mutation_condition

Declare foreign mutation condition for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/23",
      "value": {
        "role": "foreign_mutation_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "mutation-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "foreign_write_condition",
          "foreign_mutation_condition",
          "authority_consumption_condition",
          "later_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "mutation-verifies-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "foreign_mutation_condition"
          ]
        }
      }
    }
  ]
}
```

### authority_consumption_condition

Declare authority consumption condition for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/24",
      "value": {
        "role": "authority_consumption_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumption_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "foreign_write_condition",
          "foreign_mutation_condition",
          "authority_consumption_condition",
          "later_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "nonconsumption-verifies-authority",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_consumption_condition"
          ]
        }
      }
    }
  ]
}
```

### later_failure_condition

Declare later failure condition for proof.ownership.exact-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/25",
      "value": {
        "role": "later_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "later-success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "foreign_write_condition",
          "foreign_mutation_condition",
          "authority_consumption_condition",
          "later_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "later-success-verifies-result",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "later_failure_condition"
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
| owned_resource | semantic_parameter | owned_resource |  |
| legitimate_owner | semantic_parameter | legitimate_owner |  |
| foreign_subject | semantic_parameter | foreign_subject |  |
| legitimate_authority | semantic_parameter | legitimate_authority |  |
| foreign_attempt | semantic_parameter | foreign_attempt |  |
| protected_interval | semantic_parameter | protected_interval |  |
| refusal | semantic_parameter | refusal |  |
| authority_state_before | semantic_parameter | authority_state_before |  |
| authority_state_after_refusal | semantic_parameter | authority_state_after_refusal |  |
| authority_observation_before | observation_requirement |  | Acquire authority_observation_before for the exact subject, attempt and applicability in this profile. |
| authority_observation_after | observation_requirement |  | Acquire authority_observation_after for the exact subject, attempt and applicability in this profile. |
| later_valid_attempt | semantic_parameter | later_valid_attempt |  |
| later_valid_result | semantic_parameter | later_valid_result |  |
| later_result_state | semantic_parameter | later_result_state |  |
| expected_success_state | semantic_parameter | expected_success_state |  |
| result_observation | observation_requirement |  | Acquire result_observation for the exact subject, attempt and applicability in this profile. |
| success_criterion | semantic_parameter | success_criterion |  |
| write_verification | semantic_parameter | write_verification |  |
| mutation_verification | semantic_parameter | mutation_verification |  |
| nonconsumption_verification | semantic_parameter | nonconsumption_verification |  |
| later_success_verification | semantic_parameter | later_success_verification |  |
| foreign_write_condition | semantic_parameter | foreign_write_condition |  |
| foreign_mutation_condition | semantic_parameter | foreign_mutation_condition |  |
| authority_consumption_condition | semantic_parameter | authority_consumption_condition |  |
| later_failure_condition | semantic_parameter | later_failure_condition |  |

```json
{
  "roles": [
    {
      "role": "operation",
      "kind": "semantic_parameter",
      "parameter": "operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/23",
        "/claim_patterns/3",
        "/distinct_reference_role_sets/6"
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
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "owned_resource",
      "kind": "semantic_parameter",
      "parameter": "owned_resource",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/claim_patterns/26",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "owned_resource",
        "allowed_type_terms": [
          "cc:resource",
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "legitimate_owner",
      "kind": "semantic_parameter",
      "parameter": "legitimate_owner",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "legitimate_owner",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "foreign_subject",
      "kind": "semantic_parameter",
      "parameter": "foreign_subject",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "foreign_subject",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "legitimate_authority",
      "kind": "semantic_parameter",
      "parameter": "legitimate_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/17",
        "/claim_patterns/2",
        "/claim_patterns/21",
        "/claim_patterns/24",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "legitimate_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "foreign_attempt",
      "kind": "semantic_parameter",
      "parameter": "foreign_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "foreign_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_interval",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_state_before",
      "kind": "semantic_parameter",
      "parameter": "authority_state_before",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/19",
        "/claim_patterns/21",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_state_before",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_state_after_refusal",
      "kind": "semantic_parameter",
      "parameter": "authority_state_after_refusal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/21",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_state_after_refusal",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_observation_before",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/20",
        "/distinct_reference_role_sets/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire authority_observation_before for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.exact-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "authority_observation_before",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_observation_after",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/20",
        "/distinct_reference_role_sets/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire authority_observation_after for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.exact-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "authority_observation_after",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_valid_attempt",
      "kind": "semantic_parameter",
      "parameter": "later_valid_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_valid_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_valid_result",
      "kind": "semantic_parameter",
      "parameter": "later_valid_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_valid_result",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_result_state",
      "kind": "semantic_parameter",
      "parameter": "later_result_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/29",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_result_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "expected_success_state",
      "kind": "semantic_parameter",
      "parameter": "expected_success_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/30",
        "/claim_patterns/32",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_success_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "result_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/31",
        "/claim_patterns/33",
        "/distinct_reference_role_sets/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire result_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.exact-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "result_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "success_criterion",
      "kind": "semantic_parameter",
      "parameter": "success_criterion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/30"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "success_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "write_verification",
      "kind": "semantic_parameter",
      "parameter": "write_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "write_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "mutation_verification",
      "kind": "semantic_parameter",
      "parameter": "mutation_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mutation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "nonconsumption_verification",
      "kind": "semantic_parameter",
      "parameter": "nonconsumption_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "nonconsumption_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_success_verification",
      "kind": "semantic_parameter",
      "parameter": "later_success_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_success_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "foreign_write_condition",
      "kind": "semantic_parameter",
      "parameter": "foreign_write_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/distinct_reference_role_sets/5",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "foreign_write_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "foreign_mutation_condition",
      "kind": "semantic_parameter",
      "parameter": "foreign_mutation_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/5",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "foreign_mutation_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_consumption_condition",
      "kind": "semantic_parameter",
      "parameter": "authority_consumption_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/distinct_reference_role_sets/5",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_consumption_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "later_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/34",
        "/distinct_reference_role_sets/5",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "legitimate_owner",
          "foreign_subject"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "foreign_attempt",
          "protected_interval",
          "refusal",
          "later_valid_attempt",
          "later_valid_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "authority_state_before",
          "authority_state_after_refusal",
          "later_result_state",
          "expected_success_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "authority_observation_before",
          "authority_observation_after",
          "result_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "write_verification",
          "mutation_verification",
          "nonconsumption_verification",
          "later_success_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "constraint": {
        "roles": [
          "foreign_write_condition",
          "foreign_mutation_condition",
          "authority_consumption_condition",
          "later_failure_condition"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "constraint": {
        "roles": [
          "operation",
          "owned_resource",
          "legitimate_authority"
        ]
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "resource-owned-by-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "owned_resource",
          "operator": "reference:has_property",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "authority-authorizes-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "authority-does-not-authorize-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
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
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "foreign-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "foreign-attempt-targets-owned-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "foreign-attempt-uses-foreign-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "foreign-attempt-precedes-protected-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
      "ref": "/claim_patterns/7",
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
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "refusal-rejects-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "protected_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "authority-state-before-foreign-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "authority-observation-before-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_observation_before",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "foreign_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "no-foreign-write-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "write-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "write-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "write_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "no-foreign-mutation-before-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "foreign_attempt",
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
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "mutation-verification-reads-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "foreign_attempt"
            },
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "mutation-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "mutation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "foreign_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "foreign_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "authority-observation-after-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_observation_after",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "legitimate-authority-unconsumed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "nonconsumption-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_observation_before"
            },
            {
              "kind": "reference",
              "role": "authority_observation_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumption_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "refusal-precedes-later-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "later-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
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
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "later-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "later-attempt-uses-legitimate-owner",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_owner"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "later-attempt-targets-same-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "owned_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "later-attempt-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "later-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "later-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "constraint": {
        "pattern_id": "expected-state-conforms-to-success",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "constraint": {
        "pattern_id": "result-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "constraint": {
        "pattern_id": "later-valid-attempt-succeeds",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "constraint": {
        "pattern_id": "later-success-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "later_valid_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "constraint": {
        "pattern_id": "later-success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_valid_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "later_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "write-verifies-isolation",
        "role": "verifies",
        "source_claim_pattern_id": "write-isolation-verification",
        "target_claim_pattern_id": "no-foreign-write-before-refusal"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "mutation-verifies-isolation",
        "role": "verifies",
        "source_claim_pattern_id": "mutation-isolation-verification",
        "target_claim_pattern_id": "no-foreign-mutation-before-refusal"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "nonconsumption-verifies-authority",
        "role": "verifies",
        "source_claim_pattern_id": "nonconsumption-verification",
        "target_claim_pattern_id": "legitimate-authority-unconsumed"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "later-success-verifies-result",
        "role": "verifies",
        "source_claim_pattern_id": "later-success-verification",
        "target_claim_pattern_id": "later-valid-attempt-succeeds"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "write-verifies-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "foreign_write_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "mutation-verifies-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "foreign_mutation_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "nonconsumption-verifies-authority",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_consumption_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "later-success-verifies-result",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "later_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-sequence",
        "collection_kind": "ordered_sequence",
        "match_mode": "subsequence",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "proof_exact_ownership_isolation_sequence",
        "member_claim_pattern_ids": [
          "authority-state-before-foreign-attempt",
          "foreign-attempt-performs-operation",
          "foreign-attempt-precedes-protected-interval",
          "no-foreign-write-before-refusal",
          "no-foreign-mutation-before-refusal",
          "protected-interval-precedes-refusal",
          "refusal-rejects-foreign-attempt",
          "authority-state-after-refusal",
          "legitimate-authority-unconsumed",
          "refusal-precedes-later-valid-attempt",
          "later-attempt-performs-operation",
          "later-attempt-precedes-result",
          "later-result-accepts-attempt",
          "later-valid-attempt-succeeds"
        ]
      }
    },
    {
      "ref": "/collection_patterns/1",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "proof_exact_ownership_isolation_population",
        "member_claim_pattern_ids": [
          "resource-owned-by-legitimate-owner",
          "authority-authorizes-legitimate-owner",
          "authority-does-not-authorize-foreign-subject",
          "foreign-attempt-performs-operation",
          "foreign-attempt-targets-owned-resource",
          "foreign-attempt-uses-foreign-subject",
          "foreign-attempt-precedes-protected-interval",
          "protected-interval-precedes-refusal",
          "refusal-rejects-foreign-attempt",
          "authority-state-before-foreign-attempt",
          "authority-observation-before-records-state",
          "no-foreign-write-before-refusal",
          "write-verification-reads-boundary",
          "write-isolation-verification",
          "no-foreign-mutation-before-refusal",
          "mutation-verification-reads-boundary",
          "mutation-isolation-verification",
          "authority-state-after-refusal",
          "authority-observation-after-records-state",
          "legitimate-authority-unconsumed",
          "nonconsumption-verification-reads-states",
          "nonconsumption-verification",
          "refusal-precedes-later-valid-attempt",
          "later-attempt-performs-operation",
          "later-attempt-uses-authority",
          "later-attempt-uses-legitimate-owner",
          "later-attempt-targets-same-resource",
          "later-attempt-precedes-result",
          "later-result-accepts-attempt",
          "later-result-has-state",
          "expected-state-conforms-to-success",
          "result-observation-records-state",
          "later-valid-attempt-succeeds",
          "later-success-verification-reads-result",
          "later-success-verification"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "resource-owned-by-legitimate-owner"
          },
          {
            "pattern": "authority-authorizes-legitimate-owner"
          },
          {
            "pattern": "authority-does-not-authorize-foreign-subject"
          },
          {
            "pattern": "foreign-attempt-performs-operation"
          },
          {
            "pattern": "foreign-attempt-targets-owned-resource"
          },
          {
            "pattern": "foreign-attempt-uses-foreign-subject"
          },
          {
            "pattern": "foreign-attempt-precedes-protected-interval"
          },
          {
            "pattern": "protected-interval-precedes-refusal"
          },
          {
            "pattern": "refusal-rejects-foreign-attempt"
          },
          {
            "pattern": "authority-state-before-foreign-attempt"
          },
          {
            "pattern": "authority-observation-before-records-state"
          },
          {
            "pattern": "no-foreign-write-before-refusal"
          },
          {
            "pattern": "write-verification-reads-boundary"
          },
          {
            "pattern": "write-isolation-verification"
          },
          {
            "pattern": "no-foreign-mutation-before-refusal"
          },
          {
            "pattern": "mutation-verification-reads-boundary"
          },
          {
            "pattern": "mutation-isolation-verification"
          },
          {
            "pattern": "authority-state-after-refusal"
          },
          {
            "pattern": "authority-observation-after-records-state"
          },
          {
            "pattern": "legitimate-authority-unconsumed"
          },
          {
            "pattern": "nonconsumption-verification-reads-states"
          },
          {
            "pattern": "nonconsumption-verification"
          },
          {
            "pattern": "refusal-precedes-later-valid-attempt"
          },
          {
            "pattern": "later-attempt-performs-operation"
          },
          {
            "pattern": "later-attempt-uses-authority"
          },
          {
            "pattern": "later-attempt-uses-legitimate-owner"
          },
          {
            "pattern": "later-attempt-targets-same-resource"
          },
          {
            "pattern": "later-attempt-precedes-result"
          },
          {
            "pattern": "later-result-accepts-attempt"
          },
          {
            "pattern": "later-result-has-state"
          },
          {
            "pattern": "expected-state-conforms-to-success"
          },
          {
            "pattern": "result-observation-records-state"
          },
          {
            "pattern": "later-valid-attempt-succeeds"
          },
          {
            "pattern": "later-success-verification-reads-result"
          },
          {
            "pattern": "later-success-verification"
          },
          {
            "pattern": "write-verifies-isolation"
          },
          {
            "pattern": "mutation-verifies-isolation"
          },
          {
            "pattern": "nonconsumption-verifies-authority"
          },
          {
            "pattern": "later-success-verifies-result"
          },
          {
            "pattern": "proof-sequence"
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
      "owned_resource",
      "legitimate_owner",
      "foreign_subject",
      "legitimate_authority",
      "foreign_attempt",
      "protected_interval",
      "refusal",
      "authority_state_before",
      "authority_state_after_refusal",
      "later_valid_attempt",
      "later_valid_result",
      "later_result_state",
      "expected_success_state",
      "success_criterion",
      "write_verification",
      "mutation_verification",
      "nonconsumption_verification",
      "later_success_verification",
      "foreign_write_condition",
      "foreign_mutation_condition",
      "authority_consumption_condition",
      "later_failure_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "authority_observation_before",
      "authority_observation_after",
      "result_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.ownership.exact-isolation.",
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
        "missing": "No named proof.ownership.exact-isolation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.ownership.exact-isolation.",
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
