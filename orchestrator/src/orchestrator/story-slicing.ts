// Story Slicing Engine V2.0
//
// Splits L/XL stories into P0 (MVP) and P1 (enhancement) slices.
// Each slice has independent scope_write, acceptance_check, and status.
// Parent story status is DERIVED from slice aggregation.
//
// Design: specs/story-slicing.md V2.0
import { StoryEntry, StorySlice } from './types.js';

// ── Effort Assessment ─────────────────────────────────────────
const EFFORT_THRESHOLDS: Record<string, { label: string; shouldSlice: boolean }> = {
    S: { label: 'Small (< 4h)', shouldSlice: false },
    M: { label: 'Medium (4-8h)', shouldSlice: false },
    L: { label: 'Large (1-2d)', shouldSlice: true },
    XL: { label: 'Extra Large (2d+)', shouldSlice: true },
};

/**
 * Determine whether a story should be sliced based on its effort estimate.
 */
export function shouldSliceStory(story: {
    effort?: string;
    scope_write: string[];
}): boolean {
    // Never slice stories with tiny scope
    if (story.scope_write.length <= 2)
        return false;
    const effort = (story.effort ?? 'M').toUpperCase();
    return EFFORT_THRESHOLDS[effort]?.shouldSlice ?? false;
}

// ── Auto-Slice Generation ─────────────────────────────────────
/**
 * Generate a P0/P1 slice plan for a story.
 *
 * P0 = MVP: core functionality that must work for the story to deliver value.
 * P1 = Enhancement: additional polish, edge cases, optional features.
 *
 * Returns the slice plan, or a plan with should_slice=false if slicing
 * is not recommended for this story.
 */
export function generateSlicePlan(story: StoryEntry): SlicePlan {
    if (!shouldSliceStory(story)) {
        return {
            should_slice: false,
            reason: `Story "${story.story_id}" (effort: ${story.effort ?? 'M'}) does not meet slicing threshold. S and M stories should not be sliced.`,
            slices: [],
        };
    }
    // Heuristic: first ~60% of scope_write is P0, rest is P1
    const scopeLen = story.scope_write.length;
    const p0Count = Math.max(1, Math.ceil(scopeLen * 0.6));
    const p0Scope = story.scope_write.slice(0, p0Count);
    const p1Scope = story.scope_write.slice(p0Count);
    // Acceptance checks: first ~60% are P0
    const checksLen = (story.acceptance_check ?? []).length;
    const p0CheckCount = Math.max(1, Math.ceil(checksLen * 0.6));
    const p0Checks = (story.acceptance_check ?? []).slice(0, p0CheckCount);
    const p1Checks = (story.acceptance_check ?? []).slice(p0CheckCount);
    const slices: SliceDefinition[] = [
        {
            slice_id: `${story.story_id}-P0`,
            title: `${story.title} — MVP`,
            priority: 'P0',
            scope_write: p0Scope,
            acceptance_check: p0Checks,
        },
        {
            slice_id: `${story.story_id}-P1`,
            title: `${story.title} — Enhancement`,
            priority: 'P1',
            depends_on_slices: [`${story.story_id}-P0`],
            scope_write: p1Scope,
            acceptance_check: p1Checks,
        },
    ];
    return {
        should_slice: true,
        reason: `Story "${story.story_id}" (effort: ${story.effort ?? 'L'}, scope: ${scopeLen} files) qualifies for P0/P1 slicing.`,
        slices,
    };
}

// ── Slice Status Aggregation ──────────────────────────────────
/**
 * Derive the parent story status from its slice statuses.
 *
 * Rules (in priority order):
 *   1. Any slice BLOCKED_BY_DEPENDENCY → parent is BLOCKED_BY_DEPENDENCY
 *   2. All slices CODE_ACCEPTED → parent is CODE_ACCEPTED
 *   3. Any slice IN_PROGRESS → parent is IN_PROGRESS
 *   4. All slices NOT_STARTED → parent is NOT_STARTED
 */
export function deriveStoryStatusFromSlices(slices: StorySlice[]): SliceStatus {
    if (slices.length === 0)
        return 'NOT_STARTED';
    const statuses = slices.map(s => s.status);
    if (statuses.some(s => s === 'BLOCKED_BY_DEPENDENCY')) {
        return 'BLOCKED_BY_DEPENDENCY';
    }
    if (statuses.every(s => s === 'CODE_ACCEPTED')) {
        return 'CODE_ACCEPTED';
    }
    if (statuses.some(s => s === 'IN_PROGRESS')) {
        return 'IN_PROGRESS';
    }
    return 'NOT_STARTED';
}

