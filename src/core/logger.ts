import fs from 'fs';
import path from 'path';
import { getDataDir } from './utils/data-dir';

const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV === 'development';

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

const logDir = path.join(getDataDir(), 'logs');
ensureDir(logDir);
const logPath = path.join(logDir, 'app.log');

// Single write stream; rely on append-only usage
const stream = fs.createWriteStream(logPath, { flags: 'a' });

function ts() {
  return new Date().toISOString();
}

function safeWrite(line: string) {
  try {
    stream.write(line + '\n');
    // Force flush in production to ensure logs are written immediately
    if (process.env.NODE_ENV !== 'development') {
      try {
        (stream as any).fd && fs.fsyncSync((stream as any).fd);
      } catch {}
    }
  } catch {}
}

function toLine(level: string, args: any[]): string {
  const flat = args.map((a) => {
    if (a instanceof Error) return `${a.stack || a.message}`;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  return `[${ts()}] [${level}] ${flat}`;
}

// Preserve originals
const _orig = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
};

export function hookConsoleLogging() {
  console.log = (...args: any[]) => {
    safeWrite(toLine('INFO', args));
    try { _orig.log(...args); } catch {}
  };
  console.info = (...args: any[]) => {
    safeWrite(toLine('INFO', args));
    try { _orig.info(...args); } catch {}
  };
  console.warn = (...args: any[]) => {
    safeWrite(toLine('WARN', args));
    try { _orig.warn(...args); } catch {}
  };
  console.error = (...args: any[]) => {
    safeWrite(toLine('ERROR', args));
    try { _orig.error(...args); } catch {}
  };
  ;(console as any).debug = (...args: any[]) => {
    if (DEBUG_MODE) {
      safeWrite(toLine('DEBUG', args));
    }
    try { _orig.debug(...args); } catch {}
  };

  // Write boot marker
  safeWrite(toLine('INFO', ['Logger initialized. logPath=', logPath]));
}

// Auto-hook on import for main process
try { hookConsoleLogging(); } catch {}

export const Logger = {
  path: logPath,
  dir: logDir,
  info: (...args: any[]) => console.info(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
  debug: (...args: any[]) => console.debug(...args),
};
