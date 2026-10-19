
import { mapValueReferences, valueReferences } from '@agent-chassis/controlled-contract/controlled-values-v1';
export function projectRowValueReferences(row, project) {
  const out = structuredClone(row);
  if (out.behavior?.objects) out.behavior.objects = out.behavior.objects.map(operand =>
    operand.value || operand.observation || operand.binding ? mapValueReferences(operand, project) : operand);
  if (out.membership) out.membership = out.membership.map(clause => clause.domain
    ? { ...clause, domain: mapValueReferences(clause.domain, project) } : clause);
  if (out.for_each) out.for_each = out.for_each.map(declaration => ({ ...declaration, domain: mapValueReferences(declaration.domain, project) }));
  return out;
}
export const typedRowReferences = row => valueReferences([
  ...(row.behavior?.objects ?? []).filter(operand => operand.value || operand.observation || operand.binding),
  ...(row.membership ?? []).flatMap(clause => clause.domain ? [clause.domain] : []),
  ...(row.for_each ?? []).map(declaration => declaration.domain)
]);
