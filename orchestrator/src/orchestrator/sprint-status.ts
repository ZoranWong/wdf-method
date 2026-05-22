import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import YAML from 'js-yaml';
import { SprintStatus, PhaseStatus, StoryStatus, StoryEntry } from './types.js';

/**
 * Atomic file write: write to temp file, then rename (filesystem-level atomic).
 * Prevents YAML corruption from concurrent writes or interrupted writes.
 */
function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * SprintStatusManager handles all read/write operations.
 * V3.6: Supports split-file mode — reads/writes status/ directory files.
 * Falls back to unified sprint-status.yaml for backward compatibility.
 */
export class SprintStatusManager {
  private status: SprintStatus;
  private filePath: string;
  private statusDir: string | null;

  private constructor(filePath: string, status: SprintStatus, statusDir?: string) {
    this.filePath = filePath;
    this.status = status;
    this.statusDir = statusDir ?? null;
  }

  /** Load from unified sprint-status.yaml */
  static async load(filePath: string): Promise<SprintStatusManager> {
    if (!existsSync(filePath)) {
      return new SprintStatusManager(filePath, SprintStatusManager.defaultStatus(filePath));
    }
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = YAML.load(raw) as SprintStatus;
    return new SprintStatusManager(filePath, parsed);
  }

  /** V3.6: Load from split status/ directory */
  static async loadFromStatusDir(statusDir: string, fallbackPath: string): Promise<SprintStatusManager> {
    if (!existsSync(statusDir)) {
      return SprintStatusManager.load(fallbackPath);
    }

    // Try to load global first
    const globalFile = join(statusDir, 'global.yaml');
    let global: any = {};
    if (existsSync(globalFile)) {
      global = YAML.load(readFileSync(globalFile, 'utf-8')) as any;
    }

    // Merge all phase files
    const phases: Record<string, any> = {};
    for (const phaseNum of [1, 2, 3, 4]) {
      const phaseFile = join(statusDir, `phase-0${phaseNum}.yaml`);
      const beFile = join(statusDir, `phase-04-be.yaml`);
      const feFile = join(statusDir, `phase-04-fe.yaml`);

      if (existsSync(phaseFile)) {
        const data = YAML.load(readFileSync(phaseFile, 'utf-8')) as any;
        Object.assign(phases, data);
      }
      if (phaseNum === 4 && existsSync(beFile)) {
        const be = YAML.load(readFileSync(beFile, 'utf-8')) as any;
        Object.assign(phases, be);
      }
      if (phaseNum === 4 && existsSync(feFile)) {
        const fe = YAML.load(readFileSync(feFile, 'utf-8')) as any;
        Object.assign(phases, fe);
      }
    }

    // CRs
    const crFile = join(statusDir, 'change-requests.yaml');
    let changeRequests: any[] = [];
    if (existsSync(crFile)) {
      const crData = YAML.load(readFileSync(crFile, 'utf-8')) as any;
      changeRequests = crData?.change_requests ?? [];
    }

    const status: SprintStatus = {
      project: global?.global_state?.project ?? 'unknown',
      workflow_version: global?.global_state?.workflow_version ?? '3.6.0',
      created_at: global?.global_state?.created_at ?? new Date().toISOString(),
      updated_at: global?.global_state?.updated_at ?? new Date().toISOString(),
      global_state: {
        dev_mode: global?.global_state?.dev_mode ?? 'separated',
        task_triage_mode: global?.global_state?.task_triage_mode ?? 'serial',
        code_standards_source: global?.global_state?.code_standards_source ?? ['AGENTS.md'],
        overall_status: global?.global_state?.overall_status ?? 'not_started',
        current_phase: global?.global_state?.current_phase ?? 1,
        requirements_frozen_at: global?.global_state?.requirements_frozen_at,
        development_order: global?.global_state?.development_order ?? [],
        development_order_frozen_at: global?.global_state?.development_order_frozen_at,
        implementation_boundary: global?.global_state?.implementation_boundary,
      } as any,
      phases: phases as any,
      change_requests: changeRequests,
    };

    return new SprintStatusManager(fallbackPath, status, statusDir);
  }

