

import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";

export const CONTROLLED_CONTRACT_RUNTIME_TEST_LIMITS = Object.freeze({
  boundary_subjects: 8
});

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

const RUNTIME_TEST_ANSWERS = Object.freeze([
  Object.freeze({
    pointer: "/system_under_test_boundary/kind",
    field: "boundary.kind",
    read: ({ runtimeTest }) => runtimeTest.boundary?.kind
  }),
  Object.freeze({
    pointer: "/system_under_test_boundary/subject_reference_ids",
    field: "boundary.subjects",
    read: ({ boundarySubjectReferenceIds }) => boundarySubjectReferenceIds
  }),
  Object.freeze({
    pointer: "/system_under_test_boundary/runtime_module_path",
    field: "boundary.module_path",
    read: ({ runtimeTest }) => runtimeTest.boundary?.module_path
  }),
  Object.freeze({
    pointer: "/observable_result/kind",
    field: "observable.kind",
    read: ({ runtimeTest }) => runtimeTest.observable?.kind
  }),
  Object.freeze({
    pointer: "/observable_result/proposition_id",
    field: null,
    derived_from: "verification.observes",
    read: ({ observesPropositionId }) => observesPropositionId
  }),
  Object.freeze({
    pointer: "/falsifiers/0/strategy",
    field: "falsifier.strategy",
    read: ({ runtimeTest }) => runtimeTest.falsifier?.strategy
  }),
  Object.freeze({
    pointer: "/falsifiers/0/proposition_id",
    field: null,
    derived_from: "verification.fails_when",
    read: ({ falsifyingPropositionId }) => falsifyingPropositionId
  }),
  Object.freeze({
    pointer: "/falsifiers/0/mutation/module_path",
    field: "falsifier.module_path",
    read: ({ runtimeTest }) => runtimeTest.falsifier?.module_path
  }),
  Object.freeze({
    pointer: "/falsifiers/0/mutation/entry_export",
    field: "falsifier.entry_export",
    read: ({ runtimeTest }) => runtimeTest.falsifier?.entry_export
  }),
  Object.freeze({
    pointer: "/falsifiers/0/mutation/operation/module_path",
    field: "falsifier.operation.module_path",
    read: ({ runtimeTest }) => runtimeTest.falsifier?.operation?.module_path
  }),
  Object.freeze({
    pointer: "/falsifiers/0/mutation/operation/export_name",
    field: "falsifier.operation.export_name",
    read: ({ runtimeTest }) => runtimeTest.falsifier?.operation?.export_name
  }),

  Object.freeze({
    pointer: "/test_selector/name",
    field: "selector.name",
    read: ({ runtimeTest }) => runtimeTest.selector?.name
  }),
  Object.freeze({
    pointer: "/test_selector/nesting",
    field: "selector.nesting",
    read: ({ runtimeTest }) => runtimeTest.selector?.nesting
  })
]);

const ANSWERED_POINTERS = Object.freeze(new Set(
  RUNTIME_TEST_ANSWERS.map(({ pointer }) => pointer)));

function segments(pointer) {
  return pointer.slice(1).split("/");
}

function readPointer(value, pointer) {
  let cursor = value;
  for (const segment of segments(pointer)) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
  }
  return cursor;
}

