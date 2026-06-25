/**
 * hooks-cmd — manage git hooks that enforce wdf-method invariants at
 * commit / push time, rather than after the fact in CI.
 *
 * Why this exists:
 *   The framework has extensive in-flight gates (SRG, traceability, lint)
 *   but they all run post-hoc. A commit-msg hook catches the most common
 *   invariant violation *before* the bad commit enters the graph:
 *   commits tagged `[story:S-XXX]` must reference a story that:
 *     1. exists in `_wdf_output/stories/<id>.md`
 *     2. declares a REQ mapping (`maps_to_req:` or `refs:` frontmatter)
 *     3. (optional, when --strict) is `ready-for-dev` per its status file
 *
 * Design:
 *   - installHooks() writes `.git/hooks/commit-msg` with a `# wdf-hook:…`
 *     marker so reinstall / uninstall are idempotent. The hook body is a
 *     self-contained shell script that calls back into this CLI at
 *     `hooks check-commit-msg <msg-file>`.
 *   - checkCommitMsg() is pure-function friendly (takes cwd + msg string)
 *     so it can be unit-tested without touching disk or git.
 *   - uninstallHooks() strips the tagged section, leaving any user edits
 *     outside the tag intact.
 *
 * Progressive strictness:
 *   Commit messages without a `[story:...]` tag are always accepted —
 *   this keeps master writable for framework chores / docs while Phase-4
 *   stories get the tighter validation. Toggle `--strict` to require
 *   every commit to be tagged.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
} from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';

const HOOK_TAG = '# wdf-hook:commit-msg:v1';
const HOOK_PATH_RELATIVE = '.git/hooks/commit-msg';
const HOOK_BEGIN = '# --- wdf-hook:begin ---';
const HOOK_END = '# --- wdf-hook:end ---';

export interface InstallHooksOpts {
  projectRoot: string;
  /** Absolute path to the wdf CLI entry script (e.g. /path/to/orchestrator/dist/orchestrator/index.js) */
  cliPath: string;
  /** Force reinstall even if an existing hook has no tag. */
  force?: boolean;
  /** When true, require every commit to carry a `[story:...]` tag. */
  strict?: boolean;
}

export interface InstallHooksResult {
  installed: boolean;
  hookPath: string;
  /** True if we replaced a pre-existing hook (rather than creating fresh). */
  replaced: boolean;
  /** Human-readable note for the user (e.g. "replaced untagged hook; old contents at .git/hooks/commit-msg.wdf-backup"). */
  note?: string;
}

export interface UninstallHooksResult {
  removed: boolean;
  hookPath: string;
  /** True if the hook had a non-wdf user section we preserved. */
  preserved_user_section: boolean;
}

export interface CheckCommitMsgOpts {
  /** Raw commit message (with trailing newline stripped). */
  message: string;
  /** Project root where `_wdf_output/stories/` lives. */
  projectRoot: string;
  /** When true, commits without a story tag are rejected. */
  strict?: boolean;
}

export interface CheckCommitMsgResult {
  ok: boolean;
  /** Present iff ok === false; user-facing explanation. */
  reason?: string;
  /** Parsed story id, if the message contained one. */
  story_id?: string;
  /** The REQ ids the story maps to, if we found any. */
  req_ids?: string[];
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Install a commit-msg hook at `<projectRoot>/.git/hooks/commit-msg`.
 *
 * Idempotent: if the hook already exists AND carries our tag, we replace
 * the tagged block in place (preserving any user code outside it). If the
 * existing hook has no tag and `force` is false, we refuse and return
 * `{ installed: false }` with a note — users must either pass `--force`
 * or move aside the existing hook manually.
 */
export function installHooks(opts: InstallHooksOpts): InstallHooksResult {
  const hookPath = join(opts.projectRoot, HOOK_PATH_RELATIVE);
  const gitDir = join(opts.projectRoot, '.git');
  if (!existsSync(gitDir)) {
    throw new Error(`Not a git repository: ${opts.projectRoot}`);
  }

  const script = renderHookScript(opts.cliPath, opts.strict ?? false);
  let replaced = false;
  let note: string | undefined;

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes(HOOK_TAG)) {
      // Idempotent re-install — replace the tagged block.
      const updated = replaceTaggedBlock(existing, script);
      writeFileSync(hookPath, updated, 'utf8');
      chmodHook(hookPath);
      replaced = true;
    } else if (opts.force) {
      const backup = `${hookPath}.wdf-backup`;
      writeFileSync(backup, existing, 'utf8');
      writeFileSync(hookPath, script, 'utf8');
      chmodHook(hookPath);
      replaced = true;
      note = `replaced untagged hook; old contents preserved at ${backup}`;
    } else {
      return {
        installed: false,
        hookPath,
        replaced: false,
        note: `refusing to overwrite existing ${HOOK_PATH_RELATIVE} — pass --force to replace (old contents will be backed up to ${HOOK_PATH_RELATIVE}.wdf-backup)`,
      };
    }
  } else {
    mkdirSync(dirname(hookPath), { recursive: true });
    writeFileSync(hookPath, script, 'utf8');
    chmodHook(hookPath);
  }

  return { installed: true, hookPath, replaced, note };
}

