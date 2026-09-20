# proof.observation.sound-negative@4.0.0

<!-- Generated from validated package metadata. -->

For one exact captured target, observation attempt, complete declared source and raw-observation populations, and interval, every valid observation is authenticated and directly grounded to its exact target, source of record, attempt, observation position, and raw observation; declared and observed source coverage is complete; every source outcome has one stable endpoint pair; every valid observation fails to match the target; the invalidating-condition population is exactly empty; and the same exact projection derives the sole absent conclusion.

Profile digest: 4c143f826dd0d3209fd994c6362b7b9d4b47f766da7dbbe14f469815bdd92c0c. Parameter digest: 07fba8090aa3731dc70656edcc9b5f314f2e77c9113522b9577524a6aa611ea0.

Admission digest: b2679c4462e1024ccad728f278875a73570a8e71fa98d0ce7c84ea4742574c7f.

Roles: 35/35 accounted; 10 owned gaps. Semantic parameters: 23; internal roles: 12.

## Guarantee and exclusions

For one exact captured target, observation attempt, complete declared source and raw-observation populations, and interval, every valid observation is authenticated and directly grounded to its exact target, source of record, attempt, observation position, and raw observation; declared and observed source coverage is complete; every source outcome has one stable endpoint pair; every valid observation fails to match the target; the invalidating-condition population is exactly empty; and the same exact projection derives the sole absent conclusion.

- authenticated-presence-proof
- copied-transformed-or-derived-provenance
- correctness-or-completeness-of-pre-capture-source-discovery
- cross-pack-occurrence-joins
- evidence-authority-applicability-authority-or-cce-consequences
- evidenced-unavailability-proof
- external-pki-or-legal-identity
- runtime-or-post-capture-truth
- undeclared-sources-observations-conditions-or-mutations

## Parameters

### target

Declare target for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "target",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:event",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/5",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "target",
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
            "role": "observation_attempt",
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
        "applicability_join": "shared_operands"
      }
    }
  ]
}
```

### observation_attempt

Declare observation attempt for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observation_attempt",
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "observation-evidence-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_evidence_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "observation-capture-proof-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_capture_proof",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "each-valid-observation-is-grounded-to-its-position",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_positions"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "each-raw-observation-resolves-to-one-valid-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "raw_observations",
          "member_role": "raw_observation",
          "complete_population_pattern_id": "complete-raw-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "valid_observations",
              "operator": "reference:resolves_to",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-valid-observations"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "raw_observation",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "each-declared-source-is-observed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_sources",
          "member_role": "declared_source",
          "complete_population_pattern_id": "complete-declared-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "declared_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "each-observed-source-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "complete-observed-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-source-outcome-is-for-its-declared-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_sources",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-declared-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "each-source-outcome-has-its-exact-endpoint-pair",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "endpoint_pairs",
              "operator": "reference:has_state",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-endpoint-pairs"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "endpoint_pairs"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "each-endpoint-pair-is-stable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "endpoint_pairs",
          "member_role": "endpoint_pair",
          "complete_population_pattern_id": "complete-endpoint-pairs",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "endpoint_pair",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_endpoint_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "declared-source-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "declared_source_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "declared-observation-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "declared_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "absent-conclusion-is-exact-projected",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "absent_conclusion",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "absent_conclusion_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:originates_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "each-valid-observation-is-from-the-captured-attempt",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-from-the-captured-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
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
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-authenticates-its-resolved-target",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-originates-from-its-assigned-source",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-target-has-assigned-source-of-record",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt",
            "interval_start",
            "interval_end",
            "observation_positions"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/3",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-from-the-captured-attempt",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "observation_attempt",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "valid_observation_population",
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
            "role": "observation_attempt",
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
            "role": "interval_start",
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
            "role": "interval_end",
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
            "role": "observation_positions",
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
        "applicability_join": "shared_operands"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/5",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "target",
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
            "role": "observation_attempt",
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
        "applicability_join": "shared_operands"
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-declared-sources",
        "comparison": "complete_population",
        "roles": [
          "declared_source_population",
          "declared_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-observed-sources",
        "comparison": "complete_population",
        "roles": [
          "observed_source_population",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "complete-absent-conclusion",
        "comparison": "complete_population",
        "roles": [
          "absent_conclusion_population",
          "absent_conclusion"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-source-outcomes",
        "comparison": "complete_population",
        "roles": [
          "source_outcome_population",
          "source_outcomes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-endpoint-pairs",
        "comparison": "complete_population",
        "roles": [
          "endpoint_population",
          "endpoint_pairs"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-raw-observations",
        "comparison": "complete_population",
        "roles": [
          "raw_observation_population",
          "raw_observations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-valid-observations",
        "comparison": "complete_population",
        "roles": [
          "valid_observation_population",
          "valid_observations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-observation-positions",
        "comparison": "complete_population",
        "roles": [
          "observation_position_population",
          "observation_positions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-resolved-targets",
        "comparison": "complete_population",
        "roles": [
          "resolved_target_population",
          "resolved_targets"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-assigned-sources",
        "comparison": "complete_population",
        "roles": [
          "assigned_source_population",
          "assigned_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-invalidating-conditions",
        "comparison": "complete_population",
        "roles": [
          "invalidating_condition_population",
          "invalidating_conditions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### interval_start

Declare interval start for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/2",
      "value": {
        "role": "interval_start",
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
        "pattern_id": "each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt",
            "interval_start",
            "interval_end",
            "observation_positions"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "valid_observation_population",
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
            "role": "observation_attempt",
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
            "role": "interval_start",
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
            "role": "interval_end",
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
            "role": "observation_positions",
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
        "applicability_join": "shared_operands"
      }
    }
  ]
}
```

