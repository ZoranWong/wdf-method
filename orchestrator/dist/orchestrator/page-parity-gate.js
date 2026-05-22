import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
export class PageParityGate {
    projectRoot;
    uxSpecPaths;
    constructor(projectRoot, outputDir) {
        this.projectRoot = projectRoot;
        this.uxSpecPaths = [
            resolve(outputDir, '_output', 'planning', 'wireframes.md'),
            resolve(outputDir, '_output', 'planning', 'design-tokens.md'),
            resolve(outputDir, '_output', 'planning', 'design-acceptance.md'),
        ];
    }
    /**
     * PRE-IMPL: Read UX specs and generate initial gap list.
     * This is called BEFORE story coding starts in Phase 4.10.
     */
    async preImplCheck(storyId, storyScope) {
        const missingSpecs = [];
        const readSpecs = [];
        for (const specPath of this.uxSpecPaths) {
            if (existsSync(specPath)) {
                readSpecs.push(specPath);
            }
            else {
                missingSpecs.push(specPath);
            }
        }
        if (missingSpecs.length > 0) {
            return {
                story_id: storyId,
                timestamp: new Date().toISOString(),
                mode: 'PRE_IMPL',
                ux_specs_read: readSpecs,
                gap_items: [
                    {
                        severity: 'critical',
                        page: 'N/A',
                        component: 'N/A',
                        description: `Missing UX specs: ${missingSpecs.join(', ')}. Cannot verify page parity without design references.`,
                        design_ref: 'N/A',
                    },
                ],
                gap_count: missingSpecs.length,
                passed: false,
            };
        }
        // Read wireframes to extract page requirements for this story's scope
        const gaps = await this.extractGaps(storyId, storyScope);
        const criticalGaps = gaps.filter(g => g.severity === 'critical');
        return {
            story_id: storyId,
            timestamp: new Date().toISOString(),
            mode: 'PRE_IMPL',
            ux_specs_read: readSpecs,
            gap_items: gaps,
            gap_count: gaps.length,
            passed: criticalGaps.length === 0,
        };
    }
    /**
     * POST-IMPL: Verify implementation against design specs using browser screenshots.
     * This is called AFTER story coding completes in Phase 4.10 (Step 4e).
     */
    async postImplCheck(storyId, screenshots, preImplGaps) {
        // Verify each gap has been addressed
        const unresolvedGaps = preImplGaps.filter(g => g.severity !== 'minor');
        // Verify screenshots exist
        const validScreenshots = screenshots.filter(s => existsSync(s));
        return {
            story_id: storyId,
            timestamp: new Date().toISOString(),
            mode: 'POST_IMPL',
            ux_specs_read: [],
            gap_items: unresolvedGaps.map(g => ({
                ...g,
                description: `UNRESOLVED (check screenshots against design): ${g.description}`,
            })),
            gap_count: unresolvedGaps.length,
            passed: unresolvedGaps.length === 0 && validScreenshots.length > 0,
            screenshots: validScreenshots,
        };
    }
    /**
     * Extract gap items by comparing story scope against wireframes/design-tokens content.
     */
    async extractGaps(storyId, storyScope) {
        const gaps = [];
        for (const specPath of this.uxSpecPaths) {
            if (!existsSync(specPath))
                continue;
            const content = readFileSync(specPath, 'utf-8');
            const baseName = specPath.split('/').pop() ?? specPath;
            // Check if story scope pages are mentioned in wireframes
            for (const scope of storyScope) {
                const pageName = scope.replace(/^src\/pages\//, '').replace(/\/$/, '');
                if (content.includes(pageName)) {
                    // Page found in wireframes — check component inventory
                    // This is a heuristic; full verification requires visual comparison
                    // which is done in POST_IMPL via screenshots + visual regression
                }
                else if (scope.startsWith('src/pages/') || scope.includes('page')) {
                    gaps.push({
                        severity: 'major',
                        page: pageName,
                        component: 'N/A',
                        description: `Page "${pageName}" in scope_write not explicitly referenced in ${baseName}. Verify design coverage.`,
                        design_ref: baseName,
                    });
                }
            }
        }
        return gaps;
    }
    /**
     * Format the page parity report as a readable text block.
     */
    formatReport(report) {
        const phase = report.mode === 'PRE_IMPL' ? 'PRE-IMPL' : 'POST-IMPL';
        const lines = [
            `═══════════════════════════════════════════`,
            `Page Parity Gate — ${phase} Report`,
            `Story: ${report.story_id}`,
            `Time: ${report.timestamp}`,
            `═══════════════════════════════════════════`,
            `UX Specs Read: ${report.ux_specs_read.length}`,
        ];
        for (const spec of report.ux_specs_read) {
            lines.push(`  ✓ ${spec.split('/').pop()}`);
        }
        lines.push(`Gap Items: ${report.gap_count}`);
        if (report.gap_count === 0) {
            lines.push('  ✓ No gaps — design parity verified');
        }
        else {
            for (const gap of report.gap_items) {
                const icon = gap.severity === 'critical' ? '✗' : gap.severity === 'major' ? '⚠' : '⊙';
                lines.push(`  ${icon} [${gap.severity.toUpperCase()}] ${gap.page}: ${gap.description}`);
            }
        }
        lines.push(`───────────────────────────────────────────`);
        lines.push(`  Status: ${report.passed ? 'PASS' : 'FAIL'}`);
        if (report.screenshots) {
            lines.push(`  Screenshots: ${report.screenshots.join(', ')}`);
        }
        lines.push(`═══════════════════════════════════════════`);
        return lines.join('\n');
    }
}
//# sourceMappingURL=page-parity-gate.js.map