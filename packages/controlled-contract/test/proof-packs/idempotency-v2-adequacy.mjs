import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import {
  buildIdempotencyV2Fixture,
  referenceIdForRole
} from "./idempotency-v2-test-fixture.mjs";
import {
  evaluateVerificationProfileV034
} from "../../lib/verification-profile-v034.mjs";

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });
const IDEMPOTENCY_V2_GUARANTEE_DIGEST =
  "38166c31a5bcf62c7d3cdde9af1b4ecec27b67d299a4a190a15715f96f852050";
const IDEMPOTENCY_V2_PROFILE_DIGEST =
  "17bf47915be39daf662b178794faa6315fa707cd92c70bbca6919699d13721a7";

function evaluateFixture(fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function addDomainEvidence(contract, id, operator) {
  contract.propositions.push({
    proposition_id: `prop-${id}`,
    subject_reference_id: referenceIdForRole("operation"),
    operator,
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [ref(referenceIdForRole("effect_subject"))]
  });
  contract.claims.push({
    claim_id: `claim-${id}`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: `prop-${id}`
  });
}

function newPaymentStore() {
  return {
    charges: new Map(),
    ledger: [],
    responses: new Map(),
    keys: new Map(),
    hiddenAuditWrites: 0,
    secondaryWrites: 0,
    sequence: 0
  };
}

function paymentState(store) {
  return JSON.stringify({
    charges: [...store.charges.entries()].sort(),
    ledger: store.ledger
  });
}

function correctCapture(store, request) {
  if (store.keys.has(request.key)) return store.responses.get(request.key);
  store.sequence += 1;
  const id = `charge-${store.sequence}`;
  store.charges.set(id, { id, amount: request.amount });
  store.ledger.push({ id, amount: request.amount });
  const response = { status: 200, id };
  store.keys.set(request.key, id);
  store.responses.set(request.key, response);
  return response;
}

const paymentMutants = {
  "duplicate-durable-effect": {
    implementation(store, request) {
    if (store.keys.has(request.key)) {
      store.ledger.push({ id: store.keys.get(request.key), amount: request.amount });
      return store.responses.get(request.key);
    }
    return correctCapture(store, request);
    }
  },
  "reset-then-replay": {
    implementation(store, request) {
    if (store.keys.has(request.key)) {
      const id = store.keys.get(request.key);
      store.charges.delete(id);
      store.ledger = store.ledger.filter((entry) => entry.id !== id);
      store.keys.delete(request.key);
      store.responses.delete(request.key);
    }
    return correctCapture(store, request);
    }
  },
  "replace-preserving-cardinality": {
    implementation(store, request) {
    if (!store.keys.has(request.key)) return correctCapture(store, request);
    const prior = store.keys.get(request.key);
    store.charges.delete(prior);
    store.ledger = [];
    store.sequence += 1;
    const id = `charge-${store.sequence}`;
    store.charges.set(id, { id, amount: request.amount });
    store.ledger.push({ id, amount: request.amount });
    store.keys.set(request.key, id);
    return store.responses.get(request.key);
    }
  },
  "pre-second-state-change-restored-by-replay": {
    betweenObservations(store) {
      store.intermediateState = {
        charges: new Map(store.charges),
        ledger: structuredClone(store.ledger)
      };
      const [id] = store.charges.keys();
      store.charges.set(id, { id, amount: 9999 });
      store.ledger = [{ id, amount: 9999 }];
    },
    implementation(store, request) {
      if (store.intermediateState) {
        store.charges = store.intermediateState.charges;
        store.ledger = store.intermediateState.ledger;
        delete store.intermediateState;
        return store.responses.get(request.key);
      }
      return correctCapture(store, request);
    }
  }
};

function executeSequential({
  createStore,
  implementation,
  betweenObservations = () => {},
  observe,
  request
}) {
  const store = createStore();
  const first = implementation(store, request);
  const afterFirst = observe(store);
  betweenObservations(store, request);
  const beforeSecond = observe(store);
  const second = implementation(store, request);
  const afterSecond = observe(store);
  return {
    after_first: afterFirst,
    before_second: beforeSecond,
    after_second: afterSecond,
    passed: afterFirst === beforeSecond && afterFirst === afterSecond,
    responses_equal: JSON.stringify(first) === JSON.stringify(second),
    store
  };
}

function executePayment(implementation = correctCapture, betweenObservations = () => {}) {
  return executeSequential({
    createStore: newPaymentStore,
    implementation,
    betweenObservations,
    observe: paymentState,
    request: { key: "capture-1", amount: 4200 }
  });
}

function executeQueue() {
  const store = { jobs: [], responseByKey: new Map() };
  const submit = (request) => {
    if (store.responseByKey.has(request.key)) return store.responseByKey.get(request.key);
    const job = { id: `job-${store.jobs.length + 1}`, payload: request.payload };
    store.jobs.push(job);
    const response = { status: 202, job_id: job.id };
    store.responseByKey.set(request.key, response);
    return response;
  };
  const request = { key: "enqueue-1", payload: "work" };
  const first = submit(request);
  const afterFirst = JSON.stringify(store.jobs);
  const beforeSecond = JSON.stringify(store.jobs);
  const second = submit(request);
  return {
    passed: afterFirst === beforeSecond && JSON.stringify(store.jobs) === afterFirst,
    responses_equal: JSON.stringify(first) === JSON.stringify(second)
  };
}

function executeDatabaseBootstrap() {
  const catalog = Object.create(null);
  const bootstrap = ({ database, schema }) => {
    if (catalog[database]) return { created: false, database };
    catalog[database] = { schema, migrations: ["base"] };
    return { created: true, database };
  };
  const request = { database: "analytics", schema: "v1" };
  bootstrap(request);
  const afterFirst = JSON.stringify(catalog);
  const beforeSecond = JSON.stringify(catalog);
  bootstrap(request);
  return { passed: afterFirst === beforeSecond && JSON.stringify(catalog) === afterFirst };
}

function truthfulFixtureForExecution(profile, execution) {
  const fixture = buildIdempotencyV2Fixture({ profile });
  const comparisons = [
    ["pre-second-state-equality", execution.after_first, execution.before_second],
    ["idempotent-effect", execution.after_first, execution.after_second]
  ];
  for (const [patternId, left, right] of comparisons) {
    if (left === right) continue;
    const proposition = fixture.contract.propositions.find(
      ({ proposition_id: propositionId }) => propositionId === `prop-${patternId}`
    );
    if (proposition) proposition.operator = "reference:not_equals";
  }
  return fixture;
}

function positiveControls(profile) {
  const cases = [
    {
      control_id: "payment-capture-sequential-replay",
      execution: executePayment(),
      fixture: buildIdempotencyV2Fixture({ profile, domain: "payment" })
    },
    {
      control_id: "queue-submission-sequential-replay",
      execution: executeQueue(),
      fixture: buildIdempotencyV2Fixture({
        profile,
        domain: "queue",
        reference_type_overrides: {
          first_input: "cc:configuration",
          observation_after_first: "cc:evidence",
          observation_before_second: "cc:evidence",
          observation_after_second: "cc:evidence",
          verification: "cc:process"
        },
        mutate_contract(contract) {
          addDomainEvidence(contract, "queue-routing", "reference:routes_to");
        }
      })
    },
    {
      control_id: "database-bootstrap-sequential-replay",
      execution: executeDatabaseBootstrap(),
      fixture: buildIdempotencyV2Fixture({
        profile,
        domain: "database",
        reference_type_overrides: { first_input: "cc:entity" },
        mutate_contract(contract) {
          addDomainEvidence(contract, "database-creation", "reference:creates");
          contract.annotations.push({
            annotation_id: "ann-database-domain",
            kind: "rationale",
            text: "Database bootstrap uses a catalog-backed create-if-missing implementation."
          });
        }
      })
    }
  ];
  return cases.map(({ control_id: controlId, execution, fixture }) => ({
    control_id: controlId,
    category: "positive",
    implementation_outcome: execution.passed ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(fixture)
  }));
}

function mutantControls(profile) {
  return Object.entries(paymentMutants).map(([controlId, mutant]) => {
    const execution = executePayment(mutant.implementation, mutant.betweenObservations);
    const fixture = truthfulFixtureForExecution(profile, execution);
    return {
      control_id: controlId,
      category: "mutant",
      implementation_outcome: execution.passed ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(fixture)
    };
  });
}

function removeClaims(contract, claimIds) {
  const ids = new Set(claimIds);
  const propositionIds = new Set(contract.claims.filter(
    ({ claim_id: claimId }) => ids.has(claimId)
  ).flatMap(({ proposition_id: propositionId, falsifying_proposition_id: falsifierId }) =>
    [propositionId, falsifierId].filter(Boolean)
  ));
  contract.claims = contract.claims.filter(({ claim_id: claimId }) => !ids.has(claimId));
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: propositionId }) => !propositionIds.has(propositionId)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      !ids.has(source) && !ids.has(target)
  );
  contract.collections = contract.collections.map((collection) => ({
    ...collection,
    member_claim_ids: collection.member_claim_ids.filter((claimId) => !ids.has(claimId))
  }));
}

