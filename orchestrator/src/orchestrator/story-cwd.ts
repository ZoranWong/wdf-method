/**
 * Resolve the working directory for running a story's acceptance checks.
 *
 * Shared by `wdf accept` (orchestrator.ts) and the verdict-verifier so both
 * run a story's checks in the SAME directory — otherwise the CLI's
 * re-verification could disagree with `wdf accept` purely because of cwd.
 *
 * Convention: the first `scope_write` path that exists under the project root,
 * else the project root itself.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { StoryEntry } from './types.js';

export function resolveStoryCwd(
  story: Pick<StoryEntry, 'scope_write'>,
  projectRoot: string,
): string {
  for (const scope of story.scope_write ?? []) {
    const scopePath = join(projectRoot, scope);
    if (existsSync(scopePath)) {
      return scopePath;
    }
  }
  return projectRoot;
}