/**
 * Remove our tagged block from the commit-msg hook. Leaves any non-wdf
 * user code outside the block intact.
 */
export function uninstallHooks(projectRoot: string): UninstallHooksResult {
  const hookPath = join(projectRoot, HOOK_PATH_RELATIVE);
  if (!existsSync(hookPath)) {
    return { removed: false, hookPath, preserved_user_section: false };
  }
  const existing = readFileSync(hookPath, 'utf8');
  if (!existing.includes(HOOK_TAG)) {
    // Not our hook. Leave alone.
    return { removed: false, hookPath, preserved_user_section: false };
  }

  const beginIdx = existing.indexOf(HOOK_BEGIN);
  const endIdx = existing.indexOf(HOOK_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    // Tagged but no block markers — delete the whole file.
    rmSync(hookPath);
    return { removed: true, hookPath, preserved_user_section: false };
  }

  // Strip the block + any trailing blank line.
  const before = existing.slice(0, beginIdx).replace(/\s+$/, '');
  const after = existing.slice(endIdx + HOOK_END.length).replace(/^\s+/, '');
  const combined = before + (before && after ? '\n\n' : '') + after;

  // A remainder that's only a shebang / comments / blank lines isn't real
  // user code — a fresh wdf install leaves just `#!/bin/sh` behind, so treat
  // that as "pure wdf" and delete the whole hook.
  const hasUserCode = combined
    .split('\n')
    .some((l) => l.trim() && !l.trim().startsWith('#'));
  if (!hasUserCode) {
    rmSync(hookPath);
    return { removed: true, hookPath, preserved_user_section: false };
  }
  writeFileSync(hookPath, combined, 'utf8');
  chmodHook(hookPath);
  return { removed: true, hookPath, preserved_user_section: true };
}

/**
 * Validate a commit message. Pure-function friendly — does NOT touch git
 * itself, only reads files under `<projectRoot>/_wdf_output/stories/`.
 *
 * Rules (non-strict mode):
 *   - No `[story:...]` tag → ok (progressive strictness)
 *   - Tag present but story file missing → fail
 *   - Story file present but no REQ mapping → fail
 *
 * Rules (strict mode):
 *   - No tag → fail (every commit must be linked to a story)
 *   - All above rules
 *   - (optional, future) story's `bmad_story_state` must be `ready-for-dev`
 */
export function checkCommitMsg(opts: CheckCommitMsgOpts): CheckCommitMsgResult {
  const storyId = parseStoryTag(opts.message);

  if (!storyId) {
    if (opts.strict) {
      return {
        ok: false,
        reason: `[strict] commit message is missing a [story:<id>] tag. Add one (e.g. "[story:S-AUTH-01]") or drop --strict.`,
      };
    }
    return { ok: true };
  }

  const storyFile = locateStoryMarkdown(opts.projectRoot, storyId);
  if (!storyFile) {
    return {
      ok: false,
      story_id: storyId,
      reason: `story "${storyId}" not found. Expected one of:\n  - _wdf_output/stories/${storyId}.md\nCreate the story before committing against it, or remove the [story:...] tag.`,
    };
  }

  const frontmatter = readStoryFrontmatter(storyFile);
  if (!frontmatter) {
    return {
      ok: false,
      story_id: storyId,
      reason: `story "${storyId}" at ${storyFile} has no YAML frontmatter (or it failed to parse).`,
    };
  }

  const reqIds = extractReqIds(frontmatter);
  if (reqIds.length === 0) {
    return {
      ok: false,
      story_id: storyId,
      reason: `story "${storyId}" has no REQ mapping. Add one of:\n  - maps_to_req: REQ-NNN, REQ-MMM\n  - refs: [REQ-NNN]\nto the frontmatter so traceability-gate can link it upstream.`,
    };
  }

  return { ok: true, story_id: storyId, req_ids: reqIds };
}