  /** V3.6: Save to split files when statusDir is configured */
  async save(): Promise<void> {
    this.status.updated_at = new Date().toISOString();

    if (this.statusDir && existsSync(this.statusDir)) {
      // Write global.yaml
      const globalData = {
        global_state: {
          ...this.status.global_state,
          project: this.status.project,
          workflow_version: this.status.workflow_version,
          created_at: this.status.created_at,
          updated_at: this.status.updated_at,
        },
      };
      atomicWrite(join(this.statusDir, 'global.yaml'), YAML.dump(globalData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }));

      // Write per-phase files
      const phaseMap: Record<number, string[]> = {
        1: ['phase_1'],
        2: ['phase_2'],
        3: ['phase_3'],
        4: ['phase_4', 'phase_4_be', 'phase_4_fe'],
      };
      for (const [phaseNum, keys] of Object.entries(phaseMap)) {
        const phaseData: Record<string, any> = {};
        for (const key of keys) {
          if (this.status.phases[key]) {
            phaseData[key] = this.status.phases[key];
          }
        }
        if (Object.keys(phaseData).length > 0) {
          const fileName = Number(phaseNum) === 4 && keys.length > 1 ? `phase-0${phaseNum}-be.yaml` : `phase-0${phaseNum}.yaml`;
          atomicWrite(join(this.statusDir, fileName), YAML.dump(phaseData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }));
        }
      }