function writePointer(value, pointer, next) {
  const path = segments(pointer);
  const last = path.pop();
  let cursor = value;
  for (const segment of path) {
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
  }
  if (Array.isArray(cursor)) cursor[Number(last)] = next;
  else cursor[last] = next;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function same(left, right) {
  return canonical(left ?? null) === canonical(right ?? null);
}

export function projectControlledContractRuntimeTestAuthoring(templates) {
  const semantics = templates.flatMap((template) => template.author_semantics);
  const open = new Set(semantics.map(({ pointer }) => pointer));
  const strategies = templates.map(({ binding }) => binding.falsifiers[0].strategy);
  const requirementOf = (pointer) => semantics.find(
    (entry) => entry.pointer === pointer) ?? {};
  return Object.freeze({
    schema_version: "controlled-contract-runtime-test-authoring.v1",

    response_field: "verification.runtime_test",
    required_for: "test_execution",
    answers: Object.freeze([Object.freeze({ field: "falsifier.strategy",
      values: Object.freeze(strategies) }), ...RUNTIME_TEST_ANSWERS
      .filter(({ pointer, field }) => field !== null && open.has(pointer))
      .map(({ field, pointer }) => {
        const { requirement, cardinality,
          compatible_values: values } = requirementOf(pointer);
        const applicable = templates.filter((template) => template.author_semantics
          .some((entry) => entry.pointer === pointer))
          .map(({ binding }) => binding.falsifiers[0].strategy);
        return Object.freeze({ field, states: requirement ?? null,
          ...(applicable.length === templates.length ? {} : {
            strategies: applicable }),
          ...(cardinality === undefined ? {} : { cardinality }),
          ...(Array.isArray(values) && values.length > 0
            ? { values: Object.freeze([...values]) } : {}) });
      })]),

    derived_from_requirement: Object.freeze(RUNTIME_TEST_ANSWERS
      .filter(({ pointer, field }) => field === null && open.has(pointer))
      .map(({ derived_from: from }) => from))
  });
}

export function buildControlledContractRuntimeTestTemplate(buildTemplate, input, field) {
  try {
    return buildTemplate(input);
  } catch (error) {

    if (error?.name !== "StableTestProofContractError") throw error;
    throw new ControlledContractToolError(error.code, error.message,
      { ...error.details, changed: false, field: `${field}.falsifier.strategy` });
  }
}

export function composeControlledContractRuntimeTestProof({
  template, runtimeTest, boundarySubjectReferenceIds, observesPropositionId,
  falsifyingPropositionId, field, currentBinding = null,
  selectedFalsifier = null
}) {
  if (runtimeTest === null || typeof runtimeTest !== "object" ||
      Array.isArray(runtimeTest)) {
    fail("controlled_contract_requirement_runtime_meaning_missing",
      `${field} verifies by test_execution, which additionally requires its runtime-test meaning`,
      { field: `${field}`,
        open_answers: projectControlledContractRuntimeTestAuthoring([template]).answers });
  }
  if (currentBinding?.falsifiers?.length > 1 && selectedFalsifier === null) {
    fail("controlled_contract_requirement_runtime_falsifier_selection_required",
      "a proof with multiple falsifiers can only change through an explicit selected-member replacement",
      { field: `${field}.falsifier.select`,
        falsifier_count: currentBinding.falsifiers.length,
        next_response_kind: "runtime_test_replacement" });
  }
  const currentFalsifier = selectedFalsifier ?? currentBinding?.falsifiers?.[0] ?? null;
  if (runtimeTest.falsifier?.strategy === undefined && currentFalsifier !== null &&
      currentFalsifier.strategy !== template.binding.falsifiers[0].strategy) {
    fail("controlled_contract_requirement_runtime_meaning_missing",
      "restate the existing proof's strategy or explicitly select its replacement",
      { field: `${field}.falsifier.strategy`,
        unanswered_pointers: ["/falsifiers/0/strategy"], interface_gap: [],
        current_strategy: currentFalsifier.strategy });
  }
  const open = new Set(template.author_semantics.map(({ pointer }) => pointer));
  const binding = structuredClone(template.binding);
  if (runtimeTest.falsifier?.operation !== undefined &&
      binding.falsifiers[0].mutation.operation === undefined) {
    fail("controlled_contract_requirement_runtime_binding_conflict",
      "the selected strategy does not admit an operation selector",
      { field: `${field}.falsifier.operation`,
        pointer: "/falsifiers/0/mutation/operation", bound_value: null });
  }
  const missing = [];
  for (const entry of RUNTIME_TEST_ANSWERS) {
    const value = entry.read({ runtimeTest, boundarySubjectReferenceIds,
      observesPropositionId, falsifyingPropositionId });
    if (!open.has(entry.pointer)) {

      if (value !== undefined && !same(value, readPointer(binding, entry.pointer))) {
        fail("controlled_contract_requirement_runtime_binding_conflict",
          `${field}.${entry.field} contradicts a binding the stable-proof owner fixed`,
          { field: `${field}.${entry.field}`, pointer: entry.pointer,
            bound_value: readPointer(binding, entry.pointer) ?? null });
      }
      continue;
    }
    if (value === undefined) { missing.push(entry.pointer); continue; }
    writePointer(binding, entry.pointer, structuredClone(value));
  }

  const unanswered = [...open].filter((pointer) => !ANSWERED_POINTERS.has(pointer));
  if (missing.length > 0 || unanswered.length > 0) {
    fail("controlled_contract_requirement_runtime_meaning_missing",
      "the stable test proof this requirement needs is missing runtime-test meaning",
      { field: `${field}`,
        unanswered_pointers: [...missing, ...unanswered].sort(),
        interface_gap: unanswered.sort(),
        open_answers: projectControlledContractRuntimeTestAuthoring([template]).answers });
  }
  return binding;
}

export function projectControlledContractDeclaredRuntimeTest(binding) {
  if (binding === null || typeof binding !== "object") return null;
  const falsifiers = (binding.falsifiers ?? []).map((falsifier) => {
    const mutation = falsifier.mutation;
    return Object.freeze({
      selector: falsifier.falsifier_id,
      mutation_id: mutation.mutation_id,
      proposition_id: falsifier.proposition_id,
      strategy: falsifier.strategy,
      module_path: mutation.module_path,
      ...(mutation.entry_export === undefined ? {} : {
        entry_export: mutation.entry_export }),
      ...(mutation.operation === undefined ? {} : {
        operation: Object.freeze({ module_path: mutation.operation.module_path,
          export_name: mutation.operation.export_name }) })
    });
  });
  return Object.freeze({
    boundary: Object.freeze({
      kind: binding.system_under_test_boundary?.kind ?? null,
      subjects: Object.freeze([
        ...(binding.system_under_test_boundary?.subject_reference_ids ?? [])]),
      module_path: binding.system_under_test_boundary?.runtime_module_path ?? null
    }),
    observable: Object.freeze({ kind: binding.observable_result?.kind ?? null }),
    falsifiers: Object.freeze({
      total_count: falsifiers.length,
      returned_count: falsifiers.length,
      omitted_count: 0,
      items: Object.freeze(falsifiers)
    }),
    selector: Object.freeze({
      name: binding.test_selector?.name ?? null,
      nesting: binding.test_selector?.nesting ?? null
    })
  });
}

export function sameControlledContractRuntimeTestProof(left, right) {
  return same(left, right);
}

export function composeControlledContractRuntimeTestSelectorCorrection({
  storedBinding, runtimeTest, retireFields, expectedRetiredFields,
  field = "definitions"
}) {
  if (!storedBinding || typeof storedBinding !== "object" ||
      !runtimeTest || typeof runtimeTest !== "object" || Array.isArray(runtimeTest) ||
      !runtimeTest.selector || typeof runtimeTest.selector !== "object" ||
      Array.isArray(runtimeTest.selector) ||
      !same(Object.keys(runtimeTest).sort(), ["selector"]) ||
      !same(Object.keys(runtimeTest.selector).sort(), ["name", "nesting"])) {
    fail("controlled_contract_current_definition_answer_invalid",
      "current-definition correction supplies only one complete declarative selector",
      { field: `${field}.runtime_test.selector` });
  }
  const expected = [...expectedRetiredFields].sort();
  if (!Array.isArray(retireFields) || !same([...retireFields].sort(), expected) ||
      new Set(retireFields).size !== retireFields.length) {
    fail("controlled_contract_current_definition_retirement_confirmation_invalid",
      "retired-field confirmation must exactly match the fields named by the server",
      { field: `${field}.retire_fields`, expected_retired_fields: expected,
        actual_retired_fields: Array.isArray(retireFields) ? [...retireFields].sort() : null });
  }
  const binding = structuredClone(storedBinding);
  for (const retired of expected) delete binding[retired];
  binding.test_selector = structuredClone(runtimeTest.selector);
  return binding;
}

export function composeControlledContractRuntimeTestReplacement({
  template, runtimeTest, falsifierSelection, contract, verificationClaimId,
  field = "runtime_test"
}) {
  const claim = (contract?.claims ?? []).find(
    ({ claim_id: id }) => id === verificationClaimId) ?? null;
  if (claim === null || claim.kind !== "verification" ||
      claim.verification_method !== "test_execution") {
    fail("controlled_contract_requirement_runtime_target_invalid",
      "the verification this row selected is not a test_execution claim in this contract",
      { field, verification_claim_id: verificationClaimId });
  }
  const stored = (contract.test_proofs ?? []).find(
    ({ verification_claim_id: id }) => id === verificationClaimId) ?? null;
  if (stored === null) {
    fail("controlled_contract_requirement_runtime_target_invalid",
      "the selected verification has no existing proof to edit",
      { field, verification_claim_id: verificationClaimId });
  }
  const selectedId = falsifierSelection?.select;
  if (typeof selectedId !== "string" || selectedId.length === 0) {
    fail("controlled_contract_requirement_runtime_falsifier_selection_missing",
      "runtime_test_replacement must select one existing falsifier",
      { field: `${field}.falsifier.select`,
        available_falsifier_ids: stored.falsifiers.map(({ falsifier_id: id }) => id) });
  }
  const selectedMatches = stored.falsifiers
    .map((falsifier, index) => ({ falsifier, index }))
    .filter(({ falsifier }) => falsifier.falsifier_id === selectedId);
  if (selectedMatches.length > 1) {
    fail("controlled_contract_requirement_runtime_falsifier_selection_duplicate",
      "the selected falsifier identity is duplicated in this proof",
      { field: `${field}.falsifier.select`, selector: selectedId,
        occurrence_count: selectedMatches.length });
  }
  if (selectedMatches.length === 0) {
    const anotherProof = (contract.test_proofs ?? []).find((proof) =>
      proof.verification_claim_id !== verificationClaimId &&
      proof.falsifiers?.some(({ falsifier_id: id }) => id === selectedId));
    fail(anotherProof === undefined
      ? "controlled_contract_requirement_runtime_falsifier_selection_unknown"
      : "controlled_contract_requirement_runtime_falsifier_selection_cross_proof",
    anotherProof === undefined
      ? "the selected falsifier is not a member of this proof"
      : "the selected falsifier belongs to another proof",
    { field: `${field}.falsifier.select`, selector: selectedId,
      verification_claim_id: verificationClaimId });
  }
  const [{ falsifier: selected, index: selectedIndex }] = selectedMatches;
  const declared = new Set((contract?.references ?? []).map(
    ({ reference_id: id }) => id));
  const subjects = runtimeTest?.boundary?.subjects;
  const resolved = Array.isArray(subjects) ? subjects.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || entry.select === undefined ||
        entry.declare !== undefined) {
      fail("controlled_contract_requirement_runtime_replacement_declares_referent",
        `${field}.boundary.subjects[${index}] must select a referent this contract already declares; declaring a new one is a contract change`,
        { field: `${field}.boundary.subjects`,
          next_answer: "author the new referent through a contract_requirements answer, then restate the runtime test" });
    }
    if (!declared.has(entry.select)) {
      fail("controlled_contract_requirement_selector_unknown",
        `${field}.boundary.subjects[${index}] selects a referent this contract does not declare`,
        { field: `${field}.boundary.subjects`, selector: entry.select });
    }
    return entry.select;
  }) : [...(stored.system_under_test_boundary?.subject_reference_ids ?? [])];

  const effectiveRuntimeTest = {
    ...runtimeTest,
    boundary: runtimeTest?.boundary ?? {
      kind: stored.system_under_test_boundary?.kind,
      module_path: stored.system_under_test_boundary?.runtime_module_path
    },
    observable: runtimeTest?.observable ?? {
      kind: stored.observable_result?.kind
    },
    selector: runtimeTest?.selector ?? {
      name: stored.test_selector?.name,
      nesting: stored.test_selector?.nesting
    }
  };
  const composed = composeControlledContractRuntimeTestProof({
    template, runtimeTest: effectiveRuntimeTest,
    boundarySubjectReferenceIds: resolved,
    currentBinding: stored, selectedFalsifier: selected,
    observesPropositionId: claim.proposition_id,
    falsifyingPropositionId: claim.falsifying_proposition_id,
    field
  });
  const prospective = structuredClone(stored);
  if (runtimeTest.boundary !== undefined) prospective.system_under_test_boundary = {
    ...prospective.system_under_test_boundary,
    subject_reference_ids: composed.system_under_test_boundary.subject_reference_ids,
    runtime_module_path: composed.system_under_test_boundary.runtime_module_path
  };
  if (runtimeTest.observable !== undefined) {
    prospective.observable_result = { ...prospective.observable_result,
      kind: composed.observable_result.kind };
  }
  if (runtimeTest.selector !== undefined) {
    prospective.test_selector = { name: composed.test_selector.name,
      nesting: composed.test_selector.nesting };
  }
  const replacement = structuredClone(composed.falsifiers[0]);
  replacement.falsifier_id = selected.falsifier_id;
  replacement.proposition_id = selected.proposition_id;
  replacement.mutation.mutation_id = selected.mutation.mutation_id;
  prospective.falsifiers[selectedIndex] = replacement;
  return prospective;
}
