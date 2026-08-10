const DOMAINS = Object.freeze({
  tenant_document: {
    owner: "tenant-a", foreign: "tenant-b", resource: "document-17",
    expected_result: { revision: 2 }
  },
  cloud_bucket: {
    owner: "account-primary", foreign: "account-guest", resource: "bucket-ledger",
    expected_result: { policy_version: 4 }
  },
  payment_account: {
    owner: "merchant-owner", foreign: "merchant-other", resource: "payout-account",
    expected_result: { payout_enabled: true }
  }
});
function executeExactOwnershipScenario({
  domain = "tenant_document", strategy = "refuse_foreign_preserve_authority"
} = {}) {
  const definition = DOMAINS[domain];
  if (!definition) throw new Error(`unknown exact-ownership domain ${domain}`);
  let foreignSubject = definition.foreign;
  let targetedResource = definition.resource;
  let foreignRefused = true;
  let writesBeforeRefusal = 0;
  let mutationsBeforeRefusal = 0;
  let authorityStateBefore = { uses_remaining: 1 };
  let authorityStateAfter = structuredClone(authorityStateBefore);
  let laterAccepted = true;
  let laterResult = structuredClone(definition.expected_result);
  if (strategy === "cross_owner_accepted") foreignRefused = false;
  if (strategy === "alias_bypass") {
    foreignSubject = definition.owner;
    foreignRefused = false;
  }
  if (strategy === "wrong_resource") targetedResource = `${definition.resource}-decoy`;
  if (strategy === "refusal_after_effect") {
    writesBeforeRefusal = 1;
    mutationsBeforeRefusal = 1;
  }
  if (strategy === "legitimate_authority_consumed") authorityStateAfter = {
    uses_remaining: 0
  };
  if (strategy === "later_valid_fails") {
    laterAccepted = false;
    laterResult = { failed: true };
  }
  return { domain, strategy, legitimate_owner: definition.owner, foreign_subject: foreignSubject,
    owned_resource: definition.resource, targeted_resource: targetedResource,
    foreign_refused: foreignRefused, writes_before_refusal: writesBeforeRefusal,
    mutations_before_refusal: mutationsBeforeRefusal,
    authority_state_before: authorityStateBefore, authority_state_after: authorityStateAfter,
    later_accepted: laterAccepted, later_result: laterResult,
    expected_result: structuredClone(definition.expected_result) };
}
function exactOwnershipImplementationPassed(execution) {
  return execution.foreign_subject !== execution.legitimate_owner &&
    execution.targeted_resource === execution.owned_resource && execution.foreign_refused &&
    execution.writes_before_refusal === 0 && execution.mutations_before_refusal === 0 &&
    JSON.stringify(execution.authority_state_before) ===
      JSON.stringify(execution.authority_state_after) && execution.later_accepted &&
    JSON.stringify(execution.later_result) === JSON.stringify(execution.expected_result);
}
export {
  DOMAINS as EXACT_OWNERSHIP_DOMAINS,
  executeExactOwnershipScenario,
  exactOwnershipImplementationPassed
};
