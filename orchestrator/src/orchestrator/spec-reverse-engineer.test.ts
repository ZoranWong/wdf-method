/**
 * Tests for spec-reverse-engineer.ts (Phase D / V3.10.4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { reverseEngineerSpec } from './spec-reverse-engineer.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `wdf-d1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('reverseEngineerSpec', () => {
  it('parses Next.js App Router routes', () => {
    const routeDir = join(projectRoot, 'app', 'api', 'todos', '[id]');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, 'route.ts'),
      `export async function GET(req: Request) { return Response.json({}); }\nexport async function DELETE(req: Request) { return Response.json({}); }\n`,
    );

    const result = reverseEngineerSpec(projectRoot);
    const endpoints = result.candidates.filter(c => c.kind === 'endpoint');
    expect(endpoints.length).toBe(2);
    expect(endpoints.some(e => e.payload.method === 'GET')).toBe(true);
    expect(endpoints.some(e => e.payload.method === 'DELETE')).toBe(true);
    expect(endpoints[0].framework).toBe('nextjs');
    expect(endpoints[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(endpoints[0].source_ref).toContain('route.ts');
  });

  it('parses Express routes', () => {
    writeFileSync(join(projectRoot, 'server.ts'),
      `app.get('/todos', listTodos);\napp.post('/todos', createTodo);\nrouter.put('/todos/:id', updateTodo);\n`,
    );

    const result = reverseEngineerSpec(projectRoot);
    const endpoints = result.candidates.filter(c => c.framework === 'express');
    expect(endpoints.length).toBe(3);
    expect(endpoints[0].payload.method).toBe('GET');
    expect(endpoints[0].payload.path).toBe('/todos');
  });

  it('parses Prisma schemas', () => {
    writeFileSync(join(projectRoot, 'schema.prisma'),
      `model User {\n  id Int @id\n  email String\n}\n\nmodel Todo {\n  id Int @id\n}\n`,
    );

    const result = reverseEngineerSpec(projectRoot);
    const entities = result.candidates.filter(c => c.framework === 'prisma');
    expect(entities.length).toBe(2);
    expect(entities[0].payload.name).toBe('User');
  });

  it('parses TypeORM @Entity decorators', () => {
    writeFileSync(join(projectRoot, 'user.entity.ts'),
      `import { Entity, Column } from 'typeorm';\n@Entity('users')\nexport class User {\n  @Column() email: string;\n}\n`,
    );

    const result = reverseEngineerSpec(projectRoot);
    const entities = result.candidates.filter(c => c.framework === 'typeorm');
    expect(entities.length).toBe(1);
    expect(entities[0].payload.name).toBe('User');
    expect(entities[0].payload.table).toBe('users');
  });

  it('parses test files as acceptance_check candidates', () => {
    writeFileSync(join(projectRoot, 'todos.test.ts'),
      `import { test } from 'vitest';\ntest('creates a todo', () => {});\ntest('deletes a todo', () => {});\n`,
    );

    const result = reverseEngineerSpec(projectRoot);
    const acs = result.candidates.filter(c => c.kind === 'acceptance_check');
    expect(acs.length).toBe(2);
    expect(acs[0].payload.test_name).toBe('creates a todo');
  });

  it('writes each candidate as a YAML file', () => {
    writeFileSync(join(projectRoot, 'server.ts'), `app.get('/health', health);\n`);
    const result = reverseEngineerSpec(projectRoot);
    const files = readdirSync(result.outputDir);
    expect(files.length).toBe(result.candidates.length);
    const first = readFileSync(join(result.outputDir, files[0]), 'utf-8');
    expect(first).toContain('auto_generated: true');
    expect(first).toContain('confidence:');
    expect(first).toContain('source_ref:');
  });

  it('respects ignore list (node_modules, dist, .git, etc.)', () => {
    mkdirSync(join(projectRoot, 'node_modules', 'foo'), { recursive: true });
    writeFileSync(join(projectRoot, 'node_modules', 'foo', 'routes.ts'),
      `app.get('/should-not-find', handler);\n`,
    );
    writeFileSync(join(projectRoot, 'real.ts'),
      `app.get('/should-find', handler);\n`,
    );

    const result = reverseEngineerSpec(projectRoot);
    const paths = result.candidates.map(c => c.payload.path);
    expect(paths).toContain('/should-find');
    expect(paths).not.toContain('/should-not-find');
  });

  it('returns stats broken down by framework', () => {
    writeFileSync(join(projectRoot, 'server.ts'), `app.get('/todos', handler);\n`);
    writeFileSync(join(projectRoot, 'schema.prisma'), `model Todo {\n  id Int @id\n}\n`);

    const result = reverseEngineerSpec(projectRoot);
    expect(result.stats.express).toBe(1);
    expect(result.stats.prisma).toBe(1);
  });
});
