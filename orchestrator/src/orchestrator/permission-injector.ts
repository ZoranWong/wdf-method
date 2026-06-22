/**
 * permission-injector — translate a PipelineDispatchManifest's `permissions`
 * block into Claude Code host settings and apply/revoke them around each
 * sub-agent dispatch.
 *
 * Why this exists:
 *   The Agent tool itself has no inline `permissions` parameter. A sub-agent
 *   inherits the host session's permission set. To run `npm test`, `vitest`,
 *   etc. without per-call prompts, the parent must pre-populate
 *   `.claude/settings.local.json` before invoking Agent tool.
 *
 * Approach:
 *   - applyPermissions(manifest) writes tagged entries to
 *     `<projectRoot>/.claude/settings.local.json`'s permissions.allow/deny.
 *   - Each entry carries a `# wdf-dispatch:<story_id>:<stage>` marker in
 *     `additionalMarkdown` so revocation is precise.
 *   - revokePermissions(storyId) reads the file, strips tagged entries,
 *     rewrites atomically.
 *   - listPermissions() returns the currently-injected dispatch scopes for
 *     observability.
 *
 * Failure mode:
 *   If the host project has no `.claude/` directory yet, applyPermissions
 *   creates it. We never touch user-level (`~/.claude`) settings.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import type { PipelineDispatchManifest, DispatchPermissions, PipelineStage } from './types.js';

const SETTINGS_RELATIVE = '.claude/settings.local.json';

/**
 * Default agent baseline permissions, keyed by role name.
 * Used as a fallback when an agent definition file lacks a `default_permissions`
 * frontmatter block, or when the framework root cannot be located.
 *
 * Keep these conservative: role baselines are unioned with story-specific
 * inference at dispatch time. Over-permissioned baselines leak across stories.
 */
export const ROLE_BASELINE_FALLBACK: Record<string, DispatchPermissions> = {
  'backend-developer': {
    bash_allow: ['npm test', 'npm run', 'npx vitest', 'npx tsc', 'npm run migrate'],
    bash_deny: ['git push', 'rm -rf', 'docker push'],
  },
  'frontend-developer': {
    bash_allow: ['npm test', 'npm run dev', 'npx vite', 'npx tsc'],
    bash_deny: ['git push', 'rm -rf', 'docker push'],
  },
  'code-reviewer': {
    bash_allow: ['npm run lint', 'npx tsc --noEmit', 'npx vitest'],
    bash_deny: ['git push', 'rm -rf'],
  },
  'qa-verifier': {
    bash_allow: ['npx playwright', 'npm run e2e', 'docker compose up', 'docker compose down', 'curl'],
    bash_deny: ['docker push', 'git push'],
  },
  'architect': {
    bash_allow: ['npm run lint', 'npx tsc --noEmit'],
    bash_deny: ['git push'],
  },
  'readiness-auditor': {
    bash_allow: ['npm run lint', 'npx tsc --noEmit', 'wdf lint'],
    bash_deny: ['git push'],
  },
  'analyst': {
    bash_allow: [],
    bash_deny: ['git push'],
  },
  'api-designer': {
    bash_allow: ['npm run lint'],
    bash_deny: ['git push'],
  },
  'product-manager': {
    bash_allow: [],
    bash_deny: ['git push'],
  },
  'sprint-planner': {
    bash_allow: [],
    bash_deny: ['git push'],
  },
  'story-planner': {
    bash_allow: [],
    bash_deny: ['git push'],
  },
  'ux-designer': {
    bash_allow: [],
    bash_deny: ['git push'],
  },
  'retrospective-host': {
    bash_allow: [],
    bash_deny: ['git push'],
  },
};

export interface RolePermissionSource {
  role: string;
  from: 'agent-frontmatter' | 'fallback';
  permissions: DispatchPermissions;
}

/**
 * Read a role's baseline permissions from its agent definition file.
 * Returns the fallback baseline if the file is missing or has no
 * `default_permissions` block.
 *
 * The agent definition lives at `<frameworkRoot>/references/agents/<role>.md`.
 * The file uses optional YAML frontmatter delimited by `---`.
 */
