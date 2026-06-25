/**
 * spec-reverse-engineer.ts — Phase D (V3.10.4) code to spec candidate extractor.
 *
 * Scans an existing source tree and emits candidate spec fragments to
 * _wdf_output/brownfield/. Each fragment is a YAML file containing a
 * discovered concept (route, schema, test) with:
 *   - confidence   (1.0 = exact pattern match, 0.5 = heuristic guess)
 *   - source_ref   (file:line for jumping back to source)
 *   - kind         (endpoint | entity | acceptance_check)
 *   - payload      (method/path, schema fields, test name)
 *
 * Candidates are NOT spec — they need human review before promotion.
 * The framework always stamps auto_generated: true so downstream
 * consumers can filter them out of authoritative artifact graphs.
 *
 * Parsers are intentionally narrow: Next.js app/api star/route.ts and
 * Express app.get(...) for endpoints; Prisma model X, TypeORM @Entity
 * class X, and Zod z.object for entities; .test.ts / .spec.ts for
 * acceptance checks. Other frameworks can plug in via the parser
 * interface (see D4).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

export type CandidateKind = 'endpoint' | 'entity' | 'acceptance_check';

export interface Candidate {
  kind: CandidateKind;
  /** 0.0–1.0 confidence — 1.0 = exact pattern, 0.5 = heuristic guess */
  confidence: number;
  source_ref: string;
  payload: Record<string, unknown>;
  /** Framework that produced this candidate (nextjs, express, prisma, etc.) */
  framework: string;
}

export interface ReverseEngineerResult {
  candidates: Candidate[];
  /** Absolute path to the brownfield output directory */
  outputDir: string;
  /** Per-framework breakdown of candidate counts */
  stats: Record<string, number>;
}

/**
 * Scan a project root for spec candidates.
 *
 * @param projectRoot absolute path to source code root
 * @param outputRoot  override `_wdf_output` location
 */
export function reverseEngineerSpec(
  projectRoot: string,
  outputRoot?: string,
): ReverseEngineerResult {
  const outRoot = outputRoot ?? join(projectRoot, '_wdf_output');
  const outDir = join(outRoot, 'brownfield');
  mkdirSync(outDir, { recursive: true });

  const candidates: Candidate[] = [];
  const ignore = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '_wdf_output', '_bmad-output']);

  // Walk the tree and run per-file parsers. Each parser decides whether
  // the file is interesting based on its own extension/path heuristics —
  // the walk callback stays generic so .prisma, .test.ts, route.ts etc.
  // all reach the right parser.
  walk(projectRoot, ignore, (file) => {
    let src: string;
    try { src = readFileSync(file, 'utf-8'); } catch { return; }

    candidates.push(...parseNextJsRoutes(src, file, projectRoot));
    candidates.push(...parseExpressRoutes(src, file, projectRoot));
    candidates.push(...parsePrismaSchemas(src, file, projectRoot));
    candidates.push(...parseTypeOrmEntities(src, file, projectRoot));
    candidates.push(...parseZodSchemas(src, file, projectRoot));
    candidates.push(...parseTestFiles(src, file, projectRoot));
  });

  // Write each candidate as its own YAML file — easy to review/discard
  const stats: Record<string, number> = {};
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    stats[c.framework] = (stats[c.framework] ?? 0) + 1;
    const slug = `${c.kind}-${c.framework}-${i.toString().padStart(4, '0')}.yaml`;
    const filePath = join(outDir, slug);
    writeFileSync(filePath, renderCandidateYaml(c), 'utf-8');
  }

  return { candidates, outputDir: outDir, stats };
}

// ── Parsers ─────────────────────────────────────────────────────

/**
 * Next.js App Router: app/api/<segment>/route.ts files exporting HTTP methods.
 *
 * Matches `export async function GET/POST/PUT/DELETE(...)`. Confidence 0.9 —
 * the convention is rigid but technically optional (request handlers can be
 * arrow functions or differently named).
 */
function parseNextJsRoutes(src: string, file: string, root: string): Candidate[] {
  if (!/app\/api\/.*\/route\.(t|j)s$/.test(relative(root, file))) return [];
  const out: Candidate[] = [];
  const methodRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let m: RegExpExecArray | null;
  const lines = src.split('\n');
  while ((m = methodRe.exec(src))) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    const relPath = relative(root, file);
    // Extract path from file path: app/api/todos/[id]/route.ts → /api/todos/[id]
    const pathMatch = relPath.match(/app(\/api\/[^/]+(?:\/[^/]+)*?)\/route\.(t|j)s$/);
    const path = pathMatch ? pathMatch[1].replace(/\[([^\]]+)\]/g, ':$1') : '/api/unknown';
    out.push({
      kind: 'endpoint',
      confidence: 0.9,
      source_ref: `${relPath}:${lineNum}`,
      framework: 'nextjs',
      payload: {
        method: m[1],
        path,
        handler: m[1],
      },
    });
    // touch `lines` so it's not "unused" — also helps debug line lookup
    void lines;
  }
  return out;
}

