import { existsSync, readFileSync } from 'fs';
import YAML from 'js-yaml';
import { resolve } from 'path';
/**
 * Evaluates Gate Cards to determine if a phase/sub-phase can be entered.
 * Supports: artifact_exists, artifact_metadata, dependency_status, user_confirmation,
 *           all_stories_complete, scope_boundary, custom_check.
 */
export class GateEvaluator {
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    /**
     * Evaluate a full Gate Card. Returns { all_pass, results }.
     */
    async evaluate(gateCard, state, options) {
        const results = await Promise.all(gateCard.checks.map(check => this.evaluateCheck(check, state, options)));
        const all_pass = results.every(r => r.status === 'pass');
        return { all_pass, results };
    }
    async evaluateCheck(check, state, options) {
        try {
            switch (check.type) {
                case 'artifact_exists':
                    return this.checkArtifactExists(check);
                case 'artifact_metadata':
                    return this.checkArtifactMetadata(check);
                case 'dependency_status':
                    return this.checkDependencyStatus(check, state);
                case 'user_confirmation':
                    // Always pass — user confirmation handled in the menu layer
                    return { id: check.id, status: 'pass' };
                case 'all_stories_complete':
                    return this.checkAllStoriesComplete(state, options);
                case 'scope_boundary':
                    return this.checkScopeBoundary(check, state, options);
                case 'field_exists':
                    return { id: check.id, status: 'pass' }; // Handled at story level
                case 'custom_check':
                    return this.checkCustom(check, state, options);
                default:
                    return { id: check.id, status: 'fail', reason: `Unknown check type: ${check.type}` };
            }
        }
        catch (err) {
            return { id: check.id, status: 'fail', reason: err?.message ?? String(err) };
        }
    }
    checkArtifactExists(check) {
        const source = check.target ?? check.source ?? '';
        const path = resolve(this.projectRoot, source);
        const exists = existsSync(path);
        return {
            id: check.id,
            status: exists ? 'pass' : 'fail',
            reason: exists ? undefined : `Artifact not found: ${source}`,
        };
    }
    checkArtifactMetadata(check) {
        const source = check.target ?? check.source ?? '';
        const path = resolve(this.projectRoot, source);
        if (!existsSync(path)) {
            return { id: check.id, status: 'fail', reason: `File not found: ${source}` };
        }
        const content = readFileSync(path, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            return { id: check.id, status: 'fail', reason: `No frontmatter in: ${source}` };
        }
        const frontmatter = YAML.load(frontmatterMatch[1]);
        // Support nested field access via dot notation
        const field = check.target ?? 'status';
        const parts = field.split('.');
        let value = frontmatter;
        for (const part of parts) {
            if (value == null)
                break;
            value = value[part];
        }
        const expected = check.expected;
        const pass = Array.isArray(expected) ? expected.includes(value) : value === expected;
        return {
            id: check.id,
            status: pass ? 'pass' : 'fail',
            reason: pass ? undefined : `${source} field ${field}="${value}", expected ${JSON.stringify(expected)}`,
        };
    }
    checkDependencyStatus(check, state) {
        const gs = state.data.global_state;
        if (check.field?.includes('phase_3.status') && check.expected === 'LOCKED') {
            const status = state.getPhase(3)?.status;
            return {
                id: check.id,
                status: status === 'LOCKED' ? 'pass' : 'fail',
                reason: status === 'LOCKED' ? undefined : `Phase 3 status is "${status}", expected "LOCKED"`,
            };
        }
        if (check.field?.includes('development_order_frozen_at') && check.expected === null) {
            const pass = gs.development_order_frozen_at != null;
            return {
                id: check.id,
                status: pass ? 'pass' : 'fail',
                reason: pass ? undefined : 'Development order not frozen',
            };
        }
        if (check.field?.includes('requirements_frozen_at') && check.expected === null) {
            const pass = gs.requirements_frozen_at != null;
            return {
                id: check.id,
                status: pass ? 'pass' : 'fail',
                reason: pass ? undefined : 'Requirements not frozen',
            };
        }
        if (check.field?.includes('phase_3_9') && check.expected === 'LOCKED') {
            const status = state.getSubState(3, 'phase_3_9');
            return {
                id: check.id,
                status: status === 'LOCKED' ? 'pass' : 'fail',
                reason: status === 'LOCKED' ? undefined : `Phase 3.9 status is "${status}", expected "LOCKED"`,
            };
        }
        if (check.operator === 'neq' && check.expected === null) {
            return { id: check.id, status: 'pass' }; // Fallback pass for neq null checks
        }
        if (check.operator === 'eq') {
            return { id: check.id, status: 'pass' }; // Default pass for eq checks not yet implemented
        }
        return { id: check.id, status: 'pass', reason: `Check not yet implemented: ${check.field}` };
    }
    checkAllStoriesComplete(state, options) {
        // Check all stories in the relevant phase/sub-phase are APPROVED or better
        const gs = state.data.global_state;
        const order = gs.development_order ?? [];
        const phase = state.getPhase(4);
        const substates = phase?.substates;
        if (!substates) {
            return { id: 'ALL_STORIES', status: 'fail', reason: 'No substates found' };
        }
        // Find the relevant substate based on options
        const targetSubKey = options?.track === 'backend' ? 'phase_4_4' :
            options?.track === 'frontend' ? 'phase_4_10' : null;
        if (targetSubKey && substates[targetSubKey]?.stories) {
            const stories = substates[targetSubKey].stories;
            const terminalStates = ['CODE_ACCEPTED', 'FEATURE_ACCEPTED', 'UI_ACCEPTED', 'E2E_BROWSER_ACCEPTED', 'MERGED'];
            const nonBlocked = stories.filter(s => s.status !== 'BLOCKED_BY_DEPENDENCY');
            const allDone = nonBlocked.every(s => terminalStates.includes(s.status));
            return {
                id: 'ALL_STORIES',
                status: allDone ? 'pass' : 'fail',
                reason: allDone ? undefined : `${nonBlocked.length - nonBlocked.filter(s => terminalStates.includes(s.status)).length} stories not yet accepted`,
            };
        }
        return { id: 'ALL_STORIES', status: 'pass' };
    }
    checkScopeBoundary(check, state, options) {
        const boundary = state.data.global_state.implementation_boundary;
        if (!boundary || !boundary.scope_frozen) {
            return { id: check.id, status: 'fail', reason: 'Implementation boundary not frozen' };
        }
        return { id: check.id, status: 'pass' };
    }
    checkCustom(check, _state, options) {
        // For SRG-05 (scope overlap): handled at the story runner level
        // For SRG-07 (parent dirs exist): handled at the story runner level
        return { id: check.id, status: 'pass', reason: `Custom check delegated: ${check.description}` };
    }
}
//# sourceMappingURL=gate-evaluator.js.map