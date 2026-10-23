export const PAID_CAPABILITY_CONTRACT = 'agent-chassis-paid.v1';
export const PAID_PACKAGE_NAME = '@agent-chassis/cce';

export const PAID_CAPABILITY_MEMBERS = Object.freeze({
  codeIntelligence: Object.freeze(['getSidecarQueryImpact', 'getSidecarContextForPath',
    'getSidecarSymbolDefinition', 'getSidecarSymbolReferences', 'getSidecarSymbolCallers',
    'getSidecarSymbolCallees', 'normalizeSidecarCodeQuestionInput', 'createMcpOperations']),
  requirementAuthoring: Object.freeze(['prepareBatch', 'compileRequirements', 'prepareGrammarException',
    'prepareContinuationRequirement', 'previewRequiredProperties', 'prepareRequirementPatchOperations',
    'prepareRequirementVerificationBundles'])
});

export class PaidProviderError extends Error {
  static fromEnvelope(envelope) {
    const cause = Object.assign(new Error(envelope.cause.message), { name: envelope.cause.name,
      ...(envelope.cause.code === undefined ? {} : { code: envelope.cause.code }) });
    const error = new PaidProviderError(envelope.code, cause);
    error.envelope = envelope;
    error.detail = envelope;
    return error;
  }
  constructor(code, cause, { identity = null, group, member, subject, effects } = {}) {
    super(`${code}: ${cause.message}`, { cause });
    this.name = 'PaidProviderError';
    this.code = code;
    this.envelope = {
      accepted: false, code, limb: 'mechanical_failure',
      provider: { expected_package: PAID_PACKAGE_NAME, expected_interface: PAID_CAPABILITY_CONTRACT,
        ...(identity === null ? {} : { identity }), ...(group ? { group, member } : {}) },
      cause: { name: cause.name, message: cause.message, ...(cause.code ? { code: cause.code } : {}) },
      ...(subject === undefined ? {} : { subject }),
      ...(group ? { uncertainty: group === 'requirementAuthoring'
        ? 'Preparation failed before canonical publication; no publication was performed by this operation.'
        : 'Index and refresh effects are unknown; no rollback or safe retry is established.' } : {}),
      effects: effects ?? { server_registered: false, readiness_published: false }, next_calls: [],
      recovery: { state: 'cause_correction_required', responsible_actor: 'installer',
        condition: group
          ? `The package maintainer must diagnose ${group}.${member} against ${identity?.name}@${identity?.version} and the reported cause. This task has no automatic safe repair. Install a corrected compatible ${PAID_PACKAGE_NAME} in this serving installation and restart.`
          : `Install a compatible ${PAID_PACKAGE_NAME} implementing ${PAID_CAPABILITY_CONTRACT} in this serving installation, correct the reported cause, and restart.` }
    };
    this.detail = this.envelope;
  }
}

export function validatePaidCapabilities(provider, capabilities, identity) {
  if (provider.PAID_CAPABILITY_CONTRACT !== PAID_CAPABILITY_CONTRACT) {
    throw new PaidProviderError('paid_provider_contract_unsupported',
      new TypeError(`Expected interface ${PAID_CAPABILITY_CONTRACT}; received ${String(provider.PAID_CAPABILITY_CONTRACT)}`), { identity });
  }
  const invalid = detail => { throw new PaidProviderError('paid_provider_contract_invalid', new TypeError(detail), { identity }); };
  if (!capabilities || !Object.isFrozen(capabilities)) invalid('Capability object must be frozen');
  for (const [group, members] of Object.entries(PAID_CAPABILITY_MEMBERS)) {
    if (!capabilities[group] || !Object.isFrozen(capabilities[group])) invalid(`${group} must be frozen`);
    for (const member of members) if (typeof capabilities[group][member] !== 'function') invalid(`${group}.${member} must be callable`);
  }
  const vocabulary = capabilities.codeIntelligence.vocabulary;
  for (const key of ['fields', 'relationships', 'alternatives']) {
    const values = vocabulary?.[key];
    if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== 'string' || !value.trim()) ||
        new Set(values).size !== values.length) invalid(`codeIntelligence.vocabulary.${key} must contain distinct nonblank strings`);
  }
  return capabilities;
}
