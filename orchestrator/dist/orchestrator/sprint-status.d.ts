import { SprintStatus, PhaseStatus, StoryStatus, StoryEntry } from './types.js';
/**
 * SprintStatusManager handles all read/write operations on sprint-status.yaml.
 * Every write is atomic to prevent concurrent-write corruption.
 */
export declare class SprintStatusManager {
    private status;
    private filePath;
    private constructor();
    static load(filePath: string): Promise<SprintStatusManager>;
    private static defaultStatus;
    get data(): SprintStatus;
    save(): Promise<void>;
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
    enqueueMerge(item: Omit<typeof this.status.global_state.merge_queue.items[0], 'merge_status'>): Promise<void>;
    updateMergeItem(storyId: string, updates: Partial<typeof this.status.global_state.merge_queue.items[0]>): Promise<void>;
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
    }[]): Promise<void>;
    isGatePassed(phaseNum: number): boolean;
}
//# sourceMappingURL=sprint-status.d.ts.map