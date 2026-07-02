import assert from 'node:assert/strict';
import test from 'node:test';

import * as codexExecutor from '../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-executor.mjs';

const STANDARD_CLEAN_FINAL = {
  body: 'No findings.',
  blocking_finding_count: 0,
  clean_review: true,
  kind: 'no_findings',
  medium_finding_count: 0,
  no_findings: true,
  review_outcome: 'no_findings',
};

const BLOCKING_FINAL = {
  body: 'Blocking: actual finding.',
  blocking_finding_count: 1,
  clean_review: false,
  kind: 'findings',
  medium_finding_count: 0,
  no_findings: false,
  review_outcome: 'findings',
};

const ZERO_COUNT_FINDINGS_FINAL = {
  body: 'No findings.',
  blocking_finding_count: 0,
  clean_review: false,
  kind: 'findings',
  medium_finding_count: 0,
  no_findings: false,
  review_outcome: 'findings',
};

function extractKind(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (typeof value.kind === 'string') {
    return value.kind;
  }

  if (typeof value.review_outcome === 'string') {
    return value.review_outcome;
  }

  if (value.clean_review === true || value.no_findings === true) {
    return 'no_findings';
  }

  const nested = value.review_result ?? value.result ?? value.final_result ?? value.normalized_result;
  if (nested && typeof nested === 'object') {
    return extractKind(nested);
  }

  return undefined;
}

function candidateForms(value) {
  return [
    [value],
    [{ review_result: value }],
    [{ reviewResult: value }],
    [{ final_result: value }],
    [{ finalResult: value }],
    [{ result: value }],
    [{ body: typeof value === 'string' ? value : value.body }],
    [{ text: typeof value === 'string' ? value : value.body }],
    [{ review_result: typeof value === 'string' ? value : value.body }],
    [{ reviewResult: typeof value === 'string' ? value : value.body }],
  ];
}

