import { buildNextCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';

export function inputContractChoices({ source, tool, reference, members, readTool }) {
  const selection = (branches, selected = members) => ({ reads: [{ reference, select: { input_contract: { tool, members: selected,
    ...(branches ? { branches } : {}) } } }] });
  const whole = buildNextCall({ tool: readTool, arguments: selection(null), purpose: 'complete whole-member schema; use for typed relationships or unsettled future needs' });
  const owners = members.filter(member => source.branches[member]);
  if (!owners.length) return [whole];
  return [...owners.flatMap(member => source.branches[member].presets.map(requested => buildNextCall({ tool: readTool,
    arguments: selection({ [member]: requested }, [member]), purpose: `${member}: ${requested.join(' + ')}` }))), whole];
}
