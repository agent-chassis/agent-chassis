import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  ApplyFromScratchError,
  applyFromScratch,
  planApplyFromScratch,
} from '../packages/agent-launch-cli/src/lib/agent-child-apply-from-scratch.mjs';

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'apply-from-scratch-'));
  const repoRoot = path.join(root, 'repo');
  const scratchRoot = path.join(root, 'scratch');
  const homeRoot = path.join(root, 'home');
  const xdgRoot = path.join(root, 'xdg');

  await Promise.all([
    mkdir(repoRoot, { recursive: true }),
    mkdir(scratchRoot, { recursive: true }),
    mkdir(homeRoot, { recursive: true }),
    mkdir(xdgRoot, { recursive: true }),
  ]);

  return {
    homeRoot,
    repoRoot,
    root,
    scratchRoot,
    xdgRoot,
  };
}

async function writeText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

function authority(fixture, allowedTargetPaths, overrides = {}) {
  return {
    repoRoot: fixture.repoRoot,
    scratchRoot: fixture.scratchRoot,
    allowedTargetPaths,
    forbiddenSourceRoots: [fixture.repoRoot, fixture.homeRoot, fixture.xdgRoot],
    ...overrides,
  };
}

test('applyFromScratch writes scratch content into an existing exact target', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'docs', 'allowed.md');
  const scratchPath = path.join(fixture.scratchRoot, 'stage.txt');

  await writeText(targetPath, 'old body\n');
  await writeText(scratchPath, 'new body\n');

  const result = await applyFromScratch({
    authority: authority(fixture, [targetPath]),
    request: {
      scratchPath,
      targetPath,
    },
  });

  assert.deepEqual(result, {
    targetPath,
    scratchPath,
    bytesWritten: Buffer.byteLength('new body\n'),
  });
  assert.equal(await readFile(targetPath, 'utf8'), 'new body\n');
});

test('planApplyFromScratch rejects an allowed but missing exact target and does not create it', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'docs', 'missing.md');
  const scratchPath = path.join(fixture.scratchRoot, 'stage.txt');

  await writeText(scratchPath, 'new body\n');

  await assert.rejects(
    planApplyFromScratch({
      authority: authority(fixture, [targetPath]),
      request: {
        scratchPath,
        targetPath,
      },
    }),
    (error) => error instanceof ApplyFromScratchError
      && error.code === 'target_missing'
      && error.details?.path === targetPath,
  );

  await assert.rejects(readFile(targetPath), {
    code: 'ENOENT',
  });
});

test('generated-view targets are denied even when they appear in the launcher-owned allowlist', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'wiki', 'generated', 'catalog.md');
  const scratchPath = path.join(fixture.scratchRoot, 'stage.txt');

  await writeText(targetPath, 'old body\n');
  await writeText(scratchPath, 'new body\n');

  await assert.rejects(
    applyFromScratch({
      authority: authority(fixture, [targetPath]),
      request: {
        scratchPath,
        targetPath,
      },
    }),
    (error) => error instanceof ApplyFromScratchError
      && error.code === 'generated_view_target'
      && error.details?.path === targetPath,
  );

  assert.equal(await readFile(targetPath, 'utf8'), 'old body\n');
});

test('symlinked targets are rejected as realpath escapes', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'docs', 'symlink-target.md');
  const scratchPath = path.join(fixture.scratchRoot, 'stage.txt');
  const outsidePath = path.join(fixture.root, 'outside.md');

  await writeText(outsidePath, 'outside body\n');
  await writeText(scratchPath, 'new body\n');
  await mkdir(path.dirname(targetPath), { recursive: true });
  await symlink(outsidePath, targetPath);

  await assert.rejects(
    applyFromScratch({
      authority: authority(fixture, [targetPath]),
      request: {
        scratchPath,
        targetPath,
      },
    }),
    (error) => error instanceof ApplyFromScratchError
      && error.code === 'path_symlink_escape',
  );
});

test('scratch sources outside the launcher-owned scratch root are rejected', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'docs', 'allowed.md');
  const badScratchRoot = path.join(fixture.repoRoot, 'scratch');
  const scratchPath = path.join(badScratchRoot, 'stage.txt');

  await writeText(targetPath, 'old body\n');
  await writeText(scratchPath, 'new body\n');

  await assert.rejects(
    applyFromScratch({
      authority: authority(fixture, [targetPath], {
        scratchRoot: badScratchRoot,
      }),
      request: {
        scratchPath,
        targetPath,
      },
    }),
    (error) => error instanceof ApplyFromScratchError
      && error.code === 'scratch_in_forbidden_root',
  );
});

