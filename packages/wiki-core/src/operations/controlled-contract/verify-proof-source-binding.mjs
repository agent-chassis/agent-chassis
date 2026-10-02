import { classifyControlledContractGenerationBasename, readStableControlledContractGeneration }
  from '../../lib/controlled-contract-tool-shared.mjs';
import { linkedNativeTestProofs, resolveStableTestProofBindingPopulation } from '@agent-chassis/controlled-contract';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { resolveSavedProofSource, resolveSavedProofContext, resolveDerivedProofContract }
  from './saved-proof-source.mjs';

import { resolveProofExecutableMap } from '@agent-chassis/controlled-contract/executable-map';
import { readControlledContractCarrierFile } from '../../lib/controlled-contract-tools.mjs';
import { resolveBehaviorAndVerificationPopulation, createNativeVerificationIndex } from '@agent-chassis/controlled-contract';
import { ControlledContractToolError } from '../../lib/controlled-contract-tool-shared.mjs';
import { parseVerifyProofSource, verifyProofPopulationSubject } from './verify-proof-operations.mjs';

function fail(code, details) {
  throw new ControlledContractToolError(code, 'Cannot select one canonical saved proof source', {
    authority_limb: 'mechanical_failure', ...details
  });
}

export async function locateVerifyProofSubjectWkIds({ repoRoot, subject }) {
  const directory = path.join(repoRoot, 'wiki/contracts');
  const names = await readdir(directory);
  const matches = new Set();
  const invalidSources = [];
  for (const name of names.sort()) {
    const fileMatch = /^(WK-[0-9]{4,}).*\.(obligation-coverage|controlled-acceptance)\.json$/u.exec(name);
    if (!fileMatch) continue;
    let content;
    try {
      content = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    } catch (error) {
      invalidSources.push({
        repository_relative_path: path.join('wiki/contracts', name),
        diagnostic_code: 'verify_proof.identity_census_source_invalid.v1',
        cause: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    const [_, wkId, kind] = fileMatch;
    if (kind === 'obligation-coverage') {
      const obligationMatch = Array.isArray(content?.obligations) &&
        content.obligations.some(row => row?.obligation_id === subject);
      const caseMatch = Array.isArray(content?.cases) && content.cases.some(definition =>
        typeof definition?.case_id === 'string' &&
        linkedNativeTestProofs({ relations: [], test_proofs: [{ test_proof_id: subject }] },
          { case_id: definition.case_id }).length === 1);
      if (obligationMatch || caseMatch) matches.add(wkId);
    } else if (Array.isArray(content?.test_proofs) &&
        content.test_proofs.some(proof => proof?.test_proof_id === subject)) {
      matches.add(wkId);
    }
  }
  return { wk_ids: [...matches].sort(), invalid_sources: invalidSources };
}

async function canonicalSourceTuples(repoRoot, wkId) {
  const names = await readdir(path.join(repoRoot, 'wiki/contracts'));
  return names.sort().flatMap(basename => {
    const member = classifyControlledContractGenerationBasename({ wkId, basename });
    if (member.classification === 'malformed_active_candidate') {
      throw new ControlledContractToolError('controlled_contract_generation_invalid',
        'malformed same-WK proof-authoring source is present', { basename, reason: member.reason });
    }
    return member.member === true && member.carrier_kind === 'obligation_coverage'
      ? [{ focus: member.focus, selectedUnit: member.selected_unit }] : [];
  });
}

const tupleUnit = (wkId, tuple) => tuple.selectedUnit === null ? wkId : `${wkId}#${tuple.selectedUnit}`;

export function orderVerifyProofSourceChoices(choices) {
  const unique = new Map();
  for (const { unit, focus = null } of choices) {
    unique.set(JSON.stringify([unit, focus ?? '']), { unit, ...(focus === null ? {} : { focus }) });
  }
  return [...unique].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, choice]) => choice);
}

export function verifyProofSourceChoice(source) {
  return { unit: tupleUnit(source.wkId, source), ...(source.focus === null ? {} : { focus: source.focus }) };
}

function sourceChoices(wkId, matches) {
  return orderVerifyProofSourceChoices(matches.map(({ source }) =>
    ({ unit: tupleUnit(wkId, source), focus: source.focus })));
}

