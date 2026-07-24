

export const PARENT_LIFECYCLE_CONTRACT_FACTS = Object.freeze({
  INITIATIVE: "initiative",
  ACCEPTANCE_CRITERIA: "acceptance.criteria",
  ACCEPTANCE_VALIDATION: "acceptance.validation",
  TERMINAL_REVIEW_CONTRACT_UNIT: "terminal_review_contract_unit"
});

const INITIATIVE_PATTERN = /^IN-\d{4}$/u;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneAndFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreeze));
  }
  if (isObject(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)]))
    );
  }
  return value;
}

export function isEligibleTerminalWholeWkReviewContractUnit(unit) {
  return Boolean(
    isObject(unit) &&
    unit.work_kind === "review" &&
    unit.review_purpose === "terminal_whole_wk" &&
    Array.isArray(unit.write_scope) &&
    unit.write_scope.length === 0 &&
    unit.dispatch_intent?.intended_agent_role === "reviewer" &&
    unit.dispatch_intent?.target_unit === "slice" &&
    unit.status !== "done" &&
    unit.status !== "cancelled"
  );
}

export function evaluateWorkRecordParentLifecycleContract(record) {
  const missingFacts = [];
  const ambiguousFacts = [];

  if (!INITIATIVE_PATTERN.test(record?.initiative ?? "")) {
    missingFacts.push(PARENT_LIFECYCLE_CONTRACT_FACTS.INITIATIVE);
  }
  if (!Array.isArray(record?.acceptance?.criteria) || record.acceptance.criteria.length === 0) {
    missingFacts.push(PARENT_LIFECYCLE_CONTRACT_FACTS.ACCEPTANCE_CRITERIA);
  }
  if (!Array.isArray(record?.acceptance?.validation) || record.acceptance.validation.length === 0) {
    missingFacts.push(PARENT_LIFECYCLE_CONTRACT_FACTS.ACCEPTANCE_VALIDATION);
  }

  const eligibleUnits = Array.isArray(record?.slices)
    ? record.slices.filter(isEligibleTerminalWholeWkReviewContractUnit)
    : [];
  if (eligibleUnits.length === 0) {
    missingFacts.push(PARENT_LIFECYCLE_CONTRACT_FACTS.TERMINAL_REVIEW_CONTRACT_UNIT);
  } else if (eligibleUnits.length > 1) {
    ambiguousFacts.push(PARENT_LIFECYCLE_CONTRACT_FACTS.TERMINAL_REVIEW_CONTRACT_UNIT);
  }

  if (missingFacts.length > 0 || ambiguousFacts.length > 0) {
    return Object.freeze({
      complete: false,
      missing_facts: Object.freeze(missingFacts),
      ambiguous_facts: Object.freeze(ambiguousFacts)
    });
  }

  return Object.freeze({
    complete: true,
    terminal_review_contract_unit: cloneAndFreeze(eligibleUnits[0])
  });
}