test('unwritable targets report a structured denial before final apply', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'docs', 'allowed.md');
  const scratchPath = path.join(fixture.scratchRoot, 'stage.txt');

  await writeText(targetPath, 'old body\n');
  await writeText(scratchPath, 'new body\n');

  const fs = {
    ...fsPromises,
    open: async () => {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    },
  };

  await assert.rejects(
    applyFromScratch({
      authority: authority(fixture, [targetPath]),
      request: {
        scratchPath,
        targetPath,
      },
      fs,
    }),
    (error) => error instanceof ApplyFromScratchError
      && error.code === 'target_unwritable'
      && error.details?.code === 'EACCES',
  );

  assert.equal(await readFile(targetPath, 'utf8'), 'old body\n');
});

test('planApplyFromScratch returns the canonical exact paths used by applyFromScratch', async () => {
  const fixture = await makeFixture();
  const targetPath = path.join(fixture.repoRoot, 'docs', 'plan.md');
  const scratchPath = path.join(fixture.scratchRoot, 'stage.txt');

  await writeText(targetPath, 'old body\n');
  await writeText(scratchPath, 'new body\n');

  const plan = await planApplyFromScratch({
    authority: authority(fixture, [targetPath]),
    request: {
      scratchPath,
      targetPath,
    },
  });

  assert.deepEqual(plan, {
    repoRoot: fixture.repoRoot,
    scratchRoot: fixture.scratchRoot,
    scratchPath,
    targetPath,
  });
});
import { createServer } from 'node:net';
import { inspect } from 'node:util';
import { test as scratchApplyTest } from 'node:test';
import * as applyFromScratchModule from '../packages/agent-launch-cli/src/lib/agent-child-apply-from-scratch.mjs';

const scratchApplyFromScratch =
  applyFromScratchModule.applyFromScratch ??
  applyFromScratchModule.default ??
  applyFromScratchModule;

function normalizeApplyFromScratchOutcome(outcome) {
  if (outcome instanceof Error) {
    return {
      ok: false,
      code: outcome.code ?? outcome.name ?? null,
      raw: outcome,
    };
  }

  if (outcome && typeof outcome === 'object') {
    const code =
      outcome.code ??
      outcome.error?.code ??
      outcome.denial?.code ??
      outcome.result?.code ??
      null;
    const ok =
      outcome.ok ??
      outcome.allowed ??
      outcome.success ??
      (code === null ? undefined : false);
    return {
      ok,
      code,
      raw: outcome,
    };
  }

  return {
    ok: undefined,
    code: null,
    raw: outcome,
  };
}

async function invokeApplyFromScratch(request, authority, fsImpl) {
  try {
    const outcome = await scratchApplyFromScratch({
      authority,
      request,
      fs: fsImpl,
    });
    return normalizeApplyFromScratchOutcome(outcome);
  } catch (error) {
    return normalizeApplyFromScratchOutcome(error);
  }
}

function assertDeniedCode(outcome, expectedCode) {
  assert.equal(
    outcome.ok,
    false,
    `expected denial for ${expectedCode}, got ${inspect(outcome.raw, { depth: 6 })}`,
  );
  assert.equal(
    outcome.code,
    expectedCode,
    `expected code ${expectedCode}, got ${inspect(outcome.raw, { depth: 6 })}`,
  );
}

async function makeTempRoot() {
  return mkdtemp(path.join(tmpdir(), 'apply-from-scratch-'));
}

async function ensureAbsent(targetPath) {
  try {
    await readFile(targetPath);
    assert.fail(`expected ${targetPath} to stay absent`);
  } catch (error) {
    assert.equal(error.code, 'ENOENT');
  }
}

async function readFileText(filePath) {
  return readFile(filePath, 'utf8');
}

async function makeSocketFile(socketPath) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.unref();
      resolve(server);
    });
  });
}

scratchApplyTest('SLICE-012 apply_from_scratch rejects missing scratch input', async () => {
  const fixture = await makeFixture();
  try {
    const targetPath = path.join(fixture.repoRoot, 'docs', 'repo-target.txt');
    const authorityConfig = authority(fixture, [targetPath]);
    const outcome = await invokeApplyFromScratch(
      {
        scratchPath: path.join(fixture.scratchRoot, 'missing-scratch.txt'),
        targetPath,
      },
      authorityConfig,
      undefined,
    );

    assertDeniedCode(outcome, 'scratch_missing');
    await ensureAbsent(targetPath);
  } finally {
    await fsPromises.rm(fixture.root, { recursive: true, force: true });
  }
});

