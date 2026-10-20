

import { getManifestRecordBirthKinds } from "@agent-chassis/wiki-core/src/lib/contract.mjs";
import { CREATE_RECORD_INITIAL_GROUP, CREATE_RECORD_INITIAL_JOB } from "./create-record-input-exposure.mjs";
import { buildNextCall } from "./mcp-response.mjs";
import { CREATE_RECORD_ROUTE } from "./record-authoring-maintenance-subject.mjs";

export const RECORD_KIND_CONTRACT_TOOL = CREATE_RECORD_ROUTE;
export const READ_WIKI_RECORD_KIND_REASONS = Object.freeze({
  KIND_UNSUPPORTED: "record_kind_unsupported",
  BINDING_UNAVAILABLE: "record_kind_binding_unavailable"
});
const REASONS = READ_WIKI_RECORD_KIND_REASONS;

export const recordBirthKinds = () => getManifestRecordBirthKinds().map((row) => row.kind);

export function createReadWikiRecordKindSource({ requestContracts, invalid, readTool }) {
  const exposure = () => requestContracts?.contractFor(RECORD_KIND_CONTRACT_TOOL)?.inputSchemaExposure ?? null;
  const refusal = (reason, facts) => invalid(reason, { ...facts, next_calls: [], effects: { reads: [], writes: [] },
    uncertainty: "none: nothing was written, allocated or created, and no schema was disclosed" });

  function bound(kind) {
    const kinds = recordBirthKinds();
    if (!kinds.includes(kind)) {
      throw refusal(REASONS.KIND_UNSUPPORTED, { record_kind: kind, supported_kinds: kinds,
        cause: `${String(kind)} is not a record kind ${RECORD_KIND_CONTRACT_TOOL} creates`,
        choice: "name one of supported_kinds; no kind is chosen for the caller" });
    }
    const live = exposure();
    if (live === null || !live.sourceNames.includes(kind)) {
      throw refusal(REASONS.BINDING_UNAVAILABLE, { record_kind: kind, tool: RECORD_KIND_CONTRACT_TOOL,
        cause: `this session has no registered ${RECORD_KIND_CONTRACT_TOOL} input contract for ${kind}`,
        recovery: { state: "no_supported_route", caller_correctable: false,
          missing_capability: `registered_${RECORD_KIND_CONTRACT_TOOL}_input_schema_exposure`,
          owner: `${RECORD_KIND_CONTRACT_TOOL} registration of this session`,
          reason: `${RECORD_KIND_CONTRACT_TOOL} is not registered for this session, or its registration bound no input schema exposure for this kind; no read supplies one` } });
    }
    return live.source(kind);
  }

  function resource(kind) {
    const source = bound(kind);
    return { source_kind: "record_kind", subject: { record_kind: kind }, unit: null, source,

      revision: source.digest,
      facts: { record_kind: kind, tool: RECORD_KIND_CONTRACT_TOOL, addresses: "a record kind, not a saved record",
        initial_members: source.members, owner_schema_digest: source.digest } };
  }

  async function creationContractCall(kind, reference) {
    const source = bound(kind);
    const members = source.groups.find((group) => group.name === CREATE_RECORD_INITIAL_GROUP).members;
    const argumentsValue = { reads: [{ reference, select: { input_contract: { tool: RECORD_KIND_CONTRACT_TOOL, members,
      ...(Object.keys(source.branches).length ? { view: "choices" } : {}) } } }] };
    if (await requestContracts?.contractFor(readTool)?.acceptsArguments(argumentsValue) !== true) return null;
    return buildNextCall({ tool: readTool, arguments: argumentsValue, ...CREATE_RECORD_INITIAL_JOB });
  }

  return Object.freeze({ resource, bound, creationContractCall });
}