function responseEqualityOnlyFixture(profile) {
  return buildIdempotencyV2Fixture({
    profile,
    mutate_contract(contract) {
      removeClaims(contract, [
        "claim-idempotent-effect",
        "claim-idempotency-equivalence-verification"
      ]);
      for (const suffix of ["first", "second"]) contract.references.push({
        reference_id: `ref-response-${suffix}`,
        type_term: "cc:artifact",
        identity: { kind: "profile_term", term: `payment:response-${suffix}` }
      });
      contract.propositions.push({
        proposition_id: "prop-response-equality-only",
        subject_reference_id: "ref-response-second",
        operator: "reference:equals",
        applicability_context: {
          mode: "after",
          operand_reference_ids: [referenceIdForRole("second_invocation")]
        },
        operands: [ref("ref-response-first")]
      });
      contract.claims.push({
        claim_id: "claim-response-equality-only",
        kind: "evidence",
        modality: "MUST",
        proposition_id: "prop-response-equality-only"
      });
    }
  });
}

function changeApplicability(fixture, patternId, applicabilityContext) {
  const proposition = fixture.contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === `prop-${patternId}`
  );
  if (proposition) proposition.applicability_context = structuredClone(applicabilityContext);
  return fixture;
}

function rejectionFixtures(profile) {
  return {
    "response-equality-only": () => responseEqualityOnlyFixture(profile),
    "idempotent-effect-unconditional": () => changeApplicability(
      buildIdempotencyV2Fixture({ profile }),
      "idempotent-effect",
      { mode: "unconditional", operand_reference_ids: [] }
    ),
    "idempotent-effect-unless-second": () => changeApplicability(
      buildIdempotencyV2Fixture({ profile }),
      "idempotent-effect",
      {
        mode: "unless",
        operand_reference_ids: [referenceIdForRole("second_invocation")]
      }
    ),
    "pre-second-equality-after-first": () => changeApplicability(
      buildIdempotencyV2Fixture({ profile }),
      "pre-second-state-equality",
      {
        mode: "after",
        operand_reference_ids: [referenceIdForRole("first_invocation")]
      }
    ),
    "competing-proof-population": () => buildIdempotencyV2Fixture({
      profile,
      mutate_contract(contract) {
        contract.propositions.push({
          proposition_id: "prop-competing-population-extra",
          subject_reference_id: referenceIdForRole("verification"),
          operator: "reference:reads",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [ref(referenceIdForRole("first_input"))]
        });
        contract.claims.push({
          claim_id: "claim-competing-population-extra",
          kind: "evidence",
          modality: "MUST",
          proposition_id: "prop-competing-population-extra"
        });
        const proofPopulation = contract.collections.find(
          ({ collection_id: collectionId }) => collectionId === "set-proof-population"
        );
        contract.collections.push({
          collection_id: "set-competing-proof-population",
          collection_kind: "closed_set",
          purpose: "profile_proof_population",
          member_claim_ids: [
            ...proofPopulation.member_claim_ids,
            "claim-competing-population-extra"
          ]
        });
      }
    }),
    "single-invocation": () => {
      const fixture = buildIdempotencyV2Fixture({ profile });
      const binding = fixture.input.reference_bindings.find(
        ({ role }) => role === "second_invocation"
      );
      if (binding) binding.reference_ids = [referenceIdForRole("first_invocation")];
      return fixture;
    },
    "unrelated-effect-resource": () => buildIdempotencyV2Fixture({
      profile,
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-unrelated-resource",
          type_term: "cc:resource",
          identity: { kind: "profile_term", term: "unrelated-resource" }
        });
        const proposition = contract.propositions.find(
          ({ proposition_id: propositionId }) =>
            propositionId === "prop-operation-effect-resource"
        );
        if (proposition) proposition.operands = [ref("ref-unrelated-resource")];
      }
    })
  };
}

