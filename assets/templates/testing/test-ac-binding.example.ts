/**
 * test-ac-binding.example.ts — Reference for AC ↔ Test binding.
 *
 * Two conventions are accepted by the wdf-method AC binding scanner:
 *
 *   1. Name-prefix:        the test name starts with "AC-N: …"
 *   2. Comment annotation: a `// @ac AC-N` line directly precedes the test
 *
 * Use whichever fits the local style. They can be mixed within a file.
 *
 * Run:        npx vitest run --reporter=json
 * Validate:   wdf cr ac-check <story>           (CHG-2026-005)
 */

import { describe, it, test, expect } from 'vitest';

// Suppose your story declares:
//   acceptance_criteria: [AC-1, AC-2, AC-3, AC-4, AC-5]

describe('signup endpoint', () => {

  // ── Convention 1: name-prefix ────────────────────────────────────
  it('AC-1: rejects malformed email with 400', () => {
    expect(true).toBe(true);
  });

  it('AC-2: returns 409 when email already taken', () => {
    expect(true).toBe(true);
  });

  // ── Convention 2: comment annotation ─────────────────────────────
  // @ac AC-3
  it('hashes the password with argon2id', () => {
    expect(true).toBe(true);
  });

  // ── Multiple ACs covered by one test (annotate both) ─────────────
  // @ac AC-4
  // @ac AC-5
  it('emits a verification email and creates the user atomically', () => {
    expect(true).toBe(true);
  });

  // ── Negative example: NO BINDING ─────────────────────────────────
  // This test is unrelated to any AC. The scanner ignores it.
  // If your story has an AC that this test was meant to cover, add a
  // `// @ac AC-N` annotation above it or rename to `AC-N: …`.
  it('logs request id', () => {
    expect(true).toBe(true);
  });
});

// ─── Anti-patterns the scanner will reject ─────────────────────────
//
//   it('AC-1', () => {});                  // missing colon — not bound
//   it('AC1: missing dash', () => {});     // missing dash — not bound
//   // @story AC-1                         // wrong tag — not @ac
//   it('foo', () => {});
//
// Stick to the canonical "AC-N: ..." or "// @ac AC-N" forms above.
