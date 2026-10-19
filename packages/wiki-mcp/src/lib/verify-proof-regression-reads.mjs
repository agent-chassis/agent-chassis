import { resolveLauncherRunState } from './launcher-run-credential.mjs';
import { managedTestAuthorityIdentity } from './managed-test-source-context.mjs';
import { projectRunTestNativeResult } from './run-test-carrier.mjs';

function unavailable(reason, cause = undefined) {
  return { state: 'unavailable', reason,
    ...(cause === undefined ? {} : { cause }),
    stopping_condition: 'The recorded regression outcome stands. No native-detail read is available to this receiving session; do not execute again to recover it.' };
}

export async function projectVerifyProofRegressionReads(evidence, {
  workspace, sessionEnv, responseEnv, requestContracts
}) {
  if (evidence.regression_results === undefined) return evidence;
  const results = await Promise.all(evidence.regression_results.results.map(async row => {
    if (row.native_result === undefined) return row;
    const { native_read: _executorCall, native_diagnosis: _priorPresentation, ...facts } = row;
    let call;
    try {
      const state = resolveLauncherRunState(sessionEnv);
      call = projectRunTestNativeResult({ result: row.native_result, repository: workspace.repo,
        authorityIdentity: managedTestAuthorityIdentity(state), views: [], env: responseEnv }).native_read;
    } catch (error) {
      if (error?.envelope === undefined) throw error;
      const reason = error.envelope.observed_facts?.['selected_response.invalid_reason'] ?? error.envelope.reason;
      return { ...facts, native_diagnosis: unavailable(
        reason === 'source_binding_mismatch' || reason === 'authority_identity_missing'
          ? 'native_result_not_readable_by_receiving_session' : 'native_result_unavailable',
        { code: error.envelope.code, ...(reason === undefined ? {} : { reason }) }) };
    }
    const contract = requestContracts?.contractFor(call.tool);
    if (contract === undefined || contract === null || !await contract.acceptsArguments(call.arguments)) {
      return { ...facts, native_diagnosis: unavailable('native_reader_not_served_for_this_call') };
    }
    return { ...facts, native_read: call };
  }));
  return { ...evidence, regression_results: { ...evidence.regression_results, results } };
}
