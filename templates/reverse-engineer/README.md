# Reverse-Engineer Framework Parsers

Phase D (V3.10.4) ships built-in parsers for Next.js (App Router), Express,
Prisma, TypeORM, Zod, and generic `*.test.ts` test files. This document
describes how to add support for other frameworks (Vue, Nuxt, Remix,
FastAPI, etc.).

## The FrameworkParser contract

A parser is a function with this shape:

```ts
import { Candidate } from '../../orchestrator/src/orchestrator/spec-reverse-engineer';

export interface FrameworkParser {
  /** Stable identifier included in candidate.framework */
  framework: string;
  /** Return true if this parser should run against the given file path */
  matches(filePath: string): boolean;
  /** Extract candidates from file source */
  parse(src: string, filePath: string, projectRoot: string): Candidate[];
}
```

## Registering a parser

Parsers live in `parsers/<framework>/index.ts` and are loaded dynamically
by `spec-reverse-engineer.ts`. To add a new one:

1. Create `parsers/<your-framework>/index.ts` exporting a default
   `FrameworkParser`.
2. Implement `matches()` with a cheap path/extension check so the parser
   doesn't pay the cost of reading every file.
3. Implement `parse()` returning `Candidate[]` with confidence scores:
   - **1.0** — exact structural match (decorator, required export, etc.)
   - **0.7–0.9** — strong convention match (filename pattern, idiomatic call)
   - **0.4–0.6** — heuristic guess (regex on free-form strings)
4. Test it with a fixture in `parsers/<your-framework>/__fixtures__/` and
   add a vitest case to `parsers/<your-framework>/index.test.ts`.

## Confidence guidelines

Candidates are surfaced to humans for review before becoming spec —
`confidence` tells the reviewer how much to trust the candidate without
opening the source file.

- **1.0**: Single, canonical declaration form. E.g. Prisma `model X { ... }`
  — there is no other way to declare a Prisma model.
- **0.9**: Convention-rigid but technically bypassable. E.g. Next.js App
  Router `export async function GET(...)` — the convention is universal but
  JavaScript allows other forms.
- **0.7–0.8**: Common but flexible. E.g. Express `app.get('/path', ...)`
  — most code uses this shape, but `app['get'](...)` also works.
- **0.4–0.6**: Best-effort heuristic. E.g. Zod `const XSchema = z.object({...})`
  — schemas are often named without the `Schema` suffix.

Below 0.4: don't emit. The reviewer can't distinguish true candidates from
noise.

## Examples

### Vue / Nuxt

```ts
export const vueParser: FrameworkParser = {
  framework: 'vue',
  matches: (p) => /\.vue$/.test(p) || /pages\/.*\.vue$/.test(p),
  parse: (src, filePath, root) => {
    const candidates: Candidate[] = [];
    // Nuxt routing: pages/<path>.vue → /<path>
    if (/^pages\//.test(relative(root, filePath))) {
      const relPath = relative(root, filePath);
      const route = '/' + relPath
        .replace(/^pages\//, '')
        .replace(/\.vue$/, '')
        .replace(/\[(\w+)\]/g, ':$1')
        .replace(/index$/, '');
      candidates.push({
        kind: 'endpoint',
        confidence: 0.7,
        source_ref: `${relPath}:1`,
        framework: 'vue',
        payload: { method: 'GET', path: route },
      });
    }
    return candidates;
  },
};
```

### Remix

```ts
export const remixParser: FrameworkParser = {
  framework: 'remix',
  matches: (p) => /app\/routes\/.*\.(t|j)sx?$/.test(p),
  parse: (src, filePath, root) => {
    const candidates: Candidate[] = [];
    const methodRe = /export\s+(?:async\s+)?function\s+(loader|action)\b/g;
    let m;
    while ((m = methodRe.exec(src))) {
      const relPath = relative(root, filePath);
      const line = src.slice(0, m.index).split('\n').length;
      candidates.push({
        kind: 'endpoint',
        confidence: 0.85,
        source_ref: `${relPath}:${line}`,
        framework: 'remix',
        payload: {
          method: m[1] === 'loader' ? 'GET' : 'POST',
          path: remixRouteFromFilename(relPath),
        },
      });
    }
    return candidates;
  },
};
```

### FastAPI (Python)

```ts
export const fastApiParser: FrameworkParser = {
  framework: 'fastapi',
  matches: (p) => /\.py$/.test(p),
  parse: (src, filePath, root) => {
    const candidates: Candidate[] = [];
    const re = /@(app|router)\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const relPath = relative(root, filePath);
      const line = src.slice(0, m.index).split('\n').length;
      candidates.push({
        kind: 'endpoint',
        confidence: 0.9,
        source_ref: `${relPath}:${line}`,
        framework: 'fastapi',
        payload: { method: m[2].toUpperCase(), path: m[3] },
      });
    }
    return candidates;
  },
};
```

## Integration test pattern

Each parser should ship with a fixture and a vitest case that exercises
the happy path plus a non-matching file (extension or content the parser
should ignore):

```ts
import { describe, it, expect } from 'vitest';
import { fastApiParser } from '../index';

describe('fastApiParser', () => {
  it('extracts @app.get decorators', () => {
    const src = `
@app.get('/todos')
def list_todos(): pass

@app.post('/todos')
def create_todo(): pass
`;
    const out = fastApiParser.parse(src, '/x/routes.py', '/x');
    expect(out.length).toBe(2);
    expect(out[0].payload.method).toBe('GET');
    expect(out[0].payload.path).toBe('/todos');
  });

  it('does not match non-Python files', () => {
    expect(fastApiParser.matches('/x/foo.ts')).toBe(false);
    expect(fastApiParser.matches('/x/foo.py')).toBe(true);
  });
});
```

## Limitations

The reverse-engineer is intentionally conservative:

- **No control-flow analysis.** If your routes are built dynamically
  (`routes.forEach(r => app[r.method](r.path, ...))`), the parser won't
  see them. That's by design — humans must review dynamically-built APIs.
- **No type information.** We can't tell if `app.get` is Express or
  another library with the same name. Confidence stays at 0.8.
- **No AST.** Regex parsers are fast but fragile. If your framework has
  unusual syntax (decorators with complex arguments, nested builders),
  consider adding a real parser via `@babel/parser` or `typescript`.

When in doubt, ship a low-confidence candidate. Reviewers can filter by
`confidence >= 0.7` to find solid hits and ignore the rest.
