import { loadPaidCapabilities } from '@agent-chassis/wiki-core/src/lib/paid-capability-loader.mjs';
import { jsonContent, measureMcpInlineResultBytes, selectedFullContent } from './mcp-response.mjs';
import { retainSelectedResponseSource, readSelectedResponseSource, selectedResponseDeliveryBound,
  selectedResponseCorrectableError, selectedResponseQueryInvalidError } from './selected-response-snapshot.mjs';
import { resolveWorkspaceRepo } from './workspace-repo-resolution.mjs';
import { inputContractMechanicalRefusal } from './tool-discovery-input-guidance-delivery.mjs';
import { describeRetainedObservation } from './selected-response-observation.mjs';

export const codeIndexHostMechanics = Object.freeze({ jsonContent, measureMcpInlineResultBytes,
  selectedFullContent, retainSelectedResponseSource, readSelectedResponseSource,
  selectedResponseDeliveryBound, selectedResponseCorrectableError, selectedResponseQueryInvalidError,
  resolveWorkspaceRepo, inputContractMechanicalRefusal, describeRetainedObservation });

export async function composePaidCapabilities(tier) {
  if (tier === 'free') return null;
  if (tier !== 'paid') throw new TypeError('captured serving tier must be free or paid');
  return loadPaidCapabilities({ resolve: specifier => import.meta.resolve(specifier) });
}
