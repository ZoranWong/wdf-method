// Preset loader — 4-layer configuration stack (SpecKit-inspired).
//
// Layers (low → high precedence):
//   1. Built-in DEFAULT_CONFIG  (config.ts)
//   2. Skill base:              {skill-root}/customize.toml
//   3. Preset:                  {skill-root}/presets/<name>.toml  ← NEW
//   4. Team override:           {project}/_bmad/custom/web-dev-flow.toml
//   5. User override:           {project}/_bmad/custom/web-dev-flow.user.toml
//
// A "preset" is a reusable named configuration package. Compliance / Linear /
// Prototype / etc. Users activate one via `wdf preset apply <name>`; the
// choice persists in `_wdf_output/active-preset.yaml` so subsequent `loadConfig`
// calls include the preset layer automatically.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';
import { parseToml } from './config.js';

const PRESETS_DIR = 'presets';
const ACTIVE_PRESET_FILE = '_wdf_output/active-preset.yaml';

function presetsDir(skillRoot: string): string {
    return join(skillRoot, PRESETS_DIR);
}

function activePresetPath(projectRoot: string): string {
    return join(projectRoot, ACTIVE_PRESET_FILE);
}

/**
 * List all presets available in the skill root. Returns metadata only —
 * callers that need full content should call loadPreset().
 */
export function listPresets(skillRoot: string): PresetMeta[] {
    const dir = presetsDir(skillRoot);
    if (!existsSync(dir))
        return [];
    const items: PresetMeta[] = [];
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.toml'))
            continue;
        const path = join(dir, f);
        try {
            const raw = readFileSync(path, 'utf8');
            const parsed = parseToml(raw);
            const meta = parsed.preset;
            if (!meta || !meta.name)
                continue;
            items.push({
                name: meta.name,
                description: meta.description ?? '',
                version: meta.version ?? '0.0.0',
                category: meta.category,
                requires_env: meta.requires_env,
                requires_cli: meta.requires_cli,
            });
        }
        catch { /* skip malformed preset */ }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load a single preset's full content. Use by config-loader to merge into
 * the active configuration.
 */
export function loadPreset(skillRoot: string, name: string): Preset | null {
    const path = join(presetsDir(skillRoot), `${name}.toml`);
    if (!existsSync(path))
        return null;
    const raw_content = readFileSync(path, 'utf8');
    const parsed = parseToml(raw_content);
    const meta = parsed.preset;
    if (!meta)
        return null;
    return {
        ...meta,
        path,
        raw_content,
        parsed,
    };
}

/**
 * Read the currently-active preset for a project (if any).
 */
export function getActivePreset(projectRoot: string): ActivePresetRecord | null {
    const p = activePresetPath(projectRoot);
    if (!existsSync(p))
        return null;
    try {
        return YAML.load(readFileSync(p, 'utf8')) as ActivePresetRecord;
    }
    catch {
        return null;
    }
}

/**
 * Activate a preset by name. Persists to _wdf_output/active-preset.yaml.
 * Subsequent loadConfig() calls will include this preset's overrides.
 */
export function applyPreset(projectRoot: string, skillRoot: string, name: string, source: string = 'user'): {
    ok: boolean;
    preset: Preset | null;
    error?: string;
} {
    const preset = loadPreset(skillRoot, name);
    if (!preset) {
        return { ok: false, preset: null, error: `Preset "${name}" not found in ${presetsDir(skillRoot)}` };
    }
    // Verify required env / CLI are present.
    const missingEnv = (preset.requires_env ?? []).filter(v => !process.env[v]);
    if (missingEnv.length > 0) {
        return {
            ok: false,
            preset,
            error: `Preset "${name}" requires environment variables: ${missingEnv.join(', ')}`,
        };
    }
    const outputDir = join(projectRoot, '_wdf_output');
    if (!existsSync(outputDir))
        mkdirSync(outputDir, { recursive: true });
    const record: ActivePresetRecord = {
        preset: name,
        applied_at: new Date().toISOString(),
        source,
    };
    writeFileSync(activePresetPath(projectRoot), YAML.dump(record), 'utf8');
    return { ok: true, preset };
}

/**
 * Deactivate the current preset (no-op if none active).
 */
export function clearPreset(projectRoot: string): boolean {
    const p = activePresetPath(projectRoot);
    if (!existsSync(p))
        return false;
    try {
        writeFileSync(p, YAML.dump({
            preset: null,
            applied_at: new Date().toISOString(),
            source: 'user',
        }), 'utf8');
        return true;
    }
    catch {
        return false;
    }
}

export interface PresetMeta {
    name: string;
    description: string;
    version: string;
    category?: string;
    requires_env?: string[];
    requires_cli?: string[];
}

export interface Preset extends PresetMeta {
    path: string;
    raw_content: string;
    parsed: Record<string, any>;
}

export interface ActivePresetRecord {
    preset: string | null;
    applied_at: string;
    source: string;
}
