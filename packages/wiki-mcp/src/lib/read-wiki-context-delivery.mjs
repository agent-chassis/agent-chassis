

import { activeMcpInlineByteLimit, measureMcpInlineResultBytes } from './mcp-response.mjs';
import { readSelectedResponseProjection } from './selected-response-snapshot.mjs';

export function createReadWikiContextDelivery({ env, jsonContent, bindingFor }) {
  return async (value, workspace, resource) => {
    if (measureMcpInlineResultBytes(value) <= activeMcpInlineByteLimit(env)) return jsonContent(value);
    return readSelectedResponseProjection(value.reference, { env,
      expected: await bindingFor(workspace, resource.unit), project: () => value });
  };
}
