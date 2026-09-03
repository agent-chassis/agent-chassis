import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  ASSOCIATION_TRACE_POINT,
  ITERATION_TRACE_POINT,
  TRACE_RECONCILIATION_REASONS,
  selectedContractNodes
} from "../lib/projected-evaluation-binding.mjs";
import {
  evaluateVerificationProfileV034
} from "../lib/verification-profile-v034.mjs";
import { canonicalJson } from "../lib/contract-assessment.mjs";
import {
  ALTERNATE_SOURCE_FILES,
  COVERING_ITERATION_PATTERN,
  EXACT_ITERATION_PATTERN,
  PARTICIPATION_ITERATION_PATTERN,
  SMALL_SOURCE_FILES,
  VACUOUS_ITERATION_PATTERN,
  censusBytes,
  createSubject,
  projectedBindingCodes,
  projectedBindingDiagnostics,
  realEvaluationTrace,
  retracedWith
} from "./support/projected-evaluation-association-fixture.mjs";

async function withSubject(options, body) {
  const subject = await createSubject(options);
  try {
    return await body(subject);
  } finally {
    await subject.cleanup();
  }
}

function claimIdsStartingWith(selected, prefix) {
  return [...selected.claims].filter((claimId) => claimId.startsWith(prefix)).sort();
}

function contractClaimIds(subject, prefix) {
  return subject.contract.claims
    .map(({ claim_id: claimId }) => claimId)
    .filter((claimId) => claimId.startsWith(prefix))
    .sort();
}

function propositionOf(contract, propositionId) {
  return contract.propositions.find(
    ({ proposition_id: identifier }) => identifier === propositionId
  );
}

function caseIds(subject) {
  return contractClaimIds(subject, "claim-observed-in-")
    .map((claimId) => claimId.slice("claim-observed-in-".length));
}

function reconcile(subject, mutateRecords, options = {}) {
  const { evaluation, trace } = realEvaluationTrace(subject, options);
  const records = mutateRecords(
    trace.records.map((record) => structuredClone(record)), evaluation
  );
  return selectedContractNodes(
    evaluation,
    options.profile ?? subject.profile,
    retracedWith(trace, records)
  );
}

function reasonsOf(diagnostics, code) {
  return diagnostics.filter((entry) => entry.code === code)
    .map(({ reason }) => reason).sort();
}

const INCOMPLETE = "projected_evaluation_trace_incomplete";
const UNEXPECTED = "projected_evaluation_trace_unexpected_record";
const MEMBER_CONFLICT = "projected_evaluation_trace_member_conflict";
const UNPROJECTED = "projected_evaluation_selected_node_unprojected";

test("a multi-member iteration binds every association claim of every member",
  async () => {
    await withSubject({}, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.structure, "proven");
      assert.equal(projected.assessment.profile_discrimination, "proven");
      assert.equal(projected.assessment.exact_binding, "proven",
        JSON.stringify(projectedBindingDiagnostics(projected)));
      assert.equal(
        projected.assessment.verification_scope.projected_evaluation_binding,
        "bound_to_deterministic_projection"
      );
      assert.deepEqual(projectedBindingDiagnostics(projected), []);

      const { evaluation, trace } = realEvaluationTrace(subject);
      const { selected, diagnostics } = selectedContractNodes(
        evaluation, subject.profile, trace
      );
      assert.deepEqual(diagnostics, []);
      assert.equal(caseIds(subject).length, 8);
      for (const prefix of [
        "claim-observed-in-", "claim-originates-from-", "claim-covers-"
      ]) {
        assert.deepEqual(claimIdsStartingWith(selected, prefix),
          contractClaimIds(subject, prefix),
          `${prefix} claims must all be bound`);
      }
    });
  });

test("the complete selected-claim population is bound, not only the first claim",
  async () => {
    await withSubject({}, (subject) => {
      const { evaluation, trace } = realEvaluationTrace(subject);
      const covering = evaluation.pattern_results.find(
        ({ pattern_id: identifier }) => identifier === COVERING_ITERATION_PATTERN
      );
      assert.equal(covering.status, "satisfied");
      assert.equal(covering.matched_ids.length, 8,
        "the pattern result names one claim per member");
      assert.equal(contractClaimIds(subject, "claim-covers-").length, 16);
      const { selected } = selectedContractNodes(evaluation, subject.profile, trace);
      assert.deepEqual(claimIdsStartingWith(selected, "claim-covers-"),
        contractClaimIds(subject, "claim-covers-"),
        "both covering claims of every member are bound through the trace");
      for (const record of trace.records.filter(({ trace_point: point, pattern_id: id }) =>
        point === ASSOCIATION_TRACE_POINT && id === COVERING_ITERATION_PATTERN
      )) assert.equal(record.node_ids.length, 2);
    });
  });

