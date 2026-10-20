
import { ordinaryRunDiagnostic, ordinaryFailedResultDiagnostic } from '../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs';
import { distillCorrection } from '../../../agent-launch-cli/src/lib/test-execution/ordinary-test-diagnosis.mjs';
import { capturedCause, selectedFailureDiagnostic } from './run-test-carrier.mjs';
export { distillCorrection };

export function taskCapturedCause(result, carrier) {
  const original = capturedCause(result);

  const selected = carrier === undefined ? null : taskFailureDiagnostic(carrier, null);
  if (selected?.semantic !== undefined) return { semantic: selected.semantic, failures: selected.failures };
  if (selected?.identified === true && selected.failures > 0 && (original == null ||
      original.source !== selected.view.replace('candidate_', '') || original.offset < selected.offset)) return {
    phase: result.run?.phase ?? 'run', source: selected.view.replace('candidate_', ''),
    text: selected.text, ...(selected.context === undefined ? {} : { context: selected.context })
  };
  if (original == null || result.run === undefined || result.status === 'selection_unresolved') return original;
  const maxBytes = Math.max(1, ...['stdout', 'stderr', 'blocker_message', 'spawn_error']
    .map(key => typeof result.run[key] === 'string' ? Buffer.byteLength(result.run[key], 'utf8') : 0));
  const full = ordinaryRunDiagnostic(result.run, { maxBytes });
  if (full === null || full.source !== (original.source ?? original.view?.replace('candidate_', ''))) return original;
  const stream = result.run[full.source];
  const next = typeof stream === 'string' ? ordinaryFailedResultDiagnostic(stream, { failure: 2, maxBytes }) : {};
  const text = next.offset > full.offset
    ? Buffer.from(full.text).subarray(0, next.offset - full.offset).toString('utf8') : full.text;
  const distilled = distillCorrection(text);
  return { ...(distilled === text ? original : { ...original, text: distilled }),
    ...(result.run.ran === true && !(selected?.failures > 0) ? { attributed: false } : {}) };
}

export function taskFailureDiagnostic(carrier, failure) {
  const diagnosis = carrier.failure.semantic_diagnosis;

  if (diagnosis != null && (diagnosis.failures?.length > 0 || diagnosis.reason?.startsWith('go_') ||
      ['native_failure_capture_incomplete', 'execution_interrupted'].includes(diagnosis.reason))) {
    const rows = diagnosis.failures ?? [];
    const index = failure ?? 1;
    const { failures: _failures, ...limits } = diagnosis;

    if (diagnosis.state === 'unavailable' && rows.length === 0) return { semantic: limits };
    if (failure !== null && index > rows.length) return { identified: false, failure, failures: rows.length,
      semantic: { ...(diagnosis.state === 'captured' ? {} : limits), identified: false, failures: rows.length } };
    const row = rows[index - 1];
    return { identified: true, ...(row === undefined ? {} : { failure: index }), failures: rows.length,
      semantic: { ...(diagnosis.state === 'captured' ? {} : limits), ...row } };
  }
  const retained = carrier.failure.diagnostic;
  const original = failure === null && !(retained?.failures > 0)
    ? retained : selectedFailureDiagnostic(carrier, failure ?? 1);
  if (diagnosis?.state === 'unavailable' && original?.identified !== true && !(original?.failures > 0)) {
    const { failures: _failures, ...limits } = diagnosis;
    return { semantic: limits };
  }
  if (original?.identified !== true) return original;
  const stream = carrier[original.view];
  if (typeof stream !== 'string') return original;
  const maxBytes = Buffer.byteLength(stream, 'utf8');
  let text;
  if (original.failures > 0) {
    const selected = ordinaryFailedResultDiagnostic(stream, { failure: failure ?? 1, maxBytes });
    const next = ordinaryFailedResultDiagnostic(stream, { failure: (failure ?? 1) + 1, maxBytes });

    text = next.offset > selected.offset ? Buffer.from(selected.text).subarray(0, next.offset - selected.offset).toString('utf8')
      : selected.text;
  } else {
    text = Buffer.from(stream).subarray(original.offset).toString('utf8');
  }
  const distilled = distillCorrection(text);
  return { ...(distilled === text ? original : { ...original, text: distilled }),
    ...(original.failures === 0 ? { attributed: false } : {}) };
}

export function sourceFailureDetail(failure) {
  if (failure.cause.stage !== 'source_authentication' || failure.detail === null) return null;
  const detail = JSON.parse(failure.detail);
  if (detail === null || typeof detail !== 'object') return null;
  const keys = ['source', 'reason', 'commit', 'branch', 'owning_slice', 'unavailable_capability', 'owner'];
  const selected = Object.fromEntries(keys.filter(key => Object.hasOwn(detail, key)).map(key => [key, detail[key]]));
  return Object.keys(selected).length === 0 ? null : selected;
}
