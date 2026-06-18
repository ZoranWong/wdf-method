# CR Delta Workflow

This document describes the **Spec Delta** governance model introduced in
wdf-method 3.7.0 (CHG-2026-002). A Change Request (CR) now carries a
machine-readable `delta.yaml` alongside its `proposal.md`, enabling automated,
auditable changes to specs, schemas, and config.

## TL;DR

```
1. Copy template:    cp changes/.template/delta.yaml.example changes/CHG-YYYY-NNN/delta.yaml
2. Edit operations:  describe field-level changes in YAML
3. Preview:          wdf cr apply CHG-YYYY-NNN --dry-run
4. Apply:            wdf cr apply CHG-YYYY-NNN
5. Commit:           git diff && git commit -am "apply CHG-YYYY-NNN"
6. Archive (later):  wdf cr archive CHG-YYYY-NNN
```

## Why delta.yaml?

Before 3.7, every CR was free-form prose. Reviewers had to manually translate
"add a new key to customize.toml" into a code change, and the relationship
between proposal text and the eventual diff was lost.

A delta makes the modification surface explicit:

- **Diffable** — a YAML file lives in version control next to the proposal.
- **Applyable** — `wdf cr apply` converts the delta into file edits with no human translation step.
- **Reversible** — the same operations describe what would need to be undone.
- **Auditable** — traceability tools (CHG-2026-003) can join CRs to the artifacts they touched.

## When is a delta required?

| CR scope | delta.yaml |
|---|---|
| Schema, customize.toml, or SPEC.md edits | **required** |
| New skill / command / template files | **required** (use `op: create`) |
| Pure code refactors (orchestrator internals) | optional |
| Documentation-only updates | optional |

`customize.toml` flag `change_request.delta_required = true` enforces this at
review time once CHG-002 ships.

## File layout

```
changes/
├── INDEX.md
├── .template/
│   ├── proposal.md
│   └── delta.yaml.example      ← copy this when authoring a delta
├── CHG-2026-001-engine-hardening/
│   ├── proposal.md
│   └── delta.yaml              ← reference example
├── CHG-2026-002-spec-delta/
│   ├── proposal.md
│   └── delta.yaml
└── _archive/                   ← merged + aged-out CRs
    └── CHG-…/
```

## Operation types

Six op types cover the surface area of wdf-method artifacts. See
`schemas/change-delta-schema.yaml` for the authoritative definition.

| Op | Target kinds | Purpose |
|---|---|---|
| `set` | `toml_key`, `yaml_key` | Set a leaf key (creates if missing) |
| `remove` | `toml_key`, `yaml_key`, `text_match` | Drop a key or substring |
| `modify` | `spec_section`, `text_match` | Replace a unique literal `before` with `after` |
| `append` | `spec_section` | Add content to the end of a markdown section |
| `create` | `file` | Create a new file (fails if it exists) |
| `delete` | `file` | Delete a file (optional `expected_hash`) |

### Path syntax (toml_key / yaml_key)

```
change_request.delta_required             → top-level table key
acceptance_gates.code_acceptance.coverage → nested
a."b.c".d                                 → quoted segment with literal dot
```

### Section locator (spec_section)

The `section` field is the **full heading line** including its markdown prefix:

```yaml
target:
  kind: spec_section
  file: SPEC.md
  section: "## 7. Change Request 流程"
```

A section spans from its heading line up to the next heading at the same or
higher level. Within that span, `before` text must occur exactly once for a
`modify` op to succeed.

## Apply semantics

1. **Plan-then-write.** `apply` first builds an in-memory plan; the disk is
   only touched after every op plans successfully. Any failure aborts the
   whole delta.
2. **Atomic per file.** Multiple ops on the same file compose against a single
   buffered copy and are written once at the end.
3. **Format-preserving.** TOML and YAML edits are surgical text rewrites;
   comments and ordering survive.
4. **Uniqueness-checked.** `modify` and `text_match` require their `before`
   string to occur exactly once. If you need to change repeated text, scope
   it via `spec_section` or include surrounding context in `before`.
5. **Path-safe.** Targets must be relative paths inside the project root.
   Absolute paths and `..` traversal are rejected at validation time.

## Dry-run

Always preview first:

```bash
wdf cr apply CHG-2026-002 --dry-run
```

The plan summary lists every file that would change and why. Add `--diff` (or
rely on `--dry-run`'s default diff output) to inspect the unified diff before
committing.

## Common pitfalls

- **Non-unique `before`** — happens when literal text repeats. Add context
  lines or switch to `spec_section`.
- **Section heading mismatch** — `section` must match the file *exactly*,
  including the leading `##` and any trailing punctuation. Copy from the
  source file.
- **Ordering matters** — ops on the same file are applied top-to-bottom on
  the buffered text; an `append` after a `modify` sees the modified content.
- **`create` on an existing file** — fails fast. Use `modify` / `append` to
  edit existing files, or add a `delete` op first if a full rewrite is
  intentional.
- **`expected_hash` drift** — the hash is checked against the current file
  contents; if upstream changed since you wrote the delta, regenerate the
  hash or remove the precondition.

## Authoring workflow

1. **Branch.** `git checkout -b cr/CHG-YYYY-NNN-<slug>`
2. **Proposal.** Author `proposal.md` from `.template/proposal.md`.
3. **Delta.** Copy `.template/delta.yaml.example` and trim to the ops you need.
4. **Preview.** `wdf cr apply <id> --dry-run` until the diff matches intent.
5. **Apply locally.** `wdf cr apply <id>` writes the changes.
6. **Tests.** Run the suite; the orchestrator must continue to pass.
7. **Commit.** Include `proposal.md`, `delta.yaml`, and the resulting file
   edits in the same commit so reviewers can correlate them.
8. **Review.** Reviewers re-apply the delta on a clean checkout to verify
   reproducibility.
9. **Merge → IMPLEMENTED.** Update `changes/INDEX.md` status.

## Archive flow

After a CR has shipped (status `IMPLEMENTED`) and at least one minor version
has cut, archive it to keep `changes/` lean:

```bash
wdf cr archive CHG-2026-001
# moves changes/CHG-2026-001-engine-hardening → changes/_archive/CHG-2026-001-engine-hardening
```

The archive is rename-only; both `proposal.md` and `delta.yaml` remain
addressable from `changes/_archive/<id>/`.

## Reference example

`changes/CHG-2026-001-engine-hardening/delta.yaml` is a back-filled delta for
the engine hardening CR. Use it as a template for non-trivial deltas that mix
multiple op kinds.

## Related specs

- `schemas/change-delta-schema.yaml` — schema definition (authoritative)
- `schemas/change-request-schema.yaml` — CR proposal frontmatter
- `orchestrator/src/orchestrator/cr-applier.ts` — implementation
- `orchestrator/src/orchestrator/cr-applier.test.ts` — semantics tests
- `commands/wdf-cr.md` — slash-command surface
- `docs/plans/2026-06-17-standardization-automation-roadmap.md` — OPT-01 motivation
