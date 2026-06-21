// Retrospective action-item loader & cross-sprint injection.
//
// Phase 4.14 produces a markdown report with action items in tables. This
// module parses those tables into structured ActionItem records, persists
// them to `_wdf_output/retrospective-action-items.yaml`, and exposes an
// "inject" entry point that Phase 1.1 Brainstorming of the next sprint
// consumes to avoid repeating mistakes.
//
// Closes the long-term learning loop: every sprint's retrospective becomes
// structured input to the next sprint's planning.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';

const OUTPUT_FILE = '_wdf_output/retrospective-action-items.yaml';

function itemsPath(projectRoot: string): string {
    return join(projectRoot, OUTPUT_FILE);
}

/**
 * Parse action items from a single retrospective markdown report.
 *
 * The report is expected to follow the 4-14-retrospective template, which
 * contains tables under headings "### Process Improvements",
 * "### Template & Artifact Improvements", "### Workflow Improvements", and
 * "### Tooling Improvements". Each table row becomes one ActionItem.
 */
export function parseRetrospectiveReport(reportPath: string, sourceProject?: string): ActionItem[] {
    if (!existsSync(reportPath))
        return [];
    const content = readFileSync(reportPath, 'utf8');
    const items: ActionItem[] = [];
    const capturedAt = new Date().toISOString();
    const categoryHeadings: Array<{ heading: RegExp; category: ActionItemCategory }> = [
        { heading: /###\s*Process Improvements/i, category: 'process' },
        { heading: /###\s*Template\s*(?:&|and)\s*Artifact Improvements/i, category: 'template' },
        { heading: /###\s*Workflow Improvements/i, category: 'workflow' },
        { heading: /###\s*Tooling Improvements/i, category: 'tooling' },
    ];
    for (const { heading, category } of categoryHeadings) {
        const lines = content.split('\n');
        let sectionStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (heading.test(lines[i])) {
                sectionStart = i;
                break;
            }
        }
        if (sectionStart < 0)
            continue;
        // Find the first markdown table within this section (until next ### heading).
        let tableStart = -1;
        for (let i = sectionStart + 1; i < lines.length; i++) {
            if (/^#{2,3}\s/.test(lines[i]))
                break; // next section
            if (/^\|.*\|$/.test(lines[i]) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1])) {
                tableStart = i + 2; // skip header + separator
                break;
            }
        }
        if (tableStart < 0)
            continue;
        // Collect data rows until blank line or non-table line.
        for (let i = tableStart; i < lines.length; i++) {
            const line = lines[i];
            if (!/^\|.*\|$/.test(line))
                break; // end of table
            const cells = line.split('|').slice(1, -1).map(c => c.trim());
            if (cells.length < 2)
                continue;
            const [id, action, priorityRaw, owner, target, justification] = cells;
            if (!id || !/AI-\d+/i.test(id))
                continue;
            const priority = normalizePriority(priorityRaw);
            items.push({
                id,
                category,
                action,
                priority,
                owner: owner || undefined,
                target: target || undefined,
                justification: justification || undefined,
                source_retrospective: reportPath,
                source_project: sourceProject,
                captured_at: capturedAt,
            });
        }
    }
    return items;
}

function normalizePriority(raw: string): ActionItemPriority {
    const upper = (raw || '').toUpperCase();
    if (upper.includes('P0'))
        return 'P0';
    if (upper.includes('P1'))
        return 'P1';
    if (upper.includes('P2'))
        return 'P2';
    return 'P1'; // default to "should fix" if unspecified
}

/**
 * Scan _wdf_output for retrospective reports and parse them all into a
 * single structured file. Idempotent — running twice produces the same
 * output. Old action items from deleted reports are dropped.
 */
export function harvestRetrospectiveItems(projectRoot: string): RetrospectiveActionItems {
    const outputDir = join(projectRoot, '_wdf_output');
    const sources: string[] = [];
    if (existsSync(outputDir)) {
        for (const f of readdirSync(outputDir)) {
            if (/retrospective.*\.md$/i.test(f) || /retro.*\.md$/i.test(f)) {
                sources.push(join(outputDir, f));
            }
        }
    }
    // Also scan retrospectives/ subdirectory if present.
    const retroDir = join(outputDir, 'retrospectives');
    if (existsSync(retroDir)) {
        for (const f of readdirSync(retroDir)) {
            if (f.endsWith('.md'))
                sources.push(join(retroDir, f));
        }
    }
    const allItems: ActionItem[] = [];
    for (const src of sources) {
        const items = parseRetrospectiveReport(src);
        allItems.push(...items);
    }
    const collection: RetrospectiveActionItems = {
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        source_retrospectives: sources,
        items: allItems,
    };
    // Persist
    const outPath = itemsPath(projectRoot);
    if (!existsSync(join(projectRoot, '_wdf_output'))) {
        mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
    }
    writeFileSync(outPath, YAML.dump(collection, { lineWidth: 100 }), 'utf8');
    return collection;
}

/**
 * Load previously-harvested action items (no re-parse). Returns null if the
 * harvest file doesn't exist.
 */
export function loadRetrospectiveItems(projectRoot: string): RetrospectiveActionItems | null {
    const p = itemsPath(projectRoot);
    if (!existsSync(p))
        return null;
    try {
        return YAML.load(readFileSync(p, 'utf8')) as RetrospectiveActionItems;
    }
    catch {
        return null;
    }
}

/**
 * Produce a Phase 1.1 Brainstorming injection prompt — a markdown summary
 * of historical action items that the next sprint should consider. Call this
 * at the start of a new project's Phase 1 to surface learnings from past
 * retrospectives.
 *
 * If `fromProjectRoot` is supplied, harvest from a different project's
 * retrospectives (e.g. a portfolio-level "lessons learned" directory) and
 * inject into the current project.
 */
export function buildInjectionPrompt(currentProjectRoot: string, fromProjectRoot?: string): {
    prompt: string;
    item_count: number;
    high_priority_count: number;
} {
    const source = fromProjectRoot ?? currentProjectRoot;
    let collection = loadRetrospectiveItems(source);
    if (!collection) {
        collection = harvestRetrospectiveItems(source);
    }
    const items = collection.items;
    const highPriority = items.filter(i => i.priority === 'P0');
    if (items.length === 0) {
        return {
            prompt: '',
            item_count: 0,
            high_priority_count: 0,
        };
    }
    const lines: string[] = [];
    lines.push('# Historical Retrospective Action Items (auto-injected)');
    lines.push('');
    lines.push(`Source: ${collection.source_retrospectives.length} retrospective(s) from ${source}`);
    lines.push(`Total: ${items.length} items (${highPriority.length} P0, ` +
        `${items.filter(i => i.priority === 'P1').length} P1, ` +
        `${items.filter(i => i.priority === 'P2').length} P2)`);
    lines.push('');
    lines.push('Consider these learnings during Phase 1 planning. Address P0 items explicitly;');
    lines.push('P1/P2 items should inform decisions but need not be addressed directly.');
    lines.push('');
    const byCategory: Record<ActionItemCategory, ActionItem[]> = {
        process: [], template: [], workflow: [], tooling: [],
    };
    for (const it of items)
        byCategory[it.category].push(it);
    for (const cat of Object.keys(byCategory)) {
        const catItems = byCategory[cat as ActionItemCategory];
        if (catItems.length === 0)
            continue;
        lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)} Improvements (${catItems.length})`);
        lines.push('');
        for (const it of catItems) {
            const priorityIcon = it.priority === 'P0' ? '🚨' :
                it.priority === 'P1' ? '⚠️ ' : '📝';
            lines.push(`${priorityIcon} **${it.id} [${it.priority}]**: ${it.action}`);
            if (it.justification)
                lines.push(`   - _Why_: ${it.justification}`);
        }
        lines.push('');
    }
    return {
        prompt: lines.join('\n'),
        item_count: items.length,
        high_priority_count: highPriority.length,
    };
}

export type ActionItemCategory = 'process' | 'template' | 'workflow' | 'tooling';
export type ActionItemPriority = 'P0' | 'P1' | 'P2';

export interface ActionItem {
    id: string;
    category: ActionItemCategory;
    action: string;
    priority: ActionItemPriority;
    owner?: string;
    target?: string;
    justification?: string;
    source_retrospective: string;
    source_project?: string;
    captured_at: string;
}

export interface RetrospectiveActionItems {
    version: string;
    generated_at: string;
    source_retrospectives: string[];
    items: ActionItem[];
}
