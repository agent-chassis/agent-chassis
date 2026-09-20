import { loadCurrentParameterPopulation } from '../lib/pack-parameter-loader.mjs';
import { renderParameterDocumentationSet, checkParameterDocumentation,
  writeParameterDocumentation } from '../lib/pack-parameter-documentation.mjs';

const [mode, directory, ...extra] = process.argv.slice(2);
if (!['--check', '--write'].includes(mode) || !directory || extra.length) {
  throw new Error('usage: proof-pack-parameter-docs.mjs --check|--write <documentation-directory>');
}
const expected = renderParameterDocumentationSet(await loadCurrentParameterPopulation());
const result = mode === '--check' ? await checkParameterDocumentation(directory, expected)
  : await writeParameterDocumentation(directory, expected);
process.stdout.write(`${JSON.stringify({ ...result, files: expected.size })}\n`);
if (!result.passed) process.exitCode = 1;
