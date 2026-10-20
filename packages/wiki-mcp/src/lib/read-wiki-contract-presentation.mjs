

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