scratchApplyTest('SLICE-012 apply_from_scratch rejects symlinked scratch sources', async () => {
  const fixture = await makeFixture();
  try {
    const sourcePath = path.join(fixture.root, 'source.txt');
    const scratchPath = path.join(fixture.scratchRoot, 'scratch-link.txt');
    const targetPath = path.join(fixture.repoRoot, 'docs', 'repo-target.txt');
    const authorityConfig = authority(fixture, [targetPath]);

    await writeFile(sourcePath, 'scratch contents\n', 'utf8');
    await mkdir(path.dirname(scratchPath), { recursive: true });
    await symlink(sourcePath, scratchPath);

    const outcome = await invokeApplyFromScratch(
      {
        scratchPath,
        targetPath,
      },
      authorityConfig,
      undefined,
    );

    assertDeniedCode(outcome, 'path_symlink_escape');
    await ensureAbsent(targetPath);
  } finally {
    await fsPromises.rm(fixture.root, { recursive: true, force: true });
  }
});

scratchApplyTest('SLICE-012 apply_from_scratch rejects directory and non-regular scratch sources', async () => {
  const fixture = await makeFixture();
  try {
    const scratchRoot = fixture.scratchRoot;
    const directoryScratchPath = path.join(scratchRoot, 'scratch-dir');
    const directoryTargetPath = path.join(fixture.repoRoot, 'docs', 'directory-target.txt');
    const directoryAuthority = authority(fixture, [directoryTargetPath]);
    await mkdir(directoryScratchPath);

    const directoryOutcome = await invokeApplyFromScratch(
      {
        scratchPath: directoryScratchPath,
        targetPath: directoryTargetPath,
      },
      directoryAuthority,
      undefined,
    );

    assertDeniedCode(directoryOutcome, 'invalid_file');
    await ensureAbsent(directoryTargetPath);

    const socketPath = path.join(scratchRoot, 'scratch.socket');
    const socketTargetPath = path.join(fixture.repoRoot, 'docs', 'socket-target.txt');
    const socketAuthority = authority(fixture, [socketTargetPath]);
    await makeSocketFile(socketPath);

    const socketOutcome = await invokeApplyFromScratch(
      {
        scratchPath: socketPath,
        targetPath: socketTargetPath,
      },
      socketAuthority,
      undefined,
    );

    assertDeniedCode(socketOutcome, 'invalid_file');
    await ensureAbsent(socketTargetPath);
  } finally {
    await fsPromises.rm(fixture.root, { recursive: true, force: true });
  }
});

scratchApplyTest('SLICE-012 apply_from_scratch rejects undeclared targets', async () => {
  const fixture = await makeFixture();
  try {
    const scratchPath = path.join(fixture.scratchRoot, 'scratch.txt');
    const targetPath = path.join(fixture.repoRoot, 'docs', 'repo-target.txt');
    const otherAllowedTargetPath = path.join(fixture.repoRoot, 'docs', 'repo-other.txt');
    const authorityConfig = authority(fixture, [otherAllowedTargetPath]);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(scratchPath, 'scratch payload\n', 'utf8');
    await writeFile(targetPath, 'sentinel target contents\n', 'utf8');

    const before = await readFileText(targetPath);
    const outcome = await invokeApplyFromScratch(
      {
        scratchPath,
        targetPath,
      },
      authorityConfig,
      undefined,
    );

    assertDeniedCode(outcome, 'target_not_allowed');
    assert.equal(await readFileText(targetPath), before);
  } finally {
    await fsPromises.rm(fixture.root, { recursive: true, force: true });
  }
});

scratchApplyTest('SLICE-012 apply_from_scratch rejects malformed requests', async () => {
  const fixture = await makeFixture();
  try {
    const targetPath = path.join(fixture.repoRoot, 'docs', 'repo-target.txt');
    const authorityConfig = authority(fixture, [targetPath]);
    const outcome = await invokeApplyFromScratch(
      {
        targetPath,
      },
      authorityConfig,
      undefined,
    );

    assertDeniedCode(outcome, 'invalid_request');
    await ensureAbsent(targetPath);
  } finally {
    await fsPromises.rm(fixture.root, { recursive: true, force: true });
  }
});
