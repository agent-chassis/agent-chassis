

export const FIXTURE_SCOPE_PREPARATION_BASE_SHA = "1".repeat(40);

function shallowestFirst(left, right) {
  const depth = left.split("/").length - right.split("/").length;
  if (depth !== 0) return depth;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fixtureFrozenScopeFacts({
  readable = [],
  writable = [],
  preparedDirectories = [],
  baseSha = FIXTURE_SCOPE_PREPARATION_BASE_SHA
} = {}) {
  const exact = (entries) => [...new Set(entries)].sort();
  const write = exact(writable);
  const files = (entries) => Object.freeze({
    files: Object.freeze(entries),
    directories: Object.freeze([])
  });
  return Object.freeze({
    resolved_scope: Object.freeze({
      readable: files(exact(readable).filter((entry) => !write.includes(entry))),
      writable: files(write)
    }),
    scope_preparation: Object.freeze({
      base_sha: baseSha,
      directories: Object.freeze([...new Set(preparedDirectories)].sort(shallowestFirst))
    })
  });
}
