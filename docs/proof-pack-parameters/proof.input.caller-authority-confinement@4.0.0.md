# proof.input.caller-authority-confinement@4.0.0

<!-- Generated from validated package metadata. -->

For one exact closed canonical caller-input policy, one exact accepted request and parser attempt, one distinct exact authority-bearing forbidden request and parser attempt, and one authenticated complete ordered observation cut ending at that forbidden attempt's exact refusal, the package-owned combined projection exactly partitions declared members, derives typed structural identities and all member-to-coordinate-to-operation-to-effect associations, proves the accepted opaque path-like control selects no coordinate and is accepted, proves the forbidden member is refused, exactly reconciles the policy-derived source census, and establishes no resolver, loader, filesystem, environment, module, catalog, subprocess, return, or success occurrence for the forbidden attempt before refusal.

Profile digest: 3fd1bb644c2ef19e3326e5ce09b1a20eee221c16a1e75736ecdaef95533bfaf6. Parameter digest: accd695e0befd324bea3f3e072ca82a52ce863101c801b3ffc5aef2d700ea74c.

Admission digest: 7e5f0195814336b45b02ecbd90f16e0b237c709123ce271ae2422c3984eed340.

Roles: 68/68 accounted; 7 owned gaps. Semantic parameters: 44; internal roles: 24.

## Guarantee and exclusions

For one exact closed canonical caller-input policy, one exact accepted request and parser attempt, one distinct exact authority-bearing forbidden request and parser attempt, and one authenticated complete ordered observation cut ending at that forbidden attempt's exact refusal, the package-owned combined projection exactly partitions declared members, derives typed structural identities and all member-to-coordinate-to-operation-to-effect associations, proves the accepted opaque path-like control selects no coordinate and is accepted, proves the forbidden member is refused, exactly reconciles the policy-derived source census, and establishes no resolver, loader, filesystem, environment, module, catalog, subprocess, return, or success occurrence for the forbidden attempt before refusal.

- canonical-policy-adapter-fidelity-outside-capture
- cce-consequences-or-publication-authority
- cross-pack-occurrence-joins
- instrumentation-completeness-outside-policy-derived-source-census
- post-refusal-behavior-and-later-requests
- runtime-truth-beyond-exact-capture

## Parameters

### accepted_attempt

Declare accepted attempt for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "accepted_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "p-7379de87",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "p-a44bdad1",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "parser",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "accepted_request",
          "forbidden_request",
          "accepted_attempt",
          "forbidden_attempt",
          "acceptance",
          "refusal",
          "observation_cut"
        ]
      }
    }
  ]
}
```

### accepted_request

Declare accepted request for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "accepted_request",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "p-e003b870",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "path_like_control",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "p-86f04ce3",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "accepted_members",
          "member_role": "accepted_supplied_member",
          "complete_population_pattern_id": "p-9b84482a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "accepted_supplied_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "p-e09d0cda",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "p-83adfcfc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "p-ed40f7f1",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request_capture",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "p-3d87d60d",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interface"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "p-7379de87",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "p-a44bdad1",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "parser",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "accepted_request",
          "forbidden_request",
          "accepted_attempt",
          "forbidden_attempt",
          "acceptance",
          "refusal",
          "observation_cut"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "p-7c9bd5ff",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "accepted_request",
            "authority_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "p-2cad9f26",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "accepted_request",
            "coordinate_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "value": {
        "relation_pattern_id": "p-7c9bd5ff",
        "reference_role_joins": [
          {
            "role": "forbidden_member",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "authority_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/1",
      "value": {
        "relation_pattern_id": "p-2cad9f26",
        "reference_role_joins": [
          {
            "role": "resolution_coordinate",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "coordinate_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    }
  ]
}
```

### forbidden_attempt