export function readRolePermissions(
  role: string,
  frameworkRoot: string,
): RolePermissionSource {
  const fallback = ROLE_BASELINE_FALLBACK[role] ?? { bash_allow: [], bash_deny: [] };
  const agentPath = join(frameworkRoot, 'references', 'agents', `${role}.md`);
  if (!existsSync(agentPath)) {
    return { role, from: 'fallback', permissions: fallback };
  }
  const text = readFileSync(agentPath, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm || !fm.default_permissions) {
    return { role, from: 'fallback', permissions: fallback };
  }
  return { role, from: 'agent-frontmatter', permissions: fm.default_permissions as DispatchPermissions };
}

function parseFrontmatter(text: string): Record<string, unknown> | null {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const body = text.slice(3, end);
  try {
    return yaml.load(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Apply a role's baseline permissions tagged for a specific (story_id, stage).
 * Use this BEFORE story-specific applyPermissions at dispatch time so the
 * story tag can be cleanly revoked together later.
 */
export function applyRolePermissions(
  role: string,
  storyId: string,
  stage: PipelineStage,
  projectRoot: string,
  frameworkRoot: string,
): AppliedPermissionEntry[] {
  const { permissions } = readRolePermissions(role, frameworkRoot);
  const manifest = {
    story_id: storyId,
    stage,
    scope_write: [],
    permissions,
  };
  return applyPermissions(manifest, projectRoot);
}

/**
 * Infer story-specific permissions from acceptance_check entries.
 * Heuristic: extract leading command tokens and convert to Bash(prefix:*).
 * The parent session's model is the intended inferrer; this function is a
 * deterministic fallback for CI / non-LLM contexts.
 */
export function inferStoryPermissions(
  acceptanceCheck: string[],
  scopeWrite: string[],
): DispatchPermissions {
  const bashAllow = new Set<string>();
  const bashDeny = new Set<string>(['git push', 'rm -rf']);

  for (const entry of acceptanceCheck) {
    const trimmed = entry.trim();
    const match = trimmed.match(/^(npm|npx|node|pnpm|yarn|vitest|playwright|docker|curl|wdf|tsc|eslint|prettier)\b/);
    if (match) {
      if (trimmed.includes(' ')) {
        bashAllow.add(trimmed);
      } else {
        bashAllow.add(match[1]);
      }
    }
  }

  return {
    bash_allow: Array.from(bashAllow),
    bash_deny: Array.from(bashDeny),
    scope_read: scopeWrite.length > 0 ? ['_wdf_output/**'] : undefined,
  };
}

export interface AppliedPermissionEntry {
  raw: string;             // full entry as written to allow/deny
  story_id: string;
  stage: string;
  kind: 'allow' | 'deny';
  injected_at: string;
}

interface SettingsFile {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [k: string]: unknown;
}

function settingsPath(projectRoot: string): string {
  return join(projectRoot, SETTINGS_RELATIVE);
}

function tagFor(storyId: string, stage: string): string {
  return `# wdf-dispatch:${storyId}:${stage}`;
}

/**
 * Build the allow / deny arrays the host needs for a given permission scope.
 * Translates DispatchPermissions → Claude Code permission strings.
 */
export function buildPermissionStrings(
  scope: DispatchPermissions,
  scopeWrite: string[],
): { allow: string[]; deny: string[] } {
  const allow: string[] = [];
  const deny: string[] = [];

  for (const cmd of scope.bash_allow ?? []) {
    allow.push(`Bash(${normaliseCmdPrefix(cmd)})`);
  }
  for (const cmd of scope.bash_deny ?? []) {
    deny.push(`Bash(${normaliseCmdPrefix(cmd)})`);
  }
  for (const glob of scopeWrite) {
    allow.push(`Edit(${glob})`);
    allow.push(`Write(${glob})`);
  }
  for (const glob of scope.scope_read ?? []) {
    allow.push(`Read(${glob})`);
  }

  return { allow: dedupe(allow), deny: dedupe(deny) };
}

function normaliseCmdPrefix(cmd: string): string {
  const trimmed = cmd.trim();
  // Claude Code expects `prefix:*` form. If user wrote `npm test` we convert
  // to `npm test:*` so `npm test foo` is also covered. Bare `npm` becomes
  // `npm:*`.
  if (trimmed.endsWith(':*')) return trimmed;
  if (trimmed.endsWith('*')) return trimmed.slice(0, -1) + ':*';
  if (!trimmed.includes(' ')) return `${trimmed}:*`;
  return `${trimmed}:*`;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function readSettings(projectRoot: string): SettingsFile {
  const p = settingsPath(projectRoot);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SettingsFile;
  } catch {
    return {};
  }
}

function writeSettings(projectRoot: string, data: SettingsFile): void {
  const p = settingsPath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Apply a manifest's permission scope to host settings. Idempotent for the
 * same (story_id, stage) pair — re-applying replaces rather than duplicates.
 */
export function applyPermissions(
  manifest: Pick<PipelineDispatchManifest, 'story_id' | 'stage' | 'scope_write' | 'permissions'>,
  projectRoot: string,
): AppliedPermissionEntry[] {
  if (!manifest.permissions) return [];
  const { allow, deny } = buildPermissionStrings(manifest.permissions, manifest.scope_write);
  const settings = readSettings(projectRoot);
  settings.permissions = settings.permissions ?? {};
  settings.permissions.allow = settings.permissions.allow ?? [];
  settings.permissions.deny = settings.permissions.deny ?? [];

  const tag = tagFor(manifest.story_id, manifest.stage);
  const applied: AppliedPermissionEntry[] = [];
  const now = new Date().toISOString();

  // Strip any prior entries for this tag (idempotent re-apply)
  settings.permissions.allow = stripTagged(settings.permissions.allow, tag);
  settings.permissions.deny = stripTagged(settings.permissions.deny, tag);

  for (const entry of allow) {
    const raw = `${entry}  ${tag}`;
    settings.permissions.allow!.push(raw);
    applied.push({ raw, story_id: manifest.story_id, stage: manifest.stage, kind: 'allow', injected_at: now });
  }
  for (const entry of deny) {
    const raw = `${entry}  ${tag}`;
    settings.permissions.deny!.push(raw);
    applied.push({ raw, story_id: manifest.story_id, stage: manifest.stage, kind: 'deny', injected_at: now });
  }

  writeSettings(projectRoot, settings);
  return applied;
}

/**
 * Remove every permission entry tagged for this story + stage.
 */
export function revokePermissions(
  storyId: string,
  stage: string,
  projectRoot: string,
): number {
  const settings = readSettings(projectRoot);
  if (!settings.permissions) return 0;
  const tag = tagFor(storyId, stage);
  let removed = 0;

  for (const key of ['allow', 'deny'] as const) {
    const list = settings.permissions[key];
    if (!Array.isArray(list)) continue;
    const next: string[] = [];
    for (const entry of list) {
      if (typeof entry === 'string' && entry.includes(tag)) {
        removed += 1;
      } else {
        next.push(entry);
      }
    }
    settings.permissions[key] = next;
  }

  writeSettings(projectRoot, settings);
  return removed;
}

/**
 * Revoke every dispatch-tagged entry (e.g. for `wdf permissions purge`).
 */
export function revokeAllDispatchPermissions(projectRoot: string): number {
  const settings = readSettings(projectRoot);
  if (!settings.permissions) return 0;
  let removed = 0;

  for (const key of ['allow', 'deny'] as const) {
    const list = settings.permissions[key];
    if (!Array.isArray(list)) continue;
    const next: string[] = [];
    for (const entry of list) {
      if (typeof entry === 'string' && entry.includes('# wdf-dispatch:')) {
        removed += 1;
      } else {
        next.push(entry);
      }
    }
    settings.permissions[key] = next;
  }

  writeSettings(projectRoot, settings);
  return removed;
}

/**
 * List currently-injected dispatch permission entries.
 */
export function listDispatchPermissions(projectRoot: string): AppliedPermissionEntry[] {
  const settings = readSettings(projectRoot);
  const out: AppliedPermissionEntry[] = [];
  if (!settings.permissions) return out;

  for (const key of ['allow', 'deny'] as const) {
    const list = settings.permissions[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      const m = entry.match(/^(.+?)\s+#\s*wdf-dispatch:([^:]+):(.+)$/);
      if (!m) continue;
      out.push({
        raw: entry,
        story_id: m[2],
        stage: m[3],
        kind: key === 'allow' ? 'allow' : 'deny',
        injected_at: '',
      });
    }
  }
  return out;
}

function stripTagged(list: string[], tag: string): string[] {
  return list.filter((e) => typeof e !== 'string' || !e.includes(tag));
}
