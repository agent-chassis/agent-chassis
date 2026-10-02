

import { createHash } from "node:crypto";

import { dispatchRequestSchemaAuthority } from "./dispatch-tool-helpers.mjs";
import {
  authoredDocumentCall,
  RUN_STATUS_AUTHORED_DOCUMENTS
} from "./dispatch-run-status-retained-document-retrieval.mjs";
import {
  readSelectedResponseSource,
  retainSelectedResponseSource,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";
import {
  readTerminalCandidateAuthoredContracts,
  readTerminalCandidateControlledGeneration,
  TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER
} from "./dispatch-run-status-authored-contract-projection.mjs";
import {
  INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER,
  readIntegrationTransitionAuthoredRecord
} from "./dispatch-run-status-integration-receipt-projection.mjs";

export const AUTHORED_CONTRACT_RETENTION_ROUTE = "workspace_agent_run_status";

export const AUTHORED_DOCUMENTS_QUERY_IDENTITY = "authored_documents";

export function readRunStatusRetainedSource({ source, repository, subject, attemptId, queryIdentity,
  env = process.env }) {
  const envelope = readSelectedResponseSource(source, { env, expected: {
    route: AUTHORED_CONTRACT_RETENTION_ROUTE, repository, unit: subject, query_identity: queryIdentity } });
  const retainedAttempt = envelope.binding.observation_identity?.attempt_id ?? null;
  if (retainedAttempt !== attemptId) {
    throw selectedResponseQueryInvalidError(AUTHORED_CONTRACT_RETENTION_ROUTE, "source_binding_mismatch",
      { binding_field: "observation_identity.attempt_id" });
  }
  return envelope;
}

const DEFAULT_MEMO_CAPACITY = 64;

function sha256Of(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function observationIdentity({ status, terminalCandidate }) {
  const binding = terminalCandidate?.binding ?? null;
  return {
    attempt_id: status?.run_id ?? null,
    monitor_handle: status?.monitor_handle ?? null,
    subject: status?.subject ?? null,
    candidate: binding?.candidate ?? null,
    candidate_ref: binding?.candidate_ref ?? null,
    base: binding?.base ?? null,
    wk_tip: binding?.wk_tip ?? null,
    candidate_schema_version: binding?.schema_version ?? null,
    candidate_version: binding?.version_decision?.version ?? null
  };
}

function* collectRetainableDocuments(lifecycle) {
  const contracts = readTerminalCandidateAuthoredContracts(lifecycle);
  if (contracts !== null) {
    for (const { member, text } of contracts.present) yield { member, text };
  }
  const generation = readTerminalCandidateControlledGeneration(lifecycle);
  if (generation !== null) {
    yield { member: TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER, text: generation.text };
  }
  const receipt = readIntegrationTransitionAuthoredRecord(lifecycle);
  if (receipt !== null) {
    yield { member: INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER, text: receipt.text };
  }
}

export function createAuthoredContractRetention({
  env = process.env,
  memoCapacity = DEFAULT_MEMO_CAPACITY
} = {}) {
  const memo = new Map();

  return {
    retain({ repository, status, lifecycle }) {

      const present = [...collectRetainableDocuments(lifecycle)];
      if (present.length === 0) return null;
      const identity = observationIdentity({
        status,
        terminalCandidate: lifecycle.terminal_candidate
      });
      const carrier = Object.fromEntries(present.map(({ member, text }) => [member, text]));
      const unit = typeof status?.subject === "string" ? status.subject : null;
      const memoKey = sha256Of(JSON.stringify({
        repository,
        unit,
        identity,
        members: present.map(({ member, text }) => [member, sha256Of(text)])
      }));
      const memoized = memo.get(memoKey);
      if (memoized !== undefined) return memoized;

      let retained;
      try {
        const requestSchema = dispatchRequestSchemaAuthority(AUTHORED_CONTRACT_RETENTION_ROUTE);
        if (requestSchema === undefined) {
          throw new TypeError("the run-status request schema is not registered");
        }
        const [firstMember] = present.map(({ member }) => member)
          .filter((member) => Object.hasOwn(RUN_STATUS_AUTHORED_DOCUMENTS, member));
        retained = retainSelectedResponseSource({
          binding: {
            route: AUTHORED_CONTRACT_RETENTION_ROUTE,
            repository,
            unit,
            query_identity: AUTHORED_DOCUMENTS_QUERY_IDENTITY,
            observation_identity: identity
          },
          carrier,

          ownerCall: (locator) => {
            const call = authoredDocumentCall({ repository, subject: unit,
              attemptId: identity.attempt_id, source: locator, document: firstMember });
            if (call === null) throw new TypeError("the authored-document read is not a checkable call");
            return { tool: call.tool, arguments: call.arguments };
          },
          ownerRequestSchema: requestSchema
        }, { env });
      } catch (error) {

        return Object.freeze({
          state: "unavailable",
          code: typeof error?.envelope?.code === "string"
            ? error.envelope.code
            : "authored_contract_source_not_retained"
        });
      }
      const fact = Object.freeze({
        state: "retained",
        repository,
        unit,
        observation_identity: Object.freeze({ ...identity }),
        locator: Object.freeze({ ...retained }),
        members: Object.freeze(present.map(({ member }) => member))
      });

      if (memo.size >= memoCapacity) memo.delete(memo.keys().next().value);
      memo.set(memoKey, fact);
      return fact;
    }
  };
}
