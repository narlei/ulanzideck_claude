import { spawn } from 'child_process';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

const KEYCHAIN_SERVICE_BASE = 'Claude Code-credentials';
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.claude');
const API_URL = 'https://api.anthropic.com/v1/messages';
const FETCH_TIMEOUT_MS = 15_000;
const API_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'oauth-2025-04-20',
  'Content-Type': 'application/json',
  'User-Agent': 'claude-code/2.1.5',
};
const API_BODY = JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }],
});

export const ErrorKind = Object.freeze({
  NO_TOKEN: 'NO_TOKEN',
  AUTH: 'AUTH',
  NETWORK: 'NETWORK',
  RATE_LIMITED: 'RATE_LIMITED',
  UNKNOWN: 'UNKNOWN',
});

// Resolve a user-provided config-dir setting to an absolute path.
// Empty/undefined → the default ~/.claude. Supports a leading "~".
function resolveConfigDir(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return DEFAULT_CONFIG_DIR;
  let d = dir.trim();
  if (d === '~') d = os.homedir();
  else if (d.startsWith('~/')) d = path.join(os.homedir(), d.slice(2));
  return path.resolve(d);
}

// Claude Code stores its OAuth token in the macOS Keychain under
// "Claude Code-credentials" for the default config dir, and appends a
// "-<first 8 hex of sha256(absoluteConfigDirPath)>" suffix for any custom
// CLAUDE_CONFIG_DIR. Mirror that so each instance reads its own token.
export function keychainServiceForConfigDir(dir) {
  const abs = resolveConfigDir(dir);
  if (abs === DEFAULT_CONFIG_DIR) return KEYCHAIN_SERVICE_BASE;
  const suffix = createHash('sha256').update(abs).digest('hex').slice(0, 8);
  return `${KEYCHAIN_SERVICE_BASE}-${suffix}`;
}

function runSecurity(service) {
  return new Promise((resolve) => {
    const args = [
      'find-generic-password',
      '-s', service,
      '-a', os.userInfo().username,
      '-w',
    ];
    const p = spawn('security', args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out: '', err: e.message }));
  });
}

function extractAccessToken(raw) {
  try {
    const j = JSON.parse(raw.trim());
    const t = j?.claudeAiOauth?.accessToken;
    return typeof t === 'string' && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

async function readToken(configDir) {
  const r = await runSecurity(keychainServiceForConfigDir(configDir));
  if (r.code !== 0) return null;
  return extractAccessToken(r.out);
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function epoch(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Trigger a CLI-side token refresh by invoking `claude -p` with a tiny budget cap.
// The cap causes the CLI to abort BEFORE actually consuming tokens, but the OAuth
// refresh has already run by then — so the keychain entry is updated for free.
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
// Track the last refresh attempt per resolved config dir, so a refresh for one
// instance doesn't reset another instance's cooldown.
const _lastRefreshAttempt = new Map();

const CLAUDE_CANDIDATES = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', 'claude'];

function spawnClaude(bin, configDir) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['-p', 'hi', '--max-budget-usd', '0.01'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 20_000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: resolveConfigDir(configDir) },
    });
    p.on('close', () => resolve(true));
    p.on('error', () => resolve(false));
  });
}

async function attemptCliRefresh(configDir, force = false) {
  const key = resolveConfigDir(configDir);
  const now = Date.now();
  if (!force && now - (_lastRefreshAttempt.get(key) || 0) < REFRESH_COOLDOWN_MS) {
    return false;
  }
  _lastRefreshAttempt.set(key, now);
  for (const bin of CLAUDE_CANDIDATES) {
    const ok = await spawnClaude(bin, configDir);
    if (ok) return true;
  }
  return false;
}

export async function fetchUsage({ signal, _retried, force, configDir } = {}) {
  const token = await readToken(configDir);
  if (!token) {
    return { ok: false, kind: ErrorKind.NO_TOKEN, message: 'No Claude Code credentials in keychain' };
  }

  // Bound the request so a stalled connection can't leave the caller's inflight
  // lock stuck forever (app.js only clears it once this promise settles).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let resp;
  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
      body: API_BODY,
      signal: controller.signal,
    });
  } catch (e) {
    const message = controller.signal.aborted ? `timeout after ${FETCH_TIMEOUT_MS}ms` : (e?.message || 'fetch failed');
    return { ok: false, kind: ErrorKind.NETWORK, message };
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401 || resp.status === 403) {
    if (!_retried) {
      const refreshed = await attemptCliRefresh(configDir, force);
      if (refreshed) {
        return fetchUsage({ signal, _retried: true, configDir });
      }
    }
    return { ok: false, kind: ErrorKind.AUTH, message: `HTTP ${resp.status}` };
  }

  const h = (name) => resp.headers.get(name);
  const data = {
    util5h: pct(h('anthropic-ratelimit-unified-5h-utilization')),
    reset5h: epoch(h('anthropic-ratelimit-unified-5h-reset')),
    status5h: h('anthropic-ratelimit-unified-5h-status') || 'unknown',
    util7d: pct(h('anthropic-ratelimit-unified-7d-utilization')),
    reset7d: epoch(h('anthropic-ratelimit-unified-7d-reset')),
    status7d: h('anthropic-ratelimit-unified-7d-status') || 'unknown',
    unifiedStatus: h('anthropic-ratelimit-unified-status') || 'unknown',
    fetchedAt: Math.floor(Date.now() / 1000),
  };

  if (resp.status === 429) {
    return { ok: false, kind: ErrorKind.RATE_LIMITED, message: 'HTTP 429', data };
  }
  if (!resp.ok) {
    return { ok: false, kind: ErrorKind.UNKNOWN, message: `HTTP ${resp.status}`, data };
  }
  if (data.util5h === null && data.util7d === null) {
    return { ok: false, kind: ErrorKind.UNKNOWN, message: 'rate-limit headers missing' };
  }
  return { ok: true, data };
}

export function formatReset(epochSec) {
  if (!epochSec) return '';
  const diff = epochSec - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'now';
  const m = Math.round(diff / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(diff / 3600);
  if (h < 48) return `${h}h`;
  const d = Math.round(diff / 86400);
  return `${d}d`;
}

export function formatResetAt(epochSec) {
  if (!epochSec) return '';
  const date = new Date(epochSec * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatStoppedReset(epochSec) {
  if (!epochSec) return '';
  const diff = epochSec - Math.floor(Date.now() / 1000);
  if (diff > 0 && diff <= 24 * 60 * 60) {
    return `Reset at ${formatResetAt(epochSec)}`;
  }
  return `Reset in ${formatReset(epochSec)}`;
}
