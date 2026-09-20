import { assertAdmittedProofPackSnapshot,
  loadExactAdmittedProofPack, readProofPackCatalog } from './admitted-proof-packs.mjs';
import { validatePackParameterContract } from './pack-parameter-contract.mjs';
import { parameterFailure, validateParameterDependencies } from './pack-parameter-coverage.mjs';

export function loadPackParameterContract(admittedPack) {
  assertAdmittedProofPackSnapshot(admittedPack);
  if (!admittedPack.parameter_contract) parameterFailure('companion_missing', '/parameter_contract',
    'the admitted snapshot does not carry its required parameter contract');
  return validatePackParameterContract(admittedPack.parameter_contract, admittedPack.profile);
}

export async function loadCurrentParameterPopulation() {
  const catalog = await readProofPackCatalog();
  const packs = await Promise.all(catalog.packs.map(p => loadExactAdmittedProofPack({
    profileId: p.profile_id, profileVersion: p.profile_version })));
  packs.sort((a, b) => {
    const left = `${a.profile.profile_id}@${a.profile.profile_version}`;
    const right = `${b.profile.profile_id}@${b.profile.profile_version}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const contracts = packs.map(loadPackParameterContract);
  validateParameterDependencies(contracts);
  return packs.map((pack, index) => ({ pack, contract: contracts[index] }));
}
