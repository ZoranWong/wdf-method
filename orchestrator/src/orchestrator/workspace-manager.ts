// Workspace manager — multi-project portfolio coordination (OpenSpec-inspired).
//
// A "workspace" is a directory containing multiple wdf projects + a
// workspace.yaml manifest. It enables:
//
//   1. Cross-project traceability  — REQ in project A depends on API in B
//   2. Dependency graph            — visualize build / deploy order
//   3. Shared specs                — contract files referenced by multiple projects
//   4. Portfolio-level reporting   — health + progress across all projects
//
// Workspace root detection walks up from cwd looking for workspace.yaml.
// Each entry references a project by relative path + records its template,
// dependencies, and metadata.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname, relative, isAbsolute } from 'path';
import YAML from 'js-yaml';

const WORKSPACE_FILE = 'workspace.yaml';
const MANIFEST_VERSION = '1.0';

/**
 * Walk up from startDir looking for workspace.yaml. Returns absolute path
 * to the workspace root, or null if not found.
 */
export function findWorkspaceRoot(startDir: string): string | null {
    let dir = resolve(startDir);
    for (let i = 0; i < 10; i++) {
        const candidate = join(dir, WORKSPACE_FILE);
        if (existsSync(candidate))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}

/**
 * Load a workspace manifest. Throws on malformed YAML; returns null if missing.
 */
export function loadWorkspace(workspaceRoot: string): WorkspaceManifest | null {
    const p = join(workspaceRoot, WORKSPACE_FILE);
    if (!existsSync(p))
        return null;
    try {
        const raw = readFileSync(p, 'utf8');
        const parsed = YAML.load(raw) as WorkspaceManifest;
        if (!parsed || !Array.isArray(parsed.projects))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}

/**
 * Save the workspace manifest.
 */
export function saveWorkspace(workspaceRoot: string, manifest: WorkspaceManifest): void {
    const p = join(workspaceRoot, WORKSPACE_FILE);
    writeFileSync(p, YAML.dump(manifest, { lineWidth: 100 }), 'utf8');
}

/**
 * Initialize a new workspace at the given root. Fails if workspace.yaml
 * already exists (idempotent guard).
 */
export function initWorkspace(workspaceRoot: string, name: string, description?: string): {
    ok: boolean;
    manifest: WorkspaceManifest | null;
    error?: string;
} {
    if (existsSync(join(workspaceRoot, WORKSPACE_FILE))) {
        return {
            ok: false,
            manifest: null,
            error: `Workspace already exists at ${workspaceRoot}`,
        };
    }
    if (!existsSync(workspaceRoot)) {
        mkdirSync(workspaceRoot, { recursive: true });
    }
    const manifest: WorkspaceManifest = {
        version: MANIFEST_VERSION,
        name,
        description,
        created_at: new Date().toISOString(),
        projects: [],
        shared_specs: [],
    };
    saveWorkspace(workspaceRoot, manifest);
    return { ok: true, manifest };
}

/**
 * Add a project to the workspace. The project path can be absolute or
 * relative to the workspace root. Detects template from the project's
 * wdf.toml if not specified.
 */
export function addProject(workspaceRoot: string, projectPath: string, options: {
    name?: string;
    template?: string;
    description?: string;
    tags?: string[];
    dependsOn?: string[];
    status?: WorkspaceProject['status'];
} = {}): {
    ok: boolean;
    project: WorkspaceProject | null;
    error?: string;
} {
    const manifest = loadWorkspace(workspaceRoot);
    if (!manifest) {
        return { ok: false, project: null, error: `No workspace at ${workspaceRoot}` };
    }
    // Resolve to absolute then make relative to workspace root.
    // Relative paths resolve against the workspace root (not process.cwd())
    // so `wdf workspace add ./api` works from anywhere within the workspace.
    const abs = isAbsolute(projectPath)
        ? projectPath
        : resolve(workspaceRoot, projectPath);
    if (!existsSync(abs)) {
        return { ok: false, project: null, error: `Project path does not exist: ${abs}` };
    }
    const rel = relative(workspaceRoot, abs) || '.';
    const name = options.name ?? (rel === '.' ? basename(abs) : basename(abs));
    if (manifest.projects.some(p => p.name === name)) {
        return { ok: false, project: null, error: `Project "${name}" already in workspace` };
    }
    // Auto-detect template from project wdf.toml if not provided.
    let template = options.template;
    if (!template) {
        template = detectTemplateFromProject(abs);
    }
    const project: WorkspaceProject = {
        name,
        path: rel,
        template,
        description: options.description,
        tags: options.tags ?? [],
        depends_on: options.dependsOn ?? [],
        status: options.status ?? 'active',
        initialized_at: new Date().toISOString(),
    };
    manifest.projects.push(project);
    saveWorkspace(workspaceRoot, manifest);
    return { ok: true, project };
}

/**
 * Remove a project from the workspace manifest. Does NOT touch the project
 * directory itself.
 */
export function removeProject(workspaceRoot: string, name: string): {
    ok: boolean;
    error?: string;
} {
    const manifest = loadWorkspace(workspaceRoot);
    if (!manifest)
        return { ok: false, error: `No workspace at ${workspaceRoot}` };
    const before = manifest.projects.length;
    manifest.projects = manifest.projects.filter(p => p.name !== name);
    if (manifest.projects.length === before) {
        return { ok: false, error: `Project "${name}" not in workspace` };
    }
    // Also clean up dangling depends_on references.
    for (const p of manifest.projects) {
        if (p.depends_on) {
            p.depends_on = p.depends_on.filter(d => d !== name);
        }
    }
    saveWorkspace(workspaceRoot, manifest);
    return { ok: true };
}

/**
 * Return display-ready entries for `wdf workspace list`.
 */
export function listProjects(workspaceRoot: string): WorkspaceListEntry[] {
    const manifest = loadWorkspace(workspaceRoot);
    if (!manifest)
        return [];
    return manifest.projects.map(p => ({
        name: p.name,
        path: p.path,
        template: p.template ?? '(none)',
        status: p.status ?? 'active',
        depends_on_count: p.depends_on?.length ?? 0,
        tags: p.tags ?? [],
    }));
}

/**
 * Compute topological order of projects based on depends_on. Returns
 * { order, cycles } where cycles is empty if no cycles detected.
 */
export function topologicalSort(workspaceRoot: string): {
    order: string[];
    cycles: string[][];
} {
    const manifest = loadWorkspace(workspaceRoot);
    if (!manifest)
        return { order: [], cycles: [] };
    const nodes = new Map(manifest.projects.map(p => [p.name, p.depends_on ?? []]));
    const order: string[] = [];
    const cycles: string[][] = [];
    const state = new Map<string, 'visiting' | 'done'>();

    function visit(name: string, path: string[]): boolean {
        const s = state.get(name);
        if (s === 'done')
            return true;
        if (s === 'visiting') {
            cycles.push([...path.slice(path.indexOf(name)), name]);
            return false;
        }
        state.set(name, 'visiting');
        const deps = nodes.get(name) ?? [];
        for (const d of deps) {
            if (nodes.has(d))
                visit(d, [...path, name]);
        }
        state.set(name, 'done');
        order.push(name);
        return true;
    }

    for (const name of nodes.keys())
        visit(name, []);
    return { order, cycles };
}

/**
 * Validate the workspace: check project paths exist + no unknown deps.
 */
export function validateWorkspace(workspaceRoot: string): {
    ok: boolean;
    errors: string[];
    warnings: string[];
} {
    const manifest = loadWorkspace(workspaceRoot);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!manifest) {
        return { ok: false, errors: [`No workspace at ${workspaceRoot}`], warnings };
    }
    const names = new Set(manifest.projects.map(p => p.name));
    for (const p of manifest.projects) {
        const abs = resolve(workspaceRoot, p.path);
        if (!existsSync(abs)) {
            errors.push(`Project "${p.name}": path does not exist (${p.path})`);
        }
        for (const dep of p.depends_on ?? []) {
            if (!names.has(dep)) {
                errors.push(`Project "${p.name}": depends_on unknown project "${dep}"`);
            }
        }
    }
    const { cycles } = topologicalSort(workspaceRoot);
    for (const c of cycles) {
        warnings.push(`Dependency cycle detected: ${c.join(' → ')}`);
    }
    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Render the manifest as a human-readable string.
 */
export function formatWorkspaceReport(workspaceRoot: string): string {
    const manifest = loadWorkspace(workspaceRoot);
    if (!manifest)
        return `No workspace at ${workspaceRoot}`;
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════');
    lines.push(`Workspace: ${manifest.name}`);
    lines.push('═══════════════════════════════════════════');
    if (manifest.description) {
        lines.push(`  ${manifest.description}`);
        lines.push('');
    }
    lines.push(`  Created:     ${manifest.created_at}`);
    lines.push(`  Version:     ${manifest.version}`);
    lines.push(`  Projects:    ${manifest.projects.length}`);
    if (manifest.shared_specs && manifest.shared_specs.length > 0) {
        lines.push(`  Shared specs: ${manifest.shared_specs.length}`);
    }
    lines.push('');
    if (manifest.projects.length === 0) {
        lines.push('  No projects registered. Add one with: wdf workspace add <path>');
        return lines.join('\n');
    }
    lines.push('  Projects:');
    for (const p of manifest.projects) {
        const status = p.status ?? 'active';
        const icon = status === 'active' ? '✓' : status === 'maintenance' ? '◐' : status === 'deprecated' ? '✗' : '○';
        lines.push(`    ${icon} ${p.name.padEnd(20)} [${(p.template ?? 'none').padEnd(16)}] ${status}`);
        if (p.description)
            lines.push(`        ${p.description}`);
        if (p.depends_on && p.depends_on.length > 0) {
            lines.push(`        depends on: ${p.depends_on.join(', ')}`);
        }
        if (p.tags && p.tags.length > 0) {
            lines.push(`        tags: ${p.tags.join(', ')}`);
        }
    }
    const { cycles } = topologicalSort(workspaceRoot);
    if (cycles.length > 0) {
        lines.push('');
        lines.push(`  ⚠ ${cycles.length} dependency cycle(s) detected:`);
        for (const c of cycles) {
            lines.push(`    ${c.join(' → ')}`);
        }
    }
    return lines.join('\n');
}

// ── Internal helpers ──────────────────────────────────────────
function basename(p: string): string {
    const parts = p.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || p;
}

/**
 * Try to detect which template a project was initialized from by reading
 * its wdf.toml for a `template = "..."` line.
 */
function detectTemplateFromProject(projectAbsPath: string): string | undefined {
    const candidates = [
        join(projectAbsPath, 'wdf.toml'),
        join(projectAbsPath, '_wdf_output', 'init-meta.yaml'),
    ];
    for (const c of candidates) {
        if (!existsSync(c))
            continue;
        try {
            const raw = readFileSync(c, 'utf8');
            const m = raw.match(/template\s*[:=]\s*["']?([a-z0-9_-]+)["']?/i);
            if (m)
                return m[1];
        }
        catch { /* ignore */ }
    }
    return undefined;
}

export interface WorkspaceProject {
    name: string;
    path: string;
    template?: string;
    description?: string;
    tags?: string[];
    depends_on?: string[];
    status?: 'active' | 'maintenance' | 'deprecated' | 'planning';
    initialized_at?: string;
}

export interface WorkspaceManifest {
    version: string;
    name: string;
    description?: string;
    created_at: string;
    projects: WorkspaceProject[];
    shared_specs?: string[];
}

export interface WorkspaceListEntry {
    name: string;
    path: string;
    template: string;
    status: string;
    depends_on_count: number;
    tags: string[];
}
