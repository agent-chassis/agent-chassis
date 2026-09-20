

function isGraphIndexUnbuildableError(error) {
  return error instanceof Error &&
    error.name === "SidecarGraphIndexUnbuildableError" &&
    error.envelope?.kind === "sidecar_graph_index_unbuildable";
}

async function captureGraphPreparation({ dir, unitAddress, generateGraphImpactEvidence }) {
  let generated;
  try {
    generated = await generateGraphImpactEvidence({ dir, unitAddress });
  } catch (error) {

    if (!isGraphIndexUnbuildableError(error)) throw error;
    return {
      graph_preparation_failure: {
        code: error.code ?? null,
        envelope: { status_reason: error.envelope?.status_reason ?? null }
      }
    };
  }
  const envelope = generated?.graph_available === true
    ? generated.graph_impact_envelope ?? null
    : null;
  if (envelope) return { graph_impact: envelope };

  if (generated?.outcome === "no_graph_bearing_paths") {
    return { graph_impact: null, suppress_live_graph_resolution: true };
  }
  return {
    graph_preparation_failure: { code: generated?.diagnostics?.[0]?.code ?? generated?.outcome ?? null }
  };
}

export async function prepareCommittedHeadGraphAdmission({
  readiness,
  dir,
  unitAddress,
  readinessDispatchRole,
  graphDerivationRequiredForDispatch,
  generateGraphImpactEvidence,
  validateDispatch
}) {
  const graphRecovery = readiness.recovery?.graph_impact;

  const prepare = graphDerivationRequiredForDispatch(graphRecovery) ||
    graphRecovery === "nonrecoverable_missing_paths";
  const graphPreparation = prepare
    ? await captureGraphPreparation({ dir, unitAddress, generateGraphImpactEvidence })
    : { graph_impact: null };
  const revalidated = await validateDispatch({
    dir, unitAddress, dispatch_role: readinessDispatchRole, mode: "strict", ...graphPreparation
  });
  return { readiness: revalidated, graphPreparation };
}
