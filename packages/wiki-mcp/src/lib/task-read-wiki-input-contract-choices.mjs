import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { INPUT_SCHEMA_EXPOSURE_CODES } from './input-schema-exposure.mjs';

export const inputContractSelectionError = error => error.code === 'requirements_capability_selection_invalid' ||
  error.code === INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_INVALID;

export function inputContractChoices({ source, tool, reference, members, readTool, branches = {} }) {
  source.select({ members });
  const held = {}, unresolved = [];
  for (const [member, requested] of Object.entries(branches)) {

    if (!members.includes(member) || !source.branches[member]) return [];
    try {
      source.select({ members, branches: { [member]: requested } });
      held[member] = requested;
    } catch (error) {
      if (!inputContractSelectionError(error)) throw error;
      unresolved.push(member);
    }
  }
  const selection = scopes => ({ reads: [{ reference, select: { input_contract: { tool, members,
    ...(Object.keys(scopes).length ? { branches: scopes } : {}) } } }] });
  const owners = unresolved.length ? unresolved : members.filter(member => source.branches[member] && !Object.hasOwn(held, member));
  const scopes = unresolved.length
    ? owners.reduce((choices, member) => choices.flatMap(choice => source.branches[member].presets
      .map(requested => ({ ...choice, [member]: requested }))), [held])
    : owners.flatMap(member => source.branches[member].presets.map(requested => ({ ...held, [member]: requested })));
  return [...scopes.map(scope => buildNextCall({ tool: readTool, arguments: selection(scope),
    purpose: `Choose ${owners.filter(member => Object.hasOwn(scope, member)).map(member => `${member}: ${scope[member].join(' + ')}`).join('; ')}; retain all requested members and other selected branches` })),
  buildNextCall({ tool: readTool, arguments: selection(held),
    purpose: `Choose complete ${owners.length ? owners.join(' + ') : 'whole-member'} schema; retain all requested members and other selected branches; use for typed relationships or unsettled future needs` })];
}
