
import { execFileSync } from 'node:child_process';
import { realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { FeedbackError } from './agent-feedback-schema.mjs';
import { projectFailureDiagnosis } from './diagnostic-projection.mjs';

function git(directory, args) {

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', env,
    timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function commonDirectory(directory) {
  return realpathSync(git(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
}
function repositoryFailure(cause, directory) {
  const { name: _name, spawnargs: _spawnargs, message, errors, ...facts } = projectFailureDiagnosis(cause);
  const problem = { ...facts, ...(errors?.length > 0 ? { errors } : { message }) };
  const permission = ['EACCES', 'EPERM', 'EROFS'].includes(cause.code);
  return new FeedbackError(permission ? 'feedback_permission_denied' : 'feedback_repository_invalid',
    `Cannot resolve repository-local feedback storage for ${directory}`,
    { subject: directory, cause: problem }, cause);
}
function resolvePrimaryCheckout(directory) {
  try {
    const selected = realpathSync(directory);
    if (git(selected, ['rev-parse', '--is-bare-repository']).trim() === 'true') {
      throw new FeedbackError('feedback_repository_invalid', `Bare repository has no primary checkout: ${selected}`);
    }
    const commonDir = commonDirectory(selected);

    const primary = git(selected, ['worktree', 'list', '--porcelain', '-z']).split('\0\0')[0]
      .split('\0').find(line => line.startsWith('worktree '))?.slice(9);
    if (!primary) throw new FeedbackError('feedback_repository_ambiguous',
      `Git worktree metadata has no primary checkout for ${commonDir}`);
    const primaryDirectory = realpathSync(primary);
    if (realpathSync(git(primaryDirectory, ['rev-parse', '--absolute-git-dir']).trim()) !== commonDir) {
      throw new FeedbackError('feedback_repository_ambiguous',
        `Primary checkout ${primaryDirectory} does not own ${commonDir}`);
    }
    const primaryRoot = realpathSync(git(primaryDirectory, ['rev-parse', '--show-toplevel']).trim());
    if (commonDirectory(primaryRoot) !== commonDir) throw new FeedbackError('feedback_repository_ambiguous',
      `Primary checkout ${primaryRoot} does not own ${commonDir}`);
    return Object.freeze({ primaryRoot, commonDir });
  } catch (cause) {
    if (cause instanceof FeedbackError) throw cause;
    throw repositoryFailure(cause, directory);
  }
}

export function bindRepositoryLocalStateRoot(directory) {
  const identity = resolvePrimaryCheckout(directory);
  return Object.freeze({
    primaryRoot: identity.primaryRoot,
    resolve() {
      const paths = resolveRepositoryLocalStateRoot(identity.primaryRoot);
      if (paths.commonDir !== identity.commonDir || paths.primaryRoot !== identity.primaryRoot) {
        throw new FeedbackError('feedback_repository_ambiguous',
          `Bound primary checkout ${identity.primaryRoot} no longer owns ${identity.commonDir}`);
      }
      return paths;
    }
  });
}

export function resolveRepositoryLocalStateRoot(directory) {
  try {
    const { primaryRoot, commonDir } = resolvePrimaryCheckout(directory);
    const stateRoot = path.join(primaryRoot, '.agent-launch');
    const databasePath = path.join(stateRoot, 'feedback.sqlite');
    for (const candidate of [stateRoot, databasePath, `${databasePath}-journal`]) {
      let stat;
      try { stat = lstatSync(candidate); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if ((candidate === stateRoot && !stat.isDirectory()) || stat.isSymbolicLink() || (!stat.isDirectory() && stat.nlink !== 1)) throw new FeedbackError(
        'feedback_storage_unsafe', `Feedback storage cannot follow a symlink or shared file: ${candidate}`);
    }
    const tracked = git(primaryRoot, ['ls-files', '--', '.agent-launch/feedback.sqlite', '.agent-launch/feedback.sqlite-journal']).trim();
    if (tracked) throw new FeedbackError('feedback_storage_unsafe', `Feedback runtime paths are tracked: ${tracked}`);
    return Object.freeze({ primaryRoot, commonDir, stateRoot, databasePath });
  } catch (cause) {
    if (cause instanceof FeedbackError) throw cause;
    throw repositoryFailure(cause, directory);
  }
}
