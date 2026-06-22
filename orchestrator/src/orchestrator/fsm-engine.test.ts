/**
 * Tests for the FSM engine — specifically the V3.9 FAIL terminal state and
 * the metadata-gated recovery path (FAIL → NOT_STARTED via `wdf reset --force`).
 *
 * Coverage:
 *   - FAIL is terminal by default (all out-transitions rejected)
 *   - FAIL → NOT_STARTED allowed ONLY when metadata.reset === true
 *   - aggregateSubPhaseStates: FAIL outranks BLOCKED
 *   - PIPELINE_ESCALATED → FAIL is a valid transition
 *   - TERMINAL_STATES includes FAIL
 */

import { describe, it, expect } from 'vitest';
import {
  validateStateTransition,
  aggregateSubPhaseStates,
  isTerminalState,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
} from './fsm-engine.js';

describe('fsm-engine — FAIL terminal state', () => {
  describe('TERMINAL_STATES', () => {
    it('includes FAIL', () => {
      expect(TERMINAL_STATES).toContain('FAIL');
    });

    it('isTerminalState(FAIL) returns true', () => {
      expect(isTerminalState('FAIL')).toBe(true);
    });
  });

  describe('VALID_TRANSITIONS', () => {
    it('allows PIPELINE_ESCALATED → FAIL', () => {
      expect(VALID_TRANSITIONS.PIPELINE_ESCALATED).toContain('FAIL');
    });

    it('declares FAIL → NOT_STARTED as the only out-transition', () => {
      expect(VALID_TRANSITIONS.FAIL).toEqual(['NOT_STARTED']);
    });
  });

  describe('validateStateTransition — FAIL is terminal by default', () => {
    it('rejects FAIL → IN_PROGRESS (no metadata)', () => {
      const result = validateStateTransition('FAIL', 'IN_PROGRESS');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/terminal/i);
    });

    it('rejects FAIL → LOCKED (no metadata)', () => {
      const result = validateStateTransition('FAIL', 'LOCKED');
      expect(result.valid).toBe(false);
    });

    it('rejects FAIL → PIPELINE_ESCALATED (no metadata)', () => {
      const result = validateStateTransition('FAIL', 'PIPELINE_ESCALATED');
      expect(result.valid).toBe(false);
    });

    it('rejects FAIL → NOT_STARTED when metadata.reset is false', () => {
      const result = validateStateTransition('FAIL', 'NOT_STARTED', {
        metadata: { reset: false },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects FAIL → NOT_STARTED when metadata is missing', () => {
      const result = validateStateTransition('FAIL', 'NOT_STARTED');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateStateTransition — gated recovery', () => {
    it('allows FAIL → NOT_STARTED when metadata.reset === true', () => {
      const result = validateStateTransition('FAIL', 'NOT_STARTED', {
        metadata: { reset: true },
      });
      expect(result.valid).toBe(true);
    });

    it('reject message mentions `wdf reset --force`', () => {
      const result = validateStateTransition('FAIL', 'IN_PROGRESS');
      expect(result.reason).toMatch(/wdf reset --force/);
    });
  });

  describe('validateStateTransition — entry into FAIL', () => {
    it('allows PIPELINE_ESCALATED → FAIL', () => {
      const result = validateStateTransition('PIPELINE_ESCALATED', 'FAIL');
      expect(result.valid).toBe(true);
    });

    it('rejects IN_PROGRESS → FAIL (FAIL must come via ESCALATED)', () => {
      const result = validateStateTransition('IN_PROGRESS', 'FAIL');
      expect(result.valid).toBe(false);
    });
  });

  describe('aggregateSubPhaseStates — FAIL priority', () => {
    it('returns FAIL when any sub-phase is FAIL', () => {
      const result = aggregateSubPhaseStates([
        { id: 'a', status: 'IN_PROGRESS' },
        { id: 'b', status: 'FAIL' },
        { id: 'c', status: 'LOCKED' },
      ]);
      expect(result).toBe('FAIL');
    });

    it('FAIL beats BLOCKED when both present', () => {
      const result = aggregateSubPhaseStates([
        { id: 'a', status: 'BLOCKED' },
        { id: 'b', status: 'FAIL' },
      ]);
      expect(result).toBe('FAIL');
    });

    it('FAIL beats BLOCKED_BY_DEPENDENCY when both present', () => {
      const result = aggregateSubPhaseStates([
        { id: 'a', status: 'BLOCKED_BY_DEPENDENCY' },
        { id: 'b', status: 'FAIL' },
      ]);
      expect(result).toBe('FAIL');
    });

    it('still returns BLOCKED when only BLOCKED present (no FAIL regression)', () => {
      const result = aggregateSubPhaseStates([
        { id: 'a', status: 'BLOCKED' },
        { id: 'b', status: 'IN_PROGRESS' },
      ]);
      expect(result).toBe('BLOCKED');
    });
  });
});
