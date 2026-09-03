export function assertSoundNegativeObservationCapture(
  value: Record<string, unknown>
): Readonly<Record<string, unknown>>;

export function assertCallerInputAuthorityConfinementCapture(
  value: Record<string, unknown>
): Readonly<Record<string, unknown>>;

export function deriveDeterministicLexicographicConformance(input: {
  comparatorEvidenceBytes: Buffer;
  inputSnapshotBytes: Buffer;
  orderingPolicyBytes: Buffer;
  resultSnapshotBytes: Buffer;
}): Buffer;

export function assertAuthenticationProvenanceOccurrenceCapture(
  value: Record<string, unknown>
): Readonly<Record<string, unknown>>;
export function deriveAuthenticationProvenanceOccurrenceCapture(input: {
  evidenceContentBytes: Buffer;
  targetResolutionWitnessBytes: Buffer;
  sourceAuthenticationWitnessBytes: Buffer;
  sourceOfRecordAssignmentWitnessBytes: Buffer;
  attemptBindingWitnessBytes: Buffer;
  authenticationWitnessBytes: Buffer;
}): Buffer;

export function deriveDeclaredBoundaryRecordConsistency(input: {
  policyBytes: Buffer;
  observationBytes: Buffer;
  subjectsBytes: Buffer;
}): Buffer;

export function deriveDeclaredLimitGuidancePropagation(input: {
  policyBytes: Buffer;
  guidanceBytes: Buffer;
}): Buffer;
