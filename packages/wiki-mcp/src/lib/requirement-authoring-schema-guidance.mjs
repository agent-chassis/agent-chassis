
import { workItemRequirementBatchSchema } from '@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs';
import { admit } from '@agent-chassis/wiki-core/src/lib/controlled-requirement-authoring-schema.mjs';
import { REQUIREMENT_CAPABILITIES, requirementCapabilities } from '@agent-chassis/wiki-core/src/lib/requirement-schema-exposure.mjs';
import { bindInputSchemaExposure } from './input-schema-exposure.mjs';
import { inputContractSourceDigest } from './tool-discovery-input-guidance-delivery.mjs';

export const REQUIREMENT_SCHEMA_TOPIC = 'requirement_schema';
const jobs = [['relationships'], ['relationships', 'scalar_values'], ['relationships', 'typed_values']];
const completeJob = requested => requirementCapabilities(requested).excluded.length === 0;
export const REQUIREMENT_SCHEMA_METADATA = Object.freeze({ capabilities: REQUIREMENT_CAPABILITIES,
  scoped_guidance_topics: ['required_object_shapes', 'authoring_vocabulary'],

  presets: jobs.filter(requested => !completeJob(requested)),
  selection: { rule: 'Combine all known upcoming needs before reading. Use the whole-member route for typed relationships or unsettled future scope; reuse held schemas and instructions across saves.',
    whole_for: jobs.filter(completeJob) } });
export function requirementSchemaBranch(context) {
  const complete = workItemRequirementBatchSchema(context);
  const { $defs: completeDefinitions, ...completeBatch } = complete;
  return { metadata: { ...REQUIREMENT_SCHEMA_METADATA,
      capability_schema_digests: Object.fromEntries(Object.keys(REQUIREMENT_CAPABILITIES).map(key =>
        [key, inputContractSourceDigest(workItemRequirementBatchSchema(context, [key]))])) },
    validate(schema) {
      if (JSON.stringify(schema.properties.requirements) !== JSON.stringify(completeBatch) ||
          Object.entries(completeDefinitions).some(([name, definition]) => JSON.stringify(schema.$defs?.[name]) !== JSON.stringify(definition))) {
        throw Object.assign(new TypeError('requirements_capability_source_drift: registered requirements differ from their construction owner'),
          { code: 'requirements_capability_source_drift' });
      }
    },
    select(schema, requested) {
      const scope = requirementCapabilities(requested);
      const scoped = workItemRequirementBatchSchema(context, requested);
      const schemaDefinitions = Object.fromEntries(Object.entries(schema.$defs ?? {}).filter(([name]) => !Object.hasOwn(complete.$defs, name)));
      const next = { ...schema, $defs: { ...schemaDefinitions, ...scoped.$defs },
        properties: { ...schema.properties, requirements: (({ $defs: _definitions, ...batch }) => batch)(scoped) } };
      const terms = new Set();
      const walk = (node, seen = new Set()) => {
        if (!node || typeof node !== 'object') return;
        if (node.$ref && !seen.has(node.$ref)) { seen.add(node.$ref); walk(scoped.$defs[node.$ref.slice('#/$defs/'.length)], seen); }
        if (node.properties?.relation) {
          const relation = node.properties.relation;
          for (const term of relation.enum ?? relation.oneOf.map(row => row.const)) terms.add(term);
        }
        for (const value of Object.values(node)) if (typeof value === 'object') {
          if (Array.isArray(value)) value.forEach(child => walk(child, seen)); else walk(value, seen);
        }
      };
      walk(scoped.$defs.behavior); walk(scoped.$defs.observation);
      if (scope.excluded.length === 0) return { schema, scope: null,
        guidance: topics => topics, terms: [...terms].sort() };
      return { schema: next, terms: [...terms].sort(), guidance: topics => topics.map(topic =>
        REQUIREMENT_SCHEMA_METADATA.scoped_guidance_topics.includes(topic[0]) ? [...topic, 'capabilities', ...requested] : topic), scope: { ...scope,
        families: [...new Set([...terms].map(term => term.split(':')[0]))].sort() } };
    }
  };
}

export function requirementSchemaDetail(path) {
  const [context, name, ...rest] = path;
  if (!['existing', 'birth'].includes(context) || rest.length) return { ok: false,
    code: 'requirement_schema_selection_invalid', resolved_path: [REQUIREMENT_SCHEMA_TOPIC], segment_index: 1,
    expected: 'existing or birth, optionally followed by one returned definition name' };
  const schema = workItemRequirementBatchSchema(context);
  if (name === undefined) return { ok: true, value: schema };
  if (!Object.hasOwn(schema.$defs, name)) return { ok: false, code: 'requirement_schema_definition_unknown',
    resolved_path: [REQUIREMENT_SCHEMA_TOPIC, context], segment_index: 2, expected: 'a definition from the complete owner schema' };
  const selected = bindInputSchemaExposure({ digest: inputContractSourceDigest, sources: { detail: {
    schema: { type: 'object', properties: { selected: { $ref: `#/$defs/${name}` } }, $defs: schema.$defs },
    groups: [{ name: 'detail', members: ['selected'] }] } } }).source('detail').select({ members: ['selected'] }).schema;
  return { ok: true, value: { $ref: `#/$defs/${name}`, $defs: selected.$defs } };
}
export const requirementSchemaIdentity = () => ({ existing: workItemRequirementBatchSchema(),
  birth: workItemRequirementBatchSchema('birth'), exposure: REQUIREMENT_SCHEMA_METADATA,
  capability_sources: { existing: requirementSchemaBranch('existing').metadata, birth: requirementSchemaBranch('birth').metadata } });

export function inferredRequirementCapabilities(batch) {
  if (admit(workItemRequirementBatchSchema(), batch).length) return null;
  return REQUIREMENT_SCHEMA_METADATA.presets.find(requested =>
    admit(workItemRequirementBatchSchema('existing', requested), batch).length === 0);
}
