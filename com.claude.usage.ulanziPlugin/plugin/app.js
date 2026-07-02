import UlanziApi from './plugin-common-node/index.js';
import { fetchUsage, formatReset, formatStoppedReset, ErrorKind } from './usage-fetcher.js';
import {
  renderUsage,
  renderStopped,
  renderNoToken,
  renderReauth,
  renderKeychainBlocked,
  renderLoading,
  renderError,
} from './renderer.js';

const PLUGIN_UUID = 'com.narlei.claudeusage.multi.plugin';
const ACTION_5H = 'com.narlei.claudeusage.multi.plugin.fivehour';
const ACTION_7D = 'com.narlei.claudeusage.multi.plugin.weekly';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_SEC = 90;

const $UD = new UlanziApi();
const INSTANCES = new Map();

function log(...args) {
  console.log('[claude-usage]', ...args);
}

function actionFromContext(context) {
  return ($UD.decodeContext(context) || {}).uuid || '';
}

function metricFromContext(context, settings) {
  if (settings?.metric === '5h' || settings?.metric === '7d') return settings.metric;
  return actionFromContext(context) === ACTION_7D ? '7d' : '5h';
}

function metricLabel(metric) {
  return metric === '7d' ? 'Weekly' : '5h';
}

// The label drawn on the button. If the user set a custom instance label
// (e.g. "mine"), show "<label> <metric>"; otherwise just the metric.
function labelFor(inst) {
  const metric = inst.metric;
  const custom = (inst.settings?.label || '').trim();
  return custom ? `${custom} ${metricLabel(metric)}` : metricLabel(metric);
}

function pushIcon(context, dataUrl) {
  $UD.setBaseDataIcon(context, dataUrl);
}

function applyResult(inst, result) {
  inst.lastResult = result;
  renderForInstance(inst);
}

function renderForInstance(inst) {
  const { context, metric, lastResult } = inst;
  const label = labelFor(inst);

  if (!lastResult) {
    pushIcon(context, renderLoading({ label }));
    return;
  }

  if (lastResult.ok) {
    const data = lastResult.data;
    const util = metric === '7d' ? data.util7d : data.util5h;
    const reset = metric === '7d' ? data.reset7d : data.reset5h;
    const status = metric === '7d' ? data.status7d : data.status5h;
    if (status === 'rejected' || util === null || util === undefined) {
      pushIcon(context, renderStopped({ label, reset: formatStoppedReset(reset) }));
      return;
    }
    pushIcon(context, renderUsage({ label, util, reset: formatReset(reset) }));
    return;
  }

  if (lastResult.kind === ErrorKind.NO_TOKEN) {
    pushIcon(context, renderNoToken({ label }));
    return;
  }
  if (lastResult.kind === ErrorKind.AUTH) {
    pushIcon(context, renderReauth({ label }));
    return;
  }
  if (lastResult.kind === ErrorKind.RATE_LIMITED) {
    // 429 response still includes per-metric headers: only show "stopped" for the rejected
    // metric, the other continues to display actual utilization if not rejected.
    const data = lastResult.data;
    const util = data ? (metric === '7d' ? data.util7d : data.util5h) : null;
    const reset = data ? (metric === '7d' ? data.reset7d : data.reset5h) : null;
    const status = data ? (metric === '7d' ? data.status7d : data.status5h) : null;
    if (status === 'rejected' || util === null || util === undefined) {
      pushIcon(context, renderStopped({ label, reset: formatStoppedReset(reset) }));
    } else {
      pushIcon(context, renderUsage({ label, util, reset: formatReset(reset) }));
    }
    return;
  }

  const lastGood = inst.lastGood;
  if (lastGood) {
    const data = lastGood.data;
    const util = metric === '7d' ? data.util7d : data.util5h;
    const reset = metric === '7d' ? data.reset7d : data.reset5h;
    const stale = Math.floor(Date.now() / 1000) - data.fetchedAt;
    pushIcon(context, renderUsage({ label, util, reset: formatReset(reset), stale }));
    return;
  }

  pushIcon(context, renderError({ label, msg: 'no data' }));
}

