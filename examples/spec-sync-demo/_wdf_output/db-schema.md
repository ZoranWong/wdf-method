---
artifact_type: db-schema
phase: 3
sub_phase: "phase_3_8"
---

# DB Schema — spec-sync-demo

> CHG-2026-015 S3: The `<!-- wdf:specs-sync:start -->` … `:end -->` block is
> regenerated from `_wdf_output/specs/*/spec.md` whenever
> `[specs] source_of_truth = true`. Hand-authored sections (triggers,
> extensions, migration files) are preserved.

<!-- wdf:specs-sync:start -->
<!-- (regenerated from _wdf_output/specs/*/spec.md by forwardSyncDbSchema) -->
<!-- wdf:specs-sync:end -->

## Required extensions

- `uuid-ossp` — for `uuid_generate_v4()` used in primary keys
- `citext` — for case-insensitive email columns

## Performance notes

Hand-authored indexes and query patterns live here; not regenerated.
