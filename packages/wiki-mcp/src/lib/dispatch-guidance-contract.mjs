

import { buildGuidanceCall } from
  "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { buildPublicMechanicalRefusal } from
  "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { registrarGuidanceAuthority } from "./dispatch-tool-helpers.mjs";

export const GUIDANCE_CAPABILITY_OWNER = "wiki-mcp tool registration and role/tier profile";

export function guidanceCapability({ tool, requestSchemaAuthority }) {
  const authority = registrarGuidanceAuthority(requestSchemaAuthority);
  const missing = [];
  if (authority === null) {
    missing.push("registrar_request_schema_authority");
  } else {
    if (authority.registeredTools === null) missing.push("active_registered_tool_set");
    else if (!authority.registeredTools.has(tool)) missing.push(`registration:${tool}`);
    if (authority.lookup(tool) === undefined) missing.push(`request_schema:${tool}`);
  }
  return Object.freeze({
    available: missing.length === 0,
    missing: Object.freeze(missing),
    owner: GUIDANCE_CAPABILITY_OWNER
  });
}

export function isActivelyRegistered(requestSchemaAuthority, tool) {
  return registrarGuidanceAuthority(requestSchemaAuthority)?.registeredTools?.has(tool) === true;
}

export function buildDispatchGuidanceRefusal({
  code,
  decidingFacts,
  observedFacts,
  guidance,
  recovery,
  route,
  carried = null,
  requestSchemaAuthority
}) {
  const capability = guidanceCapability({ tool: guidance.tool, requestSchemaAuthority });
  if (!capability.available) return { unavailable: capability };
  const authority = registrarGuidanceAuthority(requestSchemaAuthority);
  const call = buildGuidanceCall({
    tool: guidance.tool,
    arguments: guidance.arguments,
    information: guidance.information
  }, {
    requestSchema: authority.lookup(guidance.tool),
    registeredTools: authority.registeredTools
  });
  return {
    refusal: buildPublicMechanicalRefusal({
      code,
      deciding_facts: decidingFacts,
      next_calls: [call],
      recovery: {
        state: "guidance",
        operation: call.tool,
        information: call.information,
        blocker_unchanged: true,
        ...recovery
      },
      route,
      ...(carried === null ? {} : { carried }),
      observed_facts: observedFacts,
      request_schemas: authority.lookup,
      registered_tools: authority.registeredTools
    })
  };
}
