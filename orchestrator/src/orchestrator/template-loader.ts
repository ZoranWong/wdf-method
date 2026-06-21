// Template loader — industry/project-type starting points.
//
// Templates sit one layer below presets in the mental model:
//   - PRESET   = reusable *configuration* package (compliance, linear, prototype)
//                applied at any time, persists across commands.
//   - TEMPLATE = reusable *project blueprint* (todo-app, saas-dashboard, admin-panel)
//                applied ONCE at `wdf init --template <name>`, baked into the
//                project's wdf.toml + story patterns.
//
// Templates are read-only: there is no "active template" record. Once applied,
// the template's contents live in the project's own wdf.toml.
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';

const TEMPLATES_DIR = 'templates';

function templatesDir(skillRoot: string): string {
  return join(skillRoot, TEMPLATES_DIR);
}

export interface TemplateMeta {
  name: string;
  description: string;
  version: string;
  category?: string;
  source_project?: string;
  compatible_wdf?: string;
  tech_stack?: Record<string, string>;
  story_patterns?: string[];
}

export interface Template extends TemplateMeta {
  path: string;
  directory: string;
  parsed: Record<string, any>;
}

export interface TemplateListEntry {
  name: string;
  description: string;
  version: string;
  category: string;
  tech_stack_summary: string;
  story_pattern_count: number;
}

/**
 * List all templates available in the skill root. Returns display-ready entries.
 */
export function listTemplates(skillRoot: string): TemplateListEntry[] {
  const dir = templatesDir(skillRoot);
  if (!existsSync(dir))
    return [];
  const items: TemplateListEntry[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (!statSync(entryPath).isDirectory())
      continue;
    const yamlPath = join(entryPath, 'template.yaml');
    if (!existsSync(yamlPath))
      continue;
    try {
      const parsed: any = YAML.load(readFileSync(yamlPath, 'utf8'));
      if (!parsed || !parsed.name)
        continue;
      const tech = parsed.tech_stack ?? {};
      const techSummary = [
        tech.frontend,
        tech.backend,
        tech.database,
        tech.api_style && `${tech.api_style}`,
      ].filter(Boolean).join(' / ') || '(unspecified)';
      items.push({
        name: parsed.name,
        description: parsed.description ?? '',
        version: parsed.version ?? '0.0.0',
        category: parsed.category ?? inferCategory(parsed),
        tech_stack_summary: techSummary,
        story_pattern_count: Array.isArray(parsed.story_patterns) ? parsed.story_patterns.length : 0,
      });
    }
    catch { /* skip malformed template */ }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function inferCategory(parsed: any): string {
  const name = (parsed.name ?? '').toLowerCase();
  if (name.includes('todo') || name.includes('crud'))
    return 'reference';
  if (name.includes('dashboard') || name.includes('admin'))
    return 'internal-tools';
  if (name.includes('api') || name.includes('service'))
    return 'backend';
  if (name.includes('marketing') || name.includes('site'))
    return 'public-facing';
  return 'general';
}

/**
 * Load a single template's full content.
 */
export function loadTemplate(skillRoot: string, name: string): Template | null {
  const dir = templatesDir(skillRoot);
  if (!existsSync(dir))
    return null;
  // Find by directory name OR by `name:` field inside template.yaml.
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (!statSync(entryPath).isDirectory())
      continue;
    const yamlPath = join(entryPath, 'template.yaml');
    if (!existsSync(yamlPath))
      continue;
    try {
      const raw = readFileSync(yamlPath, 'utf8');
      const parsed: any = YAML.load(raw);
      if (!parsed)
        continue;
      if (parsed.name === name || entry === name) {
        return {
          name: parsed.name,
          description: parsed.description ?? '',
          version: parsed.version ?? '0.0.0',
          category: parsed.category ?? inferCategory(parsed),
          source_project: parsed.source_project,
          compatible_wdf: parsed.compatible_wdf,
          tech_stack: parsed.tech_stack,
          story_patterns: parsed.story_patterns,
          path: yamlPath,
          directory: entryPath,
          parsed,
        };
      }
    }
    catch { /* skip malformed */ }
  }
  return null;
}

/**
 * Validate that a template has the minimum fields required for `wdf init`.
 * Returns a list of human-readable issues (empty = valid).
 */
export function validateTemplate(t: Template): string[] {
  const issues: string[] = [];
  if (!t.name)
    issues.push('missing required field: name');
  if (!t.description)
    issues.push('missing required field: description');
  if (!t.version)
    issues.push('missing required field: version');
  if (!t.tech_stack)
    issues.push('missing recommended field: tech_stack');
  if (!t.parsed.quality)
    issues.push('missing recommended field: quality (thresholds)');
  return issues;
}

/**
 * Format the template list for CLI display.
 */
export function formatTemplateList(entries: TemplateListEntry[]): string {
  if (entries.length === 0) {
    return [
      'No templates found.',
      '',
      `Looked in: templates/*/template.yaml`,
      '',
      'A template is a directory containing template.yaml describing a project',
      'blueprint (tech stack, quality thresholds, story patterns, phase skips).',
      'See templates/todo-app/ for a reference example.',
    ].join('\n');
  }
  const lines: string[] = [];
  lines.push('Available templates:');
  lines.push('');
  for (const t of entries) {
    lines.push(`  ${t.name.padEnd(22)} ${t.version.padEnd(8)} ${t.category.padEnd(16)}`);
    lines.push(`    ${t.description}`);
    lines.push(`    tech: ${t.tech_stack_summary}  |  ${t.story_pattern_count} story pattern(s)`);
    lines.push('');
  }
  lines.push(`Usage:  wdf init <path> --template <name>`);
  lines.push(`        wdf template show <name>`);
  return lines.join('\n');
}
