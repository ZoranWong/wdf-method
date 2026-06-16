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
export const MAX_IDENTIFIER_LENGTH = 200;
/**
 * Maximum permitted length for a command string passed to `validateCommand`.
 * Generous, but bounded to prevent unbounded memory / log growth.
 */
export const MAX_COMMAND_LENGTH = 2_000;
/**
 * Allowed identifier characters: ASCII letters, digits, and a small set of
 * structural punctuation (`_`, `-`, `/`, `.`). No spaces, no shell
 * metacharacters, no unicode confusables.
 */
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9_\-/.]+$/;
/**
 * Path traversal sequence — rejected anywhere in an identifier.
 */
const PATH_TRAVERSAL = '..';
/**
 * Strict-prefix allowlist of executable commands. Each entry is matched
 * against the full command string with a trailing space OR exact equality
 * (so `npm runfoo` does NOT match `npm run`). Case-sensitive.
 */
const ALLOWED_PREFIXES = [
    'npm run',
    'npm test',
    'npx --no-install',
    'node',
    'jest',
    'vitest',
    'tsc',
    'eslint',
];
/**
 * Forbidden literal substrings. Presence anywhere in the command rejects it.
 * Includes shell control operators, command substitution, redirection,
 * privilege escalation, network fetch, and destructive primitives.
 */
// Order matters: longer compound tokens (`&&`, `||`, `rm -rf`) appear before
// their single-character supersets (`|`) so the surfaced reason names the
// most-specific match. Functionally any ordering rejects the command, but
// callers and tests benefit from the precise token in the message.
const FORBIDDEN_SUBSTRINGS = [
    '&&',
    '||',
    'rm -rf',
    '$(',
    '|',
    ';',
    '`',
    '>',
    '<',
    'curl',
    'sudo',
    'eval',
    'chmod',
    'chown',
];
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
export function assertSafeIdentifier(value, label) {
    if (typeof value !== 'string') {
        throw new Error(`${label}: must be a string`);
    }
    if (value.length === 0) {
        throw new Error(`${label}: must not be empty`);
    }
    if (value.length > MAX_IDENTIFIER_LENGTH) {
        throw new Error(`${label}: exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters`);
    }
    if (!SAFE_IDENTIFIER_RE.test(value)) {
        throw new Error(`${label}: contains unsafe characters (allowed: A-Z a-z 0-9 _ - / .)`);
    }
    // Reject path traversal both as a literal substring (covers `..`, `../`,
    // `foo/../bar`) and as a leading absolute path.
    if (value === PATH_TRAVERSAL || value.includes(PATH_TRAVERSAL)) {
        throw new Error(`${label}: path traversal sequence ".." is not allowed`);
    }
    if (value.startsWith('/')) {
        throw new Error(`${label}: absolute paths are not allowed`);
    }
}
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
export function validateCommand(command) {
    if (typeof command !== 'string') {
        return { ok: false, reason: 'command must be a string' };
    }
    // Reject leading/trailing whitespace differences by checking the raw
    // string. We do NOT trim — a command with surrounding whitespace is
    // suspicious and should be normalised by the caller.
    if (command.length === 0) {
        return { ok: false, reason: 'command must not be empty' };
    }
    if (command.trim().length === 0) {
        return { ok: false, reason: 'command must not be whitespace-only' };
    }
    if (command.length > MAX_COMMAND_LENGTH) {
        return {
            ok: false,
            reason: `command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters`,
        };
    }
    // Reject control characters (newline, tab, NUL, ESC, etc.) — these can
    // smuggle additional commands past naive checks in downstream tooling.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1F\x7F]/.test(command)) {
        return { ok: false, reason: 'command contains control characters' };
    }
    // Forbidden substrings — checked before allowlist so a denied token in an
    // otherwise-allowed command surfaces the precise reason.
    for (const bad of FORBIDDEN_SUBSTRINGS) {
        if (command.includes(bad)) {
            return {
                ok: false,
                reason: `command contains forbidden token: "${bad}"`,
            };
        }
    }
    // Allowlist: must start with one of the approved prefixes, followed by
    // either end-of-string or a space (no character glue-on like `npm runfoo`).
    const matchedPrefix = ALLOWED_PREFIXES.find((prefix) => command === prefix ||
        command.startsWith(prefix + ' ') ||
        command.startsWith(prefix + '\t'));
    if (!matchedPrefix) {
        return {
            ok: false,
            reason: `command does not start with an allowed prefix (${ALLOWED_PREFIXES.join(', ')})`,
        };
    }
    return { ok: true };
}
/**
 * Read-only view of the allowlist (exported for test/diagnostic use).
 */
export const ALLOWED_COMMAND_PREFIXES = ALLOWED_PREFIXES;
/**
 * Read-only view of the denylist (exported for test/diagnostic use).
 */
export const FORBIDDEN_COMMAND_TOKENS = FORBIDDEN_SUBSTRINGS;
//# sourceMappingURL=command-safety.js.map