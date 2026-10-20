

export function proofRefreshRecovery(unit) {
  const root = unit.split('#')[0];
  return {
    read: { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: root, for_changes: ['refresh_proofs'] }] } },
    then: {
      tool: 'save_record', executable: false,
      known_arguments: { unit: root, changes: { refresh_proofs: true } },
      missing_caller_input: ['revision'],
      information: 'Read the root WK first. Copy known_arguments and add contexts[unit].revision from that bulk answer; ' +
        'then submit the root-only refresh as the sole change. This form is not executable until revision is supplied.'
    }
  };
}
