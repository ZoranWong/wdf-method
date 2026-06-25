/**
 * Minimal template renderer for Story Pack v1.0 templates.
 *
 * Supports:
 *   - {{variable}} substitution (shallow, dot-notation NOT supported)
 *   - {{#each array}}...{{/each}} iteration with {{this}} and {{this.key}}
 *
 * Deliberately NOT a full Mustache implementation — the templates are
 * controlled by the framework and only need these two features. External
 * template authors should use the same syntax.
 */

export interface TemplateContext {
  [key: string]: string | string[] | Array<Record<string, unknown>> | undefined;
}

/**
 * Render a template string against a context object.
 *
 * @example
 *   renderTemplate('Hello {{name}}!', { name: 'world' })  // 'Hello world!'
 *   renderTemplate(
 *     '{{#each items}}- {{this}}\n{{/each}}',
 *     { items: ['a', 'b', 'c'] }
 *   )  // '- a\n- b\n- c\n'
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  let out = template;

  // {{#each array}} ... {{/each}}
  out = out.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key: string, body: string) => {
      const value = ctx[key];
      if (!Array.isArray(value)) return '';
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return body.replace(/\{\{this\}\}/g, item);
          }
          if (item && typeof item === 'object') {
            let rendered = body;
            for (const [k, v] of Object.entries(item)) {
              rendered = rendered.replace(
                new RegExp(`\\{\\{this\\.${k}\\}\\}`, 'g'),
                String(v ?? ''),
              );
            }
            rendered = rendered.replace(/\{\{this\}\}/g, JSON.stringify(item));
            return rendered;
          }
          return body.replace(/\{\{this\}\}/g, String(item));
        })
        .join('');
    },
  );

  // {{variable}} — simple substitution. Missing variables become empty
  // strings rather than being left as {{name}} literals; this keeps templates
  // forward-compatible when a context field is added later but not yet
  // populated for every story.
  out = out.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = ctx[key];
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    return JSON.stringify(value);
  });

  return out;
}

/**
 * Read a template file and render it. Synchronous I/O is intentional —
 * templates are small and the render happens at dispatch time, not in a
 * hot loop.
 */
export function renderTemplateFile(
  templatePath: string,
  ctx: TemplateContext,
): string {
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  const template = fs.readFileSync(templatePath, 'utf-8');
  return renderTemplate(template, ctx);
}
