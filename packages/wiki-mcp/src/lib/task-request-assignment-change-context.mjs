

import path from 'node:path';
import { projectFailureDiagnosis } from '@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs';
import { MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX, MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES,
  MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR, readPrivateImmutableArtifact }
  from '../../../agent-launch-cli/src/lib/managed-assignment-read-artifact.mjs';
import { readManagedAssignmentPresentation } from './managed-assignment-read.mjs';

function mismatch(message) {
  throw Object.assign(new Error(message), { code: 'assignment_change_frozen_assignment_mismatch' });
}

export function captureAssignmentChangeContext({ env, session, binding, dispatchTuple }) {
  const pins = session.sessionContract.minting_provenance.trusted_source_bindings
    .filter(pin => pin.kind === 'worker_assignment');
  if (pins.length !== 1 || pins[0].id !== session.assignedUnit ||
      !/^sha256:[a-f0-9]{64}$/u.test(pins[0].digest)) {
    mismatch('This authenticated worker session has no single assignment pin for its current unit.');
  }
  const digest = pins[0].digest;
  const artifactPath = env[MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR];
  if (typeof artifactPath !== 'string' || !path.isAbsolute(artifactPath) ||
      path.basename(artifactPath) !== `${MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX}${digest.slice(7)}.json`) {
    mismatch('The configured assignment artifact location does not name the authenticated assignment pin.');
  }
  let frozen;
  try {
    frozen = readPrivateImmutableArtifact({ artifactPath,
      prefix: MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX,
      maxBytes: MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES });
  } catch (error) {

    if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    return { digest, assignment: { state: 'unavailable',
      cause: { operation: 'read_frozen_assignment', ...projectFailureDiagnosis(error) } } };
  }
  if (frozen === null) throw Object.assign(new Error(
    'The pinned assignment failed its immutable file identity, size or digest checks.'),
  { code: 'assignment_change_frozen_assignment_invalid' });
  const assignment = readManagedAssignmentPresentation({ env });
  if (assignment.presentation.identity.run_id !== dispatchTuple.run_id ||
      assignment.presentation.identity.canonical_source_digest !== binding.source_digest ||
      frozen.digest !== digest || assignment.digest !== digest) {
    mismatch('Frozen assignment run/source identity or bytes disagree with the authenticated current binding.');
  }
  return { digest, assignment: { digest, utf8: frozen.bytes.toString('utf8'), presentation: assignment.presentation } };
}