      // Write CRs
      atomicWrite(join(this.statusDir, 'change-requests.yaml'), YAML.dump({ change_requests: this.status.change_requests }, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }));
    }

    // Always write unified as fallback
    const yaml = YAML.dump(this.status, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
    atomicWrite(this.filePath, yaml);
  }

  private static defaultStatus(filePath: string): SprintStatus {
    const now = new Date().toISOString();
    return {
      project: 'unknown',
      workflow_version: '3.1.0',
      created_at: now,
      updated_at: now,
      global_state: {
        dev_mode: 'separated',
        task_triage_mode: 'serial',
        code_standards_source: ['AGENTS.md'],
        overall_status: 'not_started',
        current_phase: 1,
        merge_queue: { enabled: true, items: [] },
      },
      phases: {
        phase_1: { status: 'NOT_STARTED', gate_card: { checks: [], all_pass: false } },
        phase_2: { status: 'NOT_STARTED', gate_card: { checks: [], all_pass: false } },
        phase_3: { status: 'NOT_STARTED', gate_card: { checks: [], all_pass: false } },
        phase_4: { status: 'NOT_STARTED', gate_card: { checks: [], all_pass: false } },
      },
      change_requests: [],
    };
  }

  get data(): SprintStatus {
    return this.status;
  }

  async save(): Promise<void> {
    this.status.updated_at = new Date().toISOString();
    const yaml = YAML.dump(this.status, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
    atomicWrite(this.filePath, yaml);
  }

  // ── Phase state ──

  getPhase(phaseNum: number) {
    return this.status.phases[`phase_${phaseNum}`];
  }

  async setPhaseStatus(phaseNum: number, status: PhaseStatus): Promise<void> {
    const phase = this.getPhase(phaseNum);
    if (!phase) throw new Error(`Phase ${phaseNum} not found`);
    if (phase.status !== status) {
      phase.status = status;
      if (!phase.state_history) phase.state_history = [];
      phase.state_history.push({ state: status, at: new Date().toISOString() });
      this.status.global_state.current_phase = Math.max(this.status.global_state.current_phase, phaseNum);
      await this.save();
    }
  }

  async setSubState(phaseNum: number, subKey: string, status: string): Promise<void> {
    const phase = this.getPhase(phaseNum);
    if (!phase) throw new Error(`Phase ${phaseNum} not found`);
    if (!phase.substates) phase.substates = {};
    if (!phase.substates[subKey]) {
      phase.substates[subKey] = { status, state_history: [] };
    } else {
      phase.substates[subKey].status = status;
      if (!phase.substates[subKey].state_history) {
        phase.substates[subKey].state_history = [];
      }
      phase.substates[subKey].state_history.push({ state: status, at: new Date().toISOString() });
    }
    await this.save();
  }

  getSubState(phaseNum: number, subKey: string): string | undefined {
    const phase = this.getPhase(phaseNum);
    return phase?.substates?.[subKey]?.status;
  }

  // ── Story state ──

  getStories(phaseNum: number, subKey: string): StoryStatus[] {
    const phase = this.getPhase(phaseNum);
    return phase?.substates?.[subKey]?.stories ?? [];
  }

  async updateStoryStatus(phaseNum: number, subKey: string, story: StoryStatus): Promise<void> {
    const phase = this.getPhase(phaseNum);
    if (!phase) throw new Error(`Phase ${phaseNum} not found`);
    if (!phase.substates) phase.substates = {};
    if (!phase.substates[subKey]) {
      phase.substates[subKey] = { status: 'IN_PROGRESS', stories: [] };
    }
    if (!phase.substates[subKey].stories) {
      phase.substates[subKey].stories = [];
    }
    const idx = phase.substates[subKey].stories.findIndex(s => s.id === story.id);
    if (idx >= 0) {
      phase.substates[subKey].stories[idx] = story;
    } else {
      phase.substates[subKey].stories.push(story);
    }
    await this.save();
  }

  // ── Development order ──

  getDevelopmentOrder(): StoryEntry[] {
    return this.status.global_state.development_order ?? [];
  }

  async setDevelopmentOrder(order: StoryEntry[]): Promise<void> {
    this.status.global_state.development_order = order;
    await this.save();
  }

  async freezeDevelopmentOrder(): Promise<void> {
    this.status.global_state.development_order_frozen_at = new Date().toISOString();
    await this.save();
  }

  async freezeRequirements(): Promise<void> {
    this.status.global_state.requirements_frozen_at = new Date().toISOString();
    await this.save();
  }

  // ── Change requests ──

  async addChangeRequest(cr: {
    title: string; source_phase: number; source_artifact: string;
    discovered_in_phase: number; severity: 'blocking' | 'non_blocking';
    description: string; created_by: string;
  }): Promise<void> {
    const id = `CR-${String(this.status.change_requests.length + 1).padStart(3, '0')}`;
    this.status.change_requests.push({
      id,
      ...cr,
      created_at: new Date().toISOString(),
      status: 'open',
    });
    if (cr.severity === 'blocking') {
      this.status.global_state.blocked_by = id;
      this.status.global_state.overall_status = 'blocked';
    }
    await this.save();
  }

  async resolveChangeRequest(crId: string, resolution: string): Promise<void> {
    const cr = this.status.change_requests.find(c => c.id === crId);
    if (!cr) throw new Error(`CR ${crId} not found`);
    cr.status = 'resolved';
    cr.resolution = resolution;
    cr.resolved_at = new Date().toISOString();
    if (this.status.global_state.blocked_by === crId) {
      this.status.global_state.blocked_by = undefined;
    }
    await this.save();
  }

  getOpenBlockingCRs(): typeof this.status.change_requests {
    return this.status.change_requests.filter(
      cr => cr.severity === 'blocking' && cr.status !== 'resolved'
    );
  }

  // ── Merge queue ──

  getMergeQueue() {
    return this.status.global_state.merge_queue ?? { enabled: false, items: [] };
  }

  async enqueueMerge(item: any): Promise<void> {
    const mq = this.status.global_state.merge_queue;
    if (!mq) throw new Error('Merge queue not initialized');
    // Check duplicate
    if (mq.items.find(i => i.story_id === item.story_id && !i.unit_id)) {
      return; // Already enqueued
    }
    mq.items.push({ ...item, merge_status: 'queued' });
    await this.save();
  }

  async updateMergeItem(storyId: string, updates: any): Promise<void> {
    const mq = this.status.global_state.merge_queue;
    if (!mq) return;
    const item = mq.items.find(i => i.story_id === storyId);
    if (item) Object.assign(item, updates);
    await this.save();
  }

  // ── Overall status ──

  async setOverallStatus(status: string): Promise<void> {
    this.status.global_state.overall_status = status;
    await this.save();
  }

  getOverallStatus(): string {
    return this.status.global_state.overall_status;
  }

  // ── Implementation boundary ──

  async setImplementationBoundary(boundary: {
    backend_scope: string[]; frontend_scope: string[];
    shared_scope: string[]; forbidden_paths: string[];
  }): Promise<void> {
    this.status.global_state.implementation_boundary = {
      defined_at: new Date().toISOString(),
      scope_frozen: true,
      ...boundary,
    };
    await this.save();
  }

  // ── Gate card ──

  async setGateCard(phaseNum: number, checks: { id: string; status: 'pass' | 'fail' | 'skipped'; type?: string; description?: string }[]): Promise<void> {
    const phase = this.getPhase(phaseNum);
    if (!phase) return;
    phase.gate_card = { phase: phaseNum,
      checks: checks.map(c => ({ id: c.id, status: c.status, type: c.type ?? 'custom_check', description: c.description ?? 'Gate check' })),
      all_pass: checks.every(c => c.status === 'pass'),
    };
    await this.save();
  }

  isGatePassed(phaseNum: number): boolean {
    return this.getPhase(phaseNum)?.gate_card?.all_pass ?? false;
  }
}