async function refresh(inst, { force = false } = {}) {
  if (inst.inflight) return;
  inst.inflight = true;
  try {
    const result = await fetchUsage({ force, configDir: inst.settings?.configDir });
    if (result.ok) inst.lastGood = result;
    applyResult(inst, result);
  } catch (e) {
    log('refresh threw', e?.message);
    applyResult(inst, { ok: false, kind: ErrorKind.UNKNOWN, message: e?.message || 'unknown' });
  } finally {
    inst.inflight = false;
  }
}

function startPolling(inst) {
  stopPolling(inst);
  const jitter = Math.floor(Math.random() * 10_000);
  inst.startTimer = setTimeout(() => {
    refresh(inst);
    inst.timer = setInterval(() => refresh(inst), POLL_INTERVAL_MS);
  }, jitter);
}

function stopPolling(inst) {
  if (inst.startTimer) { clearTimeout(inst.startTimer); inst.startTimer = null; }
  if (inst.timer) { clearInterval(inst.timer); inst.timer = null; }
}

function ensureInstance(context, settings) {
  let inst = INSTANCES.get(context);
  const metric = metricFromContext(context, settings);
  if (!inst) {
    inst = {
      context,
      metric,
      settings: settings || {},
      lastResult: null,
      lastGood: null,
      inflight: false,
      timer: null,
      startTimer: null,
      active: true,
    };
    INSTANCES.set(context, inst);
    renderForInstance(inst);
    startPolling(inst);
  } else {
    const prevMetric = inst.metric;
    const prevConfigDir = inst.settings?.configDir || '';
    const prevLabel = inst.settings?.label || '';
    inst.metric = metric;
    // The deck re-issues add/param events (e.g. on click) sometimes with an
    // empty param. Only adopt incoming settings when they actually carry our
    // keys, otherwise keep what we already have — else a stray {} wipes config.
    if (settings && (('configDir' in settings) || ('label' in settings))) {
      inst.settings = settings;
    }
    const nextConfigDir = inst.settings?.configDir || '';
    const nextLabel = inst.settings?.label || '';
    if (prevConfigDir !== nextConfigDir) {
      // Switched to a different Claude account — the cached usage belongs to the
      // old one, so drop it and refetch against the new keychain entry.
      inst.lastGood = null;
      inst.lastResult = null;
      renderForInstance(inst);
      refresh(inst, { force: true });
    } else if (prevMetric !== metric || prevLabel !== nextLabel) {
      renderForInstance(inst);
    }
  }
  return inst;
}

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => log('connected'));

$UD.onAdd((msg) => {
  log('add', msg.context, msg.param);
  ensureInstance(msg.context, msg.param || {});
});

$UD.onParamFromApp((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  renderForInstance(inst);
});

$UD.onParamFromPlugin((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  renderForInstance(inst);
});

$UD.onRun((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) {
    ensureInstance(msg.context, msg.param || {});
    return;
  }
  log('click → force refresh', msg.context);
  pushIcon(msg.context, renderLoading({ label: labelFor(inst) }));
  refresh(inst, { force: true });
});

$UD.onSetActive((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) return;
  inst.active = !!msg.active;
  if (inst.active) {
    renderForInstance(inst);
    if (!inst.timer && !inst.startTimer) startPolling(inst);
  } else {
    stopPolling(inst);
  }
});

$UD.onClear((msg) => {
  if (!msg.param) return;
  for (const item of msg.param) {
    const ctx = item.context;
    const inst = INSTANCES.get(ctx);
    if (inst) {
      stopPolling(inst);
      INSTANCES.delete(ctx);
      log('clear', ctx);
    }
  }
});

$UD.onError((err) => log('socket error', err));
$UD.onClose(() => log('socket closed'));
