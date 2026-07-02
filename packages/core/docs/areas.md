
# Areas

An **area** is a canonical record that describes a durable boundary or domain of
the repository — a subsystem, package, or long-lived topic. Each area is one
authoritative orientation page: what this part of the system is, where its entry
points are, and which canonical docs, initiatives, and decisions touch it.

Areas live under `wiki/areas/` as slug-based Markdown pages (for example,
`wiki/areas/wiki-core.md`). See `packages/wiki-core/contract/schema.md` for the
canonical contract and `wiki/areas/wiki-core.md` for a worked example.

## How an area differs from the other record types

The wiki has several canonical record families. Most of them are about *work* or
*rules*; an area is about *place*.

| Record | Axis | Answers |
| --- | --- | --- |
| `WK-*` work records | work | what needs doing, its scope and status (churns; has a lifecycle) |
| `IN-*` initiatives | grouped work | what body of work, toward what goal |
| `DEC-*` decisions | rules | the ratified constraint or boundary |
| `SRC-*` sources | provenance | the external evidence or input |
| **area** | **place** | **what this subsystem is, and what canonical context relates to it** |

`WK-*`, `IN-*`, `DEC-*`, and `SRC-*` carry monotonic allocated IDs because they
are events in the system's history. An area instead uses a **slug** (for example
`wiki-core`) because it names a durable boundary, not a unit of work. The slug is
the area's identity and should remain stable once created; renaming it breaks
references.

## When to author an area

Author an area when a subsystem or boundary is durable enough that readers —
human or agent — repeatedly need orientation on it: its purpose, entry points,
and the canonical docs, initiatives, and decisions that bind it. Authoring is
infrequent and deliberate.

Do **not** use an area for transient work (use a `WK-*`) or for a one-off ruling
(use a `DEC-*`). An area aggregates and points at those records; it does not
replace them.

## How to author an area

Create the record through the same structured create route used for issues,
initiatives, decisions, and sources — areas share that create/template path but
are slug-identified, not allocator-numbered:

- `workspace_create_record` with `type=area`. The title becomes the slug, and the
  slug is the area's identity; the `id`, `title`, and `updated` front-matter
  fields are populated for you by the create route.

Then fill in the page:

- **Front matter** — `owners`, plus the canonical cross-links the area
  aggregates: `docs`, `initiatives`, `sources`, `decisions`, and `related`.
- **Body** — a short `Summary`, then the active issues, active initiatives, key
  docs, and notes/entry points for the subsystem.

Validate and cross-link with `workspace_generate_and_lint`: that route validates
the area and cross-links it into the generated retrieval entrypoint
(`wiki/catalog.md`). Well-formedness is enforced by lint and validation, so there is no separate
structured field-editor for areas: like `DEC-*` and `SRC-*` pages, an area is
hand-edited Markdown kept well-formed under lint.

## What areas are for

- **Retrieval hub.** An area is a stable place a reader lands to orient on a
  subsystem instead of reassembling that context from scattered records. The
  retrieval order in `AGENTS.md` directs agents to check `wiki/areas/` for
  durable boundaries and entry points.
- **Canonical source for generated package READMEs.** Areas are intended to be
  the single source from which package-root READMEs are projected
  deterministically. The README projection is generated from canonical JSON
  work-record metadata, not authored as prose inside area records. The same
  can't-drift pattern used for `wiki/catalog.md` applies here; the projection
  generator is not yet shipped, so an area
  remains a canonical orientation page on its own until that generator lands.

## Package README roadmap projection

Package README `## Roadmap` sections are generated from canonical JSON WK
metadata for the area or package target. They are not hand-edited.

- **Inclusion.** Include area-associated canonical JSON work records whose
  status is `inbox`, `todo`, `active`, `review`, or `blocked`.
- **Exclusion.** Exclude `done`, `cancelled`, and `parked` work records.