### interval_end

Declare interval end for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/3",
      "value": {
        "role": "interval_end",
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
        "pattern_id": "each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt",
            "interval_start",
            "interval_end",
            "observation_positions"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "valid_observation_population",
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
            "role": "observation_attempt",
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
            "role": "interval_start",
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
            "role": "interval_end",
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
            "role": "observation_positions",
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
        "applicability_join": "shared_operands"
      }
    }
  ]
}
```

### verification

Declare verification for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-from-the-captured-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
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
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### projection_result

Declare projection result for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-each-valid-observation-is-from-the-captured-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
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
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### declared_source_population

Declare declared source population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/8",
      "value": {
        "role": "declared_source_population",
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
        "pattern_id": "each-observed-source-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "complete-observed-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-declared-sources",
        "comparison": "complete_population",
        "roles": [
          "declared_source_population",
          "declared_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### declared_sources

Declare declared sources for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/9",
      "value": {
        "role": "declared_sources",
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
      "ref": "/binding_constraint_patterns/0",
      "value": {
        "pattern_id": "declared-sources-binding-required",
        "role_kind": "reference",
        "role": "declared_sources",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "each-declared-source-is-observed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_sources",
          "member_role": "declared_source",
          "complete_population_pattern_id": "complete-declared-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "declared_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-source-outcome-is-for-its-declared-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_sources",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-declared-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-declared-sources",
        "comparison": "complete_population",
        "roles": [
          "declared_source_population",
          "declared_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "declared_sources",
        "number_role": "declared_source_count"
      }
    }
  ]
}
```

### observed_source_population

