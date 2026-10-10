# Search Source Inventory

`readSearchInventory` is an internal operation of
`packages/wiki-core/src/operations/search.mjs`. It returns the complete
population of one captured search generation, unpaged, with an exact total. It
is not a registered MCP route and has no CLI entrypoint; `workspace_search_repo`
remains the registered ranked search.

## Request

`readSearchInventory(options)` accepts:

| Field | Meaning |
| --- | --- |
| `dir` | The source root to capture. The caller chooses it; a caller holding frozen-source authority passes the frozen root. The operation resolves no root itself. |
| `repository` | The registered repository identity, or omitted. Entry versions are members only when it is supplied. |
| `profile`, `extensionNamespaces` | The same projection context `searchRepo` accepts. |
| `history` | `true` adds superseded entry versions. Requires `repository`. |
| `query` | Optional. When supplied it must be a nonempty string. |
| filters | Any member of `FILTER_KEYS`. |

`FILTER_KEYS` and `normalizeFilters`, exported from the same module, are the
one filter vocabulary and normalizer. `searchRepo` and `readSearchInventory`
both normalize through `normalizeFilters`, and the MCP `SEARCH_FILTER_FIELDS`
list is `FILTER_KEYS` plus the route's `history`, `profile`,
`extensionNamespaces` and `limit` controls. Every value is lowercased except
`initiative`; absent and `null` values are not filters. Without an explicit
`retrieval_visibility` filter, suppressed sources are excluded.

## Population

With a query, the members are every match `rankLexicalSearchResults` returns
for the filtered population, in its order: score, then authority, then path,
with remaining ties in corpus order. Lower-ranked matches are members; nothing
is truncated to a page. Each member carries its `score`.

Without a query, every filter-matching canonical passage and entry version is
a member exactly once, whether or not any text would match lexically. An empty
source contributes its one empty passage. Members are in corpus order: sources
by sorted path, each source's passages in source order, then entry versions.
Members carry no `score`. The queryless population is not a wildcard query and
is not ranked.

## Result

| Field | Meaning |
| --- | --- |
| `repository`, `query`, `history`, `filters` | The effective request; `filters` is the normalized form. |
| `total_count` | Exactly `members.length`. |
| `source_signature`, `context_digest` | Identity of the captured generation and its projection context. |
| `indexState`, `indexStateReason` | The state of the persisted index only: `existing`, or `rebuilt_in_memory` with `index_missing`, `index_version_mismatch` or `source_signature_mismatch`. It does not describe where members came from. |
| `diagnostics` | The same diagnostics `searchRepo` reports, including each entry version whose content could not resolve, with its unit, entry and version. |
| `members` | The population. |

Each member has `relativePath`, `id`, `title`, `heading`, `metadata`, the
complete original `text`, and a `source` identity:

- A canonical passage: `kind: "search_source"`, `source_id`, `source_digest`,
  `location` and `scalar_length`.
- An entry version: `kind: "work_record_entry"`, `unit`, `entry_id`,
  `version_id`, `entry_kind`, `source_digest`, `scalar_length`, `utf8_bytes`,
  `reference` and `source_closure`.

`text` is the original passage or rendered entry text, with its Unicode and
whitespace unchanged. `source_digest` is the SHA-256 of the captured bytes of
the file at `relativePath`.

## Source Binding

One call makes one `loadLexicalSearchIndexForRead` call with
`capturedContent: true`. That loader captures the corpus once, and the
canonical passages, the entry versions and the freshness signature are all
projected from that capture. The operation does not scan or open a source
itself. A later call captures again; an earlier result is not updated.

The persisted index never supplies member content. It is still read, so a
malformed current-version index still fails, and its state is reported, but
its chunks are not used even when its signature matches the capture: a
persisted index that omits a chunk or carries altered text cannot change
`members`, `text`, `source_digest` or `total_count`. Ranked search
(`searchRepo`) keeps using a current persisted index for its passages.

The process-local preparation the loader keeps is reused only while the
captured signature is unchanged, so reused passages have the captured digests.

The inventory writes nothing. A missing, stale or different-version persisted
index adds a warning diagnostic. Only the index writer (`buildSearchIndex`)
creates or replaces `.cache/wiki-search/index.json`.

Sources that the census does not enumerate, such as a symbolic link in place
of a source file, are not members.

## Failures

Failures propagate unchanged from their owners. None is converted into an
empty or partial result.

| Condition | Failure |
| --- | --- |
| `query` supplied but empty or not a string | `search_inventory_query_invalid` |
| `history: true` without `repository` | `work_record_entry_search_requires_repository` |
| Query with no searchable term | `search requires a non-empty textual query` |
| Unreadable or malformed current-version persisted index | `search_index_read_failed`; an operator rebuilds it |
| Source unreadable, not regular, not UTF-8, or changed during capture | `search_source_unreadable`, `search_source_not_regular`, `search_source_invalid_utf8`, `search_source_changed` |
| Canonical JSON source that does not parse or validate | `Invalid canonical search source <path>`; a record failing validation carries `search_source_invalid_canonical_record` |
| Entry version whose content cannot resolve | Not a member; reported in `diagnostics` with its exact identity |