/**
 * Check if a story's P0 slice is complete (MVP delivered).
 * P1 can be deferred — P0 completion = "story is usable".
 */
export function isMvpComplete(slices: StorySlice[]): boolean {
    const p0Slices = slices.filter(s => s.slice_id.endsWith('-P0'));
    if (p0Slices.length === 0)
        return false;
    return p0Slices.every(s => s.status === 'CODE_ACCEPTED');
}

/**
 * Check if the full story (all slices) is complete.
 */
export function isStoryComplete(slices: StorySlice[]): boolean {
    if (slices.length === 0)
        return false;
    return slices.every(s => s.status === 'CODE_ACCEPTED');
}

// ── Slice Dependency Resolution ────────────────────────────────
/**
 * Return slices that are unblocked (all their slice-level dependencies are met).
 */
export function getUnblockedSlices(slices: StorySlice[], completedSliceIds: string[]): StorySlice[] {
    return slices.filter(slice => {
        if (!slice.depends_on_slices?.length)
            return true;
        return slice.depends_on_slices.every(depId => completedSliceIds.includes(depId));
    });
}

/**
 * Get the next unblocked slice that should be worked on.
 * Returns the first unblocked, not-yet-started, not-in-progress slice.
 */
export function getNextSlice(slices: StorySlice[]): StorySlice | null {
    const completed = slices
        .filter(s => s.status === 'CODE_ACCEPTED')
        .map(s => s.slice_id);
    const unblocked = getUnblockedSlices(slices, completed);
    const next = unblocked.find(s => s.status === 'NOT_STARTED') ?? unblocked.find(s => s.status === 'IN_PROGRESS');
    return next ?? null;
}

// ── Slice Progress ────────────────────────────────────────────
/**
 * Calculate progress percentage across slices.
 */
export function sliceProgress(slices: StorySlice[]): number {
    if (slices.length === 0)
        return 0;
    let progress = 0;
    for (const slice of slices) {
        switch (slice.status) {
            case 'CODE_ACCEPTED':
                progress += 1;
                break;
            case 'IN_PROGRESS':
                progress += 0.5;
                break;
            case 'BLOCKED_BY_DEPENDENCY':
                progress += 0;
                break;
            default:
                progress += 0;
        }
    }
    return Math.round((progress / slices.length) * 100);
}

/**
 * Validate that a slice plan is well-formed.
 */
export function validateSlicePlan(plan: SlicePlan): SliceValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!plan.should_slice) {
        return { valid: true, errors, warnings };
    }
    if (plan.slices.length === 0) {
        errors.push('Slice plan says should_slice=true but has no slices');
        return { valid: false, errors, warnings };
    }
    // P0 must come before P1
    const priorities = plan.slices.map(s => s.priority);
    if (priorities.includes('P1') && !priorities.includes('P0')) {
        errors.push('P1 slice exists but no P0 (MVP) slice defined');
    }
    // Each slice must have scope_write
    for (const slice of plan.slices) {
        if (!slice.scope_write || slice.scope_write.length === 0) {
            errors.push(`Slice "${slice.slice_id}" has empty scope_write`);
        }
        if (!slice.acceptance_check || slice.acceptance_check.length === 0) {
            warnings.push(`Slice "${slice.slice_id}" has no acceptance_check`);
        }
    }
    // P1 should depend on P0
    for (const slice of plan.slices) {
        if (slice.priority === 'P1' && !slice.depends_on_slices?.length) {
            warnings.push(`P1 slice "${slice.slice_id}" should depend on the P0 slice`);
        }
    }
    return { valid: errors.length === 0, errors, warnings };
}

export type SlicePriority = 'P0' | 'P1';
export type SliceStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'CODE_ACCEPTED' | 'BLOCKED_BY_DEPENDENCY';

export interface SliceDefinition {
    slice_id: string;
    title: string;
    priority: SlicePriority;
    depends_on_slices?: string[];
    scope_write: string[];
    acceptance_check: string[];
}

export interface SlicedStory extends StoryEntry {
    slices: StorySlice[];
    /** Derived status from slice aggregation */
    derived_status: SliceStatus;
}

export interface SlicePlan {
    should_slice: boolean;
    reason: string;
    slices: SliceDefinition[];
}

export interface SliceValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