export async function resolveVerifyProofSourceBinding({ repoRoot, wkId, subject, source,
  authenticatedRole, authorizedUnit = null }) {
  const selection = parseVerifyProofSource({ subject, ...(source === undefined ? {} : { source }) });
  const population = verifyProofPopulationSubject(subject);
  const addressed = population !== null, explicit = population ?? selection;
  const refusal = { subject, ...(selection === null ? {} : { source_unit: selection.unit }) };
  let tuples;
  if (explicit !== null) {
    if (explicit.wkId !== wkId) fail('verify_proof.source_unit_forbidden.v1', { ...refusal, wk_id: wkId });
    tuples = [{ selectedUnit: explicit.selectedUnit, focus: selection?.focus ?? null }];
  } else {
    tuples = await canonicalSourceTuples(repoRoot, wkId);
  }
  const permitted = tuple => authenticatedRole === 'orchestrator' || tupleUnit(wkId, tuple) === authorizedUnit;
  if (explicit !== null && !permitted(tuples[0])) fail('verify_proof.source_unit_forbidden.v1', {
    ...refusal, authorized_unit: authorizedUnit
  });
  const matches = [];
  for (const tuple of tuples.filter(permitted)) {
    const source = await resolveSavedProofSource({ repoRoot, wkId, ...tuple }, { requireSource: true });
    const contract = await resolveDerivedProofContract(source);
    if (!contract) fail('verify_proof.native_binding_unavailable.v1', { subject });
    const canonicalContract = await readControlledContractCarrierFile({ repoRoot, wkId, focus: tuple.focus, carrierKind: 'contract' });
    const nativeIndex = createNativeVerificationIndex(contract.content);
    const proofs = contract.content.test_proofs ?? [];
    const proofMatches = proofs.filter(proof => proof.test_proof_id === subject);
    const obligationMatches = source.rows.filter(row => row.obligation_id === subject);
    if (proofMatches.length > 1 || proofMatches.length && obligationMatches.length) {
      fail('verify_proof.subject_ambiguous.v1', { subject });
    }
    const selected = addressed ? source.rows : obligationMatches.length ? obligationMatches :
      proofMatches.length ? source.rows.filter(row => resolveBehaviorAndVerificationPopulation(
        row, contract.content, nativeIndex).qualifying.includes(proofMatches[0].verification_claim_id)) : [];
    if (addressed || obligationMatches.length || proofMatches.length && selected.length) matches.push({
      source, contract, canonicalContract, selected, kind: addressed ? source.selectedUnit === null ? 'wk' : 'slice' :
        obligationMatches.length ? 'obligation' : 'test_proof'
    });
  }
  if (!matches.length) fail('verify_proof.subject_unknown.v1', { subject });
  if (matches.length !== 1) {
    const choices = sourceChoices(wkId, matches);
    fail('verify_proof.source_tuple_ambiguous.v1', { subject, match_count: matches.length,
      source_choices: choices, choice_count: choices.length });
  }
  const [match] = matches;

  return { ...match, resolve: async () => {
    const context = await resolveSavedProofContext(match.source);
    const { map } = await resolveProofExecutableMap(match.source.source.content, {
      ...context, obligation_ids: match.selected.map(row => row.obligation_id)
    });
    return map;
  } };
}

export async function resolveSavedProofRuntimeBindings({ source, contract, verificationIds }) {
  const generation = await readStableControlledContractGeneration({ repoRoot: source.repoRoot, wkId: source.wkId });
  const canonical = await readControlledContractCarrierFile({ repoRoot: source.repoRoot, wkId: source.wkId,
    focus: source.focus, carrierKind: 'contract' });
  const member = generation.carriers.find(entry => entry.filename === canonical.filename);
  if (!member || member.content_digest !== canonical.content_digest) fail('verify_proof.execution_source_stale.v1', {});
  return { ...resolveStableTestProofBindingPopulation({ contract: contract.content, verificationIds }),
    wk_id: source.wkId, focus: source.focus, filename: canonical.filename,
    content_digest: canonical.content_digest, derived_contract_digest: contract.content_digest,
    controlled_contract_generation: generation.projection.generation_digest,
    controlled_contract_generation_schema_version: generation.projection.schema_version,
    controlled_contract_generation_carrier_count: generation.projection.carrier_count,
    controlled_contract_generation_carriers: generation.carriers.map(({ filename, content_digest, source_member }) =>
      ({ filename, content_digest, source_member })) };
}