Declare forbidden attempt for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "p-52750e0e",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "p-c7a4b41c",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_cut",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "p-3abf8951",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "p-c0394007",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "p-9834bd9b",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "mandatory_sources",
          "member_role": "mandatory_source",
          "complete_population_pattern_id": "p-9e6aeea2",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "mandatory_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "p-5e06b198",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "p-4e7df138",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mandatory_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "p-07b616ba",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "mandatory_sources",
              "operator": "reference:covers",
              "member_position": "reference_operand",
              "associated_position": "subject",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "forbidden_attempt"
                ]
              },
              "complete_population_pattern_id": "p-9e6aeea2",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "mandatory_sources",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "p-df4cf4bc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "p-845426cb",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "accepted_request",
          "forbidden_request",
          "accepted_attempt",
          "forbidden_attempt",
          "acceptance",
          "refusal",
          "observation_cut"
        ]
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/2",
      "value": {
        "relation_pattern_id": "p-660d0615",
        "reference_role_joins": [
          {
            "role": "forbidden_attempt",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "prohibited_family",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "refusal",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "family_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "p-9b84482a",
        "comparison": "complete_population",
        "roles": [
          "accepted_supply_pop",
          "accepted_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "p-3c30710c",
        "comparison": "complete_population",
        "roles": [
          "allowed_members_pop",
          "allowed_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "p-5f191275",
        "comparison": "complete_population",
        "roles": [
          "pre_refusal_pop",
          "pre_cut_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/11",
      "value": {
        "pattern_id": "p-bca5627a",
        "comparison": "complete_population",
        "roles": [
          "prohibited_families_pop",
          "prohibited_families"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/12",
      "value": {
        "pattern_id": "p-4a1bd05c",
        "comparison": "complete_population",
        "roles": [
          "protected_effects_pop",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/13",
      "value": {
        "pattern_id": "p-a778fcc1",
        "comparison": "complete_population",
        "roles": [
          "resolution_coordinates_pop",
          "resolution_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/14",
      "value": {
        "pattern_id": "p-e8c99b51",
        "comparison": "complete_population",
        "roles": [
          "resolver_operations_pop",
          "resolver_operations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/15",
      "value": {
        "pattern_id": "p-aeeea06f",
        "comparison": "complete_population",
        "roles": [
          "selected_forbidden_pop",
          "selected_forbidden"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/16",
      "value": {
        "pattern_id": "p-69388a1d",
        "comparison": "complete_population",
        "roles": [
          "server_coordinates_pop",
          "server_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "p-6f1020d2",
        "comparison": "complete_population",
        "roles": [
          "authority_classes_pop",
          "authority_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "p-18c0199c",
        "comparison": "complete_population",
        "roles": [
          "coordinate_classes_pop",
          "coordinate_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "p-8f4567c7",
        "comparison": "complete_population",
        "roles": [
          "declared_members_pop",
          "declared_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "p-9e3ac1e2",
        "comparison": "complete_population",
        "roles": [
          "forbidden_supply_pop",
          "forbidden_supply"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "p-722c10c4",
        "comparison": "complete_population",
        "roles": [
          "forbidden_members_pop",
          "forbidden_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "p-08c0e984",
        "comparison": "complete_population",
        "roles": [
          "family_classes_pop",
          "family_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "p-9e6aeea2",
        "comparison": "complete_population",
        "roles": [
          "mandatory_sources_pop",
          "mandatory_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "p-4e7df138",
        "comparison": "complete_population",
        "roles": [
          "observed_sources_pop",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### forbidden_request

Declare forbidden request for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_request",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "p-52750e0e",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "p-9d3e22e2",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request_capture",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "p-cbe070e7",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interface"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "p-845426cb",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "accepted_request",
          "forbidden_request",
          "accepted_attempt",
          "forbidden_attempt",
          "acceptance",
          "refusal",
          "observation_cut"
        ]
      }
    }
  ]
}
```

### interface

Declare interface for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "interface",
        "allowed_type_terms": [
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "p-3d87d60d",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interface"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "p-cbe070e7",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interface"
            }
          ]
        }
      }
    }
  ]
}
```

### parser

Declare parser for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/11",
      "value": {
        "role": "parser",
        "allowed_type_terms": [
          "cc:process",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "p-a44bdad1",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "parser",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_request"
            }
          ]
        }
      }
    }
  ]
}
```

### path_like_control

Declare path like control for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "path_like_control",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "p-e003b870",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "path_like_control",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    }
  ]
}
```

### projection_result

Declare projection result for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "projection_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    }
  ]
}
```

### refusal

Declare refusal for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "p-52750e0e",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "p-c7a4b41c",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_cut",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
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
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "p-df4cf4bc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "accepted_request",
          "forbidden_request",
          "accepted_attempt",
          "forbidden_attempt",
          "acceptance",
          "refusal",
          "observation_cut"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "p-660d0615",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal",
            "family_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/2",
      "value": {
        "relation_pattern_id": "p-660d0615",
        "reference_role_joins": [
          {
            "role": "forbidden_attempt",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "prohibited_family",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "refusal",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "family_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    }
  ]
}
```

### verification

Declare verification for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/16",
      "value": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    }
  ]
}
```

### accepted_supply_pop

Declare accepted supply pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/17",
      "value": {
        "role": "accepted_supply_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "p-e09d0cda",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "p-83adfcfc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "value": {
        "relation_pattern_id": "p-7c9bd5ff",
        "reference_role_joins": [
          {
            "role": "forbidden_member",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "authority_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/1",
      "value": {
        "relation_pattern_id": "p-2cad9f26",
        "reference_role_joins": [
          {
            "role": "resolution_coordinate",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "coordinate_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "p-9b84482a",
        "comparison": "complete_population",
        "roles": [
          "accepted_supply_pop",
          "accepted_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### accepted_members

Declare accepted members for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/18",
      "value": {
        "role": "accepted_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/0",
      "value": {
        "pattern_id": "p-daf4e513",
        "role_kind": "reference",
        "role": "accepted_members",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "p-86f04ce3",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "accepted_members",
          "member_role": "accepted_supplied_member",
          "complete_population_pattern_id": "p-9b84482a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "accepted_supplied_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "p-9b84482a",
        "comparison": "complete_population",
        "roles": [
          "accepted_supply_pop",
          "accepted_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "accepted_members",
        "number_role": "accepted_members_count"
      }
    }
  ]
}
```

### allowed_members_pop

Declare allowed members pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/19",
      "value": {
        "role": "allowed_members_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "p-03246b4a",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_capture",
          "operator": "reference:authoritative_for",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "p-86f04ce3",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "accepted_members",
          "member_role": "accepted_supplied_member",
          "complete_population_pattern_id": "p-9b84482a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "accepted_supplied_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "p-3c30710c",
        "comparison": "complete_population",
        "roles": [
          "allowed_members_pop",
          "allowed_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### allowed_members

Declare allowed members for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/20",
      "value": {
        "role": "allowed_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/1",
      "value": {
        "pattern_id": "p-a656cf43",
        "role_kind": "reference",
        "role": "allowed_members",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "p-4110e562",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "allowed_members",
          "member_role": "allowed_member",
          "complete_population_pattern_id": "p-3c30710c",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "allowed_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "p-3c30710c",
        "comparison": "complete_population",
        "roles": [
          "allowed_members_pop",
          "allowed_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "value": {
        "reference_role": "allowed_members",
        "number_role": "allowed_members_count"
      }
    }
  ]
}
```

### authority_classes_pop

Declare authority classes pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/21",
      "value": {
        "role": "authority_classes_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "p-6f1020d2",
        "comparison": "complete_population",
        "roles": [
          "authority_classes_pop",
          "authority_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### authority_classes

Declare authority classes for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/22",
      "value": {
        "role": "authority_classes",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/2",
      "value": {
        "pattern_id": "p-488bc7f0",
        "role_kind": "reference",
        "role": "authority_classes",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "p-e09d0cda",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "p-7c9bd5ff",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "accepted_request",
            "authority_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "value": {
        "relation_pattern_id": "p-7c9bd5ff",
        "reference_role_joins": [
          {
            "role": "forbidden_member",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "authority_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "p-6f1020d2",
        "comparison": "complete_population",
        "roles": [
          "authority_classes_pop",
          "authority_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "authority_classes",
        "number_role": "authority_classes_count"
      }
    }
  ]
}
```

### coordinate_classes_pop

Declare coordinate classes pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/23",
      "value": {
        "role": "coordinate_classes_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "p-18c0199c",
        "comparison": "complete_population",
        "roles": [
          "coordinate_classes_pop",
          "coordinate_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### coordinate_classes

Declare coordinate classes for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/24",
      "value": {
        "role": "coordinate_classes",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/3",
      "value": {
        "pattern_id": "p-34948c40",
        "role_kind": "reference",
        "role": "coordinate_classes",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "p-83adfcfc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "p-2cad9f26",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "accepted_request",
            "coordinate_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/1",
      "value": {
        "relation_pattern_id": "p-2cad9f26",
        "reference_role_joins": [
          {
            "role": "resolution_coordinate",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "coordinate_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "p-18c0199c",
        "comparison": "complete_population",
        "roles": [
          "coordinate_classes_pop",
          "coordinate_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "coordinate_classes",
        "number_role": "coordinate_classes_count"
      }
    }
  ]
}
```

### declared_members_pop

Declare declared members pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/25",
      "value": {
        "role": "declared_members_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "p-a66e3734",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_capture",
          "operator": "reference:authoritative_for",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "p-4110e562",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "allowed_members",
          "member_role": "allowed_member",
          "complete_population_pattern_id": "p-3c30710c",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "allowed_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "p-f13fc096",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "p-8f4567c7",
        "comparison": "complete_population",
        "roles": [
          "declared_members_pop",
          "declared_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### declared_members

Declare declared members for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/26",
      "value": {
        "role": "declared_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/4",
      "value": {
        "pattern_id": "p-0302193b",
        "role_kind": "reference",
        "role": "declared_members",
        "minimum": 1
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "p-8f4567c7",
        "comparison": "complete_population",
        "roles": [
          "declared_members_pop",
          "declared_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "value": {
        "reference_role": "declared_members",
        "number_role": "declared_members_count"
      }
    }
  ]
}
```

### forbidden_supply_pop

Declare forbidden supply pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/27",
      "value": {
        "role": "forbidden_supply_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "p-c0394007",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "p-9e3ac1e2",
        "comparison": "complete_population",
        "roles": [
          "forbidden_supply_pop",
          "forbidden_supply"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### forbidden_supply

Declare forbidden supply for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/28",
      "value": {
        "role": "forbidden_supply",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/5",
      "value": {
        "pattern_id": "p-9f40fca7",
        "role_kind": "reference",
        "role": "forbidden_supply",
        "minimum": 1
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "p-9e3ac1e2",
        "comparison": "complete_population",
        "roles": [
          "forbidden_supply_pop",
          "forbidden_supply"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "value": {
        "reference_role": "forbidden_supply",
        "number_role": "forbidden_supply_count"
      }
    }
  ]
}
```

### forbidden_members_pop

Declare forbidden members pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/29",
      "value": {
        "role": "forbidden_members_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "p-3abf8951",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "p-b562a4f9",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_capture",
          "operator": "reference:authoritative_for",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "p-722c10c4",
        "comparison": "complete_population",
        "roles": [
          "forbidden_members_pop",
          "forbidden_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### forbidden_members

Declare forbidden members for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/30",
      "value": {
        "role": "forbidden_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/6",
      "value": {
        "pattern_id": "p-14be148b",
        "role_kind": "reference",
        "role": "forbidden_members",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "p-f13fc096",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "p-17d5b820",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolution_coordinates",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-a778fcc1",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolution_coordinates"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "p-e09d0cda",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "p-722c10c4",
        "comparison": "complete_population",
        "roles": [
          "forbidden_members_pop",
          "forbidden_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "value": {
        "reference_role": "forbidden_members",
        "number_role": "forbidden_members_count"
      }
    }
  ]
}
```

### family_classes_pop

Declare family classes pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/31",
      "value": {
        "role": "family_classes_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "p-08c0e984",
        "comparison": "complete_population",
        "roles": [
          "family_classes_pop",
          "family_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### family_classes

Declare family classes for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/32",
      "value": {
        "role": "family_classes",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/7",
      "value": {
        "pattern_id": "p-07e5a77e",
        "role_kind": "reference",
        "role": "family_classes",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "p-df4cf4bc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "p-660d0615",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal",
            "family_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/2",
      "value": {
        "relation_pattern_id": "p-660d0615",
        "reference_role_joins": [
          {
            "role": "forbidden_attempt",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "prohibited_family",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "refusal",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "family_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "p-08c0e984",
        "comparison": "complete_population",
        "roles": [
          "family_classes_pop",
          "family_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/7",
      "value": {
        "reference_role": "family_classes",
        "number_role": "family_classes_count"
      }
    }
  ]
}
```

### mandatory_sources_pop

Declare mandatory sources pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/33",
      "value": {
        "role": "mandatory_sources_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "p-5e06b198",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "p-4e7df138",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mandatory_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "p-9e6aeea2",
        "comparison": "complete_population",
        "roles": [
          "mandatory_sources_pop",
          "mandatory_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### mandatory_sources

Declare mandatory sources for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/34",
      "value": {
        "role": "mandatory_sources",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/8",
      "value": {
        "pattern_id": "p-b99b562b",
        "role_kind": "reference",
        "role": "mandatory_sources",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "p-9834bd9b",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "mandatory_sources",
          "member_role": "mandatory_source",
          "complete_population_pattern_id": "p-9e6aeea2",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "mandatory_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "p-07b616ba",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "mandatory_sources",
              "operator": "reference:covers",
              "member_position": "reference_operand",
              "associated_position": "subject",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "forbidden_attempt"
                ]
              },
              "complete_population_pattern_id": "p-9e6aeea2",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "mandatory_sources",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "p-9e6aeea2",
        "comparison": "complete_population",
        "roles": [
          "mandatory_sources_pop",
          "mandatory_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/8",
      "value": {
        "reference_role": "mandatory_sources",
        "number_role": "mandatory_sources_count"
      }
    }
  ]
}
```

### observed_sources_pop

Declare observed sources pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/35",
      "value": {
        "role": "observed_sources_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "p-9834bd9b",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "mandatory_sources",
          "member_role": "mandatory_source",
          "complete_population_pattern_id": "p-9e6aeea2",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "mandatory_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "p-4e7df138",
        "comparison": "complete_population",
        "roles": [
          "observed_sources_pop",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### observed_sources

Declare observed sources for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/36",
      "value": {
        "role": "observed_sources",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/9",
      "value": {
        "pattern_id": "p-997275ac",
        "role_kind": "reference",
        "role": "observed_sources",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "p-5e06b198",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "p-4e7df138",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mandatory_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "p-4e7df138",
        "comparison": "complete_population",
        "roles": [
          "observed_sources_pop",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/9",
      "value": {
        "reference_role": "observed_sources",
        "number_role": "observed_sources_count"
      }
    }
  ]
}
```

### pre_refusal_pop

Declare pre refusal pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/37",
      "value": {
        "role": "pre_refusal_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "p-5f191275",
        "comparison": "complete_population",
        "roles": [
          "pre_refusal_pop",
          "pre_cut_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### pre_cut_occurrences

Declare pre cut occurrences for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/38",
      "value": {
        "role": "pre_cut_occurrences",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/10",
      "value": {
        "pattern_id": "p-1fdc058b",
        "role_kind": "reference",
        "role": "pre_cut_occurrences",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "p-5f191275",
        "comparison": "complete_population",
        "roles": [
          "pre_refusal_pop",
          "pre_cut_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/10",
      "value": {
        "reference_role": "pre_cut_occurrences",
        "number_role": "pre_cut_occurrences_count"
      }
    }
  ]
}
```

### prohibited_families_pop

Declare prohibited families pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/39",
      "value": {
        "role": "prohibited_families_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/11",
      "value": {
        "pattern_id": "p-bca5627a",
        "comparison": "complete_population",
        "roles": [
          "prohibited_families_pop",
          "prohibited_families"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### prohibited_families

Declare prohibited families for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/40",
      "value": {
        "role": "prohibited_families",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/11",
      "value": {
        "pattern_id": "p-48aafa68",
        "role_kind": "reference",
        "role": "prohibited_families",
        "minimum": 9
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "p-07b616ba",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "mandatory_sources",
              "operator": "reference:covers",
              "member_position": "reference_operand",
              "associated_position": "subject",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "forbidden_attempt"
                ]
              },
              "complete_population_pattern_id": "p-9e6aeea2",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "mandatory_sources",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "p-df4cf4bc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/11",
      "value": {
        "pattern_id": "p-bca5627a",
        "comparison": "complete_population",
        "roles": [
          "prohibited_families_pop",
          "prohibited_families"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/11",
      "value": {
        "reference_role": "prohibited_families",
        "number_role": "prohibited_families_count"
      }
    }
  ]
}
```

### protected_effects_pop

Declare protected effects pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/41",
      "value": {
        "role": "protected_effects_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/12",
      "value": {
        "pattern_id": "p-4a1bd05c",
        "comparison": "complete_population",
        "roles": [
          "protected_effects_pop",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### protected_effects

Declare protected effects for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/42",
      "value": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:event",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/12",
      "value": {
        "pattern_id": "p-159ea7d6",
        "role_kind": "reference",
        "role": "protected_effects",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "p-191d1113",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolver_operations",
          "member_role": "resolver_operation",
          "complete_population_pattern_id": "p-e8c99b51",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "protected_effects",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-4a1bd05c",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolver_operation",
          "operator": "reference:targets",
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
      "ref": "/reference_binding_patterns/12",
      "value": {
        "pattern_id": "p-4a1bd05c",
        "comparison": "complete_population",
        "roles": [
          "protected_effects_pop",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/12",
      "value": {
        "reference_role": "protected_effects",
        "number_role": "protected_effects_count"
      }
    }
  ]
}
```

### resolution_coordinates_pop

Declare resolution coordinates pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/43",
      "value": {
        "role": "resolution_coordinates_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/13",
      "value": {
        "pattern_id": "p-a778fcc1",
        "comparison": "complete_population",
        "roles": [
          "resolution_coordinates_pop",
          "resolution_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### resolution_coordinates

Declare resolution coordinates for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/44",
      "value": {
        "role": "resolution_coordinates",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/13",
      "value": {
        "pattern_id": "p-9efc6147",
        "role_kind": "reference",
        "role": "resolution_coordinates",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "p-17d5b820",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolution_coordinates",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-a778fcc1",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolution_coordinates"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "p-7caabb56",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolver_operations",
              "operator": "reference:uses",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-e8c99b51",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolver_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "p-83adfcfc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/13",
      "value": {
        "pattern_id": "p-a778fcc1",
        "comparison": "complete_population",
        "roles": [
          "resolution_coordinates_pop",
          "resolution_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/13",
      "value": {
        "reference_role": "resolution_coordinates",
        "number_role": "resolution_coordinates_count"
      }
    }
  ]
}
```

### resolver_operations_pop

Declare resolver operations pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/45",
      "value": {
        "role": "resolver_operations_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/14",
      "value": {
        "pattern_id": "p-e8c99b51",
        "comparison": "complete_population",
        "roles": [
          "resolver_operations_pop",
          "resolver_operations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### resolver_operations

Declare resolver operations for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/46",
      "value": {
        "role": "resolver_operations",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process",
          "cc:runtime_component"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/14",
      "value": {
        "pattern_id": "p-5a4b12fa",
        "role_kind": "reference",
        "role": "resolver_operations",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "p-7caabb56",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolver_operations",
              "operator": "reference:uses",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-e8c99b51",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolver_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "p-191d1113",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolver_operations",
          "member_role": "resolver_operation",
          "complete_population_pattern_id": "p-e8c99b51",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "protected_effects",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-4a1bd05c",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolver_operation",
          "operator": "reference:targets",
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
      "ref": "/reference_binding_patterns/14",
      "value": {
        "pattern_id": "p-e8c99b51",
        "comparison": "complete_population",
        "roles": [
          "resolver_operations_pop",
          "resolver_operations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/14",
      "value": {
        "reference_role": "resolver_operations",
        "number_role": "resolver_operations_count"
      }
    }
  ]
}
```

### selected_forbidden_pop

Declare selected forbidden pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/47",
      "value": {
        "role": "selected_forbidden_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/15",
      "value": {
        "pattern_id": "p-aeeea06f",
        "comparison": "complete_population",
        "roles": [
          "selected_forbidden_pop",
          "selected_forbidden"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### selected_forbidden

Declare selected forbidden for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/48",
      "value": {
        "role": "selected_forbidden",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/15",
      "value": {
        "pattern_id": "p-e7dc5404",
        "role_kind": "reference",
        "role": "selected_forbidden",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "p-3abf8951",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "p-c0394007",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/15",
      "value": {
        "pattern_id": "p-aeeea06f",
        "comparison": "complete_population",
        "roles": [
          "selected_forbidden_pop",
          "selected_forbidden"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/15",
      "value": {
        "reference_role": "selected_forbidden",
        "number_role": "selected_forbidden_count"
      }
    }
  ]
}
```

### server_coordinates_pop

Declare server coordinates pop for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/49",
      "value": {
        "role": "server_coordinates_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/16",
      "value": {
        "pattern_id": "p-69388a1d",
        "comparison": "complete_population",
        "roles": [
          "server_coordinates_pop",
          "server_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    }
  ]
}
```

### server_coordinates

Declare server coordinates for proof.input.caller-authority-confinement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/50",
      "value": {
        "role": "server_coordinates",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/16",
      "value": {
        "pattern_id": "p-d2ff5f6e",
        "role_kind": "reference",
        "role": "server_coordinates",
        "minimum": 1
      }
    },
    {
      "ref": "/reference_binding_patterns/16",
      "value": {
        "pattern_id": "p-69388a1d",
        "comparison": "complete_population",
        "roles": [
          "server_coordinates_pop",
          "server_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/16",
      "value": {
        "reference_role": "server_coordinates",
        "number_role": "server_coordinates_count"
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| acceptance | capability_gap |  | Required role acceptance has no rule-linked semantic source. |
| accepted_attempt | semantic_parameter | accepted_attempt |  |
| accepted_request | semantic_parameter | accepted_request |  |
| accepted_request_capture | observation_requirement |  | Acquire accepted_request_capture for the exact subject, attempt and applicability in this profile. |
| capture_proof | capability_gap |  | Required role capture_proof has no rule-linked semantic source. |
| forbidden_attempt | semantic_parameter | forbidden_attempt |  |
| forbidden_request | semantic_parameter | forbidden_request |  |
| forbidden_request_capture | observation_requirement |  | Acquire forbidden_request_capture for the exact subject, attempt and applicability in this profile. |
| interface | semantic_parameter | interface |  |
| observation_cut | observation_requirement |  | Acquire observation_cut for the exact subject, attempt and applicability in this profile. |
| observation_evidence_capture | capability_gap |  | Required role observation_evidence_capture has no rule-linked semantic source. |
| parser | semantic_parameter | parser |  |
| path_like_control | semantic_parameter | path_like_control |  |
| policy_capture | observation_requirement |  | Acquire policy_capture for the exact subject, attempt and applicability in this profile. |
| projection_result | semantic_parameter | projection_result |  |
| refusal | semantic_parameter | refusal |  |
| verification | semantic_parameter | verification |  |
| accepted_supply_pop | semantic_parameter | accepted_supply_pop |  |
| accepted_members | semantic_parameter | accepted_members |  |
| allowed_members_pop | semantic_parameter | allowed_members_pop |  |
| allowed_members | semantic_parameter | allowed_members |  |
| authority_classes_pop | semantic_parameter | authority_classes_pop |  |
| authority_classes | semantic_parameter | authority_classes |  |
| coordinate_classes_pop | semantic_parameter | coordinate_classes_pop |  |
| coordinate_classes | semantic_parameter | coordinate_classes |  |
| declared_members_pop | semantic_parameter | declared_members_pop |  |
| declared_members | semantic_parameter | declared_members |  |
| forbidden_supply_pop | semantic_parameter | forbidden_supply_pop |  |
| forbidden_supply | semantic_parameter | forbidden_supply |  |
| forbidden_members_pop | semantic_parameter | forbidden_members_pop |  |
| forbidden_members | semantic_parameter | forbidden_members |  |
| family_classes_pop | semantic_parameter | family_classes_pop |  |
| family_classes | semantic_parameter | family_classes |  |
| mandatory_sources_pop | semantic_parameter | mandatory_sources_pop |  |
| mandatory_sources | semantic_parameter | mandatory_sources |  |
| observed_sources_pop | semantic_parameter | observed_sources_pop |  |
| observed_sources | semantic_parameter | observed_sources |  |
| pre_refusal_pop | semantic_parameter | pre_refusal_pop |  |
| pre_cut_occurrences | semantic_parameter | pre_cut_occurrences |  |
| prohibited_families_pop | semantic_parameter | prohibited_families_pop |  |
| prohibited_families | semantic_parameter | prohibited_families |  |
| protected_effects_pop | semantic_parameter | protected_effects_pop |  |
| protected_effects | semantic_parameter | protected_effects |  |
| resolution_coordinates_pop | semantic_parameter | resolution_coordinates_pop |  |
| resolution_coordinates | semantic_parameter | resolution_coordinates |  |
| resolver_operations_pop | semantic_parameter | resolver_operations_pop |  |
| resolver_operations | semantic_parameter | resolver_operations |  |
| selected_forbidden_pop | semantic_parameter | selected_forbidden_pop |  |
| selected_forbidden | semantic_parameter | selected_forbidden |  |
| server_coordinates_pop | semantic_parameter | server_coordinates_pop |  |
| server_coordinates | semantic_parameter | server_coordinates |  |
| accepted_members_count | complete_population_count | accepted_members |  |
| allowed_members_count | complete_population_count | allowed_members |  |
| authority_classes_count | complete_population_count | authority_classes |  |
| coordinate_classes_count | complete_population_count | coordinate_classes |  |
| declared_members_count | complete_population_count | declared_members |  |
| forbidden_supply_count | complete_population_count | forbidden_supply |  |
| forbidden_members_count | complete_population_count | forbidden_members |  |
| family_classes_count | complete_population_count | family_classes |  |
| mandatory_sources_count | complete_population_count | mandatory_sources |  |
| observed_sources_count | complete_population_count | observed_sources |  |
| pre_cut_occurrences_count | complete_population_count | pre_cut_occurrences |  |
| prohibited_families_count | complete_population_count | prohibited_families |  |
| protected_effects_count | complete_population_count | protected_effects |  |
| resolution_coordinates_count | complete_population_count | resolution_coordinates |  |
| resolver_operations_count | complete_population_count | resolver_operations |  |
| selected_forbidden_count | complete_population_count | selected_forbidden |  |
| server_coordinates_count | complete_population_count | server_coordinates |  |

```json
{
  "roles": [
    {
      "role": "acceptance",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role acceptance has no rule-linked semantic source.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json#/reference_roles/0",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "acceptance",
        "allowed_type_terms": [
          "cc:event",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accepted_attempt",
      "kind": "semantic_parameter",
      "parameter": "accepted_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accepted_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accepted_request",
      "kind": "semantic_parameter",
      "parameter": "accepted_request",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1",
        "/falsifier_occurrence_bindings/0",
        "/falsifier_occurrence_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accepted_request",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accepted_request_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire accepted_request_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "accepted_request_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "capture_proof",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role capture_proof has no rule-linked semantic source.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json#/reference_roles/4",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "capture_proof",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_attempt",
      "kind": "semantic_parameter",
      "parameter": "forbidden_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0",
        "/falsifier_occurrence_bindings/2",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/1",
        "/reference_binding_patterns/10",
        "/reference_binding_patterns/11",
        "/reference_binding_patterns/12",
        "/reference_binding_patterns/13",
        "/reference_binding_patterns/14",
        "/reference_binding_patterns/15",
        "/reference_binding_patterns/16",
        "/reference_binding_patterns/2",
        "/reference_binding_patterns/3",
        "/reference_binding_patterns/4",
        "/reference_binding_patterns/5",
        "/reference_binding_patterns/6",
        "/reference_binding_patterns/7",
        "/reference_binding_patterns/8",
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_request",
      "kind": "semantic_parameter",
      "parameter": "forbidden_request",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/4",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_request",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_request_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire forbidden_request_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "forbidden_request_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "interface",
      "kind": "semantic_parameter",
      "parameter": "interface",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "interface",
        "allowed_type_terms": [
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_cut",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_cut for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_cut",
        "allowed_type_terms": [
          "cc:event",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_evidence_capture",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role observation_evidence_capture has no rule-linked semantic source.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json#/reference_roles/10",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "observation_evidence_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "parser",
      "kind": "semantic_parameter",
      "parameter": "parser",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "parser",
        "allowed_type_terms": [
          "cc:process",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "path_like_control",
      "kind": "semantic_parameter",
      "parameter": "path_like_control",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "path_like_control",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "policy_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire policy_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.input.caller-authority-confinement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "policy_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "projection_result",
      "kind": "semantic_parameter",
      "parameter": "projection_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25",
        "/claim_patterns/27",
        "/claim_patterns/29"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "projection_result",
        "allowed_type_terms": [
          "cc:artifact"
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
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/2",
        "/falsifier_occurrence_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25",
        "/claim_patterns/27",
        "/claim_patterns/29"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accepted_supply_pop",
      "kind": "semantic_parameter",
      "parameter": "accepted_supply_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/falsifier_occurrence_bindings/0",
        "/falsifier_occurrence_bindings/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accepted_supply_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accepted_members",
      "kind": "semantic_parameter",
      "parameter": "accepted_members",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/0",
        "/claim_patterns/13",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accepted_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "allowed_members_pop",
      "kind": "semantic_parameter",
      "parameter": "allowed_members_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/13",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_members_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "allowed_members",
      "kind": "semantic_parameter",
      "parameter": "allowed_members",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/1",
        "/claim_patterns/14",
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "authority_classes_pop",
      "kind": "semantic_parameter",
      "parameter": "authority_classes_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_classes_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_classes",
      "kind": "semantic_parameter",
      "parameter": "authority_classes",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/2",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/falsifier_condition_bindings/0",
        "/falsifier_occurrence_bindings/0",
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_classes",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "coordinate_classes_pop",
      "kind": "semantic_parameter",
      "parameter": "coordinate_classes_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "coordinate_classes_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "coordinate_classes",
      "kind": "semantic_parameter",
      "parameter": "coordinate_classes",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/3",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/falsifier_condition_bindings/1",
        "/falsifier_occurrence_bindings/1",
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "coordinate_classes",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "declared_members_pop",
      "kind": "semantic_parameter",
      "parameter": "declared_members_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_members_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "declared_members",
      "kind": "semantic_parameter",
      "parameter": "declared_members",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/4",
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "forbidden_supply_pop",
      "kind": "semantic_parameter",
      "parameter": "forbidden_supply_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_supply_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_supply",
      "kind": "semantic_parameter",
      "parameter": "forbidden_supply",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/5",
        "/reference_binding_patterns/5",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_supply",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "forbidden_members_pop",
      "kind": "semantic_parameter",
      "parameter": "forbidden_members_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/2",
        "/reference_binding_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_members_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_members",
      "kind": "semantic_parameter",
      "parameter": "forbidden_members",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/6",
        "/claim_patterns/15",
        "/claim_patterns/18",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/reference_binding_patterns/6",
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_members",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "family_classes_pop",
      "kind": "semantic_parameter",
      "parameter": "family_classes_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "family_classes_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "family_classes",
      "kind": "semantic_parameter",
      "parameter": "family_classes",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/7",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/falsifier_condition_bindings/2",
        "/falsifier_occurrence_bindings/2",
        "/reference_binding_patterns/7",
        "/reference_role_count_bindings/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "family_classes",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "mandatory_sources_pop",
      "kind": "semantic_parameter",
      "parameter": "mandatory_sources_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/reference_binding_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mandatory_sources_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "mandatory_sources",
      "kind": "semantic_parameter",
      "parameter": "mandatory_sources",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/8",
        "/claim_patterns/21",
        "/claim_patterns/23",
        "/reference_binding_patterns/8",
        "/reference_role_count_bindings/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mandatory_sources",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "observed_sources_pop",
      "kind": "semantic_parameter",
      "parameter": "observed_sources_pop",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_sources_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observed_sources",
      "kind": "semantic_parameter",
      "parameter": "observed_sources",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/9",
        "/claim_patterns/22",
        "/reference_binding_patterns/9",
        "/reference_role_count_bindings/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_sources",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "pre_refusal_pop",
      "kind": "semantic_parameter",
      "parameter": "pre_refusal_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/10"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "pre_refusal_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "pre_cut_occurrences",
      "kind": "semantic_parameter",
      "parameter": "pre_cut_occurrences",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/10",
        "/reference_binding_patterns/10",
        "/reference_role_count_bindings/10"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "pre_cut_occurrences",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "prohibited_families_pop",
      "kind": "semantic_parameter",
      "parameter": "prohibited_families_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/11"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "prohibited_families_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "prohibited_families",
      "kind": "semantic_parameter",
      "parameter": "prohibited_families",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/11",
        "/claim_patterns/23",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/reference_binding_patterns/11",
        "/reference_role_count_bindings/11"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "prohibited_families",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "protected_effects_pop",
      "kind": "semantic_parameter",
      "parameter": "protected_effects_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effects_pop",
        "allowed_type_terms": [
          "cc:population"
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
        "/binding_constraint_patterns/12",
        "/claim_patterns/20",
        "/reference_binding_patterns/12",
        "/reference_role_count_bindings/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:event",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "resolution_coordinates_pop",
      "kind": "semantic_parameter",
      "parameter": "resolution_coordinates_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/13"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolution_coordinates_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "resolution_coordinates",
      "kind": "semantic_parameter",
      "parameter": "resolution_coordinates",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/13",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/reference_binding_patterns/13",
        "/reference_role_count_bindings/13"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolution_coordinates",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "resolver_operations_pop",
      "kind": "semantic_parameter",
      "parameter": "resolver_operations_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/14"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolver_operations_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "resolver_operations",
      "kind": "semantic_parameter",
      "parameter": "resolver_operations",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/14",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/reference_binding_patterns/14",
        "/reference_role_count_bindings/14"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolver_operations",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process",
          "cc:runtime_component"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "selected_forbidden_pop",
      "kind": "semantic_parameter",
      "parameter": "selected_forbidden_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/15"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "selected_forbidden_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "selected_forbidden",
      "kind": "semantic_parameter",
      "parameter": "selected_forbidden",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/reference_binding_patterns/15",
        "/reference_role_count_bindings/15"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "selected_forbidden",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "server_coordinates_pop",
      "kind": "semantic_parameter",
      "parameter": "server_coordinates_pop",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/16"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "server_coordinates_pop",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "server_coordinates",
      "kind": "semantic_parameter",
      "parameter": "server_coordinates",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/16",
        "/reference_binding_patterns/16",
        "/reference_role_count_bindings/16"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "server_coordinates",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "accepted_members_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "accepted_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accepted_members_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "allowed_members_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "allowed_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_members_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "authority_classes_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "authority_classes"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_classes_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "coordinate_classes_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "coordinate_classes"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "coordinate_classes_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "declared_members_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "declared_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_members_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "forbidden_supply_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "forbidden_supply"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_supply_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "forbidden_members_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "forbidden_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_members_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "family_classes_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "family_classes"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "family_classes_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "mandatory_sources_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "mandatory_sources"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mandatory_sources_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "observed_sources_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "observed_sources"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_sources_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "pre_cut_occurrences_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "pre_cut_occurrences"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/10"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "pre_cut_occurrences_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "prohibited_families_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "prohibited_families"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/11"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "prohibited_families_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "protected_effects_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "protected_effects"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effects_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "resolution_coordinates_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "resolution_coordinates"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/13"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolution_coordinates_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "resolver_operations_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "resolver_operations"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/14"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolver_operations_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "selected_forbidden_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "selected_forbidden"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/15"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "selected_forbidden_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "server_coordinates_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "server_coordinates"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/16"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "server_coordinates_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "accepted_request",
          "forbidden_request",
          "accepted_attempt",
          "forbidden_attempt",
          "acceptance",
          "refusal",
          "observation_cut"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "p-9b84482a",
        "comparison": "complete_population",
        "roles": [
          "accepted_supply_pop",
          "accepted_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "p-3c30710c",
        "comparison": "complete_population",
        "roles": [
          "allowed_members_pop",
          "allowed_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "p-6f1020d2",
        "comparison": "complete_population",
        "roles": [
          "authority_classes_pop",
          "authority_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "p-18c0199c",
        "comparison": "complete_population",
        "roles": [
          "coordinate_classes_pop",
          "coordinate_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "constraint": {
        "pattern_id": "p-8f4567c7",
        "comparison": "complete_population",
        "roles": [
          "declared_members_pop",
          "declared_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "constraint": {
        "pattern_id": "p-9e3ac1e2",
        "comparison": "complete_population",
        "roles": [
          "forbidden_supply_pop",
          "forbidden_supply"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "constraint": {
        "pattern_id": "p-722c10c4",
        "comparison": "complete_population",
        "roles": [
          "forbidden_members_pop",
          "forbidden_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "constraint": {
        "pattern_id": "p-08c0e984",
        "comparison": "complete_population",
        "roles": [
          "family_classes_pop",
          "family_classes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "constraint": {
        "pattern_id": "p-9e6aeea2",
        "comparison": "complete_population",
        "roles": [
          "mandatory_sources_pop",
          "mandatory_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "constraint": {
        "pattern_id": "p-4e7df138",
        "comparison": "complete_population",
        "roles": [
          "observed_sources_pop",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "constraint": {
        "pattern_id": "p-5f191275",
        "comparison": "complete_population",
        "roles": [
          "pre_refusal_pop",
          "pre_cut_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/11",
      "constraint": {
        "pattern_id": "p-bca5627a",
        "comparison": "complete_population",
        "roles": [
          "prohibited_families_pop",
          "prohibited_families"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/12",
      "constraint": {
        "pattern_id": "p-4a1bd05c",
        "comparison": "complete_population",
        "roles": [
          "protected_effects_pop",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/13",
      "constraint": {
        "pattern_id": "p-a778fcc1",
        "comparison": "complete_population",
        "roles": [
          "resolution_coordinates_pop",
          "resolution_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/14",
      "constraint": {
        "pattern_id": "p-e8c99b51",
        "comparison": "complete_population",
        "roles": [
          "resolver_operations_pop",
          "resolver_operations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/15",
      "constraint": {
        "pattern_id": "p-aeeea06f",
        "comparison": "complete_population",
        "roles": [
          "selected_forbidden_pop",
          "selected_forbidden"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/16",
      "constraint": {
        "pattern_id": "p-69388a1d",
        "comparison": "complete_population",
        "roles": [
          "server_coordinates_pop",
          "server_coordinates"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "forbidden_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "accepted_members",
        "number_role": "accepted_members_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "allowed_members",
        "number_role": "allowed_members_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "authority_classes",
        "number_role": "authority_classes_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "coordinate_classes",
        "number_role": "coordinate_classes_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "declared_members",
        "number_role": "declared_members_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "forbidden_supply",
        "number_role": "forbidden_supply_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "constraint": {
        "reference_role": "forbidden_members",
        "number_role": "forbidden_members_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/7",
      "constraint": {
        "reference_role": "family_classes",
        "number_role": "family_classes_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/8",
      "constraint": {
        "reference_role": "mandatory_sources",
        "number_role": "mandatory_sources_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/9",
      "constraint": {
        "reference_role": "observed_sources",
        "number_role": "observed_sources_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/10",
      "constraint": {
        "reference_role": "pre_cut_occurrences",
        "number_role": "pre_cut_occurrences_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/11",
      "constraint": {
        "reference_role": "prohibited_families",
        "number_role": "prohibited_families_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/12",
      "constraint": {
        "reference_role": "protected_effects",
        "number_role": "protected_effects_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/13",
      "constraint": {
        "reference_role": "resolution_coordinates",
        "number_role": "resolution_coordinates_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/14",
      "constraint": {
        "reference_role": "resolver_operations",
        "number_role": "resolver_operations_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/15",
      "constraint": {
        "reference_role": "selected_forbidden",
        "number_role": "selected_forbidden_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/16",
      "constraint": {
        "reference_role": "server_coordinates",
        "number_role": "server_coordinates_count"
      }
    },
    {
      "ref": "/binding_constraint_patterns/0",
      "constraint": {
        "pattern_id": "p-daf4e513",
        "role_kind": "reference",
        "role": "accepted_members",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/1",
      "constraint": {
        "pattern_id": "p-a656cf43",
        "role_kind": "reference",
        "role": "allowed_members",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/2",
      "constraint": {
        "pattern_id": "p-488bc7f0",
        "role_kind": "reference",
        "role": "authority_classes",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/3",
      "constraint": {
        "pattern_id": "p-34948c40",
        "role_kind": "reference",
        "role": "coordinate_classes",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/4",
      "constraint": {
        "pattern_id": "p-0302193b",
        "role_kind": "reference",
        "role": "declared_members",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/5",
      "constraint": {
        "pattern_id": "p-9f40fca7",
        "role_kind": "reference",
        "role": "forbidden_supply",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/6",
      "constraint": {
        "pattern_id": "p-14be148b",
        "role_kind": "reference",
        "role": "forbidden_members",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/7",
      "constraint": {
        "pattern_id": "p-07e5a77e",
        "role_kind": "reference",
        "role": "family_classes",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/8",
      "constraint": {
        "pattern_id": "p-b99b562b",
        "role_kind": "reference",
        "role": "mandatory_sources",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/9",
      "constraint": {
        "pattern_id": "p-997275ac",
        "role_kind": "reference",
        "role": "observed_sources",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/10",
      "constraint": {
        "pattern_id": "p-1fdc058b",
        "role_kind": "reference",
        "role": "pre_cut_occurrences",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "ref": "/binding_constraint_patterns/11",
      "constraint": {
        "pattern_id": "p-48aafa68",
        "role_kind": "reference",
        "role": "prohibited_families",
        "minimum": 9
      }
    },
    {
      "ref": "/binding_constraint_patterns/12",
      "constraint": {
        "pattern_id": "p-159ea7d6",
        "role_kind": "reference",
        "role": "protected_effects",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/13",
      "constraint": {
        "pattern_id": "p-9efc6147",
        "role_kind": "reference",
        "role": "resolution_coordinates",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/14",
      "constraint": {
        "pattern_id": "p-5a4b12fa",
        "role_kind": "reference",
        "role": "resolver_operations",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/15",
      "constraint": {
        "pattern_id": "p-e7dc5404",
        "role_kind": "reference",
        "role": "selected_forbidden",
        "minimum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/16",
      "constraint": {
        "pattern_id": "p-d2ff5f6e",
        "role_kind": "reference",
        "role": "server_coordinates",
        "minimum": 1
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "p-a66e3734",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_capture",
          "operator": "reference:authoritative_for",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "p-03246b4a",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_capture",
          "operator": "reference:authoritative_for",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "p-b562a4f9",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_capture",
          "operator": "reference:authoritative_for",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "p-ed40f7f1",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request_capture",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "p-9d3e22e2",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request_capture",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "p-3d87d60d",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interface"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "p-cbe070e7",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interface"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "p-7379de87",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accepted_request",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "p-845426cb",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "forbidden_request",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "p-a44bdad1",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "parser",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "p-52750e0e",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "p-c7a4b41c",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_cut",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
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
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "p-e003b870",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "path_like_control",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "p-86f04ce3",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "accepted_members",
          "member_role": "accepted_supplied_member",
          "complete_population_pattern_id": "p-9b84482a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "accepted_supplied_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "p-4110e562",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "allowed_members",
          "member_role": "allowed_member",
          "complete_population_pattern_id": "p-3c30710c",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "allowed_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "p-f13fc096",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "p-3abf8951",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_members_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "p-c0394007",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "selected_forbidden",
          "member_role": "selected_forbidden_member",
          "complete_population_pattern_id": "p-aeeea06f",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "selected_forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "p-17d5b820",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolution_coordinates",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-a778fcc1",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolution_coordinates"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "p-7caabb56",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolver_operations",
              "operator": "reference:uses",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-e8c99b51",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolver_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "p-191d1113",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolver_operations",
          "member_role": "resolver_operation",
          "complete_population_pattern_id": "p-e8c99b51",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "protected_effects",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-4a1bd05c",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolver_operation",
          "operator": "reference:targets",
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
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "p-9834bd9b",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "mandatory_sources",
          "member_role": "mandatory_source",
          "complete_population_pattern_id": "p-9e6aeea2",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "mandatory_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "p-5e06b198",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "p-4e7df138",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mandatory_sources_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "p-07b616ba",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "mandatory_sources",
              "operator": "reference:covers",
              "member_position": "reference_operand",
              "associated_position": "subject",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "forbidden_attempt"
                ]
              },
              "complete_population_pattern_id": "p-9e6aeea2",
              "associated_cardinality": "one_or_more"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "mandatory_sources",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "forbidden_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "p-e09d0cda",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "p-0821c6b6",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member",
          "complete_population_pattern_id": "p-722c10c4",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "authority_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-6f1020d2"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_member"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "authority_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "p-83adfcfc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "p-14a2fa17",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "resolution_coordinates",
          "member_role": "resolution_coordinate",
          "complete_population_pattern_id": "p-a778fcc1",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "coordinate_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-18c0199c"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolution_coordinate"
            },
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolution_coordinate",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "accepted_request",
              "coordinate_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accepted_supply_pop"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "p-df4cf4bc",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "p-0ef68dba",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prohibited_families",
          "member_role": "prohibited_family",
          "complete_population_pattern_id": "p-bca5627a",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "family_classes",
              "operator": "reference:classifies_as",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "p-08c0e984"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "forbidden_attempt"
            },
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "forbidden_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "refusal",
              "family_classes"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prohibited_family"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "p-7c9bd5ff",
        "role": "verifies",
        "source_claim_pattern_id": "p-0821c6b6",
        "target_claim_pattern_id": "p-e09d0cda"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "p-2cad9f26",
        "role": "verifies",
        "source_claim_pattern_id": "p-14a2fa17",
        "target_claim_pattern_id": "p-83adfcfc"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "p-660d0615",
        "role": "verifies",
        "source_claim_pattern_id": "p-0ef68dba",
        "target_claim_pattern_id": "p-df4cf4bc"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "p-7c9bd5ff",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "accepted_request",
            "authority_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "p-2cad9f26",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "accepted_request",
            "coordinate_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "p-660d0615",
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "refusal",
            "family_classes"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "constraint": {
        "relation_pattern_id": "p-7c9bd5ff",
        "reference_role_joins": [
          {
            "role": "forbidden_member",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "authority_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/1",
      "constraint": {
        "relation_pattern_id": "p-2cad9f26",
        "reference_role_joins": [
          {
            "role": "resolution_coordinate",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "accepted_supply_pop",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "accepted_request",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "coordinate_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/2",
      "constraint": {
        "relation_pattern_id": "p-660d0615",
        "reference_role_joins": [
          {
            "role": "forbidden_attempt",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          },
          {
            "role": "prohibited_family",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          },
          {
            "role": "refusal",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          },
          {
            "role": "family_classes",
            "target_positions": [
              "applicability_operand"
            ],
            "verification_positions": [
              "applicability_operand"
            ],
            "falsifier_positions": [
              "applicability_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "p-9b84482a"
          },
          {
            "pattern": "p-3c30710c"
          },
          {
            "pattern": "p-6f1020d2"
          },
          {
            "pattern": "p-18c0199c"
          },
          {
            "pattern": "p-8f4567c7"
          },
          {
            "pattern": "p-9e3ac1e2"
          },
          {
            "pattern": "p-722c10c4"
          },
          {
            "pattern": "p-08c0e984"
          },
          {
            "pattern": "p-9e6aeea2"
          },
          {
            "pattern": "p-4e7df138"
          },
          {
            "pattern": "p-5f191275"
          },
          {
            "pattern": "p-bca5627a"
          },
          {
            "pattern": "p-4a1bd05c"
          },
          {
            "pattern": "p-a778fcc1"
          },
          {
            "pattern": "p-e8c99b51"
          },
          {
            "pattern": "p-aeeea06f"
          },
          {
            "pattern": "p-69388a1d"
          },
          {
            "pattern": "p-daf4e513"
          },
          {
            "pattern": "p-a656cf43"
          },
          {
            "pattern": "p-488bc7f0"
          },
          {
            "pattern": "p-34948c40"
          },
          {
            "pattern": "p-0302193b"
          },
          {
            "pattern": "p-9f40fca7"
          },
          {
            "pattern": "p-14be148b"
          },
          {
            "pattern": "p-07e5a77e"
          },
          {
            "pattern": "p-b99b562b"
          },
          {
            "pattern": "p-997275ac"
          },
          {
            "pattern": "p-1fdc058b"
          },
          {
            "pattern": "p-48aafa68"
          },
          {
            "pattern": "p-159ea7d6"
          },
          {
            "pattern": "p-9efc6147"
          },
          {
            "pattern": "p-5a4b12fa"
          },
          {
            "pattern": "p-e7dc5404"
          },
          {
            "pattern": "p-d2ff5f6e"
          },
          {
            "pattern": "p-a66e3734"
          },
          {
            "pattern": "p-03246b4a"
          },
          {
            "pattern": "p-b562a4f9"
          },
          {
            "pattern": "p-ed40f7f1"
          },
          {
            "pattern": "p-9d3e22e2"
          },
          {
            "pattern": "p-3d87d60d"
          },
          {
            "pattern": "p-cbe070e7"
          },
          {
            "pattern": "p-7379de87"
          },
          {
            "pattern": "p-845426cb"
          },
          {
            "pattern": "p-a44bdad1"
          },
          {
            "pattern": "p-52750e0e"
          },
          {
            "pattern": "p-c7a4b41c"
          },
          {
            "pattern": "p-e003b870"
          },
          {
            "pattern": "p-86f04ce3"
          },
          {
            "pattern": "p-4110e562"
          },
          {
            "pattern": "p-f13fc096"
          },
          {
            "pattern": "p-3abf8951"
          },
          {
            "pattern": "p-c0394007"
          },
          {
            "pattern": "p-17d5b820"
          },
          {
            "pattern": "p-7caabb56"
          },
          {
            "pattern": "p-191d1113"
          },
          {
            "pattern": "p-9834bd9b"
          },
          {
            "pattern": "p-5e06b198"
          },
          {
            "pattern": "p-07b616ba"
          },
          {
            "pattern": "p-e09d0cda"
          },
          {
            "pattern": "p-0821c6b6"
          },
          {
            "pattern": "p-83adfcfc"
          },
          {
            "pattern": "p-14a2fa17"
          },
          {
            "pattern": "p-df4cf4bc"
          },
          {
            "pattern": "p-0ef68dba"
          },
          {
            "pattern": "p-7c9bd5ff"
          },
          {
            "pattern": "p-2cad9f26"
          },
          {
            "pattern": "p-660d0615"
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
      "accepted_attempt",
      "accepted_request",
      "forbidden_attempt",
      "forbidden_request",
      "interface",
      "parser",
      "path_like_control",
      "projection_result",
      "refusal",
      "verification",
      "accepted_supply_pop",
      "accepted_members",
      "allowed_members_pop",
      "allowed_members",
      "authority_classes_pop",
      "authority_classes",
      "coordinate_classes_pop",
      "coordinate_classes",
      "declared_members_pop",
      "declared_members",
      "forbidden_supply_pop",
      "forbidden_supply",
      "forbidden_members_pop",
      "forbidden_members",
      "family_classes_pop",
      "family_classes",
      "mandatory_sources_pop",
      "mandatory_sources",
      "observed_sources_pop",
      "observed_sources",
      "pre_refusal_pop",
      "pre_cut_occurrences",
      "prohibited_families_pop",
      "prohibited_families",
      "protected_effects_pop",
      "protected_effects",
      "resolution_coordinates_pop",
      "resolution_coordinates",
      "resolver_operations_pop",
      "resolver_operations",
      "selected_forbidden_pop",
      "selected_forbidden",
      "server_coordinates_pop",
      "server_coordinates"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "accepted_request_capture",
      "forbidden_request_capture",
      "observation_cut",
      "policy_capture"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.input.caller-authority-confinement.",
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
        "missing": "No named proof.input.caller-authority-confinement constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.input.caller-authority-confinement.",
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
