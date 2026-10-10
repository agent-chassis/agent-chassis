

import { loadManifest } from '@agent-chassis/wiki-core/src/lib/contract.mjs';
import { slugify } from '@agent-chassis/wiki-core/src/lib/wiki-shared.mjs';

export const CREATE_RECORD_ROUTE = 'workspace_create_record';
const manifest = await loadManifest();
const supported = ['work_item', 'initiative', 'decision', 'source', 'area'];
const kindSpec = kind => manifest.types[kind === 'work_item' ? 'issue' : kind];
export const CREATION_MAINTENANCE_UNIT_PATTERN = new RegExp('^(?:' + supported.map(kind => {
  const spec = kindSpec(kind);
  return spec.idStrategy === 'slug' ? '[a-z0-9]+(?:-[a-z0-9]+)*' : `${spec.prefix}-[0-9]{4,}${kind === "work_item" ? "(?:#SLICE-[0-9]{3,})?" : ""}`;
}).join('|') + ')$', 'u');

export function creationMaintenanceSubject({ unit, kind, source, readIdentity, recordSourceDigest = null }) {
  if (!supported.includes(kind) || typeof unit !== 'string') throw new TypeError('Creation maintenance requires a supported subject');
  const spec = kindSpec(kind);
  const matches = spec.idStrategy === 'slug' ? unit !== '' && slugify(unit) === unit
    : new RegExp(`^${spec.prefix}-[0-9]{4,}$`, 'u').test(unit);
  if (!matches || source === null || typeof source !== 'object' || readIdentity === null ||
      typeof readIdentity !== 'object') throw new TypeError('Creation maintenance requires exact producer source and read identity');
  return structuredClone({ unit, kind, source, read_identity: readIdentity, record_source_digest: recordSourceDigest });
}

export function saveMaintenanceSubject(saved) {
  const kind = Object.entries({ WK: 'work_item', IN: 'initiative', DEC: 'decision' })
    .find(([prefix]) => saved.unit.startsWith(prefix + '-'))?.[1];
  if (kind === undefined || saved.kind !== kind) throw new TypeError('Save original subject is mismatched');
  return { unit: saved.unit, kind, revision: saved.revision, record_source_digest: saved.record_source_digest ?? null };
}
