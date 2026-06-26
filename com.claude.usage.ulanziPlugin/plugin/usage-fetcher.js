import { spawn } from 'child_process';
import os from 'os';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
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

function runSecurity() {
  return new Promise((resolve) => {
    const args = [
      'find-generic-password',
      '-s', KEYCHAIN_SERVICE,
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

async function readToken() {
  const r = await runSecurity();
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
let _lastRefreshAttempt = 0;

const CLAUDE_CANDIDATES = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', 'claude'];

function spawnClaude(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['-p', 'hi', '--max-budget-usd', '0.01'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 20_000,
    });
    p.on('close', () => resolve(true));
    p.on('error', () => resolve(false));
  });
}

async function attemptCliRefresh(force = false) {
  const now = Date.now();
  if (!force && now - _lastRefreshAttempt < REFRESH_COOLDOWN_MS) {
    return false;
  }
  _lastRefreshAttempt = now;
  for (const bin of CLAUDE_CANDIDATES) {
    const ok = await spawnClaude(bin);
    if (ok) return true;
  }
  return false;
}

export async function fetchUsage({ signal, _retried, force } = {}) {
  const token = await readToken();
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
      const refreshed = await attemptCliRefresh(force);
      if (refreshed) {
        return fetchUsage({ signal, _retried: true });
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
