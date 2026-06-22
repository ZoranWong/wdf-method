/**
 * Party Mode Dispatch Bridge — connects the PartyEngine to the V3
 * permission injection system and provides a clean dispatch protocol
 * for the parent Claude session.
 *
 * The party engine generates a dispatch manifest with one entry per
 * persona. This bridge:
 *   1. Applies V3 three-layer permissions for each persona
 *   2. Returns a structured "next action" for the parent session
 *   3. After dispatch, revokes permissions and collects outputs
 *
 * Usage flow:
 *   1. Parent calls `wdf party create` → gets party_id
 *   2. Parent calls `wdf party dispatch-loop <id> "<prompt>"` → gets dispatch action
 *   3. Parent uses Agent tool to dispatch one sub-agent per entry (parallel)
 *   4. Parent calls `wdf party dispatch-loop --post-dispatch <id>` → CLI revokes
 *      permissions and collects outputs, returns next step
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  applyRolePermissions,
  revokePermissions,
} from './permission-injector.js';

// ── Types ──────────────────────────────────────────────────

export interface PartyDispatchEntry {
  agent_id: string;
  role: string;
  name: string;
  persona: string;
  perspectives: string[];
  prompt: string;
  context: {
    topic: string;
    phase: string;
    round_number: number;
  };
  output_path: string;
}

export interface PartyDispatchManifest {
  manifest_path: string;
  output_dir: string;
  entries: PartyDispatchEntry[];
}

export interface PartyLoopAction {
  kind: 'dispatch' | 'collect' | 'complete';
  party_id: string;
  /** For 'dispatch': entries to dispatch in parallel */
  entries?: PartyDispatchEntry[];
  manifest_path?: string;
  /** Permissions applied for each entry */
  permissions_applied: Record<string, boolean>;
  /** Instructions for the parent session */
  instructions: string[];
}

// ── Bridge Functions ───────────────────────────────────────

/**
 * Prepare a party dispatch with V3 permissions applied to each entry.
 *
 * For each persona in the manifest, this applies the corresponding
 * role-based permissions (from references/agents/<role>.md) to the
 * host's .claude/settings.local.json. The parent session can then
 * dispatch sub-agents without per-step permission prompts.
 *
 * Returns the action the parent session should take.
 */
export function preparePartyDispatchWithPermissions(
  partyId: string,
  manifest: PartyDispatchManifest,
  projectRoot: string,
  frameworkRoot: string,
): PartyLoopAction {
  const permissionsApplied: Record<string, boolean> = {};
  const instructions: string[] = [];

  for (const entry of manifest.entries) {
    const role = mapPartyRoleToAgentRole(entry.role);
    try {
      applyRolePermissions(role, entry.agent_id, 'dev', projectRoot, frameworkRoot);
      permissionsApplied[entry.agent_id] = true;
    } catch {
      permissionsApplied[entry.agent_id] = false;
    }
  }

  instructions.push(`Dispatch ${manifest.entries.length} sub-agent(s) in parallel using the Agent tool.`);
  instructions.push(`Each sub-agent should adopt the persona described in its entry.`);
  instructions.push(`Each sub-agent writes its full markdown response to the entry's output_path.`);
  instructions.push(`After all sub-agents complete, run: wdf party dispatch-loop --post-dispatch ${partyId}`);

  return {
    kind: 'dispatch',
    party_id: partyId,
    entries: manifest.entries,
    manifest_path: manifest.manifest_path,
    permissions_applied: permissionsApplied,
    instructions,
  };
}

/**
 * After all sub-agents have completed their dispatch, call this to:
 *   1. Revoke all party permissions (cleanup)
 *   2. Return the "collect" action
 *
 * The parent session then runs `wdf party collect` to fold outputs
 * into party state.
 */
export function postPartyDispatch(
  partyId: string,
  manifest: PartyDispatchManifest,
  projectRoot: string,
): PartyLoopAction {
  // Revoke all permissions for this party
  for (const entry of manifest.entries) {
    try {
      revokePermissions(entry.agent_id, 'dev', projectRoot);
    } catch {
      // Non-fatal
    }
  }

  return {
    kind: 'collect',
    party_id: partyId,
    permissions_applied: {},
    instructions: [
      `All sub-agents have completed. Permissions revoked.`,
      `Run: wdf party collect ${partyId}`,
      `Then: wdf party crosstalk ${partyId} <round-number>`,
    ],
  };
}

/**
 * Map a party role to the corresponding agent file role.
 * Party roles use underscores (e.g. "product_manager"); agent files
 * use hyphens (e.g. "product-manager").
 */
function mapPartyRoleToAgentRole(partyRole: string): string {
  const mapping: Record<string, string> = {
    analyst: 'analyst',
    product_manager: 'product-manager',
    ux_designer: 'ux-designer',
    architect: 'architect',
    story_planner: 'story-planner',
    api_designer: 'api-designer',
    external_expert: 'analyst', // fallback
  };
  return mapping[partyRole] ?? partyRole.replace(/_/g, '-');
}

/**
 * Build the prompt for a single party dispatch entry.
 * The sub-agent needs to know: its persona, its perspectives, and the
 * discussion prompt.
 */
export function buildPartyAgentPrompt(entry: PartyDispatchEntry): string {
  const lines: string[] = [];

  lines.push(`# Party Mode: ${entry.name}`);
  lines.push('');
  lines.push('## Your Persona');
  lines.push(entry.persona);
  lines.push('');
  lines.push('## Your Perspectives');
  for (const p of entry.perspectives) {
    lines.push(`- ${p}`);
  }
  lines.push('');
  lines.push('## Discussion Context');
  lines.push(`- Topic: ${entry.context.topic}`);
  lines.push(`- Phase: ${entry.context.phase}`);
  lines.push(`- Round: ${entry.context.round_number}`);
  lines.push('');
  lines.push('## The Prompt');
  lines.push('');
  lines.push(entry.prompt);
  lines.push('');
  lines.push('## Instructions');
  lines.push('');
  lines.push(`1. Adopt the persona above. Think from this role's perspective.`);
  lines.push(`2. Address the prompt using your assigned perspectives.`);
  lines.push(`3. Be specific and concrete. Avoid generic advice.`);
  lines.push(`4. Write your full response as markdown to: \`${entry.output_path}\``);
  lines.push(`5. Your response will be read by other agents in the cross-talk phase.`);

  return lines.join('\n');
}
