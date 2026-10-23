import { buildGuidanceCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { guidanceCapability } from './dispatch-guidance-contract.mjs';
import { registrarGuidanceAuthority } from './dispatch-tool-helpers.mjs';

export function candidateInspectionReadCall(args, { information, requestSchemaAuthority = null }) {
  const tool = 'workspace_inspect_candidate';
  if (!guidanceCapability({ tool, requestSchemaAuthority }).available) return null;
  const authority = registrarGuidanceAuthority(requestSchemaAuthority);
  return buildGuidanceCall({ tool, arguments: args, information }, {
    requestSchema: authority.lookup(tool),
    registeredTools: authority.registeredTools
  });
}
