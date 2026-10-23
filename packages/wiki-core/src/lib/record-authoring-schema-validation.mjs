

import { createRequire } from 'node:module';
import { isCanonicalWorkRecordBaseBranch } from './work-record-base-branch.mjs';
import { parseRepositoryScopeFileSelector, isRepositoryRelativePath, normalizeRepositoryRelativePath } from './work-record-repository-path.mjs';
const require = createRequire(import.meta.url);
const loaded = require('ajv');
const Ajv = loaded.default ?? loaded;
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('local_branch_name', isCanonicalWorkRecordBaseBranch);
ajv.addFormat('repository_scope_file', value => parseRepositoryScopeFileSelector(value).ok);
ajv.addFormat('normalized_repository_scope_file', value => parseRepositoryScopeFileSelector(normalizeRepositoryRelativePath(value)).ok);
ajv.addFormat('normalized_repository_path', isRepositoryRelativePath);
function byteLimit(maximum, value) {
  const actual = Buffer.byteLength(value, 'utf8');
  byteLimit.errors = actual <= maximum ? null : [{ keyword: 'max_utf8_bytes',
    params: { maximum, actual }, message: `must fit ${maximum} UTF-8 bytes (received ${actual})` }];
  return actual <= maximum;
}
ajv.addKeyword({ keyword: 'max_utf8_bytes', type: 'string', schemaType: 'number', validate: byteLimit, errors: true });
const validators = new WeakMap();
export function recordAuthoringSchemaValidator(schema, definitions = schema.$defs) {
  let environments = validators.get(schema);
  if (!environments) validators.set(schema, environments = new Map());
  if (!environments.has(definitions)) environments.set(definitions,
    ajv.compile(definitions === undefined ? schema : { ...schema, $defs: definitions }));
  return environments.get(definitions);
}
export const RECORD_AUTHORING_FORMATS = Object.freeze(['local_branch_name', 'repository_scope_file',
  'normalized_repository_scope_file', 'normalized_repository_path']);