test("a single-member iteration in the reference-operand position binds one-or-more",
  async () => {
    await withSubject({ sourceFiles: SMALL_SOURCE_FILES }, (subject) => {
      assert.equal(subject.project().assessment.exact_binding, "proven");
      const { evaluation, trace } = realEvaluationTrace(subject);
      const iteration = trace.records.find(({ trace_point: point, pattern_id: id }) =>
        point === ITERATION_TRACE_POINT && id === PARTICIPATION_ITERATION_PATTERN
      );
      assert.equal(iteration.member_reference_ids.length, 1);
      assert.equal(iteration.association_count, 1);
      assert.equal(iteration.iteration_vacuous, false);
      const [record] = trace.records.filter(({ trace_point: point, pattern_id: id }) =>
        point === ASSOCIATION_TRACE_POINT && id === PARTICIPATION_ITERATION_PATTERN
      );
      assert.equal(record.member_reference_id, iteration.member_reference_ids[0]);
      assert.equal(record.associated_cardinality, "one_or_more");
      assert.deepEqual(record.node_ids,
        contractClaimIds(subject, "claim-originates-from-"));
      const participation = evaluation.pattern_results.find(
        ({ pattern_id: id }) => id === PARTICIPATION_ITERATION_PATTERN
      );
      assert.equal(participation.matched_ids.length, 1,
        "the pattern result names one claim, the trace names the whole population");
    });
  });

test("each member is paired with its own distinct target and source", async () => {
  await withSubject({}, (subject) => {
    const { trace } = realEvaluationTrace(subject);
    const records = trace.records.filter(({ trace_point: point, pattern_id: id }) =>
      point === ASSOCIATION_TRACE_POINT && id === EXACT_ITERATION_PATTERN
    );
    assert.equal(records.length, 16, "eight members times two associations");
    const owners = new Map();
    for (const record of records) {
      assert.equal(record.node_ids.length, 1);
      const [claimId] = record.node_ids;
      assert.ok(claimId.endsWith(record.member_reference_id.slice("ref-".length)),
        "an association claim is attributed only to the member it names");
      assert.equal(owners.has(claimId), false, "no claim serves two members");
      owners.set(claimId, record.member_reference_id);
    }
    assert.deepEqual([...new Set(records.map(({ associated_role: role }) => role))].sort(),
      ["occurrence_attempts", "occurrence_sources"]);
  });
});

test("an empty mechanically complete universal iteration is vacuously satisfied",
  async () => {
    await withSubject({}, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.exact_binding, "proven");
      const { evaluation, trace } = realEvaluationTrace(subject);
      const vacuous = evaluation.pattern_results.find(
        ({ pattern_id: id }) => id === VACUOUS_ITERATION_PATTERN
      );
      assert.equal(vacuous.status, "satisfied");
      assert.deepEqual(vacuous.matched_ids, []);
      const iteration = trace.records.find(({ trace_point: point, pattern_id: id }) =>
        point === ITERATION_TRACE_POINT && id === VACUOUS_ITERATION_PATTERN
      );
      assert.equal(iteration.iteration_vacuous, true);
      assert.deepEqual(iteration.member_reference_ids, []);
      assert.equal(trace.records.some(({ trace_point: point, pattern_id: id }) =>
        point === ASSOCIATION_TRACE_POINT && id === VACUOUS_ITERATION_PATTERN
      ), false, "a vacuous iteration selects nothing");
    });
  });

