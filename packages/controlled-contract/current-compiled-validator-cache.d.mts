export const COMPILED_VALIDATOR_CACHE_FORMAT_VERSION: string;

export interface CompiledValidatorCacheGroupStatus {
  readonly group_id: string;
  readonly schema_digest: string;
  readonly directory: string;
  readonly result: "hit" | "miss";
  readonly published: boolean;
  readonly contended: boolean;
  /** The typed code of the invalid artifact this group replaced, if any. */
  readonly replaced_invalid: string | null;
}

export interface CompiledValidatorCacheStatus {
  readonly result: "hit" | "miss";
  readonly mode: "ensure" | "verify" | "resolve";
  readonly cache_root: string;
  readonly directory: string;
  /** The toolchain identity digest. Schema identity is carried per group. */
  readonly identity_digest: string;
  readonly toolchain_digest: string;
  readonly group_count: number;
  readonly groups: readonly CompiledValidatorCacheGroupStatus[];
  readonly published: boolean;
  readonly contended: boolean;
  readonly generation: Readonly<{
    ajv_compilations: number;
    groups_compiled: number;
    groups_reused: number;
    groups_replaced_invalid: number;
    publication_error: Readonly<{ code: string | null; message: string | null }> | null;
  }> | null;
  readonly ajv_module_loaded: boolean;
  readonly ajv_compilations: number;
}

export class CompiledValidatorCacheError extends Error {
  readonly name: "CompiledValidatorCacheError";
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export function compiledValidatorCacheRoot(): string;

export function compiledValidatorCacheStatus(): CompiledValidatorCacheStatus | null;

export function loadCompiledValidatorCache(): Promise<CompiledValidatorCacheStatus>;

export function prepareCompiledValidatorCache(options?: {
  mode?: "ensure" | "verify";
  cacheRoot?: string;
}): Promise<CompiledValidatorCacheStatus & {
  readonly mode: "ensure" | "verify";
  readonly isolated_cache_root: boolean;
}>;