async function invokeWithCandidates(fn, value) {
  let lastError;

  for (const args of candidateForms(value)) {
    try {
      return await fn(...args);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Unable to invoke candidate review classifier');
}

function isClassifierName(name) {
  const lower = name.toLowerCase();
  if (lower === 'default') {
    return false;
  }

  const hasReview = lower.includes('review');
  const hasResult = lower.includes('result');
  const hasFinal = lower.includes('final');
  const hasClassifierVerb =
    lower.includes('classif') ||
    lower.includes('normalize') ||
    lower.includes('derive') ||
    lower.includes('parse') ||
    lower.includes('extract');

  return hasResult && hasClassifierVerb && (hasReview || hasFinal || lower.includes('clean'));
}

function getCallableEntries(surface) {
  return Object.entries(surface).filter(([, value]) => typeof value === 'function');
}

async function resolveClassifier() {
  const exportedCandidates = [
    ...getCallableEntries(codexExecutor).filter(([name]) => isClassifierName(name)),
    ...getCallableEntries(codexExecutor).filter(([name]) => !isClassifierName(name)),
  ];

  for (const [name, fn] of exportedCandidates) {
    const cleanKind = extractKind(await invokeWithCandidates(fn, STANDARD_CLEAN_FINAL));
    const blockingKind = extractKind(await invokeWithCandidates(fn, BLOCKING_FINAL));

    if (cleanKind === 'no_findings' && blockingKind === 'findings') {
      return { fn, name };
    }
  }

  const factoryNames = ['createWorkspaceAgentDispatchCodexExecutor', 'createCodexExecutor'];
  for (const factoryName of factoryNames) {
    const factory = codexExecutor[factoryName];
    if (typeof factory !== 'function') {
      continue;
    }

    for (const args of [[], [{}]]) {
      let instance;
      try {
        instance = factory(...args);
      } catch {
        continue;
      }

      if (!instance || typeof instance !== 'object') {
        continue;
      }

      const instanceCandidates = [
        ...getCallableEntries(instance).filter(([candidateName]) => isClassifierName(candidateName)),
        ...getCallableEntries(instance).filter(([candidateName]) => !isClassifierName(candidateName)),
      ];

      for (const [name, value] of instanceCandidates) {
        const cleanKind = extractKind(await invokeWithCandidates(value.bind(instance), STANDARD_CLEAN_FINAL));
        const blockingKind = extractKind(await invokeWithCandidates(value.bind(instance), BLOCKING_FINAL));

        if (cleanKind === 'no_findings' && blockingKind === 'findings') {
          return { fn: value.bind(instance), name: `${factoryName}.${name}` };
        }
      }
    }
  }

  const defaultExport = codexExecutor.default;
  if (typeof defaultExport === 'function') {
    const cleanKind = extractKind(await invokeWithCandidates(defaultExport.bind(codexExecutor), STANDARD_CLEAN_FINAL));
    const blockingKind = extractKind(await invokeWithCandidates(defaultExport.bind(codexExecutor), BLOCKING_FINAL));

    if (cleanKind === 'no_findings' && blockingKind === 'findings') {
      return { fn: defaultExport.bind(codexExecutor), name: 'default' };
    }
  }

  if (defaultExport && typeof defaultExport === 'object') {
    const defaultCandidates = [
      ...getCallableEntries(defaultExport).filter(([candidateName]) => isClassifierName(candidateName)),
      ...getCallableEntries(defaultExport).filter(([candidateName]) => !isClassifierName(candidateName)),
    ];

    for (const [name, value] of defaultCandidates) {
      const cleanKind = extractKind(await invokeWithCandidates(value.bind(defaultExport), STANDARD_CLEAN_FINAL));
      const blockingKind = extractKind(await invokeWithCandidates(value.bind(defaultExport), BLOCKING_FINAL));

      if (cleanKind === 'no_findings' && blockingKind === 'findings') {
        return { fn: value.bind(defaultExport), name: `default.${name}` };
      }
    }
  }

  throw new Error(
    `Could not resolve a Codex review classifier export. Available exports: ${Object.keys(codexExecutor).join(', ')}`
  );
}

const classifier = await resolveClassifier();

async function assertKind(value, expected, message) {
  const result = await invokeWithCandidates(classifier.fn, value);
  assert.equal(
    extractKind(result),
    expected,
    `${message} (classifier: ${classifier.name})`
  );
}

test('standardized clean-review final format normalizes to a clean signal', async () => {
  await assertKind(STANDARD_CLEAN_FINAL, 'no_findings', 'standardized clean final result should stay clean');
});

for (const { sample, label, payload, reason } of [
  {
    sample: ZERO_COUNT_FINDINGS_FINAL,
    label: 'zero-count findings remain findings',
    payload: ZERO_COUNT_FINDINGS_FINAL,
    reason: 'zero-count findings should not normalize to clean',
  },
  {
    sample: `${STANDARD_CLEAN_FINAL.body}\n\nMedium: later marker should remain findings.`,
    label: 'later Medium marker remains findings',
    payload: { ...BLOCKING_FINAL, body: `${STANDARD_CLEAN_FINAL.body}\n\nMedium: later marker should remain findings.` },
    reason: 'Medium marker should not normalize to clean',
  },
  {
    sample: `${STANDARD_CLEAN_FINAL.body}\n\nBlocking: later marker should remain findings.`,
    label: 'later Blocking marker remains findings',
    payload: { ...BLOCKING_FINAL, body: `${STANDARD_CLEAN_FINAL.body}\n\nBlocking: later marker should remain findings.` },
    reason: 'Blocking marker should not normalize to clean',
  },
  {
    sample: `${STANDARD_CLEAN_FINAL.body}\n\nM1: later marker should remain findings.`,
    label: 'later M1 marker remains findings',
    payload: { ...BLOCKING_FINAL, body: `${STANDARD_CLEAN_FINAL.body}\n\nM1: later marker should remain findings.` },
    reason: 'M1 marker should not normalize to clean',
  },
  {
    sample: `${STANDARD_CLEAN_FINAL.body}\n\nB1: later marker should remain findings.`,
    label: 'later B1 marker remains findings',
    payload: { ...BLOCKING_FINAL, body: `${STANDARD_CLEAN_FINAL.body}\n\nB1: later marker should remain findings.` },
    reason: 'B1 marker should not normalize to clean',
  },
  {
    sample: `${STANDARD_CLEAN_FINAL.body}\n\nH1: later marker should remain findings.`,
    label: 'later H1 marker remains findings',
    payload: { ...BLOCKING_FINAL, body: `${STANDARD_CLEAN_FINAL.body}\n\nH1: later marker should remain findings.` },
    reason: 'H1 marker should not normalize to clean',
  },
]) {
  test(label, async () => {
    await assertKind(payload ?? sample, 'findings', reason);
  });
}
