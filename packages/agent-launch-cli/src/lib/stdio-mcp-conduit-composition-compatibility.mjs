

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
  STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY
} from "./stdio-mcp-conduit-contract.mjs";
import { createStdioMcpConduit } from "./stdio-mcp-conduit.mjs";
import {
  isTrustedWikiMcpHostServerBinding,
  resolveWikiMcpHostServerBinding
} from "./wiki-mcp-host-server.mjs";
import {
  STDIO_MCP_CONDUIT_LIFECYCLE_DESCRIPTOR_SCHEMA_VERSION,
  isAuthenticatedStdioMcpConduitProducerDescriptor
} from "@agent-chassis/wiki-mcp/src/lib/stdio-mcp-conduit-producer-descriptor.mjs";

export const STDIO_MCP_CONDUIT_COMPOSITION_FACT_SCHEMA_VERSION =
  "stdio-mcp-conduit-composition-compatibility.v1";
export const STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE =
  "launcher_active_composition";
export const STDIO_MCP_CONDUIT_COMPOSITION_REFUSAL_CAUSE =
  "stdio_mcp_lifecycle_protocol_incompatible";
export const STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER =
  "operator_recovery_needed";
export const STDIO_MCP_CONDUIT_COMPOSITION_RECOVERY =
  STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY;

export const STDIO_MCP_CONDUIT_COMPOSITION_STATES = Object.freeze([
  "compatible",
  "incompatible",
  "unknown"
]);
export const STDIO_MCP_CONDUIT_COMPOSITION_GATE_OUTCOMES = Object.freeze([
  ...STDIO_MCP_CONDUIT_COMPOSITION_STATES,
  "missing_fact",
  "malformed_fact",
  "stale_fact",
  "backend_generation_mismatch"
]);

const FACT_KEYS = Object.freeze([
  "schema_version",
  "backend_generation_id",
  "producer_protocol_generation",
  "consumer_protocol_generation",
  "compatibility_state",
  "source"
].sort());
const SUPPORTED_PROTOCOL_GENERATIONS = new Set([
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION
]);
const AUTHENTICATED_CONSUMER_DESCRIPTORS = new WeakSet();
const AUTHENTICATED_COMPOSITIONS = new WeakSet();
const AUTHENTICATED_AUTHORITIES = new WeakSet();
const AUTHORITY_RECORDS = new WeakMap();
const FACT_RECORDS = new WeakMap();

function mintConsumerDescriptor(protocolGeneration) {
  const descriptor = Object.freeze({
    schema_version: STDIO_MCP_CONDUIT_LIFECYCLE_DESCRIPTOR_SCHEMA_VERSION,
    protocol_generation: protocolGeneration
  });
  AUTHENTICATED_CONSUMER_DESCRIPTORS.add(descriptor);
  return descriptor;
}

export const STDIO_MCP_CONDUIT_CONSUMER_DESCRIPTOR = mintConsumerDescriptor(
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION
);

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === keys.join("\0");
}

function wellFormedDescriptor(descriptor) {
  return exactKeys(descriptor, ["protocol_generation", "schema_version"]) &&
    Object.isFrozen(descriptor) &&
    descriptor.schema_version === STDIO_MCP_CONDUIT_LIFECYCLE_DESCRIPTOR_SCHEMA_VERSION &&
    typeof descriptor.protocol_generation === "string" &&
    descriptor.protocol_generation.length > 0;
}

