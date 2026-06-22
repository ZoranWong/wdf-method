/**
 * Tests for party-dispatch-bridge.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  preparePartyDispatchWithPermissions,
  postPartyDispatch,
  buildPartyAgentPrompt,
  type PartyDispatchManifest,
  type PartyDispatchEntry,
} from './party-dispatch-bridge.js';

function makeTempProject(): string {
  const dir = join(tmpdir(), `wdf-pdb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({
    permissions: { allow: [], deny: [] },
  }));
  return dir;
}

function makeManifest(entries: PartyDispatchEntry[]): PartyDispatchManifest {
  return {
    manifest_path: '/tmp/manifest.json',
    output_dir: '/tmp/party',
    entries,
  };
}

function makeEntry(role: string, name: string): PartyDispatchEntry {
  return {
    agent_id: `${role}-${Date.now()}`,
    role,
    name,
    persona: `You are a ${name}.`,
    perspectives: ['security', 'scalability'],
    prompt: 'How should we design the auth system?',
    context: {
      topic: 'Authentication Design',
      phase: 'architecture',
      round_number: 1,
    },
    output_path: `/tmp/output-${role}.md`,
  };
}

describe('party-dispatch-bridge', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTempProject();
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  describe('preparePartyDispatchWithPermissions', () => {
    it('returns dispatch action with all entries', () => {
      const manifest = makeManifest([
        makeEntry('architect', 'Lead Architect'),
        makeEntry('product_manager', 'Product Owner'),
      ]);
      const action = preparePartyDispatchWithPermissions(
        'party-1', manifest, projectRoot, projectRoot,
      );

      expect(action.kind).toBe('dispatch');
      expect(action.party_id).toBe('party-1');
      expect(action.entries).toHaveLength(2);
    });

    it('applies permissions for each entry', () => {
      const manifest = makeManifest([
        makeEntry('architect', 'Lead Architect'),
        makeEntry('analyst', 'Domain Expert'),
      ]);
      const action = preparePartyDispatchWithPermissions(
        'party-1', manifest, projectRoot, projectRoot,
      );

      expect(Object.keys(action.permissions_applied)).toHaveLength(2);
    });

    it('provides instructions for the parent session', () => {
      const manifest = makeManifest([makeEntry('architect', 'Lead Architect')]);
      const action = preparePartyDispatchWithPermissions(
        'party-1', manifest, projectRoot, projectRoot,
      );

      expect(action.instructions.length).toBeGreaterThan(0);
      expect(action.instructions.some(i => i.includes('Agent tool'))).toBe(true);
    });

    it('handles permission application failure gracefully', () => {
      const manifest = makeManifest([makeEntry('unknown_role', 'Mystery Agent')]);
      const action = preparePartyDispatchWithPermissions(
        'party-1', manifest, projectRoot, projectRoot,
      );

      // Should not throw; should record failure in permissions_applied
      expect(action.permissions_applied).toBeDefined();
    });
  });

  describe('postPartyDispatch', () => {
    it('returns collect action', () => {
      const manifest = makeManifest([makeEntry('architect', 'Lead Architect')]);
      const action = postPartyDispatch('party-1', manifest, projectRoot);

      expect(action.kind).toBe('collect');
      expect(action.party_id).toBe('party-1');
    });

    it('provides next-step instructions', () => {
      const manifest = makeManifest([makeEntry('architect', 'Lead Architect')]);
      const action = postPartyDispatch('party-1', manifest, projectRoot);

      expect(action.instructions.some(i => i.includes('wdf party collect'))).toBe(true);
    });

    it('does not throw when revoking non-existent permissions', () => {
      const manifest = makeManifest([makeEntry('architect', 'Lead Architect')]);
      expect(() => {
        postPartyDispatch('party-1', manifest, projectRoot);
      }).not.toThrow();
    });
  });

  describe('buildPartyAgentPrompt', () => {
    it('includes persona in the prompt', () => {
      const entry = makeEntry('architect', 'Lead Architect');
      entry.persona = 'You are a pragmatic systems architect.';
      const prompt = buildPartyAgentPrompt(entry);

      expect(prompt).toContain('Lead Architect');
      expect(prompt).toContain('pragmatic systems architect');
    });

    it('includes perspectives', () => {
      const entry = makeEntry('analyst', 'Domain Expert');
      entry.perspectives = ['user empathy', 'market trends'];
      const prompt = buildPartyAgentPrompt(entry);

      expect(prompt).toContain('user empathy');
      expect(prompt).toContain('market trends');
    });

    it('includes the discussion prompt', () => {
      const entry = makeEntry('architect', 'Lead Architect');
      entry.prompt = 'What is the best caching strategy?';
      const prompt = buildPartyAgentPrompt(entry);

      expect(prompt).toContain('What is the best caching strategy?');
    });

    it('includes output path instruction', () => {
      const entry = makeEntry('architect', 'Lead Architect');
      entry.output_path = '/tmp/response.md';
      const prompt = buildPartyAgentPrompt(entry);

      expect(prompt).toContain('/tmp/response.md');
    });

    it('includes context (topic, phase, round)', () => {
      const entry = makeEntry('architect', 'Lead Architect');
      entry.context = {
        topic: 'Caching',
        phase: 'design',
        round_number: 3,
      };
      const prompt = buildPartyAgentPrompt(entry);

      expect(prompt).toContain('Caching');
      expect(prompt).toContain('design');
      expect(prompt).toContain('3');
    });
  });
});
