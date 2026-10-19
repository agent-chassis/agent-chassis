import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROLLED_ACCEPTANCE_PUBLICATION_ENV as KEY, resolveControlledAcceptancePublication,
  createExceptionPublication } from '../../packages/wiki-core/src/lib/controlled-acceptance-publication-config.mjs';
import { sessionExceptionKinds } from '../../packages/wiki-mcp/src/lib/record-authoring-session-exposure.mjs';
import { sessionRequirementAuthoringGuidance } from '../../packages/wiki-mcp/src/lib/requirement-authoring-guidance.mjs';

test('publication is on when unset; only exact boolean spellings are configuration', () => {
  for (const [value, expected] of [[undefined, true], ['true', true], ['false', false]]) {
    assert.equal(resolveControlledAcceptancePublication(value === undefined ? {} : { [KEY]: value }), expected);
  }
  for (const value of ['', '0', '1', 'FALSE', 'True', ' false ', false, null]) {
    assert.throws(() => resolveControlledAcceptancePublication({ [KEY]: value }),
      { code: 'controlled_acceptance_publication_config_invalid' });
  }
});

test('one publication filter composes with tier capabilities and changes only whole-unit guidance', () => {
  const kinds = ['proof', 'grammar', 'controlled_acceptance'];
  for (const tier of ['paid_cce', 'free_local']) {
    const off = createExceptionPublication(false), on = createExceptionPublication(true);
    assert.deepEqual(off.kinds(sessionExceptionKinds(tier, kinds)), tier === 'paid_cce' ? ['proof', 'grammar'] : ['proof']);
    assert.deepEqual(on.kinds(sessionExceptionKinds(tier, kinds)), sessionExceptionKinds(tier, kinds));
    const enabled = sessionRequirementAuthoringGuidance(tier, on);
    const disabled = sessionRequirementAuthoringGuidance(tier, off);
    if (tier === 'paid_cce') assert.deepEqual(disabled, enabled);
    else {
      assert.match(enabled.ordinary_authoring.applicability, /deliberate opt-out/);
      assert.doesNotMatch(disabled.ordinary_authoring.applicability, /opt-out/);
      assert.deepEqual({ ...disabled.ordinary_authoring, applicability: null },
        { ...enabled.ordinary_authoring, applicability: null });
    }
  }
});