Declare observed source population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/10",
      "value": {
        "role": "observed_source_population",
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
        "pattern_id": "each-declared-source-is-observed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_sources",
          "member_role": "declared_source",
          "complete_population_pattern_id": "complete-declared-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "declared_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-observed-sources",
        "comparison": "complete_population",
        "roles": [
          "observed_source_population",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### observed_sources

Declare observed sources for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/11",
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
      "ref": "/binding_constraint_patterns/1",
      "value": {
        "pattern_id": "observed-sources-binding-required",
        "role_kind": "reference",
        "role": "observed_sources",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "each-observed-source-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "complete-observed-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-observed-sources",
        "comparison": "complete_population",
        "roles": [
          "observed_source_population",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "value": {
        "reference_role": "observed_sources",
        "number_role": "declared_source_count"
      }
    }
  ]
}
```

### source_outcome_population

Declare source outcome population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/12",
      "value": {
        "role": "source_outcome_population",
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
        "pattern_id": "complete-source-outcomes",
        "comparison": "complete_population",
        "roles": [
          "source_outcome_population",
          "source_outcomes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### source_outcomes

Declare source outcomes for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/13",
      "value": {
        "role": "source_outcomes",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/2",
      "value": {
        "pattern_id": "source-outcomes-binding-required",
        "role_kind": "reference",
        "role": "source_outcomes",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-source-outcome-is-for-its-declared-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_sources",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-declared-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "each-source-outcome-has-its-exact-endpoint-pair",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "endpoint_pairs",
              "operator": "reference:has_state",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-endpoint-pairs"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "endpoint_pairs"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-source-outcomes",
        "comparison": "complete_population",
        "roles": [
          "source_outcome_population",
          "source_outcomes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "source_outcomes",
        "number_role": "declared_source_count"
      }
    }
  ]
}
```

### endpoint_population

Declare endpoint population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/14",
      "value": {
        "role": "endpoint_population",
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
        "pattern_id": "complete-endpoint-pairs",
        "comparison": "complete_population",
        "roles": [
          "endpoint_population",
          "endpoint_pairs"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### endpoint_pairs

Declare endpoint pairs for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/15",
      "value": {
        "role": "endpoint_pairs",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/3",
      "value": {
        "pattern_id": "endpoint-pairs-binding-required",
        "role_kind": "reference",
        "role": "endpoint_pairs",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "each-source-outcome-has-its-exact-endpoint-pair",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "endpoint_pairs",
              "operator": "reference:has_state",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-endpoint-pairs"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "endpoint_pairs"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "each-endpoint-pair-is-stable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "endpoint_pairs",
          "member_role": "endpoint_pair",
          "complete_population_pattern_id": "complete-endpoint-pairs",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "endpoint_pair",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_endpoint_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-endpoint-pairs",
        "comparison": "complete_population",
        "roles": [
          "endpoint_population",
          "endpoint_pairs"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "endpoint_pairs",
        "number_role": "declared_source_count"
      }
    }
  ]
}
```

### stable_endpoint_state

Declare stable endpoint state for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "stable_endpoint_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "each-endpoint-pair-is-stable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "endpoint_pairs",
          "member_role": "endpoint_pair",
          "complete_population_pattern_id": "complete-endpoint-pairs",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "endpoint_pair",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_endpoint_state"
            }
          ]
        }
      }
    }
  ]
}
```

### resolved_target_population

Declare resolved target population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "resolved_target_population",
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
        "pattern_id": "complete-resolved-targets",
        "comparison": "complete_population",
        "roles": [
          "resolved_target_population",
          "resolved_targets"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### resolved_targets

Declare resolved targets for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "resolved_targets",
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
      "ref": "/binding_constraint_patterns/7",
      "value": {
        "pattern_id": "resolved-targets-binding-required",
        "role_kind": "reference",
        "role": "resolved_targets",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-authenticates-its-resolved-target",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "resolved_targets",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-target-has-assigned-source-of-record",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "assigned_sources",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/5",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "target",
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
            "role": "observation_attempt",
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
        "applicability_join": "shared_operands"
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-resolved-targets",
        "comparison": "complete_population",
        "roles": [
          "resolved_target_population",
          "resolved_targets"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### assigned_source_population

Declare assigned source population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "assigned_source_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-assigned-sources",
        "comparison": "complete_population",
        "roles": [
          "assigned_source_population",
          "assigned_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### assigned_sources

Declare assigned sources for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "assigned_sources",
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
        "pattern_id": "assigned-sources-binding-required",
        "role_kind": "reference",
        "role": "assigned_sources",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:originates_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/1",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-originates-from-its-assigned-source",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "assigned_sources",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-each-valid-observation-target-has-assigned-source-of-record",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "assigned_sources",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-assigned-sources",
        "comparison": "complete_population",
        "roles": [
          "assigned_source_population",
          "assigned_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### invalidating_condition_population

Declare invalidating condition population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "invalidating_condition_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-invalidating-conditions",
        "comparison": "complete_population",
        "roles": [
          "invalidating_condition_population",
          "invalidating_conditions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### invalidating_conditions

Declare invalidating conditions for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "invalidating_conditions",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/9",
      "value": {
        "pattern_id": "invalidating-conditions-binding-required",
        "role_kind": "reference",
        "role": "invalidating_conditions",
        "minimum": 0,
        "maximum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-invalidating-conditions",
        "comparison": "complete_population",
        "roles": [
          "invalidating_condition_population",
          "invalidating_conditions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### absent_conclusion_population

Declare absent conclusion population for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "absent_conclusion_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "absent-conclusion-is-exact-projected",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "absent_conclusion",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "absent_conclusion_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "complete-absent-conclusion",
        "comparison": "complete_population",
        "roles": [
          "absent_conclusion_population",
          "absent_conclusion"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### absent_conclusion

Declare absent conclusion for proof.observation.sound-negative. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/30",
      "value": {
        "role": "absent_conclusion",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "absent-conclusion-is-exact-projected",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "absent_conclusion",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "absent_conclusion_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "complete-absent-conclusion",
        "comparison": "complete_population",
        "roles": [
          "absent_conclusion_population",
          "absent_conclusion"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
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
| target | semantic_parameter | target |  |
| observation_attempt | semantic_parameter | observation_attempt |  |
| interval_start | semantic_parameter | interval_start |  |
| interval_end | semantic_parameter | interval_end |  |
| verification | semantic_parameter | verification |  |
| observation_evidence_capture | observation_requirement |  | Acquire observation_evidence_capture for the exact subject, attempt and applicability in this profile. |
| observation_capture_proof | observation_requirement |  | Acquire observation_capture_proof for the exact subject, attempt and applicability in this profile. |
| projection_result | semantic_parameter | projection_result |  |
| declared_source_population | semantic_parameter | declared_source_population |  |
| declared_sources | semantic_parameter | declared_sources |  |
| observed_source_population | semantic_parameter | observed_source_population |  |
| observed_sources | semantic_parameter | observed_sources |  |
| source_outcome_population | semantic_parameter | source_outcome_population |  |
| source_outcomes | semantic_parameter | source_outcomes |  |
| endpoint_population | semantic_parameter | endpoint_population |  |
| endpoint_pairs | semantic_parameter | endpoint_pairs |  |
| stable_endpoint_state | semantic_parameter | stable_endpoint_state |  |
| raw_observation_population | observation_requirement |  | Acquire raw_observation_population for the exact subject, attempt and applicability in this profile. |
| raw_observations | observation_requirement |  | Acquire raw_observations for the exact subject, attempt and applicability in this profile. |
| valid_observation_population | observation_requirement |  | Acquire valid_observation_population for the exact subject, attempt and applicability in this profile. |
| valid_observations | observation_requirement |  | Acquire valid_observations for the exact subject, attempt and applicability in this profile. |
| observation_position_population | observation_requirement |  | Acquire observation_position_population for the exact subject, attempt and applicability in this profile. |
| observation_positions | observation_requirement |  | Acquire observation_positions for the exact subject, attempt and applicability in this profile. |
| resolved_target_population | semantic_parameter | resolved_target_population |  |
| resolved_targets | semantic_parameter | resolved_targets |  |
| assigned_source_population | semantic_parameter | assigned_source_population |  |
| assigned_sources | semantic_parameter | assigned_sources |  |
| invalidating_condition_population | semantic_parameter | invalidating_condition_population |  |
| invalidating_conditions | semantic_parameter | invalidating_conditions |  |
| absent_conclusion_population | semantic_parameter | absent_conclusion_population |  |
| absent_conclusion | semantic_parameter | absent_conclusion |  |
| source_count_signal | observation_requirement |  | Acquire source_count_signal for the exact subject, attempt and applicability in this profile. |
| observation_count_signal | observation_requirement |  | Acquire observation_count_signal for the exact subject, attempt and applicability in this profile. |
| declared_source_count | complete_population_count | declared_sources, observed_sources, source_outcomes, endpoint_pairs |  |
| declared_observation_count | complete_population_count | raw_observations, valid_observations, observation_positions |  |

```json
{
  "roles": [
    {
      "role": "target",
      "kind": "semantic_parameter",
      "parameter": "target",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/falsifier_occurrence_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "target",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:event",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_attempt",
      "kind": "semantic_parameter",
      "parameter": "observation_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/2",
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1",
        "/falsifier_condition_bindings/2",
        "/falsifier_condition_bindings/4",
        "/falsifier_condition_bindings/5",
        "/falsifier_occurrence_bindings/3",
        "/falsifier_occurrence_bindings/4",
        "/falsifier_occurrence_bindings/5",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/1",
        "/reference_binding_patterns/10",
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
        "role": "observation_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "interval_start",
      "kind": "semantic_parameter",
      "parameter": "interval_start",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/falsifier_condition_bindings/4",
        "/falsifier_occurrence_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "interval_start",
        "allowed_type_terms": [
          "cc:event",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "interval_end",
      "kind": "semantic_parameter",
      "parameter": "interval_end",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/falsifier_condition_bindings/4",
        "/falsifier_occurrence_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "interval_end",
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
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/9"
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
      "role": "observation_evidence_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_evidence_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
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
      "role": "observation_capture_proof",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_capture_proof for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_capture_proof",
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
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/9"
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
      "role": "declared_source_population",
      "kind": "semantic_parameter",
      "parameter": "declared_source_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_source_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "declared_sources",
      "kind": "semantic_parameter",
      "parameter": "declared_sources",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/0",
        "/claim_patterns/16",
        "/claim_patterns/18",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_sources",
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
      "role": "observed_source_population",
      "kind": "semantic_parameter",
      "parameter": "observed_source_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_source_population",
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
        "/binding_constraint_patterns/1",
        "/claim_patterns/17",
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
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
      "role": "source_outcome_population",
      "kind": "semantic_parameter",
      "parameter": "source_outcome_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_outcome_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_outcomes",
      "kind": "semantic_parameter",
      "parameter": "source_outcomes",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/2",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_outcomes",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "endpoint_population",
      "kind": "semantic_parameter",
      "parameter": "endpoint_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "endpoint_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "endpoint_pairs",
      "kind": "semantic_parameter",
      "parameter": "endpoint_pairs",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/3",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "endpoint_pairs",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "stable_endpoint_state",
      "kind": "semantic_parameter",
      "parameter": "stable_endpoint_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stable_endpoint_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "raw_observation_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire raw_observation_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "raw_observation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "raw_observations",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/4",
        "/claim_patterns/15",
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire raw_observations for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "raw_observations",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "valid_observation_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/falsifier_occurrence_bindings/4",
        "/reference_binding_patterns/5"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire valid_observation_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "valid_observation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "valid_observations",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/5",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_binding_patterns/5",
        "/reference_role_count_bindings/5"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire valid_observations for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "valid_observations",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "observation_position_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/6"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_position_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_position_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_positions",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/6",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/14",
        "/falsifier_condition_bindings/4",
        "/falsifier_occurrence_bindings/4",
        "/reference_binding_patterns/6",
        "/reference_role_count_bindings/6"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_positions for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_positions",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "resolved_target_population",
      "kind": "semantic_parameter",
      "parameter": "resolved_target_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolved_target_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "resolved_targets",
      "kind": "semantic_parameter",
      "parameter": "resolved_targets",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/7",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/falsifier_occurrence_bindings/0",
        "/falsifier_occurrence_bindings/2",
        "/falsifier_occurrence_bindings/5",
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resolved_targets",
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
      "role": "assigned_source_population",
      "kind": "semantic_parameter",
      "parameter": "assigned_source_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "assigned_source_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "assigned_sources",
      "kind": "semantic_parameter",
      "parameter": "assigned_sources",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/8",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/falsifier_occurrence_bindings/1",
        "/falsifier_occurrence_bindings/2",
        "/reference_binding_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "assigned_sources",
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
      "role": "invalidating_condition_population",
      "kind": "semantic_parameter",
      "parameter": "invalidating_condition_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "invalidating_condition_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "invalidating_conditions",
      "kind": "semantic_parameter",
      "parameter": "invalidating_conditions",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/9",
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "invalidating_conditions",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "absent_conclusion_population",
      "kind": "semantic_parameter",
      "parameter": "absent_conclusion_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/reference_binding_patterns/10"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "absent_conclusion_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "absent_conclusion",
      "kind": "semantic_parameter",
      "parameter": "absent_conclusion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/reference_binding_patterns/10"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "absent_conclusion",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire source_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "source_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.observation.sound-negative/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "declared_source_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "declared_sources",
        "observed_sources",
        "source_outcomes",
        "endpoint_pairs"
      ],
      "rule_refs": [
        "/claim_patterns/21",
        "/reference_role_count_bindings/0",
        "/reference_role_count_bindings/1",
        "/reference_role_count_bindings/2",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_source_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "declared_observation_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "raw_observations",
        "valid_observations",
        "observation_positions"
      ],
      "rule_refs": [
        "/claim_patterns/22",
        "/reference_role_count_bindings/4",
        "/reference_role_count_bindings/5",
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_observation_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-declared-sources",
        "comparison": "complete_population",
        "roles": [
          "declared_source_population",
          "declared_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-observed-sources",
        "comparison": "complete_population",
        "roles": [
          "observed_source_population",
          "observed_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "complete-source-outcomes",
        "comparison": "complete_population",
        "roles": [
          "source_outcome_population",
          "source_outcomes"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-endpoint-pairs",
        "comparison": "complete_population",
        "roles": [
          "endpoint_population",
          "endpoint_pairs"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "constraint": {
        "pattern_id": "complete-raw-observations",
        "comparison": "complete_population",
        "roles": [
          "raw_observation_population",
          "raw_observations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "constraint": {
        "pattern_id": "complete-valid-observations",
        "comparison": "complete_population",
        "roles": [
          "valid_observation_population",
          "valid_observations"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "constraint": {
        "pattern_id": "complete-observation-positions",
        "comparison": "complete_population",
        "roles": [
          "observation_position_population",
          "observation_positions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "constraint": {
        "pattern_id": "complete-resolved-targets",
        "comparison": "complete_population",
        "roles": [
          "resolved_target_population",
          "resolved_targets"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "constraint": {
        "pattern_id": "complete-assigned-sources",
        "comparison": "complete_population",
        "roles": [
          "assigned_source_population",
          "assigned_sources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "constraint": {
        "pattern_id": "complete-invalidating-conditions",
        "comparison": "complete_population",
        "roles": [
          "invalidating_condition_population",
          "invalidating_conditions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "constraint": {
        "pattern_id": "complete-absent-conclusion",
        "comparison": "complete_population",
        "roles": [
          "absent_conclusion_population",
          "absent_conclusion"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "declared_sources",
        "number_role": "declared_source_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "observed_sources",
        "number_role": "declared_source_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "source_outcomes",
        "number_role": "declared_source_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "endpoint_pairs",
        "number_role": "declared_source_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "raw_observations",
        "number_role": "declared_observation_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "valid_observations",
        "number_role": "declared_observation_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "constraint": {
        "reference_role": "observation_positions",
        "number_role": "declared_observation_count"
      }
    },
    {
      "ref": "/binding_constraint_patterns/0",
      "constraint": {
        "pattern_id": "declared-sources-binding-required",
        "role_kind": "reference",
        "role": "declared_sources",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/1",
      "constraint": {
        "pattern_id": "observed-sources-binding-required",
        "role_kind": "reference",
        "role": "observed_sources",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/2",
      "constraint": {
        "pattern_id": "source-outcomes-binding-required",
        "role_kind": "reference",
        "role": "source_outcomes",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/3",
      "constraint": {
        "pattern_id": "endpoint-pairs-binding-required",
        "role_kind": "reference",
        "role": "endpoint_pairs",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/4",
      "constraint": {
        "pattern_id": "raw-observations-binding-required",
        "role_kind": "reference",
        "role": "raw_observations",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/5",
      "constraint": {
        "pattern_id": "valid-observations-binding-required",
        "role_kind": "reference",
        "role": "valid_observations",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/6",
      "constraint": {
        "pattern_id": "observation-positions-binding-required",
        "role_kind": "reference",
        "role": "observation_positions",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/7",
      "constraint": {
        "pattern_id": "resolved-targets-binding-required",
        "role_kind": "reference",
        "role": "resolved_targets",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/8",
      "constraint": {
        "pattern_id": "assigned-sources-binding-required",
        "role_kind": "reference",
        "role": "assigned_sources",
        "minimum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/binding_constraint_patterns/9",
      "constraint": {
        "pattern_id": "invalidating-conditions-binding-required",
        "role_kind": "reference",
        "role": "invalidating_conditions",
        "minimum": 0,
        "maximum": 0,
        "binding_presence": "required"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "observation-evidence-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_evidence_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
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
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "observation-capture-proof-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_capture_proof",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
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
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "verify-each-valid-observation-authenticates-its-resolved-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resolved_targets"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:originates_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "verify-each-valid-observation-originates-from-its-assigned-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            },
            {
              "associated_role": "assigned_sources",
              "operator": "reference:originates_from",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-assigned-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "assigned_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "each-valid-observation-is-from-the-captured-attempt",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "verify-each-valid-observation-is-from-the-captured-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
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
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "observation"
            },
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt",
              "interval_start",
              "interval_end",
              "observation_positions"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "resolved_targets",
              "operator": "reference:authenticates",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-resolved-targets"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "resolved_targets"
            },
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "resolved_targets",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "each-valid-observation-is-grounded-to-its-position",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "valid_observations",
          "member_role": "observation",
          "complete_population_pattern_id": "complete-valid-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "observation_positions",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-observation-positions"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_positions"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "each-raw-observation-resolves-to-one-valid-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "raw_observations",
          "member_role": "raw_observation",
          "complete_population_pattern_id": "complete-raw-observations",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "valid_observations",
              "operator": "reference:resolves_to",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-valid-observations"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "raw_observation",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_observations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "each-declared-source-is-observed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_sources",
          "member_role": "declared_source",
          "complete_population_pattern_id": "complete-declared-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "declared_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "each-observed-source-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observed_sources",
          "member_role": "observed_source",
          "complete_population_pattern_id": "complete-observed-sources",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "observed_source",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "each-source-outcome-is-for-its-declared-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_sources",
              "operator": "reference:depends_on",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-declared-sources"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:depends_on",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_sources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "each-source-outcome-has-its-exact-endpoint-pair",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "source_outcomes",
          "member_role": "source_outcome",
          "complete_population_pattern_id": "complete-source-outcomes",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "endpoint_pairs",
              "operator": "reference:has_state",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "during",
                "operand_roles": [
                  "observation_attempt"
                ]
              },
              "complete_population_pattern_id": "complete-endpoint-pairs"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "source_outcome",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "endpoint_pairs"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "each-endpoint-pair-is-stable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "endpoint_pairs",
          "member_role": "endpoint_pair",
          "complete_population_pattern_id": "complete-endpoint-pairs",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "endpoint_pair",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_endpoint_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "declared-source-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "declared_source_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "declared-observation-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "declared_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "absent-conclusion-is-exact-projected",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "absent_conclusion",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "absent_conclusion_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-each-valid-observation-authenticates-its-resolved-target",
        "role": "verifies",
        "source_claim_pattern_id": "verify-each-valid-observation-authenticates-its-resolved-target",
        "target_claim_pattern_id": "each-valid-observation-authenticates-its-resolved-target"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-targets-each-valid-observation-originates-from-its-assigned-source",
        "role": "verifies",
        "source_claim_pattern_id": "verify-each-valid-observation-originates-from-its-assigned-source",
        "target_claim_pattern_id": "each-valid-observation-originates-from-its-assigned-source"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-targets-each-valid-observation-target-has-assigned-source-of-record",
        "role": "verifies",
        "source_claim_pattern_id": "verify-each-valid-observation-target-has-assigned-source-of-record",
        "target_claim_pattern_id": "each-valid-observation-target-has-assigned-source-of-record"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-targets-each-valid-observation-is-from-the-captured-attempt",
        "role": "verifies",
        "source_claim_pattern_id": "verify-each-valid-observation-is-from-the-captured-attempt",
        "target_claim_pattern_id": "each-valid-observation-is-from-the-captured-attempt"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "role": "verifies",
        "source_claim_pattern_id": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "target_claim_pattern_id": "each-valid-observation-is-at-its-position-in-the-captured-interval"
      }
    },
    {
      "ref": "/relation_patterns/5",
      "constraint": {
        "pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "role": "verifies",
        "source_claim_pattern_id": "verify-each-valid-observation-does-not-match-the-selected-target",
        "target_claim_pattern_id": "each-valid-observation-does-not-match-the-selected-target"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-authenticates-its-resolved-target",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-originates-from-its-assigned-source",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-target-has-assigned-source-of-record",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-from-the-captured-attempt",
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt",
            "interval_start",
            "interval_end",
            "observation_positions"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-authenticates-its-resolved-target",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "resolved_targets",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
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
        "relation_pattern_id": "verification-targets-each-valid-observation-originates-from-its-assigned-source",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "assigned_sources",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
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
        "relation_pattern_id": "verification-targets-each-valid-observation-target-has-assigned-source-of-record",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "assigned_sources",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-from-the-captured-attempt",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "observation_attempt",
            "target_positions": [
              "reference_operand"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "reference_operand"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval",
        "reference_role_joins": [
          {
            "role": "observation",
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
            "role": "valid_observation_population",
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
            "role": "observation_attempt",
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
            "role": "interval_start",
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
            "role": "interval_end",
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
            "role": "observation_positions",
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
        "applicability_join": "shared_operands"
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/5",
      "constraint": {
        "relation_pattern_id": "verification-targets-each-valid-observation-does-not-match-the-selected-target",
        "reference_role_joins": [
          {
            "role": "resolved_targets",
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
            "role": "target",
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
            "role": "observation_attempt",
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
        "applicability_join": "shared_operands"
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-declared-sources"
          },
          {
            "pattern": "complete-observed-sources"
          },
          {
            "pattern": "complete-source-outcomes"
          },
          {
            "pattern": "complete-endpoint-pairs"
          },
          {
            "pattern": "complete-raw-observations"
          },
          {
            "pattern": "complete-valid-observations"
          },
          {
            "pattern": "complete-observation-positions"
          },
          {
            "pattern": "complete-resolved-targets"
          },
          {
            "pattern": "complete-assigned-sources"
          },
          {
            "pattern": "complete-invalidating-conditions"
          },
          {
            "pattern": "complete-absent-conclusion"
          },
          {
            "pattern": "declared-sources-binding-required"
          },
          {
            "pattern": "observed-sources-binding-required"
          },
          {
            "pattern": "source-outcomes-binding-required"
          },
          {
            "pattern": "endpoint-pairs-binding-required"
          },
          {
            "pattern": "raw-observations-binding-required"
          },
          {
            "pattern": "valid-observations-binding-required"
          },
          {
            "pattern": "observation-positions-binding-required"
          },
          {
            "pattern": "resolved-targets-binding-required"
          },
          {
            "pattern": "assigned-sources-binding-required"
          },
          {
            "pattern": "invalidating-conditions-binding-required"
          },
          {
            "pattern": "observation-evidence-capture-exists"
          },
          {
            "pattern": "observation-capture-proof-exists"
          },
          {
            "pattern": "each-valid-observation-authenticates-its-resolved-target"
          },
          {
            "pattern": "verify-each-valid-observation-authenticates-its-resolved-target"
          },
          {
            "pattern": "each-valid-observation-originates-from-its-assigned-source"
          },
          {
            "pattern": "verify-each-valid-observation-originates-from-its-assigned-source"
          },
          {
            "pattern": "each-valid-observation-target-has-assigned-source-of-record"
          },
          {
            "pattern": "verify-each-valid-observation-target-has-assigned-source-of-record"
          },
          {
            "pattern": "each-valid-observation-is-from-the-captured-attempt"
          },
          {
            "pattern": "verify-each-valid-observation-is-from-the-captured-attempt"
          },
          {
            "pattern": "each-valid-observation-is-at-its-position-in-the-captured-interval"
          },
          {
            "pattern": "verify-each-valid-observation-is-at-its-position-in-the-captured-interval"
          },
          {
            "pattern": "each-valid-observation-does-not-match-the-selected-target"
          },
          {
            "pattern": "verify-each-valid-observation-does-not-match-the-selected-target"
          },
          {
            "pattern": "each-valid-observation-is-grounded-to-its-position"
          },
          {
            "pattern": "each-raw-observation-resolves-to-one-valid-observation"
          },
          {
            "pattern": "each-declared-source-is-observed"
          },
          {
            "pattern": "each-observed-source-is-declared"
          },
          {
            "pattern": "each-source-outcome-is-for-its-declared-source"
          },
          {
            "pattern": "each-source-outcome-has-its-exact-endpoint-pair"
          },
          {
            "pattern": "each-endpoint-pair-is-stable"
          },
          {
            "pattern": "declared-source-count-is-captured"
          },
          {
            "pattern": "declared-observation-count-is-captured"
          },
          {
            "pattern": "absent-conclusion-is-exact-projected"
          },
          {
            "pattern": "verification-targets-each-valid-observation-authenticates-its-resolved-target"
          },
          {
            "pattern": "verification-targets-each-valid-observation-originates-from-its-assigned-source"
          },
          {
            "pattern": "verification-targets-each-valid-observation-target-has-assigned-source-of-record"
          },
          {
            "pattern": "verification-targets-each-valid-observation-is-from-the-captured-attempt"
          },
          {
            "pattern": "verification-targets-each-valid-observation-is-at-its-position-in-the-captured-interval"
          },
          {
            "pattern": "verification-targets-each-valid-observation-does-not-match-the-selected-target"
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
      "target",
      "observation_attempt",
      "interval_start",
      "interval_end",
      "verification",
      "projection_result",
      "declared_source_population",
      "declared_sources",
      "observed_source_population",
      "observed_sources",
      "source_outcome_population",
      "source_outcomes",
      "endpoint_population",
      "endpoint_pairs",
      "stable_endpoint_state",
      "resolved_target_population",
      "resolved_targets",
      "assigned_source_population",
      "assigned_sources",
      "invalidating_condition_population",
      "invalidating_conditions",
      "absent_conclusion_population",
      "absent_conclusion"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_evidence_capture",
      "observation_capture_proof",
      "raw_observation_population",
      "raw_observations",
      "valid_observation_population",
      "valid_observations",
      "observation_position_population",
      "observation_positions",
      "source_count_signal",
      "observation_count_signal"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.observation.sound-negative.",
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
        "missing": "No named proof.observation.sound-negative constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.observation.sound-negative.",
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
