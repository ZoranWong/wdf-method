/**
 * command-safety.ts
 *
 * Shared, pure utilities for validating shell commands and identifiers used
 * throughout the orchestrator (story IDs, branch names, acceptance commands,
 * pre-flight commands, etc.).
 *
 * These helpers MUST remain:
 *   - Pure (no I/O, no fs, no process state).
 *   - Deterministic (same input → same output, no time/random).
 *   - Defensive: deny-by-default for anything outside an explicit allow set.
 *
 * Two layers of protection are provided:
 *   1. assertSafeIdentifier — for short symbolic strings (story IDs, branch
 *      names, file path fragments) that will be embedded in shell-adjacent
 *      operations. Throws on any unsafe character or path traversal sequence.
 *   2. validateCommand — for full command strings that will be executed as
 *      acceptance / pre-flight steps. Returns a structured ok/reason result
 *      so callers can surface human-readable explanations without exception
 *      handling on every call site.
 */
/**
 * Maximum permitted length for an identifier passed to `assertSafeIdentifier`.
 * Long enough to accommodate realistic branch/story IDs (e.g.
 * `feature/epic-12/story-3.4.5-something-descriptive`) without allowing
 * pathological inputs that could degrade downstream regex / logging paths.
 */
export declare const MAX_IDENTIFIER_LENGTH = 200;
/**
 * Maximum permitted length for a command string passed to `validateCommand`.
 * Generous, but bounded to prevent unbounded memory / log growth.
 */
export declare const MAX_COMMAND_LENGTH = 2000;
/**
 * Result of validating a command string.
 */
export interface CommandValidationResult {
    ok: boolean;
    reason?: string;
}
/**
 * Throw if `value` is not a safe identifier.
 *
 * Safe identifiers are non-empty strings consisting solely of ASCII
 * alphanumerics and the characters `_`, `-`, `/`, `.`, with no embedded
 * `..` (path traversal) and no leading `/` (absolute path). Length is
 * capped at `MAX_IDENTIFIER_LENGTH`.
 *
 * @param value - The candidate identifier (story ID, branch name, etc.).
 * @param label - Human-readable label for error messages.
 * @throws Error if `value` is empty, too long, contains unsafe characters,
 *   or contains a path-traversal sequence.
 */
export declare function assertSafeIdentifier(value: string, label: string): void;
/**
 * Validate a full command string against the allowlist + denylist.
 *
 * Returns `{ ok: true }` only when:
 *   - The command is a non-empty, reasonably-sized string.
 *   - It begins with one of the allowed prefixes (case-sensitive, strict
 *     boundary — `npm run` matches `npm run build` but not `npm runfoo`).
 *   - It contains none of the forbidden substrings (pipes, redirection,
 *     command substitution, sudo, curl, etc.).
 *
 * @param command - The full command string to validate.
 * @returns Structured result with optional human-readable reason on failure.
 */
export declare function validateCommand(command: string): CommandValidationResult;
/**
 * Read-only view of the allowlist (exported for test/diagnostic use).
 */
export declare const ALLOWED_COMMAND_PREFIXES: readonly string[];
/**
 * Read-only view of the denylist (exported for test/diagnostic use).
 */
export declare const FORBIDDEN_COMMAND_TOKENS: readonly string[];
//# sourceMappingURL=command-safety.d.ts.map