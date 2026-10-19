

import { projectRequirementDefinitionMeaning } from '@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-description-sources.mjs';
export function readWikiContractMeaning({ content_digest: _revision, source_identity: _source,
  contract_content_digest: _contract, meaning_identity: _meaning, schema_version: _schema,
  view: _view, ...meaning }) {
  return projectRequirementDefinitionMeaning(meaning);
}
