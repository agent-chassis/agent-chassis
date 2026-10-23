

export async function offerReadWikiDefinitionSources(results, { requestContracts, repository }) {
  const contract = requestContracts?.contractFor('query_code_index');
  if (!contract) return;
  for (const result of results) for (const member of result.value?.members ?? [])
    for (const node of [...(member.definitions ?? []), ...(member.dependencies?.nodes ?? [])]) {
      const identity = node.entity?.identity;
      if (!node.source || !['repository_path', 'code_symbol'].includes(identity?.kind) || identity.repository !== repository) continue;
      const args = { path: identity.path };
      if (!await contract.acceptsArguments(args)) continue;
      node.source.next_calls = [{ tool: 'query_code_index', arguments: args, recommended: false,
        purpose: 'inspect_supporting_code',
        information: 'Read this exact path from the published code index; follow its returned source selections for content. Its revision may differ from this definition capture; it does not replace the captured source binding.' }];
    }
}

export function shareReadWikiDefinitions(results, sources) {
  const occurrences = new Map();
  for (const [resultIndex, result] of results.entries()) for (const member of result.value?.members ?? []) {
    for (const nodes of [member.definitions, member.dependencies?.nodes].filter(Array.isArray)) {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (!node.entity || !node.definitions?.length && node.source === undefined) continue;
        const identity = JSON.stringify([sources[resultIndex], node.owner ?? null, node.entity]);
        const held = occurrences.get(identity) ?? [];
        held.push({ nodes, index, node }); occurrences.set(identity, held);
      }
    }
  }
  const shared = [];
  for (const held of occurrences.values()) {
    if (held.length < 2 || !held.every(row => JSON.stringify(row.node) === JSON.stringify(held[0].node))) continue;
    const node = held[0].node;
    shared.push(node);
    for (const row of held) row.nodes[row.index] = { entity: node.entity,
      ...(node.owner === undefined ? {} : { owner: node.owner }) };
  }
  return shared;
}
