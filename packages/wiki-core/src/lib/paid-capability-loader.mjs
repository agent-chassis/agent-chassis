import { fileURLToPath } from 'node:url';
import { resolvePackageIdentity } from './wiki-package-provenance.mjs';
import { PAID_PACKAGE_NAME, PAID_CAPABILITY_CONTRACT, PAID_CAPABILITY_MEMBERS,
  PaidProviderError, validatePaidCapabilities } from './paid-capability-contract.mjs';

function operationFailure(error, args, { identity, group, member }) {

  if (error?.envelope || typeof error?.code === 'string' &&
      (/^(?:sidecar_|controlled_contract_|record_authoring_)/u.test(error.code) ||
        error.code === 'repository_snapshot_changed' ||
        error instanceof Error && error.constructor !== Error && error.constructor !== TypeError)) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  const input = args[0];
  const subject = input && typeof input === 'object' ? Object.fromEntries(
    ['wkId', 'focus', 'path', 'paths', 'symbol', 'line', 'detail', 'status', 'query_kind', 'validated_paths', 'indexed_commit', 'dir', 'repoRoot'].filter(key => input[key] !== undefined)
      .map(key => [key, input[key]])) : input;
  if (input?.initial?.wkId !== undefined) subject.wkId = input.initial.wkId;
  return new PaidProviderError('paid_provider_operation_failed', cause, { identity, group, member,
    subject, effects: group === 'requirementAuthoring'
      ? { record_publication: 'none', contract_publication: 'none' }
      : { query_completion: 'failed', index: 'unknown', refresh: 'unknown' } });
}

function protectReturnedOperations(result, context) {
  if (typeof result === 'function') return protectOperation(result, { ...context, member: `${context.member}.handler` }, true);
  if (result === null || typeof result !== 'object' || Object.getPrototypeOf(result) !== Object.prototype ||
      !Object.values(result).some(value => typeof value === 'function')) return result;
  return Object.freeze(Object.fromEntries(Object.entries(result).map(([member, value]) => [member,
    typeof value === 'function' ? protectOperation((...args) => result[member](...args),
      { ...context, member: `${context.member}.${member}` }, true) : value])));
}

function protectOperation(operation, context, returnedOperations = false) {
  return (...args) => {

    if (context.member === 'createMcpOperations.createCodeIndexQuestionHandler') {
      const options = args[0];
      args = [{ ...options, errorContent: (error, subject) =>
        options.errorContent(operationFailure(error, [subject], context)) }, ...args.slice(1)];
    }
    try {
      const result = operation(...args);
      const protect = value => returnedOperations || context.member === 'createMcpOperations'
        ? protectReturnedOperations(value, context) : value;
      return result && typeof result.then === 'function'
        ? result.then(protect, error => { throw operationFailure(error, args, context); }) : protect(result);
    } catch (error) { throw operationFailure(error, args, context); }
  };
}

export async function loadPaidCapabilities({ resolve }) {
  let entry;
  try { entry = resolve(PAID_PACKAGE_NAME); }
  catch (cause) {
    throw new PaidProviderError(cause.code === 'ERR_MODULE_NOT_FOUND' &&
      cause.message.includes(`'${PAID_PACKAGE_NAME}'`) ? 'paid_provider_missing' : 'paid_provider_load_failed', cause);
  }
  let identity;
  try {
    identity = resolvePackageIdentity(fileURLToPath(resolve(`${PAID_PACKAGE_NAME}/package.json`)));
    if (identity.name !== PAID_PACKAGE_NAME) throw new TypeError(`Expected package ${PAID_PACKAGE_NAME}; received ${identity.name}`);
  } catch (cause) { throw new PaidProviderError('paid_provider_identity_invalid', cause); }
  let provider;
  try { provider = await import(entry); }
  catch (cause) { throw new PaidProviderError('paid_provider_load_failed', cause, { identity }); }
  if (provider.PAID_CAPABILITY_CONTRACT !== PAID_CAPABILITY_CONTRACT) {
    validatePaidCapabilities(provider, null, identity);
  }
  if (typeof provider.createPaidCapabilities !== 'function') {
    throw new PaidProviderError('paid_provider_contract_invalid', new TypeError('createPaidCapabilities must be callable'), { identity });
  }
  let capabilities;
  try { capabilities = provider.createPaidCapabilities(); }
  catch (cause) { throw new PaidProviderError('paid_provider_load_failed', cause, { identity }); }
  validatePaidCapabilities(provider, capabilities, identity);
  return Object.freeze(Object.fromEntries(Object.entries(PAID_CAPABILITY_MEMBERS).map(([group, members]) => [group,
    Object.freeze({ ...capabilities[group], ...Object.fromEntries(members.map(member => [member,
      protectOperation((...args) => capabilities[group][member](...args), { identity, group, member })])) })])));
}
