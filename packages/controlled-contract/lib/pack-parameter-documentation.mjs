import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describePackParameters, assertValidatedParameterContract } from './pack-parameter-contract.mjs';
import { inspectPackParameterCoverage, parameterFailure } from './pack-parameter-coverage.mjs';
import { canonicalDigest } from './deterministic-projection-primitives.mjs';
import { admissionDigest } from './admitted-proof-packs.mjs';

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;')
  .replaceAll('\n', '<br>');
const json = value => '```json\n' + JSON.stringify(value, null, 2).replaceAll('`', '\\u0060') + '\n```';
const key = contract => `${contract.profile_id}@${contract.profile_version}`;

export function renderPackParameterDocumentation(contract, profile, admission) {
  const bound = assertValidatedParameterContract(contract);
  if (canonicalDigest(bound) !== canonicalDigest(profile) || admission.profile_digest !== contract.profile_digest ||
    admission.profile_id !== contract.profile_id || admission.profile_version !== contract.profile_version ||
    admission.parameter_contract_digest !== canonicalDigest(contract)) parameterFailure(
    'identity_mismatch', '/documentation', 'documentation inputs must bind one exact admitted contract');
  const description = describePackParameters(contract);
  const coverage = inspectPackParameterCoverage(contract, profile);
  const lines = [`# ${escape(key(contract))}`, '', '<!-- Generated from validated package metadata. -->', '',
    escape(contract.description), '',
    `Profile digest: ${contract.profile_digest}. Parameter digest: ${canonicalDigest(contract)}.`, '',
    `Admission digest: ${admissionDigest(admission)}.`, '',
    `Roles: ${coverage.accounted}/${coverage.total} accounted; ${coverage.gaps} owned gaps. ` +
      `Semantic parameters: ${coverage.semantic_parameters}; internal roles: ${coverage.internal_roles}.`, '',
    '## Guarantee and exclusions', '', escape(admission.guarantee), '',
    ...admission.explicit_exclusions.map(value => `- ${escape(value)}`), '',
    '## Parameters', ''];
  for (const parameter of description.parameters) lines.push(`### ${escape(parameter.name)}`, '',
    escape(parameter.purpose), '', `Kind: ${parameter.value_kind}.`, '',
    json({ source: parameter.source, refinements: parameter.refinements,
      constraints: parameter.constraints }), '');
  lines.push('## Role production and complete constraints', '',
    '| Role | Producer | Source | Capability gap |', '| --- | --- | --- | --- |',
    ...coverage.rows.map(row => `| ${escape(row.role)} | ${row.kind} | ${escape(row.parameter ?? row.inputs.join(', '))} | ${escape(row.gap?.missing ?? '')} |`), '',
    json({ roles: coverage.rows, constraints: coverage.constraints }), '',
    '## Construction, dependencies and capabilities', '',
    json({ construction: contract.construction, dependencies: contract.dependencies,
      capabilities: contract.capabilities }), '',
    'Metadata is a declaration. It does not acquire observations or certify implementation truth.', '');
  return lines.join('\n');
}

export function renderParameterDocumentationSet(population) {
  const entries = [...population].sort((a, b) => key(a.contract) < key(b.contract) ? -1 : 1);
  const files = new Map();
  const rows = [];
  let total = 0, gaps = 0;
  for (const { contract, pack } of entries) {
    const name = `${key(contract)}.md`;
    if (files.has(name)) parameterFailure('coverage_mismatch', '/documentation', 'duplicate exact pack');
    const coverage = inspectPackParameterCoverage(contract, pack.profile);
    total += coverage.total; gaps += coverage.gaps;
    files.set(name, renderPackParameterDocumentation(contract, pack.profile, pack.admission));
    rows.push(`| [${escape(key(contract))}](${name}) | ${coverage.total} | ${coverage.semantic_parameters} | ${coverage.gaps} |`);
  }
  if (!files.size) parameterFailure('coverage_mismatch', '/documentation', 'empty population is not complete');
  files.set('index.md', ['# Proof pack parameter index', '', '<!-- Generated from validated package metadata. -->', '',
    `${entries.length} exact definitions; ${total}/${total} roles accounted; ${gaps} owned role gaps.`, '',
    '| Exact pack | Roles | Semantic parameters | Role gaps |', '| --- | --- | --- | --- |', ...rows, ''].join('\n'));
  return files;
}

export async function checkParameterDocumentation(directory, expected) {
  let names;
  try { names = await readdir(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  const missing = [...expected.keys()].filter(name => !names.includes(name));
  const extra = names.filter(name => !expected.has(name));
  const edited = [];
  for (const name of expected.keys()) if (names.includes(name) &&
    await readFile(path.join(directory, name), 'utf8') !== expected.get(name)) edited.push(name);
  return { passed: !missing.length && !extra.length && !edited.length, missing, extra, edited };
}

export async function writeParameterDocumentation(directory, expected) {
  await mkdir(directory, { recursive: true });
  const check = await checkParameterDocumentation(directory, expected);
  if (check.extra.length) parameterFailure('documentation_extra', '/documentation',
    'remove explicitly identified obsolete outputs before generation', { extra: check.extra });
  for (const [name, bytes] of expected) await writeFile(path.join(directory, name), bytes);
  return checkParameterDocumentation(directory, expected);
}
