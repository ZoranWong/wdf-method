import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import YAML from 'js-yaml';
import { backupFileBeforeWrite } from './status-backup.js';
/**
 * Atomic file write: write to temp file, then rename (filesystem-level atomic).
 * Prevents YAML corruption from concurrent writes or interrupted writes.
 *
 * If `statusDir` is provided and the destination file already exists, a
 * timestamped backup copy is placed under `<statusDir>/backup/` before the
 * write. Backup failures do not block the write.
 */
function atomicWrite(filePath, content, statusDir) {
    const dir = dirname(filePath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const backupDir = statusDir ?? dir;
    try {
        backupFileBeforeWrite(filePath, backupDir);
    }
    catch {
        // Backup is best-effort — never block the primary write.
    }
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
    status;
    filePath;
    statusDir;
    constructor(filePath, status, statusDir) {
        this.filePath = filePath;
        this.status = status;
        this.statusDir = statusDir ?? null;
    }
    /** Load from unified sprint-status.yaml */
    static async load(filePath) {
        if (!existsSync(filePath)) {
            return new SprintStatusManager(filePath, SprintStatusManager.defaultStatus(filePath));
        }
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = YAML.load(raw);
        return new SprintStatusManager(filePath, parsed);
    }
    /** V3.6: Load from split status/ directory */
    static async loadFromStatusDir(statusDir, fallbackPath) {
        if (!existsSync(statusDir)) {
            return SprintStatusManager.load(fallbackPath);
        }
        // Try to load global first
        const globalFile = join(statusDir, 'global.yaml');
        let global = {};
        if (existsSync(globalFile)) {
            global = YAML.load(readFileSync(globalFile, 'utf-8'));
        }
        // Merge all phase files
        const phases = {};
        for (const phaseNum of [1, 2, 3, 4]) {
            const phaseFile = join(statusDir, `phase-0${phaseNum}.yaml`);
            const beFile = join(statusDir, `phase-04-be.yaml`);
            const feFile = join(statusDir, `phase-04-fe.yaml`);
            if (existsSync(phaseFile)) {
                const data = YAML.load(readFileSync(phaseFile, 'utf-8'));
                Object.assign(phases, data);
            }
            if (phaseNum === 4 && existsSync(beFile)) {
                const be = YAML.load(readFileSync(beFile, 'utf-8'));
                Object.assign(phases, be);
            }
            if (phaseNum === 4 && existsSync(feFile)) {
                const fe = YAML.load(readFileSync(feFile, 'utf-8'));
                Object.assign(phases, fe);
            }
        }
        // CRs
        const crFile = join(statusDir, 'change-requests.yaml');
        let changeRequests = [];
        if (existsSync(crFile)) {
            const crData = YAML.load(readFileSync(crFile, 'utf-8'));
            changeRequests = crData?.change_requests ?? [];
        }
        const status = {
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
            },
            phases: phases,
            change_requests: changeRequests,
        };
        return new SprintStatusManager(fallbackPath, status, statusDir);
    }
    /** V3.6: Save to split files when statusDir is configured */
    async save() {
        this.status.updated_at = new Date().toISOString();
        if (this.statusDir && existsSync(this.statusDir)) {
            const statusDir = this.statusDir;
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
            atomicWrite(join(statusDir, 'global.yaml'), YAML.dump(globalData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);
            // Write per-phase files
            const phaseMap = {
                1: ['phase_1'],
                2: ['phase_2'],
                3: ['phase_3'],
                4: ['phase_4', 'phase_4_be', 'phase_4_fe'],
            };
            for (const [phaseNum, keys] of Object.entries(phaseMap)) {
                const phaseData = {};
                for (const key of keys) {
                    if (this.status.phases[key]) {
                        phaseData[key] = this.status.phases[key];
                    }
                }
                if (Object.keys(phaseData).length > 0) {
                    const fileName = Number(phaseNum) === 4 && keys.length > 1 ? `phase-0${phaseNum}-be.yaml` : `phase-0${phaseNum}.yaml`;
                    atomicWrite(join(statusDir, fileName), YAML.dump(phaseData, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);
                }
            }
            // Write CRs
            atomicWrite(join(statusDir, 'change-requests.yaml'), YAML.dump({ change_requests: this.status.change_requests }, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false }), statusDir);
        }
        // Always write unified as fallback
        const yaml = YAML.dump(this.status, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
        atomicWrite(this.filePath, yaml, this.statusDir ?? undefined);
    }
    static defaultStatus(filePath) {
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
    get data() {
        return this.status;
    }
    // ── V3.6 Audit log (append-only JSONL) ──
    async appendAudit(event, data = {}) {
        const auditDir = join(dirname(this.filePath), 'audit');
        const auditFile = join(auditDir, 'orchestrator-audit.jsonl');
        if (!existsSync(auditDir))
            mkdirSync(auditDir, { recursive: true });
        const entry = {
            ts: new Date().toISOString(),
            event,
            decision: data.decision ?? 'info',
            ...data,
        };
        appendFileSync(auditFile, JSON.stringify(entry) + '\n');
    }
    // ── Phase state ──
    getPhase(phaseNum) {
        return this.status.phases[`phase_${phaseNum}`];
    }
    async setPhaseStatus(phaseNum, status) {
        const phase = this.getPhase(phaseNum);
        if (!phase)
            throw new Error(`Phase ${phaseNum} not found`);
        if (phase.status !== status) {
            phase.status = status;
            if (!phase.state_history)
                phase.state_history = [];
            phase.state_history.push({ state: status, at: new Date().toISOString() });
            this.status.global_state.current_phase = Math.max(this.status.global_state.current_phase, phaseNum);
            await this.save();
        }
    }
    async setSubState(phaseNum, subKey, status) {
        const phase = this.getPhase(phaseNum);
        if (!phase)
            throw new Error(`Phase ${phaseNum} not found`);
        if (!phase.substates)
            phase.substates = {};
        if (!phase.substates[subKey]) {
            phase.substates[subKey] = { status, state_history: [] };
        }
        else {
            phase.substates[subKey].status = status;
            if (!phase.substates[subKey].state_history) {
                phase.substates[subKey].state_history = [];
            }
            phase.substates[subKey].state_history.push({ state: status, at: new Date().toISOString() });
        }
        await this.save();
    }
    getSubState(phaseNum, subKey) {
        const phase = this.getPhase(phaseNum);
        return phase?.substates?.[subKey]?.status;
    }
    // ── Story state ──
    getStories(phaseNum, subKey) {
        const phase = this.getPhase(phaseNum);
        return phase?.substates?.[subKey]?.stories ?? [];
    }
    async updateStoryStatus(phaseNum, subKey, story) {
        const phase = this.getPhase(phaseNum);
        if (!phase)
            throw new Error(`Phase ${phaseNum} not found`);
        if (!phase.substates)
            phase.substates = {};
        if (!phase.substates[subKey]) {
            phase.substates[subKey] = { status: 'IN_PROGRESS', stories: [] };
        }
        if (!phase.substates[subKey].stories) {
            phase.substates[subKey].stories = [];
        }
        const idx = phase.substates[subKey].stories.findIndex(s => s.id === story.id);
        if (idx >= 0) {
            phase.substates[subKey].stories[idx] = story;
        }
        else {
            phase.substates[subKey].stories.push(story);
        }
        await this.save();
    }
    // ── Development order ──
    getDevelopmentOrder() {
        return this.status.global_state.development_order ?? [];
    }
    async setDevelopmentOrder(order) {
        this.status.global_state.development_order = order;
        await this.save();
    }
    async freezeDevelopmentOrder() {
        this.status.global_state.development_order_frozen_at = new Date().toISOString();
        await this.save();
    }
    async freezeRequirements() {
        this.status.global_state.requirements_frozen_at = new Date().toISOString();
        await this.save();
    }
    // ── Change requests ──
    async addChangeRequest(cr) {
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
    async resolveChangeRequest(crId, resolution) {
        const cr = this.status.change_requests.find(c => c.id === crId);
        if (!cr)
            throw new Error(`CR ${crId} not found`);
        cr.status = 'resolved';
        cr.resolution = resolution;
        cr.resolved_at = new Date().toISOString();
        if (this.status.global_state.blocked_by === crId) {
            this.status.global_state.blocked_by = undefined;
        }
        await this.save();
    }
    getOpenBlockingCRs() {
        return this.status.change_requests.filter(cr => cr.severity === 'blocking' && cr.status !== 'resolved');
    }
    // ── Merge queue ──
    getMergeQueue() {
        return this.status.global_state.merge_queue ?? { enabled: false, items: [] };
    }
    async enqueueMerge(item) {
        const mq = this.status.global_state.merge_queue;
        if (!mq)
            throw new Error('Merge queue not initialized');
        // Check duplicate
        if (mq.items.find(i => i.story_id === item.story_id && !i.unit_id)) {
            return; // Already enqueued
        }
        mq.items.push({ ...item, merge_status: 'queued' });
        await this.save();
    }
    async updateMergeItem(storyId, updates) {
        const mq = this.status.global_state.merge_queue;
        if (!mq)
            return;
        const item = mq.items.find(i => i.story_id === storyId);
        if (item)
            Object.assign(item, updates);
        await this.save();
    }
    // ── Overall status ──
    async setOverallStatus(status) {
        this.status.global_state.overall_status = status;
        await this.save();
    }
    getOverallStatus() {
        return this.status.global_state.overall_status;
    }
    // ── Implementation boundary ──
    async setImplementationBoundary(boundary) {
        this.status.global_state.implementation_boundary = {
            defined_at: new Date().toISOString(),
            scope_frozen: true,
            ...boundary,
        };
        await this.save();
    }
    // ── Gate card ──
    async setGateCard(phaseNum, checks) {
        const phase = this.getPhase(phaseNum);
        if (!phase)
            return;
        phase.gate_card = { phase: phaseNum,
            checks: checks.map(c => ({ id: c.id, status: c.status, type: c.type ?? 'custom_check', description: c.description ?? 'Gate check' })),
            all_pass: checks.every(c => c.status === 'pass'),
        };
        await this.save();
    }
    isGatePassed(phaseNum) {
        return this.getPhase(phaseNum)?.gate_card?.all_pass ?? false;
    }
}
//# sourceMappingURL=sprint-status.js.map