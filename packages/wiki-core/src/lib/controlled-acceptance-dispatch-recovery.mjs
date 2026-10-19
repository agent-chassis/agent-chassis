

export function projectControlledAcceptanceDispatchFailure(state, requestedUnit) {
  const admission = state?.semantic?.admission;
  if (admission?.admits !== false) return null;
  const recovery = typeof state.recovery?.tool === 'string' ? state.recovery
    : admission.supported_next_call;
  const correctionUnit = recovery?.arguments?.subject ?? recovery?.arguments?.unit ??
    state.semantic.selected_unit.address;

  const ownerCall = ['workspace_read_wiki', 'workspace_assess_contract'].includes(recovery?.tool)
    ? { tool: recovery.tool, arguments: structuredClone(recovery.arguments ?? {}) }
    : { tool: 'workspace_assess_contract', arguments: { unit: correctionUnit } };
  return Object.freeze({
    requested_unit: requestedUnit,
    correction_unit: correctionUnit,
    deciding_cause: admission.blocked_reason_code,
    deciding_causes: admission.deciding_causes?.map(cause => {
      if (cause.correction?.read_tool === undefined && cause.correction?.write_tool === undefined) return cause;
      const { read_tool, write_tool, expected_content_digest_from, arguments: addressing, ...facts } = cause.correction;
      const target = addressing?.unit ?? cause.unit ?? correctionUnit;
      return { ...cause, correction: { ...facts, unit: target,
        ...(addressing?.focus ? { focus: addressing.focus } : {}),
        next_calls: [{ tool: 'workspace_read_wiki', arguments: { subject: target } },
          { tool: 'workspace_assess_contract', arguments: { unit: target,
            ...(addressing?.focus ? { focus: addressing.focus } : {}) } }],
        instruction: 'Inspect this unit and its assessment correction. Acquire its current revision and save_record input contract before authoring obligations; assessment supplies no replacement meaning.' } };
    }),
    explanation: admission.recovery_explanation ?? state.recovery?.explanation ?? null,
    responsible_owner: admission.responsible_owner,
    owner_call: ownerCall
  });
}

export function controlledAcceptanceDispatchGuidance(failure) {
  if (failure?.owner_call == null) return { state: 'no_supported_route', route: null };
  return { state: 'guidance', route: failure.owner_call.tool, args: failure.owner_call.arguments,
    information: "Inspect the assessment owner's selected correction subject and authoring guidance; reading or assessing changes no readiness.",
    responsible_actor: 'coordinator',
    prerequisite: failure.explanation ?? failure.deciding_cause };
}
