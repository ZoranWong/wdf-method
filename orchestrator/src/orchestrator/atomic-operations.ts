// Atomic file operations with idempotency guarantees.
// Prevents partial state corruption during crashes or concurrent writes.
import { writeFileSync, renameSync, existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { createHash } from 'crypto';

export interface AtomicWriteOptions {
  mkdirp?: boolean;
  verify?: boolean;
  expectedChecksum?: string;
  mode?: number;
}

export interface AtomicWriteResult {
  success: boolean;
  checksum: string;
  rejected?: boolean;
  previousChecksum?: string;
}

export function atomicWrite(filePath: string, content: string, options: AtomicWriteOptions = {}): AtomicWriteResult {
  const { mkdirp = true, verify = true, expectedChecksum, mode = 0o644 } = options;
  const dir = dirname(filePath);
  if (mkdirp && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  let previousChecksum: string | undefined;
  if (existsSync(filePath)) {
    previousChecksum = computeChecksum(readFileSync(filePath, 'utf-8'));
    if (expectedChecksum !== undefined && previousChecksum !== expectedChecksum) {
      return { success: false, checksum: previousChecksum, rejected: true, previousChecksum };
    }
  } else if (expectedChecksum !== undefined && expectedChecksum !== '') {
    return { success: false, checksum: '', rejected: true, previousChecksum: undefined };
  }

  const newChecksum = computeChecksum(content);
  if (previousChecksum === newChecksum) {
    return { success: true, checksum: newChecksum, previousChecksum };
  }

  const tempFile = join(dir, `.${basename(filePath)}.tmp.${process.pid}`);
  try {
    writeFileSync(tempFile, content, { encoding: 'utf-8', mode });
    if (verify) {
      const written = readFileSync(tempFile, 'utf-8');
      if (written !== content) throw new Error('Written content does not match');
    }
    renameSync(tempFile, filePath);
    return { success: true, checksum: newChecksum, previousChecksum };
  } finally {
    try {
      if (existsSync(tempFile)) unlinkSync(tempFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

export function fileChecksum(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return computeChecksum(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function idempotentOperation(filePath: string, produceContent: () => string): boolean {
  const current = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  const desired = produceContent();
  if (current === desired) return false;
  atomicWrite(filePath, desired);
  return true;
}

export function safeReadJson<T = any>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function safeWriteJson(filePath: string, data: any): boolean {
  try {
    const content = JSON.stringify(data, null, 2) + '\n';
    return atomicWrite(filePath, content).success;
  } catch {
    return false;
  }
}
