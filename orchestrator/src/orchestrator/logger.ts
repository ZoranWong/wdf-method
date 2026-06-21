// Structured logging system for wdf-method orchestrator.
// Supports multiple log levels, structured JSON output, and environment-based configuration.
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: Record<string, any>;
}

export interface LoggerConfig {
  level: LogLevel;
  logFile?: string;
  jsonOutput: boolean;
  projectRoot?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

let globalConfig: LoggerConfig = {
  level: (process.env.WDF_LOG_LEVEL as LogLevel) ?? 'info',
  logFile: process.env.WDF_LOG_FILE,
  jsonOutput: process.env.WDF_LOG_JSON === '1',
};

export function configureLogger(updates: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...updates };
}

export function getLoggerConfig(): Readonly<LoggerConfig> {
  return { ...globalConfig };
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[globalConfig.level];
}

export class Logger {
  private module: string;

  constructor(moduleName: string) {
    this.module = moduleName;
  }

  error(message: string, details?: Record<string, any>): void { this.log('error', message, details); }
  warn(message: string, details?: Record<string, any>): void { this.log('warn', message, details); }
  info(message: string, details?: Record<string, any>): void { this.log('info', message, details); }
  debug(message: string, details?: Record<string, any>): void { this.log('debug', message, details); }
  trace(message: string, details?: Record<string, any>): void { this.log('trace', message, details); }

  private log(level: LogLevel, message: string, details?: Record<string, any>): void {
    if (!isLevelEnabled(level)) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      details,
    };
    if (globalConfig.jsonOutput) {
      this.writeJson(entry);
    } else {
      this.writeHuman(entry);
    }
    if (globalConfig.logFile && globalConfig.projectRoot) {
      this.writeToFile(entry);
    }
  }

  private writeJson(entry: LogEntry): void {
    console.log(JSON.stringify(entry));
  }

  private writeHuman(entry: LogEntry): void {
    const icon = levelIcon(entry.level);
    const time = entry.timestamp.slice(11, 19);
    const module = entry.module.padEnd(18).slice(0, 18);
    const details = entry.details ? ` — ${formatDetails(entry.details)}` : '';
    console.log(`[${time}] ${icon} ${module} | ${entry.message}${details}`);
  }

  private writeToFile(entry: LogEntry): void {
    if (!globalConfig.projectRoot || !globalConfig.logFile) return;
    const logDir = join(globalConfig.projectRoot, '_wdf_output', 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, globalConfig.logFile);
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(logPath, line, 'utf-8');
  }
}

export function createLogger(moduleName: string): Logger {
  return new Logger(moduleName);
}

export function withLogLevel<T>(level: LogLevel, fn: () => T): T {
  const previous = globalConfig.level;
  globalConfig.level = level;
  try {
    return fn();
  } finally {
    globalConfig.level = previous;
  }
}

function levelIcon(level: LogLevel): string {
  switch (level) {
    case 'error': return '❌';
    case 'warn': return '⚠️ ';
    case 'info': return 'ℹ️ ';
    case 'debug': return '🔍';
    case 'trace': return '📍';
    case 'silent': return '';
  }
}

function formatDetails(details: Record<string, any>): string {
  return Object.entries(details)
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null) return `${k}=${JSON.stringify(v)}`;
      return `${k}=${String(v)}`;
    })
    .join(' ');
}
