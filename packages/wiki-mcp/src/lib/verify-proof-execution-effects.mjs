

const FAILED_EXECUTION_EFFECTS = new WeakMap();

function failureObject(thrown) {
  return thrown !== null && (typeof thrown === 'object' || typeof thrown === 'function')
    ? thrown : Object.assign(new Error('Proof execution threw a non-Error value', { cause: thrown }), {
      code: 'verify_proof.execution_threw_non_error.v1'
    });
}

export function verifyProofFailureEffects(error) {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? FAILED_EXECUTION_EFFECTS.get(error) : undefined;
}

export async function withVerifyProofPrerequisiteEffects(state, execute) {
  try {
    return await execute();
  } catch (thrown) {
    const error = failureObject(thrown);
    if (!FAILED_EXECUTION_EFFECTS.has(error)) FAILED_EXECUTION_EFFECTS.set(error, {
      status: state.entered ? 'unknown' : 'not_started'
    });
    throw error;
  }
}

export async function withVerifyProofExecutionEffects(state, execute) {
  try {
    return await execute();
  } catch (thrown) {
    const error = failureObject(thrown);
    const proofs = state.resolution.proofs.map(proof => {
      const key = proof.execution_key;
      const receipts = state.evidenceByExecution.get(key);
      const local = state.localUnavailable.get(key);
      const execution = receipts !== undefined ? 'completed'
        : local !== undefined ? local.executionStatus
          : state.interrupted.has(key) ? 'interrupted'
            : state.startedExecution.has(key) ? 'unknown' : 'not_started';
      return {
        test_proof_id: proof.test_proof_id,
        obligation_ids: proof.relationships.map(row => row.obligation_id),
        execution_status: execution,
        ...(receipts?.[0]?.execution_result?.status === undefined ? {} : {
          candidate_status: receipts[0].execution_result.status
        }),
        ...(receipts !== undefined || local?.selectedObservation === undefined ? {} : {
          candidate_status: local.selectedObservation.status
        })
      };
    });
    let regressionEffects = verifyProofFailureEffects(error)?.regressions;
    if (regressionEffects === undefined && Array.isArray(state.resolution.execution_source_binding?.regression_tests)) {
      regressionEffects = state.resolution.execution_source_binding.regression_tests
        .map(file => ({ file, execution_status: 'not_started' }));
    }
    FAILED_EXECUTION_EFFECTS.set(error, Object.freeze({
      status: proofs.every(proof => proof.execution_status === 'not_started') &&
        (regressionEffects === undefined || regressionEffects.every(row => row.execution_status === 'not_started'))
        ? 'not_started' : 'partial',
      proofs,
      ...(regressionEffects === undefined ? {} : { regressions: regressionEffects }),
      proof_credit: 'not_established',
      meaning: 'The shared failure stopped verification. Confirmed execution effects remain; unknown execution is not evidence that nothing ran. No automatic retry occurred.'
    }));
    throw error;
  }
}

export async function withVerifyProofRegressionEffects({ declared, results, startedFiles }, execute) {
  try {
    return await execute();
  } catch (thrown) {
    const error = failureObject(thrown);
    const settled = new Map(results.map(row => [row.file, row]));
    FAILED_EXECUTION_EFFECTS.set(error, {
      status: startedFiles.size === 0 ? 'not_started' : 'partial',
      regressions: declared.files.map(file => {
        const row = settled.get(file);
        return { file,
          ...(row === undefined ? { execution_status: startedFiles.has(file) ? 'unknown' : 'not_started' }
            : { status: row.status, reason_code: row.reason_code,
              execution_status: row.execution === undefined || row.execution.executed === false ? 'not_started'
                : row.execution.executed !== true ? 'unknown'
                  : row.execution.timed_out || row.execution.cancelled ? 'interrupted' : 'completed',
              ...(row.execution === undefined ? {} : { execution: {
                executed: row.execution.executed, exit_code: row.execution.exit_code,
                timed_out: row.execution.timed_out, cancelled: row.execution.cancelled
              } }) })
        };
      }),
      proof_credit: 'not_established'
    });
    throw error;
  }
}