function compositionState(composition) {
  if (!AUTHENTICATED_COMPOSITIONS.has(composition) ||
      !isTrustedWikiMcpHostServerBinding(composition.producerBinding) ||
      composition.producerEntrypoint !== composition.producerBinding.entrypoint ||
      composition.producerDescriptor !== composition.producerBinding.producerDescriptor ||
      composition.nodeExecutable !== process.execPath ||
      composition.spawnPrimitive !== spawn ||
      composition.conduitConstructor !== createStdioMcpConduit ||
      !isAuthenticatedStdioMcpConduitProducerDescriptor(composition.producerDescriptor) ||
      !AUTHENTICATED_CONSUMER_DESCRIPTORS.has(composition.consumerDescriptor) ||
      !wellFormedDescriptor(composition.producerDescriptor) ||
      !wellFormedDescriptor(composition.consumerDescriptor)) {
    return "unknown";
  }
  const producer = composition.producerDescriptor.protocol_generation;
  const consumer = composition.consumerDescriptor.protocol_generation;
  return producer === consumer && SUPPORTED_PROTOCOL_GENERATIONS.has(producer)
    ? "compatible"
    : "incompatible";
}

function mintBackendGenerationId() {
  return `managed_stdio_mcp_backend.${randomBytes(16).toString("hex")}`;
}

function wellFormedFact(fact) {
  return exactKeys(fact, FACT_KEYS) && Object.isFrozen(fact) &&
    fact.schema_version === STDIO_MCP_CONDUIT_COMPOSITION_FACT_SCHEMA_VERSION &&
    fact.source === STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE &&
    typeof fact.backend_generation_id === "string" && fact.backend_generation_id.length > 0 &&
    (typeof fact.producer_protocol_generation === "string" ||
      fact.producer_protocol_generation === null) &&
    (typeof fact.consumer_protocol_generation === "string" ||
      fact.consumer_protocol_generation === null) &&
    STDIO_MCP_CONDUIT_COMPOSITION_STATES.includes(fact.compatibility_state);
}

function evaluateFact(authority, fact) {
  const authorityRecord = AUTHORITY_RECORDS.get(authority);
  if (!AUTHENTICATED_AUTHORITIES.has(authority) || authorityRecord === undefined) {
    throw new TypeError("managed stdio MCP composition authority is not launcher-minted");
  }
  if (fact === null || fact === undefined) return "missing_fact";
  if (!wellFormedFact(fact) || !FACT_RECORDS.has(fact)) return "malformed_fact";
  const factRecord = FACT_RECORDS.get(fact);
  if (factRecord.stale === true) return "stale_fact";
  if (factRecord.authority !== authority ||
      fact.backend_generation_id !== authorityRecord.backendGenerationId) {
    return "backend_generation_mismatch";
  }
  if (fact !== authorityRecord.fact) return "stale_fact";
  return fact.compatibility_state;
}

export function buildManagedStdioMcpCompositionRefusal(gateOutcome) {
  return Object.freeze({
    code: STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER,
    cause: STDIO_MCP_CONDUIT_COMPOSITION_REFUSAL_CAUSE,
    recovery: STDIO_MCP_CONDUIT_COMPOSITION_RECOVERY,
    gate_outcome: STDIO_MCP_CONDUIT_COMPOSITION_GATE_OUTCOMES.includes(gateOutcome)
      ? gateOutcome
      : "malformed_fact"
  });
}

export class ManagedStdioMcpCompositionError extends Error {
  constructor(gateOutcome) {
    super("managed stdio MCP composition is not compatible");
    this.name = "ManagedStdioMcpCompositionError";
    this.code = STDIO_MCP_CONDUIT_COMPOSITION_REFUSAL_CAUSE;
    this.detail = buildManagedStdioMcpCompositionRefusal(gateOutcome);
  }
}