// ─── Internals ──────────────────────────────────────────────────────

/**
 * Render the hook shell script. Keeps the CLI path + strict flag as
 * literals so the hook is self-contained and survives even if the
 * orchestrator is re-installed elsewhere.
 */
function renderHookScript(cliPath: string, strict: boolean): string {
  // POSIX shell: portable across Linux / macOS / WSL.
  // Everything wdf owns lives between HOOK_BEGIN/HOOK_END so uninstall can
  // strip it cleanly; only the shebang sits outside the markers.
  const strictFlag = strict ? ' --strict' : '';
  return [
    '#!/bin/sh',
    HOOK_BEGIN,
    `# ${HOOK_TAG}`,
    '# wdf-method commit-msg hook — validates [story:...] tags.',
    '# Installed by `wdf hooks install`. Do not hand-edit between the markers.',
    '# To bypass for a single commit: git commit --no-verify',
    `WDF_CLI=${quoteShell(cliPath)}`,
    'MSG_FILE="$1"',
    '# If CLI path is missing (framework uninstalled), warn but allow.',
    'if [ ! -f "$WDF_CLI" ]; then',
    '  echo "[wdf-hook] warning: wdf CLI not found at $WDF_CLI — skipping validation"',
    '  exit 0',
    'fi',
    `node "$WDF_CLI" hooks check-commit-msg "$MSG_FILE"${strictFlag}`,
    HOOK_END,
    '',
  ].join('\n');
}

function quoteShell(s: string): string {
  // Single-quote everything; escape internal single quotes via '\'' idiom.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function chmodHook(p: string): void {
  try {
    chmodSync(p, 0o755);
  } catch {
    // best-effort; git honors the executable bit but some fs (e.g. WSL
    // mounts) ignore it.
  }
}

function replaceTaggedBlock(original: string, replacement: string): string {
  const beginIdx = original.indexOf(HOOK_BEGIN);
  const endIdx = original.indexOf(HOOK_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    // No block markers but tag is present — append.
    return original.trimEnd() + '\n' + replacement;
  }
  const before = original.slice(0, beginIdx);
  const after = original.slice(endIdx + HOOK_END.length);
  return before + replacement + after;
}

/**
 * Extract a story id from a commit message. Only the bracketed form
 * `[story:S-AUTH-01]` is accepted — a bare `story:...` or a tag missing its
 * closing bracket is treated as no tag, so a typo can't silently bypass the
 * validation it was meant to trigger.
 */
export function parseStoryTag(message: string): string | null {
  const m = message.match(/\[story:([A-Za-z0-9._-]+)\]/);
  return m ? m[1] : null;
}

/**
 * Find the story markdown by scanning known directories. Returns null
 * when no candidate is found.
 */
function locateStoryMarkdown(projectRoot: string, storyId: string): string | null {
  const candidates = [
    join(projectRoot, '_wdf_output', 'stories', `${storyId}.md`),
    // Back-compat with older projects that kept output under a different path.
    join(projectRoot, 'wdf-output', 'stories', `${storyId}.md`),
    join(projectRoot, 'docs', 'wdf', 'stories', `${storyId}.md`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read the YAML frontmatter from a story markdown. Returns null when
 * there's no frontmatter or parsing fails.
 */
function readStoryFrontmatter(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  try {
    return yaml.load(text.slice(3, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Collect REQ ids from either `maps_to_req` (comma-separated) or `refs`
 * (string[]), deduped. Returns [] when neither field is present.
 */
export function extractReqIds(frontmatter: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const key of ['maps_to_req', 'refs']) {
    const raw = frontmatter[key];
    if (typeof raw === 'string') {
      for (const id of raw.split(/[,\s]+/)) {
        if (/^REQ(-[A-Za-z0-9]+)?-\d+$/.test(id.trim())) out.add(id.trim());
      }
    } else if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        for (const id of entry.split(/[,\s]+/)) {
          if (/^REQ(-[A-Za-z0-9]+)?-\d+$/.test(id.trim())) out.add(id.trim());
        }
      }
    }
  }
  return Array.from(out);
}
