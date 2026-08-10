const DOMAINS = Object.freeze({
  file_upload: {
    cause: { code: "disk-full", origin: "chunk-writer" },
    residues: ["temp-chunk", "upload-lock"]
  },
  job_dispatch: {
    cause: { code: "broker-rejected", origin: "queue-publisher" },
    residues: ["capacity-reservation", "dedupe-lease"]
  },
  schema_migration: {
    cause: { code: "ddl-failed", origin: "migration-runner" },
    residues: ["schema-lock", "shadow-table", "migration-marker"]
  }
});

function executeFailureSettlementScenario({
  domain = "file_upload", strategy = "cleanup_and_preserve_cause"
} = {}) {
  const definition = DOMAINS[domain];
  if (!definition) throw new Error(`unknown failure-settlement domain ${domain}`);
  const originalCause = structuredClone(definition.cause);
  let settledCause = structuredClone(originalCause);
  let residues = [...definition.residues];
  let failureInjected = true;
  let cleanupObserved = true;
  let settlementFollowsCleanup = true;
  let failureRecordPreserved = true;

  if (strategy === "no_failure") failureInjected = false;
  if (strategy === "missing_cleanup") cleanupObserved = false;
  if (strategy === "partial_cleanup") residues = residues.slice(-1);
  else if (cleanupObserved) residues = [];
  if (strategy === "settlement_before_cleanup") settlementFollowsCleanup = false;
  if (strategy === "cause_replaced") settledCause = {
    code: "generic-failure", origin: "settlement-wrapper"
  };
  if (strategy === "cause_dropped") {
    settledCause = null;
    failureRecordPreserved = false;
  }
  if (strategy === "cleanup_then_residue_reappears") residues = [definition.residues[0]];

  return {
    domain,
    strategy,
    failure_injected: failureInjected,
    cleanup_observed: cleanupObserved,
    settlement_follows_cleanup: settlementFollowsCleanup,
    original_cause: originalCause,
    settled_cause: settledCause,
    failure_record_preserved: failureRecordPreserved,
    residue_count_after_settlement: residues.length,
    residues_after_settlement: residues
  };
}

function failureSettlementImplementationPassed(execution) {
  return execution.failure_injected && execution.cleanup_observed &&
    execution.settlement_follows_cleanup && execution.failure_record_preserved &&
    execution.residue_count_after_settlement === 0 &&
    JSON.stringify(execution.original_cause) === JSON.stringify(execution.settled_cause);
}

export {
  DOMAINS as FAILURE_SETTLEMENT_DOMAINS,
  executeFailureSettlementScenario,
  failureSettlementImplementationPassed
};
