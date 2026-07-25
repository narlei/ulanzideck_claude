import { spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const KEYCHAIN_SERVICE_BASE = 'Claude Code-credentials';
const CREDENTIALS_FILE = '.credentials.json';
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
// Empty/undefined → the default ~/.claude. Supports a leading "~" everywhere and
// %VAR% expansion on Windows, since that's how paths are usually written there.
function resolveConfigDir(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return DEFAULT_CONFIG_DIR;
  let d = dir.trim();
  if (IS_WINDOWS) {
    d = d.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? process.env[name.toUpperCase()] ?? m);
  }
  if (d === '~') d = os.homedir();
  else if (d.startsWith('~/') || (IS_WINDOWS && d.startsWith('~\\'))) d = path.join(os.homedir(), d.slice(2));
  return path.resolve(d);
}

// macOS Claude Code stores its OAuth token in the Keychain under
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

// Windows and Linux Claude Code keep the OAuth token in a plain file inside the
// config dir — same JSON shape as the macOS Keychain entry. Because the file
// lives *inside* CLAUDE_CONFIG_DIR, multi-account support falls out for free.
export function credentialsPathForConfigDir(dir) {
  return path.join(resolveConfigDir(dir), CREDENTIALS_FILE);
}

function readTokenFromFile(configDir) {
  try {
    return extractAccessToken(fs.readFileSync(credentialsPathForConfigDir(configDir), 'utf8'));
  } catch {
    return null;
  }
}

async function readToken(configDir) {
  if (IS_MAC) {
    const r = await runSecurity(keychainServiceForConfigDir(configDir));
    const fromKeychain = r.code === 0 ? extractAccessToken(r.out) : null;
    // Fall back to the on-disk file: some macOS setups (headless/CI, or a CLI
    // configured for file storage) never populate the Keychain entry.
    return fromKeychain || readTokenFromFile(configDir);
  }
  return readTokenFromFile(configDir);
}

function noTokenMessage(configDir) {
  if (IS_MAC) return 'No Claude Code credentials in keychain';
  return `No Claude Code credentials at ${credentialsPathForConfigDir(configDir)}`;
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
// refresh has already run by then — so the stored credentials are updated for free.
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
// Track the last refresh attempt per resolved config dir, so a refresh for one
// instance doesn't reset another instance's cooldown.
const _lastRefreshAttempt = new Map();

// The Ulanzi deck launches this plugin from the GUI, so it inherits a minimal
// PATH that usually lacks the shell-profile additions where `claude` lives.
// Probe the known absolute install locations explicitly before falling back to
// a bare `claude` (which only resolves if it happens to be on the process PATH).
function claudeCandidates() {
  const home = os.homedir();

  if (!IS_WINDOWS) {
    return [
      path.join(home, '.local/bin/claude'), // native installer (current default)
      path.join(home, '.claude/local/claude'), // legacy local install / migrate-installer
      '/opt/homebrew/bin/claude', // Homebrew (Apple Silicon)
      '/usr/local/bin/claude', // Homebrew (Intel) / npm global prefix
      'claude', // last resort: rely on inherited PATH
    ];
  }

  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const list = [];

  const push = (p) => { if (fs.existsSync(p)) list.push(p); };

  push(path.join(home, '.local', 'bin', 'claude.exe')); // native installer
  push(path.join(appData, 'npm', 'claude.cmd')); // npm -g shim
  push(path.join(localAppData, 'Programs', 'claude', 'claude.exe'));

  // Bundled CLI ships under a per-version directory, so pick the newest one
  // instead of hard-coding a version that goes stale on every update.
  const bundledRoot = path.join(appData, 'Claude', 'claude-code');
  try {
    const versions = fs.readdirSync(bundledRoot)
      .map((name) => ({ name, parts: name.split('.').map((n) => parseInt(n, 10) || 0) }))
      .sort((a, b) => (b.parts[0] - a.parts[0]) || (b.parts[1] - a.parts[1]) || (b.parts[2] - a.parts[2]));
    for (const v of versions) push(path.join(bundledRoot, v.name, 'claude.exe'));
  } catch {
    /* directory may not exist */
  }

  push(path.join(localAppData, 'Claude', 'claude.exe'));
  list.push('claude'); // last resort: rely on inherited PATH
  return list;
}

function spawnClaude(bin, configDir) {
  return new Promise((resolve) => {
    // Claude Code keys its credentials entry off whether CLAUDE_CONFIG_DIR is *set*,
    // not off its value: setting it (even to the default ~/.claude) makes the macOS
    // CLI look for a hash-suffixed "Claude Code-credentials-<hash>" entry and report
    // "Not logged in", so the OAuth refresh never runs. Only export it for a
    // genuinely custom dir; for the default, leave it unset like a normal shell.
    const resolved = resolveConfigDir(configDir);
    const env = { ...process.env };
    if (resolved === DEFAULT_CONFIG_DIR) delete env.CLAUDE_CONFIG_DIR;
    else env.CLAUDE_CONFIG_DIR = resolved;

    // On Windows only .exe entries can be spawned directly; the npm shim
    // (claude.cmd) and the bare PATH lookup need cmd.exe to resolve them.
    // With shell:true the args must be pre-joined into the command line — they
    // are hard-coded constants, so there is no injection surface, but the
    // install path can contain spaces, hence the explicit quoting.
    const useShell = IS_WINDOWS && !/\.exe$/i.test(bin);
    const args = ['-p', 'hi', '--max-budget-usd', '0.01'];
    const command = useShell
      ? `${bin.includes(' ') ? `"${bin}"` : bin} ${args.join(' ')}`
      : bin;

    const p = spawn(command, useShell ? [] : args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 20_000,
      windowsHide: true,
      shell: useShell,
      env,
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
  for (const bin of claudeCandidates()) {
    const ok = await spawnClaude(bin, configDir);
    if (ok) return true;
  }
  return false;
}

export async function fetchUsage({ signal, _retried, force, configDir } = {}) {
  const token = await readToken(configDir);
  if (!token) {
    return { ok: false, kind: ErrorKind.NO_TOKEN, message: noTokenMessage(configDir) };
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