function mintAuthority(overrides = {}) {
  const producerBinding = overrides.producerBinding ?? resolveWikiMcpHostServerBinding();
  const composition = Object.freeze({
    producerBinding,
    producerEntrypoint: Object.prototype.hasOwnProperty.call(overrides, "producerEntrypoint")
      ? overrides.producerEntrypoint
      : producerBinding?.entrypoint ?? null,
    nodeExecutable: Object.prototype.hasOwnProperty.call(overrides, "nodeExecutable")
      ? overrides.nodeExecutable
      : process.execPath,
    spawnPrimitive: Object.prototype.hasOwnProperty.call(overrides, "spawnPrimitive")
      ? overrides.spawnPrimitive
      : spawn,
    producerDescriptor: Object.prototype.hasOwnProperty.call(overrides, "producerDescriptor")
      ? overrides.producerDescriptor
      : producerBinding?.producerDescriptor ?? null,
    consumerDescriptor: Object.prototype.hasOwnProperty.call(overrides, "consumerDescriptor")
      ? overrides.consumerDescriptor
      : STDIO_MCP_CONDUIT_CONSUMER_DESCRIPTOR,
    conduitConstructor: Object.prototype.hasOwnProperty.call(overrides, "conduitConstructor")
      ? overrides.conduitConstructor
      : createStdioMcpConduit
  });
  AUTHENTICATED_COMPOSITIONS.add(composition);
  const backendGenerationId = mintBackendGenerationId();
  const fact = Object.freeze({
    schema_version: STDIO_MCP_CONDUIT_COMPOSITION_FACT_SCHEMA_VERSION,
    backend_generation_id: backendGenerationId,
    producer_protocol_generation: wellFormedDescriptor(composition.producerDescriptor)
      ? composition.producerDescriptor.protocol_generation
      : null,
    consumer_protocol_generation: wellFormedDescriptor(composition.consumerDescriptor)
      ? composition.consumerDescriptor.protocol_generation
      : null,
    compatibility_state: compositionState(composition),
    source: STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE
  });
  const factRecord = { authority: null, stale: false };
  let authority;
  const getFact = () => fact;
  const evaluate = (candidate = fact) => evaluateFact(authority, candidate);
  const createConduit = async (input) => {
    const outcome = evaluate(fact);
    if (outcome !== "compatible") throw new ManagedStdioMcpCompositionError(outcome);

    if (compositionState(composition) !== "compatible") {
      throw new ManagedStdioMcpCompositionError("unknown");
    }
    return composition.conduitConstructor(input);
  };
  authority = Object.freeze({ getFact, evaluate, createConduit });
  factRecord.authority = authority;
  AUTHENTICATED_AUTHORITIES.add(authority);
  AUTHORITY_RECORDS.set(authority, { composition, fact, backendGenerationId });
  FACT_RECORDS.set(fact, factRecord);
  return authority;
}

export function createManagedStdioMcpCompositionAuthority() {
  return mintAuthority();
}

export function assertManagedStdioMcpCompositionAuthority(authority) {
  if (!isManagedStdioMcpCompositionAuthority(authority)) {
    throw new TypeError("managed stdio MCP composition authority is not launcher-minted");
  }
  return authority;
}

export function isManagedStdioMcpCompositionAuthority(authority) {
  return authority !== null && typeof authority === "object" &&
    Object.isFrozen(authority) && AUTHENTICATED_AUTHORITIES.has(authority);
}

export function projectManagedStdioMcpCompositionAuthority(authority, fact = undefined) {
  const trusted = assertManagedStdioMcpCompositionAuthority(authority);
  const currentFact = fact === undefined ? trusted.getFact() : fact;
  const gateOutcome = trusted.evaluate(currentFact);
  const available = gateOutcome === "compatible";
  return Object.freeze({
    available,
    gate_outcome: gateOutcome,
    fact: available || wellFormedFact(currentFact) ? currentFact : null,
    blocker: available ? null : buildManagedStdioMcpCompositionRefusal(gateOutcome)
  });
}

export function __createManagedStdioMcpCompositionAuthorityForTest(overrides = {}) {
  return mintAuthority(overrides);
}

export function __mintStdioMcpConduitConsumerDescriptorForTest(protocolGeneration) {
  return mintConsumerDescriptor(protocolGeneration);
}

export function __retireManagedStdioMcpCompositionAuthorityForTest(authority) {
  assertManagedStdioMcpCompositionAuthority(authority);
  FACT_RECORDS.get(AUTHORITY_RECORDS.get(authority).fact).stale = true;
}