test("unrelated references, claims, associations, and equalities stay accepted",
  async () => {
    await withSubject({
      mutateContract: (contract) => {
        for (let index = 0; index < 40; index += 1) {
          contract.references.push({
            reference_id: `ref-unrelated-${index}`,
            type_term: "cc:evidence_occurrence",
            identity: { kind: "profile_term", term: `unrelated-δοκιμή-${index}` }
          });
          contract.propositions.push({
            proposition_id: `prop-unrelated-observed-${index}`,
            subject_reference_id: `ref-unrelated-${index}`,
            operator: "reference:observed_in",
            applicability_context: { mode: "unconditional", operand_reference_ids: [] },
            operands: [{
              kind: "reference", reference_id: "ref-derived-census-run"
            }]
          });
          contract.claims.push({
            claim_id: `claim-unrelated-observed-${index}`,
            kind: "evidence",
            modality: "MUST",
            proposition_id: `prop-unrelated-observed-${index}`
          });
        }
        for (let index = 0; index + 1 < 40; index += 2) {
          contract.propositions.push({
            proposition_id: `prop-unrelated-equals-${index}`,
            subject_reference_id: `ref-unrelated-${index}`,
            operator: "reference:equals",
            applicability_context: { mode: "unconditional", operand_reference_ids: [] },
            operands: [{
              kind: "reference", reference_id: `ref-unrelated-${index + 1}`
            }]
          });
          contract.claims.push({
            claim_id: `claim-unrelated-equals-${index}`,
            kind: "evidence",
            modality: "MUST",
            proposition_id: `prop-unrelated-equals-${index}`
          });
        }
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.deepEqual(projectedBindingDiagnostics(projected), []);
      assert.equal(projected.assessment.exact_binding, "proven");
    });
  });

test("property and set-order permutations of the captured contract stay accepted",
  async () => {
    await withSubject({
      mutateContract: (contract) => {
        const reorder = (node) => Object.fromEntries(
          Object.entries(node).reverse()
        );
        return {
          ...contract,
          references: contract.references.map(reorder).reverse(),
          propositions: contract.propositions.map((proposition) => reorder({
            ...proposition,
            operands: [...proposition.operands].reverse(),
            applicability_context: {
              ...proposition.applicability_context,
              operand_reference_ids: [
                ...proposition.applicability_context.operand_reference_ids
              ].reverse()
            }
          })).reverse(),
          claims: contract.claims.map(reorder).reverse(),
          relations: contract.relations.map(reorder).reverse(),
          collections: contract.collections.map((collection) => reorder({
            ...collection,
            member_claim_ids: [...collection.member_claim_ids].reverse()
          })).reverse()
        };
      }
    }, (subject) => {
      const projected = subject.project();
      assert.deepEqual(projectedBindingDiagnostics(projected), []);
      assert.equal(projected.assessment.exact_binding, "proven");
    });
  });

test("the association trace sink is write-only", async () => {
  await withSubject({}, (subject) => {
    const withoutSink = evaluateVerificationProfileV034({
      contract: structuredClone(subject.contract),
      profile: structuredClone(subject.profile),
      evaluation_input: structuredClone(subject.evaluationInput)
    });
    const { evaluation: withSink, trace } = realEvaluationTrace(subject);
    assert.equal(canonicalJson(withSink), canonicalJson(withoutSink));
    assert.ok(trace.records.some(({ trace_point: point }) =>
      point === ASSOCIATION_TRACE_POINT));
  });
});

test("repeated projection is byte identical and does not mutate caller inputs",
  async () => {
    await withSubject({}, (subject) => {
      const before = canonicalJson({
        contract: subject.contract,
        evaluationInput: subject.evaluationInput,
        profile: subject.profile
      });
      const first = subject.project();
      const second = subject.project();
      assert.equal(canonicalJson(first.assessment), canonicalJson(second.assessment));
      assert.equal(canonicalJson({
        contract: subject.contract,
        evaluationInput: subject.evaluationInput,
        profile: subject.profile
      }), before);
      assert.notEqual(first.assessment, second.assessment);
      assert.equal(Object.isFrozen(first.assessment.diagnostics), true,
        "a returned assessment must not be mutable through a caller-held reference");
    });
  });

test("the association assessment identity is stable across process, locale, and timezone",
  async () => {
    const script = `
      const { createSubject } = await import(${
  JSON.stringify(new URL(
    "./support/projected-evaluation-association-fixture.mjs", import.meta.url
  ).href)});
      const subject = await createSubject();
      try {
        const projected = subject.project();
        process.stdout.write(JSON.stringify({
          identity: projected.assessment.assessment_identity,
          exact_binding: projected.assessment.exact_binding
        }));
      } finally { await subject.cleanup(); }
    `;
    const observed = [
      { LC_ALL: "C", TZ: "UTC" },
      { LC_ALL: "tr_TR.UTF-8", TZ: "Europe/Istanbul" },
      { LC_ALL: "lt_LT.UTF-8", TZ: "Pacific/Kiritimati" }
    ].map((environment) => execFileSync(process.execPath, [
      "--input-type=module", "-e", script
    ], { env: { ...process.env, ...environment }, encoding: "utf8" }));
    assert.equal(new Set(observed).size, 1, observed.join("\n"));
    assert.equal(JSON.parse(observed[0]).exact_binding, "proven");
  });

test("an association claim outside the projected graph is refused", async () => {
  await withSubject({
    mutateContract: (contract) => {
      const covered = contract.propositions.find(({ proposition_id: identifier }) =>
        identifier.startsWith("prop-covers-branch-"));
      contract.propositions.push({
        ...structuredClone(covered),
        proposition_id: "prop-smuggled-covers"
      });
      contract.claims.push({
        claim_id: "claim-smuggled-covers",
        kind: "evidence",
        modality: "MUST",
        proposition_id: "prop-smuggled-covers"
      });
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.exact_binding, "not_proven");
    const unprojected = projectedBindingDiagnostics(projected)
      .filter(({ code }) => code === UNPROJECTED);
    assert.deepEqual(unprojected.map(({ node_kind: kind, node_id: identifier }) =>
      [kind, identifier]), [["claims", "claim-smuggled-covers"]]);
  });
});

test("a projected association claim reused with changed content is refused", async () => {
  await withSubject({
    mutateContract: (contract) => {
      const claim = contract.claims.find(({ claim_id: identifier }) =>
        identifier.startsWith("claim-observed-in-"));
      claim.modality = "SHOULD";
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.ok(projectedBindingCodes(projected)
      .includes("projected_graph_node_content_mismatch"));
  });
});

test("a substituted proposition beneath an association claim is refused", async () => {
  await withSubject({
    mutateContract: (contract) => {
      const [first, second] = contract.claims
        .filter(({ claim_id: identifier }) => identifier.startsWith("claim-covers-"))
        .slice(0, 2);
      const swap = first.proposition_id;
      first.proposition_id = second.proposition_id;
      second.proposition_id = swap;
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.ok(projectedBindingCodes(projected)
      .includes("projected_graph_node_content_mismatch"));
  });
});

test("a changed subject or operand under an association claim is refused", async () => {
  for (const mutate of [
    (proposition, contract) => {
      proposition.subject_reference_id = contract.propositions.find(
        ({ proposition_id: identifier, subject_reference_id: subject }) =>
          identifier.startsWith("prop-observed-in-") &&
          subject !== proposition.subject_reference_id
      ).subject_reference_id;
    },
    (proposition, contract) => {
      proposition.operands[0].reference_id = contract.references.find(
        ({ reference_id: identifier, type_term: term }) => term === "cc:process" &&
          identifier !== proposition.operands[0].reference_id &&
          identifier !== "ref-derived-census-run"
      ).reference_id;
    }
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await withSubject({
      mutateContract: (contract) => {
        mutate(contract.propositions.find(({ proposition_id: identifier }) =>
          identifier.startsWith("prop-observed-in-")), contract);
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.exact_binding, "not_proven");
      assert.ok(projectedBindingCodes(projected)
        .includes("projected_graph_node_content_mismatch"));
    });
  }
});

test("a changed applicability scope under a provenance association is refused",
  async () => {
    await withSubject({
      mutateContract: (contract) => {
        const proposition = contract.propositions.find(
          ({ proposition_id: identifier }) =>
            identifier.startsWith("prop-originates-from-")
        );
        proposition.applicability_context = {
          mode: "during", operand_reference_ids: [
            contract.references.find(({ type_term: term, reference_id: identifier }) =>
              term === "cc:process" && identifier !== "ref-derived-census-run"
            ).reference_id
          ]
        };
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.exact_binding, "not_proven");
      assert.equal(projected.assessment.profile_discrimination, "not_proven");
      assert.ok(projectedBindingCodes(projected)
        .includes("projected_graph_node_content_mismatch"));
    });
  });

test("one member using another member's association claim is refused", async () => {
  await withSubject({
    mutateContract: (contract) => {
      const [first, second] = contract.propositions
        .filter(({ proposition_id: identifier }) =>
          identifier.startsWith("prop-observed-in-"))
        .slice(0, 2);
      first.subject_reference_id = second.subject_reference_id;
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    const { evaluation } = realEvaluationTrace(subject);
    assert.notEqual(evaluation.pattern_results.find(
      ({ pattern_id: identifier }) => identifier === EXACT_ITERATION_PATTERN
    ).status, "satisfied");
  });
});

test("target and source associations crossed between observations are refused",
  async () => {
    await withSubject({
      mutateContract: (contract) => {
        const [first, second] = contract.propositions
          .filter(({ proposition_id: identifier }) =>
            identifier.startsWith("prop-originates-from-"))
          .slice(0, 2);
        const swap = first.operands[0].reference_id;
        first.operands[0].reference_id = second.operands[0].reference_id;
        second.operands[0].reference_id = swap;
        return contract;
      }
    }, (subject) => {
      const projected = subject.project();
      assert.equal(projected.assessment.exact_binding, "not_proven");
      assert.ok(projectedBindingCodes(projected)
        .includes("projected_graph_node_content_mismatch"));
    });
  });

test("ambiguous and incomplete association candidates gain no proof", async () => {
  await withSubject({
    mutateProfile: (profile) => {
      const pattern = profile.claim_patterns.find(
        ({ pattern_id: identifier }) => identifier === COVERING_ITERATION_PATTERN
      );
      delete pattern.for_each.association_bindings[0].associated_cardinality;
      return profile;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    const { evaluation } = realEvaluationTrace(subject);
    assert.equal(evaluation.pattern_results.find(
      ({ pattern_id: identifier }) => identifier === COVERING_ITERATION_PATTERN
    ).status, "indeterminate");
  });

  await withSubject({
    mutateEvaluationInput: (input) => {
      input.reference_bindings.find(({ role }) => role === "occurrence_criteria")
        .reference_ids.pop();
      return input;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    const { evaluation } = realEvaluationTrace(subject);
    assert.notEqual(evaluation.pattern_results.find(
      ({ pattern_id: identifier }) => identifier === COVERING_ITERATION_PATTERN
    ).status, "satisfied");
  });
});

test("an association claim carried over from another contract is refused", async () => {
  const alien = await createSubject({ sourceFiles: ALTERNATE_SOURCE_FILES });
  const alienClaim = alien.contract.claims.find(({ claim_id: identifier }) =>
    identifier.startsWith("claim-covers-branch-"));
  const alienProposition = structuredClone(
    propositionOf(alien.contract, alienClaim.proposition_id)
  );
  const alienClaimId = alienClaim.claim_id;
  await alien.cleanup();
  await withSubject({

    mutateContract: (contract) => {
      const native = contract.propositions.find(({ proposition_id: identifier }) =>
        identifier.startsWith("prop-covers-branch-"));
      contract.propositions.push({
        ...alienProposition,
        subject_reference_id: native.subject_reference_id,
        operands: structuredClone(native.operands)
      });
      contract.claims.push({
        claim_id: alienClaimId,
        kind: "evidence",
        modality: "MUST",
        proposition_id: alienProposition.proposition_id
      });
      return contract;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.deepEqual(projectedBindingDiagnostics(projected)
      .filter(({ code }) => code === UNPROJECTED)
      .map(({ node_id: identifier }) => identifier), [alienClaimId]);
  });
});

test("a spliced projection result and a swapped evaluation input are refused",
  async () => {
    await withSubject({ censusOverride: censusBytes(SMALL_SOURCE_FILES) },
      (subject) => {
        assert.equal(subject.project().assessment.exact_binding, "not_proven");
        assert.notDeepEqual(projectedBindingCodes(subject.project()), []);
      });
    await withSubject({}, async (subject) => {
      const other = await createSubject({ sourceFiles: SMALL_SOURCE_FILES });
      try {
        const projected = subject.project({
          evaluationInput: other.evaluationInput,
          contract: subject.contract
        });
        assert.equal(projected.assessment.exact_binding, "not_proven");
        assert.ok(projectedBindingCodes(projected)
          .includes("projected_evaluation_context_stale_or_spliced"));
      } finally {
        await other.cleanup();
      }
    });
  });

test("a profile, declaration, or admission swapped behind its digest is refused",
  async () => {
    await withSubject({}, (subject) => {
      const substituted = structuredClone(subject.profile);
      substituted.claim_patterns = substituted.claim_patterns.filter(
        ({ pattern_id: identifier }) => identifier !== EXACT_ITERATION_PATTERN
      );
      substituted.satisfaction_expression.all_of =
        substituted.satisfaction_expression.all_of.filter(
          ({ pattern }) => pattern !== EXACT_ITERATION_PATTERN
        );
      assert.equal(subject.project({
        proofPack: Object.freeze({ ...subject.pack, profile: substituted })
      }).assessment.exact_binding, "not_proven");

      const declaration = structuredClone(subject.declaration);
      declaration.projected_evaluation_binding.graph_projection_id = "case-membership";
      assert.equal(subject.project({
        proofPack: Object.freeze({ ...subject.pack, declaration })
      }).assessment.exact_binding, "not_proven");

      const admission = structuredClone(subject.pack.admission);
      admission.guarantee = "substituted guarantee";
      assert.equal(subject.project({
        proofPack: Object.freeze({ ...subject.pack, admission })
      }).assessment.exact_binding, "not_proven");
    });
  });

test("an unbound iteration population is not vacuity and gains no proof", async () => {
  await withSubject({
    mutateEvaluationInput: (input) => ({
      ...input,
      reference_bindings: input.reference_bindings.filter(
        ({ role }) => role !== "excluded_cases"
      )
    })
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.profile_discrimination, "not_proven");
    const { evaluation, trace } = realEvaluationTrace(subject);
    const iteration = trace.records.find(({ trace_point: point, pattern_id: id }) =>
      point === ITERATION_TRACE_POINT && id === VACUOUS_ITERATION_PATTERN
    );
    assert.equal(iteration.iteration_vacuous, false);
    assert.notEqual(evaluation.pattern_results.find(
      ({ pattern_id: identifier }) => identifier === VACUOUS_ITERATION_PATTERN
    ).status, "satisfied");
  });
});

test("declaring an unsupported construct still fails closed", async () => {
  await withSubject({
    mutateProfile: (profile) => {
      profile.reference_binding_patterns.push({
        pattern_id: "aliased-pair",
        required_by_stage: "pre_dispatch",
        comparison: "same_reference",
        roles: ["attempt_population", "criterion_population"],
        applicability_context: { mode: "unconditional", operand_roles: [] }
      });
      return profile;
    }
  }, (subject) => {
    const projected = subject.project();
    assert.equal(projected.assessment.exact_binding, "not_proven");
    assert.deepEqual(projectedBindingDiagnostics(projected)
      .filter(({ code }) =>
        code === "projected_evaluation_unsupported_profile_construct")
      .map(({ construct }) => construct), ["reference_binding.same_reference"]);
  });
});

test("an omitted association record fails closed", async () => {
  await withSubject({}, (subject) => {
    const { diagnostics } = reconcile(subject, (records) => records.filter(
      (record, index) => !(record.trace_point === ASSOCIATION_TRACE_POINT &&
        index === records.findIndex(({ trace_point: point }) =>
          point === ASSOCIATION_TRACE_POINT))
    ));
    assert.deepEqual(reasonsOf(diagnostics, INCOMPLETE), ["association_record_missing"]);
  });
});

test("an unlicensed or duplicated association record fails closed", async () => {
  await withSubject({}, (subject) => {
    const unlicensed = reconcile(subject, (records) => {
      const record = records.find(({ trace_point: point }) =>
        point === ASSOCIATION_TRACE_POINT);
      return [...records, { ...record, member_reference_id: "ref-not-iterated" }];
    });
    assert.deepEqual(reasonsOf(unlicensed.diagnostics, UNEXPECTED),
      ["association_record_unlicensed"]);

    const duplicated = reconcile(subject, (records) => {
      const record = records.find(({ trace_point: point }) =>
        point === ASSOCIATION_TRACE_POINT);
      return [...records, structuredClone(record)];
    });
    assert.deepEqual(reasonsOf(duplicated.diagnostics, UNEXPECTED),
      ["association_record_duplicate"]);

    const outOfRange = reconcile(subject, (records) => {
      const record = records.find(({ trace_point: point, pattern_id: id }) =>
        point === ASSOCIATION_TRACE_POINT && id === EXACT_ITERATION_PATTERN);
      return [...records, { ...record, association_index: 7 }];
    });
    assert.deepEqual(reasonsOf(outOfRange.diagnostics, UNEXPECTED),
      ["association_record_unlicensed"]);
  });
});

test("a record reassigned to another member fails closed", async () => {
  await withSubject({}, (subject) => {
    const { diagnostics } = reconcile(subject, (records) => {
      const exact = records.filter(({ trace_point: point, pattern_id: id }) =>
        point === ASSOCIATION_TRACE_POINT && id === EXACT_ITERATION_PATTERN);
      const [first] = exact;
      const other = exact.find(({ member_reference_id: member }) =>
        member !== first.member_reference_id);
      return records.map((record) => record === first
        ? { ...record, member_reference_id: other.member_reference_id }
        : record);
    });
    assert.deepEqual(reasonsOf(diagnostics, UNEXPECTED),
      ["association_record_duplicate"]);
    assert.deepEqual(reasonsOf(diagnostics, INCOMPLETE),
      ["association_record_missing"]);
  });
});

test("one claim attributed to two iterated members fails closed", async () => {
  await withSubject({}, (subject) => {
    const { diagnostics } = reconcile(subject, (records) => {
      const exact = records.filter(({ trace_point: point, pattern_id: id,
        association_index: index }) => point === ASSOCIATION_TRACE_POINT &&
        id === EXACT_ITERATION_PATTERN && index === 0);
      const [first] = exact;
      const other = exact.find(({ member_reference_id: member }) =>
        member !== first.member_reference_id);
      return records.map((record) => record === other
        ? { ...record, node_ids: [...first.node_ids] }
        : record);
    });
    assert.deepEqual(diagnostics.map(({ code }) => code), [MEMBER_CONFLICT]);
  });
});

test("the evaluator records a failed association rather than omitting it", async () => {
  await withSubject({
    mutateEvaluationInput: (input) => {
      input.reference_bindings.find(({ role }) => role === "occurrence_criteria")
        .reference_ids.pop();
      return input;
    }
  }, (subject) => {
    const { evaluation, trace } = realEvaluationTrace(subject);
    assert.notEqual(evaluation.pattern_results.find(
      ({ pattern_id: identifier }) => identifier === COVERING_ITERATION_PATTERN
    ).status, "satisfied");
    const records = trace.records.filter(({ trace_point: point, pattern_id: id }) =>
      point === ASSOCIATION_TRACE_POINT && id === COVERING_ITERATION_PATTERN);
    const iteration = trace.records.find(({ trace_point: point, pattern_id: id }) =>
      point === ITERATION_TRACE_POINT && id === COVERING_ITERATION_PATTERN);
    assert.equal(records.length, iteration.member_reference_ids.length,
      "a failed association is still recorded once per member");
    assert.ok(records.some(({ association_status: status }) => status !== "satisfied"));

    for (const record of records.filter(
      ({ association_status: status }) => status !== "satisfied"
    )) assert.deepEqual(record.node_ids, []);

    const { diagnostics } = selectedContractNodes({
      pattern_results: [{
        pattern_id: COVERING_ITERATION_PATTERN,
        pattern_kind: "claim",
        status: "satisfied",
        matched_ids: []
      }]
    }, subject.profile, trace);
    assert.deepEqual(new Set(reasonsOf(diagnostics, INCOMPLETE)),
      new Set(["association_record_unsatisfied"]));
  });
});

test("conflicts are keyed by member position, not by declaration index", () => {
  const positions = (first, second) => ({
    reference_binding_patterns: [],
    claim_patterns: [{
      pattern_id: "ring",
      for_each: {
        association_bindings: [
          { associated_role: "first_role", member_position: first },
          { associated_role: "second_role", member_position: second }
        ]
      }
    }]
  });
  const evaluation = {
    pattern_results: [{
      pattern_id: "ring", pattern_kind: "claim", status: "satisfied", matched_ids: []
    }]
  };
  const record = (member, index, claimId) => ({
    trace_point: ASSOCIATION_TRACE_POINT,
    pattern_id: "ring",
    member_reference_id: member,
    association_index: index,
    associated_role: index === 0 ? "first_role" : "second_role",
    associated_cardinality: "exactly_one",
    association_status: "satisfied",
    node_kind: "claim",
    node_ids: [claimId]
  });
  const iteration = {
    trace_point: ITERATION_TRACE_POINT,
    pattern_id: "ring",
    member_reference_ids: ["ref-a", "ref-b"],
    association_count: 2,
    iteration_vacuous: false
  };
  const reconcile = (profile, records) =>
    selectedContractNodes(evaluation, profile, { records: [iteration, ...records] });
  const conflicts = ({ diagnostics }) => diagnostics.map(
    ({ code, member_position: position }) => [code, position]
  );

  const opposite = reconcile(positions("subject", "reference_operand"), [
    record("ref-a", 0, "claim-a-b"),
    record("ref-b", 1, "claim-a-b"),
    record("ref-b", 0, "claim-b-a"),
    record("ref-a", 1, "claim-b-a")
  ]);
  assert.deepEqual(opposite.diagnostics, []);
  assert.deepEqual([...opposite.selected.claims].sort(), ["claim-a-b", "claim-b-a"]);

  for (const position of ["subject", "reference_operand"]) {
    assert.deepEqual(conflicts(reconcile(positions(position, position), [
      record("ref-a", 0, "claim-shared"),
      record("ref-b", 1, "claim-shared"),
      record("ref-b", 0, "claim-b-only"),
      record("ref-a", 1, "claim-a-only")
    ])), [[MEMBER_CONFLICT, position]], `same ${position} position across indices`);
  }

  assert.deepEqual(conflicts(reconcile(positions("subject", "reference_operand"), [
    record("ref-a", 0, "claim-a-b"),
    record("ref-b", 0, "claim-a-b"),
    record("ref-a", 1, "claim-b-a"),
    record("ref-b", 1, "claim-a-b")
  ])), [[MEMBER_CONFLICT, "subject"]]);
});

test("a partial trace after an association failure fails closed", async () => {
  await withSubject({}, (subject) => {
    const { diagnostics } = reconcile(subject, (records) => records.map((record) =>
      record.trace_point === ASSOCIATION_TRACE_POINT &&
        record.pattern_id === EXACT_ITERATION_PATTERN &&
        record.association_index === 1
        ? { ...record, association_status: "indeterminate", node_ids: [] }
        : record
    ));
    assert.deepEqual(new Set(reasonsOf(diagnostics, INCOMPLETE)),
      new Set(["association_record_unsatisfied"]));
    assert.equal(reasonsOf(diagnostics, INCOMPLETE).length, 8);
  });
});

test("a selection whose size contradicts its declared cardinality fails closed",
  async () => {
    await withSubject({}, (subject) => {
      const exactlyOne = reconcile(subject, (records) => records.map((record) =>
        record.trace_point === ASSOCIATION_TRACE_POINT &&
          record.pattern_id === EXACT_ITERATION_PATTERN &&
          record.association_index === 0
          ? { ...record, node_ids: [...record.node_ids, "claim-extra"] }
          : record
      ));
      assert.deepEqual(new Set(reasonsOf(exactlyOne.diagnostics, INCOMPLETE)),
        new Set(["association_selection_cardinality_mismatch"]));

      const oneOrMore = reconcile(subject, (records) => records.map((record) =>
        record.trace_point === ASSOCIATION_TRACE_POINT &&
          record.pattern_id === COVERING_ITERATION_PATTERN
          ? { ...record, node_ids: [] }
          : record
      ));
      assert.deepEqual(new Set(reasonsOf(oneOrMore.diagnostics, INCOMPLETE)),
        new Set(["association_selection_cardinality_mismatch"]));
    });
  });

test("a record disagreeing with the declared association fails closed", async () => {
  await withSubject({}, (subject) => {
    for (const override of [
      { associated_role: "occurrence_criteria" },
      { associated_cardinality: "one_or_more" },
      { node_kind: "relation" }
    ]) {
      const { diagnostics } = reconcile(subject, (records) => records.map((record) =>
        record.trace_point === ASSOCIATION_TRACE_POINT &&
          record.pattern_id === EXACT_ITERATION_PATTERN &&
          record.association_index === 0
          ? { ...record, ...override }
          : record
      ));
      assert.deepEqual(new Set(reasonsOf(diagnostics, UNEXPECTED)),
        new Set(["association_record_declaration_mismatch"]),
        JSON.stringify(override));
    }
  });
});

test("a missing, duplicated, or malformed iteration record fails closed", async () => {
  await withSubject({}, (subject) => {
    const isIteration = (record, patternId) =>
      record.trace_point === ITERATION_TRACE_POINT && record.pattern_id === patternId;

    const missing = reconcile(subject, (records) => records.filter((record) =>
      !isIteration(record, EXACT_ITERATION_PATTERN)));
    assert.deepEqual(reasonsOf(missing.diagnostics, INCOMPLETE),
      ["iteration_record_missing"]);

    const duplicated = reconcile(subject, (records) => [
      ...records,
      structuredClone(records.find((record) =>
        isIteration(record, EXACT_ITERATION_PATTERN)))
    ]);
    assert.deepEqual(reasonsOf(duplicated.diagnostics, UNEXPECTED),
      ["iteration_record_duplicate"]);

    const noncanonical = reconcile(subject, (records) => records.map((record) =>
      isIteration(record, EXACT_ITERATION_PATTERN)
        ? {
          ...record,
          member_reference_ids: [...record.member_reference_ids].reverse()
        }
        : record));
    assert.deepEqual(reasonsOf(noncanonical.diagnostics, UNEXPECTED),
      ["iteration_population_noncanonical"]);

    const miscounted = reconcile(subject, (records) => records.map((record) =>
      isIteration(record, EXACT_ITERATION_PATTERN)
        ? { ...record, association_count: 1 }
        : record));
    assert.deepEqual(reasonsOf(miscounted.diagnostics, UNEXPECTED),
      ["iteration_association_count_mismatch"]);

    const emptied = reconcile(subject, (records) => records.map((record) =>
      isIteration(record, EXACT_ITERATION_PATTERN)
        ? { ...record, member_reference_ids: [] }
        : record));
    assert.deepEqual(reasonsOf(emptied.diagnostics, INCOMPLETE),
      ["iteration_population_empty"]);
  });
});

test("vacuity laundering fails closed", async () => {
  await withSubject({}, (subject) => {
    const laundered = reconcile(subject, (records) => records.map((record) =>
      record.trace_point === ITERATION_TRACE_POINT &&
        record.pattern_id === EXACT_ITERATION_PATTERN
        ? { ...record, member_reference_ids: [], iteration_vacuous: true }
        : record));
    assert.deepEqual(reasonsOf(laundered.diagnostics, UNEXPECTED),
      ["vacuous_iteration_selected_nodes"]);
    assert.deepEqual(
      claimIdsStartingWith(laundered.selected, "claim-observed-in-"), []
    );

    const populated = reconcile(subject, (records) => records.map((record) =>
      record.trace_point === ITERATION_TRACE_POINT &&
        record.pattern_id === VACUOUS_ITERATION_PATTERN
        ? { ...record, member_reference_ids: ["ref-invented"] }
        : record));
    assert.deepEqual(reasonsOf(populated.diagnostics, UNEXPECTED),
      ["vacuous_iteration_selected_nodes"]);

    const disavowed = reconcile(subject, (records) => records.map((record) =>
      record.trace_point === ITERATION_TRACE_POINT &&
        record.pattern_id === VACUOUS_ITERATION_PATTERN
        ? { ...record, member_reference_ids: ["ref-invented"], iteration_vacuous: false }
        : record));
    assert.deepEqual(reasonsOf(disavowed.diagnostics, INCOMPLETE),
      ["association_record_missing"]);
  });
});

test("the reconciliation reason vocabulary is closed and exhaustively reachable",
  () => {
    assert.deepEqual(TRACE_RECONCILIATION_REASONS.incomplete,
      [...TRACE_RECONCILIATION_REASONS.incomplete].sort());
    assert.deepEqual(TRACE_RECONCILIATION_REASONS.unexpected,
      [...TRACE_RECONCILIATION_REASONS.unexpected].sort());
    assert.equal(new Set([
      ...TRACE_RECONCILIATION_REASONS.incomplete,
      ...TRACE_RECONCILIATION_REASONS.unexpected
    ]).size, TRACE_RECONCILIATION_REASONS.incomplete.length +
      TRACE_RECONCILIATION_REASONS.unexpected.length);
  });

test("caller-supplied trace-like material carries no authority", async () => {
  await withSubject({}, (subject) => {
    const baseline = canonicalJson(subject.project().assessment);
    const forged = [
      {
        trace_point: ITERATION_TRACE_POINT,
        pattern_id: EXACT_ITERATION_PATTERN,
        member_reference_ids: [],
        association_count: 2,
        iteration_vacuous: true
      },
      {
        trace_point: ASSOCIATION_TRACE_POINT,
        pattern_id: EXACT_ITERATION_PATTERN,
        member_reference_id: "ref-invented",
        association_index: 0,
        associated_role: "occurrence_attempts",
        associated_cardinality: "exactly_one",
        association_status: "satisfied",
        node_kind: "claim",
        node_ids: ["claim-invented"]
      }
    ];
    const poisonedInput = structuredClone(subject.evaluationInput);
    poisonedInput.graph_selection_trace = forged;
    const poisonedContract = structuredClone(subject.contract);
    poisonedContract.graph_selection_trace = forged;
    const poisonedPack = Object.freeze({
      ...subject.pack,
      graph_selection_trace: forged,
      declaration: {
        ...subject.declaration,
        projected_evaluation_binding: {
          ...subject.declaration.projected_evaluation_binding
        }
      }
    });
    assert.equal(canonicalJson(subject.project({
      proofPack: poisonedPack
    }).assessment), baseline,
      "a pack-carried trace changes nothing");
    assert.equal(subject.project({
      evaluationInput: poisonedInput
    }).assessment.exact_binding, "not_proven",
      "an evaluation input the capture context does not cover proves nothing");
    assert.throws(() => subject.project({ contract: poisonedContract }),
      /source|differ/,
      "a contract the structural result does not cover cannot be substituted");
  });
});

test("a foreign trace version contributes no records", async () => {
  await withSubject({}, (subject) => {
    const { trace } = realEvaluationTrace(subject);
    assert.equal(trace.trace_version,
      "controlled-contract-profile-graph-selection-trace.v1");
    assert.ok(trace.records.length > 0);
    const { diagnostics } = selectedContractNodes(
      realEvaluationTrace(subject).evaluation,
      subject.profile,
      retracedWith(trace, [])
    );
    assert.ok(reasonsOf(diagnostics, INCOMPLETE).includes("iteration_record_missing"));
  });
});
