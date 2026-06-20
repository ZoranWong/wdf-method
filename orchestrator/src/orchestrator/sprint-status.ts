import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync, openSync, closeSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import YAML from 'js-yaml';
import { SprintStatus, PhaseStatus, StoryStatus, StoryEntry } from './types.js';
import { backupFileBeforeWrite } from './status-backup.js';

/**
 * Atomic file write: write to temp file, then rename (filesystem-level atomic).
 * Prevents YAML corruption from concurrent writes or interrupted writes.
 *
 * If `statusDir` is provided and the destination file already exists, a
 * timestamped backup copy is placed under `<statusDir>/backup/` before the
 * write. Backup failures do not block the write.
 */
function atomicWrite(filePath: string, content: string, statusDir?: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const backupDir = statusDir ?? dir;
  try {
    backupFileBeforeWrite(filePath, backupDir);
  } catch {
    // Backup is best-effort — never block the primary write.
  }

  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Single-writer lockfile enforcement.
 *
 * WDF design rule: every status file has exactly one writer at a time. Two
 * concurrent `wdf` invocations (e.g. a /wdf-start loop racing a manual
 * /wdf-status) used to silently clobber each other. This lock makes the
 * contract enforceable: save() blocks until the lock is acquired.
 *
 * Implementation: O_EXCL create of `<statusDir>/.lock`. Stale locks older
 * than STALE_MS are auto-reaped (covers a killed process). Lock content is
 * `pid\nstarted_at_iso` for diagnostics.
 */
const LOCK_NAME = '.wdf-status.lock';
const STALE_MS = 5 * 60 * 1000; // 5 min — longer than any single CLI command
const RETRY_MS = 50;
const MAX_WAIT_MS = 10 * 1000; // 10 s ceiling — fail loud over indefinite block

function lockPath(statusDir: string): string {
  return join(statusDir, LOCK_NAME);
}

function tryAcquireLock(statusDir: string): boolean {
  const path = lockPath(statusDir);
  // Best-effort stale cleanup before we attempt our own create.
  reapStaleLock(statusDir);
  try {
    const fd = openSync(path, 'wx'); // O_EXCL — fails if file exists
    const payload = `${process.pid}\n${new Date().toISOString()}\n`;
    writeFileSync(fd, payload, 'utf-8');
    closeSync(fd);
    return true;
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      // Permission or filesystem error — fall back to non-locking mode
      // rather than blocking the entire CLI. Log once to stderr.
      console.error(`[wdf] lock acquire failed (${err.code}); proceeding without lock`);
      return true;
    }
    return false;
  }
}

function reapStaleLock(statusDir: string): void {
  const path = lockPath(statusDir);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  const age = Date.now() - st.mtimeMs;
  if (age < STALE_MS) return;
  try {
    unlinkSync(path);
  } catch {
    /* race with another reaper — ignore */
  }
}

function releaseLock(statusDir: string): void {
  try {
    unlinkSync(lockPath(statusDir));
  } catch {
    /* already released — fine */
  }
}

/**
 * Block until the status dir lock is acquired or MAX_WAIT_MS elapses.
 * Returns true on acquisition, false on timeout (caller proceeds without
 * the lock and logs a warning — better than deadlocking the CLI).
 */
