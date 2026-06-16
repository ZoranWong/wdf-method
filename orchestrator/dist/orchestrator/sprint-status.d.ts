import { SprintStatus, PhaseStatus, StoryStatus, StoryEntry } from './types.js';
/**
 * SprintStatusManager handles all read/write operations.
 * V3.6: Supports split-file mode — reads/writes status/ directory files.
 * Falls back to unified sprint-status.yaml for backward compatibility.
 */
export declare class SprintStatusManager {
    private status;
    private filePath;
    private statusDir;
    private constructor();
    /** Load from unified sprint-status.yaml */
    static load(filePath: string): Promise<SprintStatusManager>;
    /** V3.6: Load from split status/ directory */
    static loadFromStatusDir(statusDir: string, fallbackPath: string): Promise<SprintStatusManager>;
    /** V3.6: Save to split files when statusDir is configured */
    save(): Promise<void>;
    private static defaultStatus;
    get data(): SprintStatus;
    appendAudit(event: string, data?: Record<string, any>): Promise<void>;
    getPhase(phaseNum: number): import("./types.js").PhaseState;
    setPhaseStatus(phaseNum: number, status: PhaseStatus): Promise<void>;
    setSubState(phaseNum: number, subKey: string, status: string): Promise<void>;
    getSubState(phaseNum: number, subKey: string): string | undefined;
    getStories(phaseNum: number, subKey: string): StoryStatus[];
    updateStoryStatus(phaseNum: number, subKey: string, story: StoryStatus): Promise<void>;
    getDevelopmentOrder(): StoryEntry[];
    setDevelopmentOrder(order: StoryEntry[]): Promise<void>;
    freezeDevelopmentOrder(): Promise<void>;
    freezeRequirements(): Promise<void>;
    addChangeRequest(cr: {
        title: string;
        source_phase: number;
        source_artifact: string;
        discovered_in_phase: number;
        severity: 'blocking' | 'non_blocking';
        description: string;
        created_by: string;
    }): Promise<void>;
    resolveChangeRequest(crId: string, resolution: string): Promise<void>;
    getOpenBlockingCRs(): typeof this.status.change_requests;
    getMergeQueue(): {
        enabled: boolean;
        items: import("./types.js").MergeQueueItem[];
    };
    enqueueMerge(item: any): Promise<void>;
    updateMergeItem(storyId: string, updates: any): Promise<void>;
    setOverallStatus(status: string): Promise<void>;
    getOverallStatus(): string;
    setImplementationBoundary(boundary: {
        backend_scope: string[];
        frontend_scope: string[];
        shared_scope: string[];
        forbidden_paths: string[];
    }): Promise<void>;
    setGateCard(phaseNum: number, checks: {
        id: string;
        status: 'pass' | 'fail' | 'skipped';
        type?: string;
        description?: string;
    }[]): Promise<void>;
    isGatePassed(phaseNum: number): boolean;
}
//# sourceMappingURL=sprint-status.d.ts.map