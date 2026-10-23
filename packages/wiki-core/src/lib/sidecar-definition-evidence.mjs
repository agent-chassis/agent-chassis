import { sameGraphSnapshot, unavailableCommittedSnapshot } from './sidecar-committed-preparation.mjs';
import { resolveExplicitNativeIdentity } from './sidecar-native-identity.mjs';
import { assembleNativeSourceFacts } from './sidecar-native-source.mjs';
import { createScipUnavailableState, layerFromStore } from './sidecar-provider-state.mjs';
import { describeNativeSymbolRecovery, RETAINED_ANSWER_NEXT_ACTION } from './sidecar-native-recovery.mjs';
import { requireNativeNonblankString, requireNativePath, assertNativeSymbolPath } from './sidecar-native-input.mjs';
import { sidecarDependencyLimitations } from './sidecar-scip-projects.mjs';
import { readSidecarSymbolSelection } from './sidecar-store.mjs';

export async function readNativeDefinitionEvidence({ prepared, symbol, path, cacheDir }) {
  const input = { symbol: requireNativeNonblankString('symbol', symbol) };
  if (path !== undefined && path !== null) {
    input.path = requireNativePath(path);
    assertNativeSymbolPath(symbol);
  }
  const selection = readSidecarSymbolSelection({ repoRoot: prepared.repoRoot, cacheDir,
    symbol, documentPath: input.path ?? null, positionSymbols: null });
  if (!sameGraphSnapshot(selection.publication, prepared.graph_snapshot)) {
    throw unavailableCommittedSnapshot('repository_snapshot_changed', prepared.status);
  }
  const layer = layerFromStore(selection);
  const scipState = createScipUnavailableState(layer);
  const available = layer.scip_available === true && layer.graph_available !== false;
  const answer = available ? await assembleNativeSourceFacts({ repoRoot: prepared.repoRoot, selection,
    navigation: resolveExplicitNativeIdentity({ input, selection }), includeReferences: false }) : {
      symbol_resolution: { kind: 'explicit_symbol', state: 'unresolved',
        status_reason: layer.status_reason || 'scip_indexer_unavailable', candidates: [] },
      definitions: [], context_regions: [], complete_files: []
    };
  const action = describeNativeSymbolRecovery({ scip_state: scipState, staleness: prepared.status.staleness,
    dependency_limitations: sidecarDependencyLimitations(layer.coverage, input.path) },
  { resolutionState: answer.symbol_resolution.state });
  return { symbol_resolution: answer.symbol_resolution, definitions: answer.definitions,
    context_regions: answer.context_regions, complete_files: answer.complete_files,
    recovery: [action, scipState.scip_available ? RETAINED_ANSWER_NEXT_ACTION : null].filter(Boolean).join(' ') };
}
