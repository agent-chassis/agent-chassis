

import { buildGuidanceCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { createToolInputValidationError } from './register-tool.mjs';
import { projectZodRequestContract } from './zod-request-contract-projection.mjs';
import { FIND_PROOFS_TASK } from '@agent-chassis/controlled-contract/proof-discovery-task';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathName = path => '$' + path.map(member => `.${member}`).join('');

export function createFindProofsInputDiagnosis({ contract, requestSchema }) {
  const { inputSchema, advertisedInputSchema, allowedFieldSets, retainedSelectionSchema } = contract;
  const formFor = field => inputSchema.options.find(option => Object.hasOwn(option.shape, field));
  const fresh = formFor('proof_name'), search = formFor('query');
  const partSchema = fresh.shape.part.unwrap();
  const retainedPartSchema = retainedSelectionSchema.shape.selection.unwrap().shape.part.unwrap();

  return args => {
    const retained = object(args) && (Object.hasOwn(args, 'result') || Object.hasOwn(args, 'selection'));
    const named = object(args) && Object.hasOwn(args, 'proof_name');
    const queried = object(args) && Object.hasOwn(args, 'query');

    const form = retained ? retainedSelectionSchema : named && !queried ? fresh : queried && !named ? search
      : object(args) && Object.hasOwn(args, 'part') && !queried ? fresh : null;
    const parsed = (form ?? advertisedInputSchema).safeParse(args);
    const missingResult = retained && !Object.hasOwn(args, 'result');
    const issues = parsed.success ? [] : parsed.error.issues;
    if (form === null && object(args)) issues.push({ code: 'custom', path: [],
      message: named && queried ? 'Choose query or proof_name; they belong to different request forms.'
        : Object.hasOwn(args, 'target_family') ? 'target_family requires a caller-chosen query or proof_name.'
          : 'Choose catalogue browsing, a query, a fresh proof_name read, or a retained result read.' });
    const details = { allowed_field_sets: allowedFieldSets,
      ...(missingResult ? { missing_input: 'result', correction: 'A selection reads within one original result: pass the result a ' +
        `${FIND_PROOFS_TASK} call returned, unchanged, beside the selection. No result is invented.` } : {}) };
    const conflicting = retained ? ['query', 'proof_name', 'part', 'target_family'].filter(field => Object.hasOwn(args, field)) : [];
    if (conflicting.length) Object.assign(details, { conflicting_fields: conflicting,
      correction: 'Choose a retained result with selection or an explicitly fresh query/proof_name request. ' +
        'No field is removed and the retained read is never converted to a current-catalogue read.' });
    const nextCalls = [];
    const heldPart = retained ? args.selection?.part : args?.part;
    const partPath = retained ? ['selection', 'part'] : ['part'];
    if (form === fresh || form === retainedSelectionSchema) {
      const selectedPartSchema = retained ? retainedPartSchema : partSchema;
      const wrapped = { kind: heldPart };
      if (typeof heldPart === 'string' && selectedPartSchema.safeParse(wrapped).success) {
        const corrected = retained ? { ...args, selection: { ...args.selection, part: wrapped } } : { ...args, part: wrapped };
        if (inputSchema.safeParse(corrected).success) nextCalls.push(buildGuidanceCall({
          tool: FIND_PROOFS_TASK, arguments: corrected, recommended: true,
          information: 'Uses the requested part as a kind object; preserves every other argument, including any retained result. ' +
            'This is a separate read; the refused request read nothing.'
        }, { requestSchema, registeredTools: [FIND_PROOFS_TASK] }));
      }

      if (!nextCalls.length && issues.some(issue => partPath.every((member, index) => issue.path[index] === member))) {
        const kind = typeof heldPart === 'string' ? heldPart : heldPart?.kind;
        const variant = selectedPartSchema.options.find(option => option.shape.kind.value === kind);
        details.part_shape = { field: pathName(partPath), schema: projectZodRequestContract(variant ?? selectedPartSchema).contract };
      }
    }

    if (missingResult && issues.length === 1 && args.selection?.proof_name !== undefined) {
      const current = { proof_name: args.selection.proof_name,
        ...(args.selection.part === undefined ? {} : { part: args.selection.part }) };
      if (inputSchema.safeParse(current).success) nextCalls.push(buildGuidanceCall({
        tool: FIND_PROOFS_TASK, arguments: current,
        information: 'Reads the CURRENT catalogue entry for this proof_name instead. It is a different ' +
          'request: not the retained original the refused selection needs, and no substitute for it.'
      }, { requestSchema, registeredTools: [FIND_PROOFS_TASK] }));
    }
    return createToolInputValidationError({ tool: FIND_PROOFS_TASK,
      validationError: { issues, message: missingResult ? `selection requires a result returned by ${FIND_PROOFS_TASK}.`
        : issues.map(issue => `${pathName(issue.path)}: ${issue.message}`).join('; ') }, details, nextCalls });
  };
}
