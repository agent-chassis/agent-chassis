

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { recommendToolRouteFromVocabulary } from
  "../../packages/wiki-core/src/operations/tool-router.mjs";
import {
  loadToolDiscoveryDescriptor,
  resolveRoleToolGrantsFromPolicy
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import { createRegisteredToolRequestContractStore } from
  "../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs";

export const TOOL_ROUTING_VOCABULARY_URL = new URL(
  "../../packages/wiki-core/data/tool-routing-intents.v1.json", import.meta.url);
const SESSION_ROLE_TOOL_ACCESS_URL = new URL(
  "../../packages/wiki-core/data/tool-discovery/session-role-tool-access.json", import.meta.url);

export async function createToolRouterHarness() {
  const vocabulary = JSON.parse(await readFile(TOOL_ROUTING_VOCABULARY_URL, "utf8"));
  const descriptor = await loadToolDiscoveryDescriptor();
  const rolePolicy = JSON.parse(await readFile(SESSION_ROLE_TOOL_ACCESS_URL, "utf8"));
  const roleGrants = resolveRoleToolGrantsFromPolicy(rolePolicy);

  const store = createRegisteredToolRequestContractStore();
  const permissive = z.object({}).passthrough();
  for (const { tool_name: name, kind } of descriptor.tools) {
    if (kind === "mcp_tool") {
      store.retain(name, { inputSchema: permissive, publishedInputSchema: permissive });
    }
  }
  const permissiveRequestContracts = store.lookup;

  function descriptorForRole(role) {
    const allowed = roleGrants.get(role) ?? new Set();
    return {
      ...descriptor,
      tools: descriptor.tools.filter(({ tool_name: toolName }) => allowed.has(toolName))
    };
  }

  function recommend(input, context = {}) {
    return recommendToolRouteFromVocabulary(input, context.vocabulary ?? vocabulary, {
      descriptor: context.descriptor ?? descriptor,
      completeDescriptor: context.completeDescriptor ?? descriptor,
      requestContracts: Object.hasOwn(context, "requestContracts")
        ? context.requestContracts
        : permissiveRequestContracts
    });
  }

  function route(input, { role = "orchestrator" } = {}) {
    return recommend(typeof input === "string" ? { task_description: input } : input,
      { descriptor: descriptorForRole(role) });
  }

  return {
    vocabulary,
    descriptor,
    rolePolicy,
    roleGrants,
    permissiveRequestContracts,
    descriptorForRole,
    recommend,
    route
  };
}
