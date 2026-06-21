// Planning-phase review loop for Phase 1-3 artifacts.
//
// Mirrors Phase 4's pipeline-engine pattern but simpler: one review stage,
// one manifest, one report. Parent Claude session uses the Agent tool to
// dispatch a review sub-agent; the sub-agent writes a verdict report; this
// module reads it back and returns PASS/FAIL.
//
// FAIL triggers a Party Mode dispatch so multiple personas can patch the
// artifact — closing the quality loop without manual intervention.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, basename, relative } from 'path';
import { appendAudit } from './audit-logger.js';

const REVIEW_DIR = join('_wdf_output', '.dispatch', 'review');

function reviewDir(projectRoot: string): string {
    return join(projectRoot, REVIEW_DIR);
}

function artifactIdFromPath(projectRoot: string, artifactPath: string): string {
    const rel = relative(projectRoot, artifactPath);
    // e.g. "_wdf_output/prd.md" → "prd"; "_wdf_output/stories/S-001.md" → "S-001"
    const base = basename(artifactPath).replace(/\.[^.]+$/, '');
    return base;
}

/**
 * Prepare a review manifest for a planning artifact. The parent Claude session
 * consumes the manifest with the Agent tool: dispatch one review sub-agent,
 * which reads the artifact, writes a verdict report to `output_path`.
 */
export function prepareArtifactReview(projectRoot: string, artifactPath: string, reviewFocus?: string): ReviewManifest {
    if (!existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}`);
    }
    const artifactId = artifactIdFromPath(projectRoot, artifactPath);
    const dir = reviewDir(projectRoot);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const outputPath = join(dir, `${artifactId}-review.json`);
    const manifest: ReviewManifest = {
        artifact_id: artifactId,
        artifact_path: artifactPath,
        artifact_rel_path: relative(projectRoot, artifactPath),
        generated_at: new Date().toISOString(),
        review_focus: reviewFocus,
        instruction_for_parent_agent: 'Dispatch one review sub-agent via the Agent tool (subagent_type=general-purpose). ' +
            'The sub-agent reads the artifact, evaluates it against the review_focus (if set) ' +
            'plus standard quality dimensions (traceability, completeness, clarity, consistency), ' +
            'and writes a JSON ReviewReport to output_path.',
        output_path: outputPath,
        output_format: {
            artifact_id: artifactId,
            verdict: 'pass | fail | changes_requested',
            score: '0-100 (optional)',
            summary: 'one-paragraph summary of the review',
            strengths: ['list of 2-3 strengths'],
            issues: [
                {
                    severity: 'blocker | major | minor | nit',
                    location: 'section / heading / line (optional)',
                    message: 'what is wrong',
                    suggested_fix: 'how to fix it',
                },
            ],
            reviewer_agent: 'review sub-agent identifier',
            reviewed_at: 'ISO 8601 timestamp',
        },
    };
    const manifestPath = join(dir, `${artifactId}-manifest.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    appendAudit(projectRoot, 'agent_dispatch_start', {
        status: 'info',
        message: `Prepared review manifest for ${artifactId}`,
        details: {
            artifact_id: artifactId,
            artifact_path: manifest.artifact_rel_path,
            review_focus: reviewFocus,
        },
    });
    return manifest;
}

/**
 * Collect a review report written by a dispatched review sub-agent.
 * Returns the verdict and a flag indicating whether Party Mode should be
 * triggered to patch the artifact (verdict === 'fail' or 'changes_requested').
 */
export function collectArtifactReview(projectRoot: string, artifactId: string): ReviewResult {
    const reportPath = join(reviewDir(projectRoot), `${artifactId}-review.json`);
    if (!existsSync(reportPath)) {
        return {
            artifact_id: artifactId,
            verdict: 'fail',
            report: null,
            should_trigger_party: false,
        };
    }
    let report: ReviewReport;
    try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'));
    }
    catch (err) {
        return {
            artifact_id: artifactId,
            verdict: 'fail',
            report: null,
            should_trigger_party: false,
        };
    }
    const verdict = report.verdict ?? 'fail';
    const shouldTriggerParty = verdict !== 'pass';
    appendAudit(projectRoot, 'agent_dispatch_complete', {
        status: verdict === 'pass' ? 'pass' : 'fail',
        message: `Review collected for ${artifactId}: ${verdict}${shouldTriggerParty ? ' (suggest Party Mode)' : ''}`,
        details: {
            artifact_id: artifactId,
            verdict,
            score: report.score,
            issue_count: report.issues?.length ?? 0,
        },
    });
    return {
        artifact_id: artifactId,
        verdict,
        report,
        should_trigger_party: shouldTriggerParty,
    };
}

/**
 * List pending reviews — artifacts with a manifest but no report yet.
 * Useful for `wdf review status` and CI checks.
 */
export function listPendingReviews(projectRoot: string): Array<{
    artifact_id: string;
    manifest_path: string;
    report_exists: boolean;
}> {
    const dir = reviewDir(projectRoot);
    if (!existsSync(dir))
        return [];
    const items: Array<{ artifact_id: string; manifest_path: string; report_exists: boolean }> = [];
    for (const f of readdirSync(dir)) {
        const m = f.match(/^(.+)-manifest\.json$/);
        if (!m)
            continue;
        const artifactId = m[1];
        const manifestPath = join(dir, f);
        const reportPath = join(dir, `${artifactId}-review.json`);
        items.push({
            artifact_id: artifactId,
            manifest_path: manifestPath,
            report_exists: existsSync(reportPath),
        });
    }
    return items;
}

export type ReviewVerdict = 'pass' | 'fail' | 'changes_requested';

export interface ReviewManifest {
    artifact_id: string;
    artifact_path: string;
    artifact_rel_path: string;
    generated_at: string;
    review_focus?: string;
    instruction_for_parent_agent: string;
    output_path: string;
    output_format: Record<string, any>;
}

export interface ReviewReport {
    artifact_id: string;
    verdict: ReviewVerdict;
    score?: number;
    summary: string;
    strengths?: string[];
    issues?: Array<{
        severity: 'blocker' | 'major' | 'minor' | 'nit';
        location?: string;
        message: string;
        suggested_fix?: string;
    }>;
    reviewer_agent?: string;
    reviewed_at: string;
}

export interface ReviewResult {
    artifact_id: string;
    verdict: ReviewVerdict;
    report: ReviewReport | null;
    should_trigger_party: boolean;
}