function waitForLock(statusDir: string): boolean {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (tryAcquireLock(statusDir)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_MS);
  }
  return false;
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
  /**
   * Raw global.yaml object as last loaded from disk. Preserved verbatim so save()
   * can write back the init-compatible flat schema (project / workflow / tech_stack
   * / quality_gates / scope_lock / agents / audit) instead of collapsing into a
   * `global_state:` wrapper that load() can no longer round-trip. See BUG-2 fix.
   */
  private rawGlobal: any | null;

  private constructor(filePath: string, status: SprintStatus, statusDir?: string, rawGlobal?: any) {
    this.filePath = filePath;
    this.status = status;
    this.statusDir = statusDir ?? null;
    this.rawGlobal = rawGlobal ?? null;
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

    // Merge all phase files, keyed by phase number
    const phases: Record<string, any> = {};
    for (const phaseNum of [1, 2, 3, 4]) {
      const phaseFile = join(statusDir, `phase-0${phaseNum}.yaml`);
      const beFile = join(statusDir, `phase-04-be.yaml`);
      const feFile = join(statusDir, `phase-04-fe.yaml`);

      // Initialize phase entry
      const phaseKey = `phase_${phaseNum}`;
      phases[phaseKey] = {
        status: 'NOT_STARTED',
        substates: {},
        state_history: [],
      };

      if (existsSync(phaseFile)) {
        const data = YAML.load(readFileSync(phaseFile, 'utf-8')) as any;
        // Map sub_phases → substates (naming convention fix)
        if (data.sub_phases) {
          data.substates = data.sub_phases;
          delete data.sub_phases;
        }
        // Map fsm → state_history
        if (data.fsm?.state_history) {
          data.state_history = data.fsm.state_history;
        }
        Object.assign(phases[phaseKey], data);
      }
      if (phaseNum === 4 && existsSync(beFile)) {
        const be = YAML.load(readFileSync(beFile, 'utf-8')) as any;
        if (be.sub_phases) {
          if (!phases[phaseKey].substates) phases[phaseKey].substates = {};
          Object.assign(phases[phaseKey].substates, be.sub_phases);
        }
        if (be.status) phases[phaseKey].status = be.status;
      }
      if (phaseNum === 4 && existsSync(feFile)) {
        const fe = YAML.load(readFileSync(feFile, 'utf-8')) as any;
        if (fe.sub_phases) {
          if (!phases[phaseKey].substates) phases[phaseKey].substates = {};
          Object.assign(phases[phaseKey].substates, fe.sub_phases);
        }
        if (fe.status) phases[phaseKey].status = fe.status;
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
      project: global?.project?.name ?? 'unknown',
      workflow_version: global?.workflow?.version ?? '3.6.0',
      created_at: global?.project?.created_at ?? new Date().toISOString(),
      updated_at: global?.audit?.last_updated_at ?? new Date().toISOString(),
      global_state: {
        dev_mode: global?.workflow?.dev_mode ?? 'separated',
        task_triage_mode: global?.workflow?.task_triage_mode ?? 'serial',
        execution_mode: global?.workflow?.execution_mode ?? 'interactive',
        project_description: global?.project?.description ?? '',
        code_standards_source: ['AGENTS.md'],
        overall_status: global?.workflow?.overall_status ?? 'not_started',
        current_phase: global?.workflow?.current_phase ?? 1,
        requirements_frozen_at: global?.workflow?.requirements_frozen_at,
        development_order: global?.workflow?.development_order ?? [],
        development_order_frozen_at: global?.workflow?.development_order_frozen_at,
        implementation_boundary: global?.workflow?.implementation_boundary,
      } as any,
      phases: phases as any,
      change_requests: changeRequests,
    };

    return new SprintStatusManager(fallbackPath, status, statusDir, global);
  }

  /** V3.6: Save to split files when statusDir is configured */
  async save(): Promise<void> {
    this.status.updated_at = new Date().toISOString();

    // Single-writer lock: prevent two concurrent CLI processes from
    // clobbering each other's status writes. Lock is per statusDir so two
    // different projects don't block each other.
    let heldLock = false;
    if (this.statusDir && existsSync(this.statusDir)) {
      heldLock = waitForLock(this.statusDir);
      if (!heldLock) {
        console.error(`[wdf] status lock busy for >${MAX_WAIT_MS}ms; proceeding without lock (risk of write race)`);
      }
    }

    try {
      return await this.saveInner();
    } finally {
      if (heldLock && this.statusDir) releaseLock(this.statusDir);
    }
  }

  private async saveInner(): Promise<void> {
    if (this.statusDir && existsSync(this.statusDir)) {
      const statusDir = this.statusDir;
      // Write global.yaml. Preserve init's flat schema (project / workflow /
      // tech_stack / ...) by mutating the raw object in place — only update
      // fields the FSM actually owns. Fall back to a minimal flat structure
      // if no raw was loaded.
      const globalData: any = this.rawGlobal ?? {
        project: { name: this.status.project, created_at: this.status.created_at },
        workflow: {},
      };
      // Sync FSM-owned workflow fields
      if (!globalData.workflow) globalData.workflow = {};
      const gs: any = this.status.global_state ?? {};
      if (gs.overall_status !== undefined) globalData.workflow.overall_status = gs.overall_status;
      if (gs.current_phase !== undefined) globalData.workflow.current_phase = gs.current_phase;
      if (gs.requirements_frozen_at !== undefined) globalData.workflow.requirements_frozen_at = gs.requirements_frozen_at;
      if (gs.development_order_frozen_at !== undefined) globalData.workflow.development_order_frozen_at = gs.development_order_frozen_at;
      if (gs.development_order !== undefined) globalData.workflow.development_order = gs.development_order;
      if (gs.implementation_boundary !== undefined) globalData.workflow.implementation_boundary = gs.implementation_boundary;
      // Audit timestamps
      if (!globalData.audit) globalData.audit = { created_by: 'wdf-init', created_at: this.status.created_at };
      globalData.audit.last_updated_at = this.status.updated_at;
      atomicWrite(join(statusDir, 'global.yaml'), YAML.dump(globalData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);
      // Keep our cached raw in sync so subsequent saves don't regress
      this.rawGlobal = globalData;

      // Write per-phase files in init-compatible format
      const phaseMap: Record<number, { key: string; otherKeys?: string[] }> = {
        1: { key: 'phase_1' },
        2: { key: 'phase_2' },
        3: { key: 'phase_3' },
        4: { key: 'phase_4', otherKeys: ['phase_4_be', 'phase_4_fe'] },
      };
      for (const [phaseNumStr, cfg] of Object.entries(phaseMap)) {
        const phaseNum = parseInt(phaseNumStr, 10);
        const phase = this.status.phases[cfg.key];
        if (!phase) continue;

        // Write main phase file in init-compatible flat format
        const mainData: Record<string, any> = {
          phase: phaseNum,
          title: this.phaseTitle(phaseNum),
          status: phase.status ?? 'NOT_STARTED',
          fsm: {
            current_state: phase.status ?? 'NOT_STARTED',
            state_history: phase.state_history ?? [],
          },
          sub_phases: phase.substates ?? {},  // Write as sub_phases (init format)
        };
        atomicWrite(join(statusDir, `phase-0${phaseNum}.yaml`), YAML.dump(mainData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);

        // Write BE/FE track files for Phase 4
        if (phaseNum === 4 && cfg.otherKeys) {
          for (const otherKey of cfg.otherKeys) {
            const otherPhase = this.status.phases[otherKey];
            if (otherPhase) {
              const trackType = otherKey === 'phase_4_be' ? 'backend' : 'frontend';
              const trackData: Record<string, any> = {
                track: trackType,
                status: otherPhase.status ?? 'NOT_STARTED',
                fsm: {
                  current_state: otherPhase.status ?? 'NOT_STARTED',
                  state_history: otherPhase.state_history ?? [],
                },
                sub_phases: otherPhase.substates ?? {},
              };
              atomicWrite(join(statusDir, `${otherKey.replace('_', '-')}.yaml`), YAML.dump(trackData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);
            }
          }
        }
      }

      // Write CRs
      atomicWrite(join(statusDir, 'change-requests.yaml'), YAML.dump({ change_requests: this.status.change_requests }, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);
    }

    // Always write unified as fallback
    const yaml = YAML.dump(this.status, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
    atomicWrite(this.filePath, yaml, this.statusDir ?? undefined);
  }

  private phaseTitle(phaseNum: number): string {
    const titles: Record<number, string> = {
      1: 'Analysis',
      2: 'Planning',
      3: 'Solutioning',
      4: 'Implementation',
    };
    return titles[phaseNum] ?? 'Unknown';
  }

  private static defaultStatus(filePath: string): SprintStatus {
    const now = new Date().toISOString();
    return {
      project: 'unknown',
      workflow_version: '3.6.0',
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

  // ── V3.6 Audit log (append-only JSONL) ──

  async appendAudit(event: string, data: Record<string, any> = {}): Promise<void> {
    const auditDir = join(dirname(this.filePath), 'audit');
    const auditFile = join(auditDir, 'orchestrator-audit.jsonl');
    if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });

    const entry = {
      ts: new Date().toISOString(),
      event,
      decision: data.decision ?? 'info',
      ...data,
    };
    appendFileSync(auditFile, JSON.stringify(entry) + '\n');
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
