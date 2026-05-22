/**
 * Page Parity Gate (V3.1 #10)
 *
 * Before coding, frontend page stories must read UX specs (wireframes.md, design-tokens.md)
 * and output a gap list against design prototypes. After coding, browser runtime verification
 * with screenshots is required.
 *
 * This validator operates in two modes:
 *   PRE-IMPL: Read UX specs → generate gap list → user reviews before coding starts
 *   POST-IMPL: Browser runtime verification → compare screenshots against design specs
 */
export interface GapItem {
    severity: 'critical' | 'major' | 'minor';
    page: string;
    component: string;
    description: string;
    design_ref: string;
}
export interface PageParityReport {
    story_id: string;
    timestamp: string;
    mode: 'PRE_IMPL' | 'POST_IMPL';
    ux_specs_read: string[];
    gap_items: GapItem[];
    gap_count: number;
    passed: boolean;
    screenshots?: string[];
}
export declare class PageParityGate {
    private projectRoot;
    private uxSpecPaths;
    constructor(projectRoot: string, outputDir: string);
    /**
     * PRE-IMPL: Read UX specs and generate initial gap list.
     * This is called BEFORE story coding starts in Phase 4.10.
     */
    preImplCheck(storyId: string, storyScope: string[]): Promise<PageParityReport>;
    /**
     * POST-IMPL: Verify implementation against design specs using browser screenshots.
     * This is called AFTER story coding completes in Phase 4.10 (Step 4e).
     */
    postImplCheck(storyId: string, screenshots: string[], preImplGaps: GapItem[]): Promise<PageParityReport>;
    /**
     * Extract gap items by comparing story scope against wireframes/design-tokens content.
     */
    private extractGaps;
    /**
     * Format the page parity report as a readable text block.
     */
    formatReport(report: PageParityReport): string;
}
//# sourceMappingURL=page-parity-gate.d.ts.map