/**
 * Express: app.get('/path', ...), router.post('/path', ...), etc.
 */
function parseExpressRoutes(src: string, file: string, root: string): Candidate[] {
  const out: Candidate[] = [];
  // Backreference \2 matches the opening quote so 'X'/"X"/`X` all close.
  const re = /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])([^'"`]+)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    const relPath = relative(root, file);
    out.push({
      kind: 'endpoint',
      confidence: 0.8,
      source_ref: `${relPath}:${lineNum}`,
      framework: 'express',
      payload: {
        method: m[1].toUpperCase(),
        path: m[2] === '`' ? `<template-literal:${lineNum}>` : m[3],
      },
    });
  }
  return out;
}

/**
 * Prisma: model X { field Type }
 */
function parsePrismaSchemas(src: string, file: string, root: string): Candidate[] {
  if (!/\.(prisma|schema)$/i.test(file)) return [];
  const out: Candidate[] = [];
  const re = /^\s*model\s+([A-Za-z0-9_]+)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    const relPath = relative(root, file);
    out.push({
      kind: 'entity',
      confidence: 1.0,
      source_ref: `${relPath}:${lineNum}`,
      framework: 'prisma',
      payload: {
        name: m[1],
      },
    });
  }
  return out;
}

/**
 * TypeORM: @Entity() class X { @Property() field: Type }
 */
function parseTypeOrmEntities(src: string, file: string, root: string): Candidate[] {
  if (!/\.(t|j)sx?$/.test(file)) return [];
  const out: Candidate[] = [];
  const re = /@Entity\s*\(\s*(?:['"]([^'"]+)['"])?\s*\)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    const relPath = relative(root, file);
    out.push({
      kind: 'entity',
      confidence: 0.9,
      source_ref: `${relPath}:${lineNum}`,
      framework: 'typeorm',
      payload: {
        name: m[2],
        table: m[1] ?? m[2].toLowerCase(),
      },
    });
  }
  return out;
}

/**
 * Zod: const XSchema = z.object({ ... })
 */
function parseZodSchemas(src: string, file: string, root: string): Candidate[] {
  if (!/\.(t|j)sx?$/.test(file)) return [];
  const out: Candidate[] = [];
  const re = /(?:const|let|var)\s+([A-Za-z0-9_]+(?:Schema|Schema))\s*[:=]\s*z\.object\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    const relPath = relative(root, file);
    out.push({
      kind: 'entity',
      confidence: 0.6,
      source_ref: `${relPath}:${lineNum}`,
      framework: 'zod',
      payload: {
        name: m[1],
        note: 'Zod schema — review whether it represents a persisted entity or just a validation shape',
      },
    });
  }
  return out;
}

/**
 * Test files: *.test.ts / *.spec.ts → emit one AC per test() / it() call.
 */
function parseTestFiles(src: string, file: string, root: string): Candidate[] {
  const relPath = relative(root, file);
  if (!/\.(test|spec)\.(t|j)sx?$/.test(relPath)) return [];
  const out: Candidate[] = [];
  const re = /\b(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    out.push({
      kind: 'acceptance_check',
      confidence: 0.7,
      source_ref: `${relPath}:${lineNum}`,
      framework: 'test-file',
      payload: {
        test_name: m[1],
        note: 'Candidate acceptance check — review whether it maps to a story AC',
      },
    });
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────

function walk(start: string, ignores: Set<string>, visit: (file: string) => void): void {
  const stack: string[] = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    let st;
    try { st = statSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      let entries: string[] = [];
      try { entries = readdirSync(cur); } catch { continue; }
      for (const name of entries) {
        if (ignores.has(name)) continue;
        stack.push(join(cur, name));
      }
    } else if (st.isFile()) {
      visit(cur);
    }
  }
}

function renderCandidateYaml(c: Candidate): string {
  const lines: string[] = [
    `# Candidate generated by wdf import (Phase D / V3.10.4)`,
    `# Review the source_ref before promoting to spec/`,
    `---`,
    `kind: ${c.kind}`,
    `framework: ${c.framework}`,
    `confidence: ${c.confidence}`,
    `source_ref: ${c.source_ref}`,
    `auto_generated: true`,
    `payload:`,
  ];
  for (const [k, v] of Object.entries(c.payload)) {
    if (typeof v === 'string') {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
  return lines.join('\n') + '\n';
}
