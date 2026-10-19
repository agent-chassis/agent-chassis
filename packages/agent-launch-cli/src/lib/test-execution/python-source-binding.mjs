

import { fileURLToPath } from 'node:url';

export const PYTHON_SOURCE_BINDING_ASSET = fileURLToPath(
  new URL('./python_source_binding.py', import.meta.url));

export function bindPythonInvocation(args, { repositoryRoot, checkoutRoot }) {
  const flags = [];
  let offset = 0;
  while (['-I', '-B'].includes(args[offset])) flags.push(args[offset++]);
  if (!flags.includes('-B')) flags.push('-B');
  return [...flags, PYTHON_SOURCE_BINDING_ASSET, repositoryRoot, checkoutRoot, ...args.slice(offset)];
}