function profileRejectionControls(profile) {
  return Object.entries(rejectionFixtures(profile)).map(([controlId, createFixture]) => ({
    control_id: controlId,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: evaluateFixture(createFixture())
  }));
}

function baselineSatisfaction(profile) {
  return evaluateFixture(buildIdempotencyV2Fixture({ profile }));
}

function exclusionControls(profile) {
  const baseline = baselineSatisfaction(profile);
  const concurrencyStore = newPaymentStore();
  const concurrentRequest = { key: "capture-race", amount: 4200 };
  const bothObservedAbsent = !concurrencyStore.keys.has(concurrentRequest.key);
  if (bothObservedAbsent) {
    for (const id of ["charge-race-a", "charge-race-b"]) {
      concurrencyStore.charges.set(id, { id, amount: concurrentRequest.amount });
      concurrencyStore.ledger.push({ id, amount: concurrentRequest.amount });
    }
  }
  const partialStore = newPaymentStore();
  partialStore.ledger.push({ id: "uncommitted-charge", amount: 4200 });
  correctCapture(partialStore, { key: "partial-1", amount: 4200 });
  const principalStore = newPaymentStore();
  const alice = correctCapture(principalStore, { key: "shared-key", amount: 4200 });
  const bob = correctCapture(principalStore, { key: "shared-key", amount: 7300 });
  const outsideResource = executePayment((store, request) => {
    const response = correctCapture(store, request);
    if (store.keys.has(request.key) && store.responses.get(request.key) === response &&
        store.ledger.length === 1) store.secondaryWrites += 1;
    return response;
  });
  const hiddenAction = executePayment((store, request) => {
    const response = correctCapture(store, request);
    store.hiddenAuditWrites += 1;
    return response;
  });
  const resetHistoryStore = newPaymentStore();
  correctCapture(resetHistoryStore, { key: "history-1", amount: 4200 });
  const stableState = paymentState(resetHistoryStore);
  const savedCharges = new Map(resetHistoryStore.charges);
  const savedLedger = structuredClone(resetHistoryStore.ledger);
  resetHistoryStore.charges.clear();
  resetHistoryStore.ledger = [];
  const resetOccurred = paymentState(resetHistoryStore) !== stableState;
  resetHistoryStore.charges = savedCharges;
  resetHistoryStore.ledger = savedLedger;
  const restored = paymentState(resetHistoryStore) === stableState;
  const resetFixture = buildIdempotencyV2Fixture({
    profile,
    mutate_contract(contract) {
      contract.propositions.push({
        proposition_id: "prop-declared-intervening-reset",
        subject_reference_id: referenceIdForRole("operation"),
        operator: "reference:deletes",
        applicability_context: {
          mode: "before",
          operand_reference_ids: [referenceIdForRole("second_invocation")]
        },
        operands: [ref(referenceIdForRole("effect_subject"))]
      });
      contract.claims.push({
        claim_id: "claim-declared-intervening-reset",
        kind: "evidence",
        modality: "MUST",
        proposition_id: "prop-declared-intervening-reset"
      });
    }
  });
  const resetSatisfaction = evaluateFixture(resetFixture);
  const groundingFixture = buildIdempotencyV2Fixture({ profile });
  const groundingSatisfaction = evaluateFixture(groundingFixture);
  const realOccurrenceByReference = new Map([
    [referenceIdForRole("first_invocation"), "runtime-occurrence-one"],
    [referenceIdForRole("second_invocation"), "runtime-occurrence-one"]
  ]);
  const demonstrations = {
    "concurrent-replay-safety":
      baseline === "satisfied" && concurrencyStore.ledger.length === 2,
    "partial-commit-recovery":
      baseline === "satisfied" && partialStore.ledger.length === 2,
    "idempotency-key-principal-scope":
      baseline === "satisfied" && alice.id === bob.id,
    "mutation-of-resources-outside-the-elected-effect-resource":
      outsideResource.passed && outsideResource.store.secondaryWrites > 0,
    "intervening-reset-or-mutation-history":
      resetSatisfaction === "satisfied" && resetOccurred && restored,
    "undeclared-runtime-actions":
      hiddenAction.passed && hiddenAction.store.hiddenAuditWrites > 0,
    "dishonest-reference-grounding":
      groundingSatisfaction === "satisfied" &&
        new Set(realOccurrenceByReference.values()).size === 1
  };
  return Object.entries(demonstrations).map(([controlId, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
    profile_satisfaction: controlId === "intervening-reset-or-mutation-history"
      ? resetSatisfaction
      : baseline
  }));
}

async function runProofPackAdequacyControls({
  profile
}) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: IDEMPOTENCY_V2_PROFILE_DIGEST,
    guarantee_digest: IDEMPOTENCY_V2_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  executePayment,
  paymentMutants,
  responseEqualityOnlyFixture,
  runProofPackAdequacyControls,
  truthfulFixtureForExecution
};
