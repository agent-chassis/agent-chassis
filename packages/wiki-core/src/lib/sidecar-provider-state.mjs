const SCIP_STATUS_NOT_CONFIGURED = "scip_not_configured";
const cloneJson = value => structuredClone(value);
const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function layerFromStore(selection) {
  const coverage = selection.publication.provider_coverage ?? {};
  return {
    scip_available: coverage.scip_available === true,
    graph_available: coverage.graph_available === true,
    call_graph_available: coverage.call_graph_available === true,
    status_reason: coverage.status_reason ?? SCIP_STATUS_NOT_CONFIGURED,
    ...(coverage.error_reason ? { error_reason: coverage.error_reason } : {}),
    coverage: cloneJson(coverage),
    provider_descriptors: selection.providers.map(({ descriptor }) => cloneJson(descriptor)),
    graph_edges: selection.symbol_edges.map(({ payload }) => cloneJson(payload))
  };
}

export function providerDescriptorsForLayer(layer) {
  if (Array.isArray(layer?.provider_descriptors)) {
    return layer.provider_descriptors.map(cloneJson);
  }
  if (isPlainObject(layer?.provider_descriptor)) {
    return [cloneJson(layer.provider_descriptor)];
  }
  return [];
}

export function createScipUnavailableState(layer, statusReason = SCIP_STATUS_NOT_CONFIGURED) {
  const scipAvailable = layer?.scip_available === true;
  const callGraphAvailable = layer?.call_graph_available ?? layer?.coverage?.call_graph_available;
  const callGraphStatusReason =
    layer?.call_graph_status_reason ?? layer?.coverage?.call_graph_status_reason;
  const callGraphUnavailableReason =
    layer?.call_graph_unavailable_reason ?? layer?.coverage?.call_graph_unavailable_reason;
  const state = {
    scip_available: scipAvailable,
    graph_available: scipAvailable && layer?.graph_available !== false,
    status_reason: layer?.status_reason || statusReason,
    ...(layer?.error_reason ? { error_reason: layer.error_reason } : {})
  };
  if (typeof callGraphAvailable === "boolean") {
    state.call_graph_available = callGraphAvailable;
  }
  if (typeof callGraphStatusReason === "string" && callGraphStatusReason.length > 0) {
    state.call_graph_status_reason = callGraphStatusReason;
  }
  if (typeof callGraphUnavailableReason === "string" && callGraphUnavailableReason.length > 0) {
    state.call_graph_unavailable_reason = callGraphUnavailableReason;
  }
  return state;
}

