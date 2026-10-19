

export function proofRefreshRecovery(unit) {
  const root = unit.split('#')[0];
  return {
    read: { tool: 'workspace_read_wiki', arguments: { subject: root } },
    then: {
      tool: 'save_record', executable: false,
      known_arguments: { unit: root, changes: { refresh_proofs: true } },
      missing_caller_input: ['revision'],
      information: 'Read the root WK first. Copy known_arguments and add the revision that read returns; ' +
        'then submit the root-only refresh as the sole change. This form is not executable until revision is supplied.'
    }
  };
}
