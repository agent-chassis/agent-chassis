

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { resolveProspectiveScopeExistenceBase } from './backend-provisioning-state.mjs';
import { readWorkerScopePathRefusal, validateWorkerScopeEntries, validateWorkerScopePathsAtBase } from
  './backend-worker-scope-authority.mjs';

const correction = 'Nothing was saved. Name existing individual read files and exact existing or intended new write files; ' +
  'remove globs, directories, traversal and Git metadata paths, then save against the current revision.';

function pathDiagnostic(error, target) {

  const facts = readWorkerScopePathRefusal(error, { bounded: false });
  if (facts === null) return null;
  const index = target.authored[facts.field]?.indexOf(facts.path) ?? -1;
  return { code: facts.code, severity: 'error',
    path: `${target.inputPath}.${facts.field}${index < 0 ? '' : `[${index}]`}`,
    message: error.message, details: facts, correction };
}

export async function validateSaveRecordScopes({ repoRoot, record, targets, deps = {} }) {
  let target = targets[0];
  try {

    for (target of targets) {
      for (const [field, entries] of Object.entries(target.authored)) validateWorkerScopeEntries(entries, field);
      for (const field of ['read_scope', 'repo_paths', 'write_scope']) {
        validateWorkerScopeEntries(target.scope[field] ?? [], field);
      }
    }
    target = targets[0];
    const mainRepo = realpathSync(path.resolve(repoRoot));
    if (!/^IN-\d{4}$/u.test(record.initiative ?? '')) throw new Error('initiative_unresolvable: the resulting record must name its canonical initiative');
    const prospective = await resolveProspectiveScopeExistenceBase({ mainRepo, initiative: record.initiative,
      recordId: record.id, baseBranch: record.base_branch, deps });
    if (!prospective.ok) return [{ code: 'save_record_scope_not_evaluated', severity: 'error', path: target.inputPath,
      message: `Scope paths were not checked: ${prospective.reason}`, details: prospective,
      next_calls: [{ tool: 'workspace_read_wiki', arguments: { subject: record.id,
        select: { context: true, for_changes: ['base_branch'] } } }],
      correction: 'Nothing was saved. Inspect the selected base_branch and resolution_failure. If the caller chooses a different existing local base, author changes.base_branch on the parent work record using its current revision; otherwise restore the reported repository/base source. Reacquire the intended unit current revision before retrying its scope save.' }];
    for (target of targets) validateWorkerScopePathsAtBase({ mainRepo, scopeBase: prospective.scope_existence_base,
      readScope: target.scope.read_scope ?? [], repoPaths: target.scope.repo_paths ?? [],
      writeScope: target.scope.write_scope ?? [], deps, requireExistingReads: true, exclusions: [] });
    return [];
  } catch (error) {
    const diagnostic = pathDiagnostic(error, target);
    return [diagnostic ?? { code: 'save_record_scope_not_evaluated', severity: 'error', path: target.inputPath,
      message: `Scope paths were not checked: ${error.message}`,
      correction: 'Nothing was saved. Restore the applicable repository/base source reported here, then retry; preview and launch must still revalidate.' }];
  }
}
