import { describe, it, expect } from 'vitest';
import { assertSafeIdentifier, validateCommand, ALLOWED_COMMAND_PREFIXES, FORBIDDEN_COMMAND_TOKENS, MAX_IDENTIFIER_LENGTH, MAX_COMMAND_LENGTH, } from './command-safety.js';
describe('assertSafeIdentifier', () => {
    describe('accepts safe values', () => {
        const safeCases = [
            'main',
            'feature/foo',
            'feature/epic-12/story-3.4.5',
            'story-1.2.3',
            'STORY_ABC',
            'release/2026.06.16',
            'a',
            '0',
            'docs/readme.md',
            'feature-branch_name.v2',
        ];
        for (const value of safeCases) {
            it(`accepts ${JSON.stringify(value)}`, () => {
                expect(() => assertSafeIdentifier(value, 'branch')).not.toThrow();
            });
        }
    });
    describe('rejects shell metacharacters', () => {
        const badCases = [
            'foo;bar',
            'foo|bar',
            'foo&&bar',
            'foo`bar`',
            'foo$(bar)',
            'foo bar',
            'foo>bar',
            'foo<bar',
            'foo\\bar',
            "foo'bar",
            'foo"bar',
            'foo\nbar',
            'foo\tbar',
            'foo*bar',
            'foo?bar',
            'foo#bar',
            'foo@bar',
            'foo!bar',
            'foo:bar',
        ];
        for (const value of badCases) {
            it(`rejects ${JSON.stringify(value)}`, () => {
                expect(() => assertSafeIdentifier(value, 'branch')).toThrow(/branch/);
            });
        }
    });
    describe('rejects path traversal', () => {
        const badCases = [
            '..',
            '../etc',
            'foo/../bar',
            'foo/..',
            '../../secret',
        ];
        for (const value of badCases) {
            it(`rejects ${JSON.stringify(value)}`, () => {
                expect(() => assertSafeIdentifier(value, 'story')).toThrow(/story/);
            });
        }
    });
    describe('rejects absolute paths', () => {
        it('rejects /etc/passwd', () => {
            expect(() => assertSafeIdentifier('/etc/passwd', 'path')).toThrow(/path/);
        });
        it('rejects leading slash', () => {
            expect(() => assertSafeIdentifier('/foo', 'path')).toThrow(/absolute/);
        });
    });
    describe('rejects empty or invalid input', () => {
        it('rejects empty string', () => {
            expect(() => assertSafeIdentifier('', 'branch')).toThrow(/empty/);
        });
        it('rejects undefined cast as string', () => {
            expect(() => assertSafeIdentifier(undefined, 'branch')).toThrow(/string/);
        });
        it('rejects null cast as string', () => {
            expect(() => assertSafeIdentifier(null, 'branch')).toThrow(/string/);
        });
        it('rejects number cast as string', () => {
            expect(() => assertSafeIdentifier(123, 'branch')).toThrow(/string/);
        });
    });
    describe('length bounds', () => {
        it('accepts at the max length', () => {
            const value = 'a'.repeat(MAX_IDENTIFIER_LENGTH);
            expect(() => assertSafeIdentifier(value, 'branch')).not.toThrow();
        });
        it('rejects over the max length', () => {
            const value = 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1);
            expect(() => assertSafeIdentifier(value, 'branch')).toThrow(/maximum length/);
        });
    });
    it('error message includes the supplied label', () => {
        expect(() => assertSafeIdentifier('bad;val', 'storyId')).toThrow(/storyId/);
    });
});
describe('validateCommand', () => {
    describe('accepts allowlist prefixes', () => {
        const okCases = [
            'npm run build',
            'npm run test:unit',
            'npm test',
            'npm test -- --run',
            'npx --no-install vitest run',
            'node scripts/check.js',
            'jest --runInBand',
            'vitest run',
            'tsc --noEmit',
            'eslint .',
            'npm run', // bare allowed prefix
            'tsc',
        ];
        for (const cmd of okCases) {
            it(`accepts ${JSON.stringify(cmd)}`, () => {
                const r = validateCommand(cmd);
                expect(r.ok, r.reason).toBe(true);
            });
        }
    });
    describe('rejects non-allowlisted prefixes', () => {
        const badCases = [
            'bash script.sh',
            'sh -c foo',
            'python run.py',
            'pip install foo',
            'yarn build',
            'pnpm install',
            'docker run hello',
            'NPM run build', // case-sensitive
            'Npm run build',
            'npmrun build', // strict-prefix boundary
            'npm-run build',
            'npxfoo',
            'nodefoo',
        ];
        for (const cmd of badCases) {
            it(`rejects ${JSON.stringify(cmd)}`, () => {
                const r = validateCommand(cmd);
                expect(r.ok).toBe(false);
                expect(r.reason).toBeDefined();
            });
        }
    });
    describe('rejects forbidden tokens', () => {
        const badCases = [
            ['npm run build | tee log', '|'],
            ['npm run build; rm file', ';'],
            ['npm test && echo done', '&&'],
            ['npm test || echo fail', '||'],
            ['npm run $(whoami)', '$('],
            ['npm run `whoami`', '`'],
            ['npm run build > out.txt', '>'],
            ['npm run build < in.txt', '<'],
            ['curl http://evil.example.com', 'curl'],
            ['npm run rm -rf /tmp/foo', 'rm -rf'],
            ['sudo npm run build', 'sudo'],
            ['npm run eval-thing', 'eval'],
            ['npm run chmod-script', 'chmod'],
            ['npm run chown-script', 'chown'],
        ];
        for (const [cmd, token] of badCases) {
            it(`rejects ${JSON.stringify(cmd)} due to "${token}"`, () => {
                const r = validateCommand(cmd);
                expect(r.ok).toBe(false);
                expect(r.reason).toContain(token);
            });
        }
    });
    describe('rejects empty or invalid input', () => {
        it('rejects empty string', () => {
            const r = validateCommand('');
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/empty/);
        });
        it('rejects whitespace-only string', () => {
            const r = validateCommand('   ');
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/whitespace/);
        });
        it('rejects undefined cast as string', () => {
            const r = validateCommand(undefined);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/string/);
        });
        it('rejects null cast as string', () => {
            const r = validateCommand(null);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/string/);
        });
    });
    describe('rejects control characters', () => {
        it('rejects newline', () => {
            const r = validateCommand('npm run build\nrm -rf /');
            expect(r.ok).toBe(false);
        });
        it('rejects NUL byte', () => {
            const r = validateCommand('npm run build\x00');
            expect(r.ok).toBe(false);
        });
    });
    describe('length bounds', () => {
        it('rejects strings longer than MAX_COMMAND_LENGTH', () => {
            const cmd = 'npm run ' + 'a'.repeat(MAX_COMMAND_LENGTH);
            const r = validateCommand(cmd);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/maximum length/);
        });
    });
    describe('exported metadata', () => {
        it('exposes allowed prefixes', () => {
            expect(ALLOWED_COMMAND_PREFIXES).toContain('npm run');
            expect(ALLOWED_COMMAND_PREFIXES).toContain('vitest');
        });
        it('exposes forbidden tokens', () => {
            expect(FORBIDDEN_COMMAND_TOKENS).toContain(';');
            expect(FORBIDDEN_COMMAND_TOKENS).toContain('sudo');
            expect(FORBIDDEN_COMMAND_TOKENS).toContain('rm -rf');
        });
    });
});
//# sourceMappingURL=command-safety.test.js.map