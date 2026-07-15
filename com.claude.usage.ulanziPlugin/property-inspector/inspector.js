let settings = {};
let loaded = false;
// The last { configDir, color } this PI itself sent via setSettings. The deck
// echoes every setSettings call back through didReceiveSettings, so we use
// this to recognize our own echo and skip re-populating the form from it —
// otherwise an echo arriving while the user is still interacting resets the
// field, discarding whatever changed since the debounced save.
let lastSent = null;

const form = document.getElementById('property-inspector');
const instanceEl = document.getElementById('instance');
const configDirRow = document.getElementById('configDirRow');
const configDirEl = document.getElementById('configDir');
const colorModeEl = document.getElementById('colorMode');
const colorRow = document.getElementById('colorRow');
const colorEl = document.getElementById('color');

// UlanziDeck delivers saved settings via didReceiveSettings, but it may also
// pass them in the URL as `param`. Try the URL first as a fast path.
function readInitialSettings() {
  const raw = Utils.getQueryParams('param');
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && (('configDir' in p) || ('color' in p)) ? p : null;
  } catch (e) {
    return null;
  }
}

function toggleConfigDirRow() {
  configDirRow.style.display = instanceEl.value === 'custom' ? '' : 'none';
}

function toggleColorRow() {
  colorRow.style.display = colorModeEl.value === 'custom' ? '' : 'none';
}

function populate() {
  const dir = (settings.configDir || '').trim();
  const color = (settings.color || '').trim();
  const active = document.activeElement;
  // Never overwrite a field the user is actively editing — a remote update
  // (e.g. a delayed/out-of-order settings echo) landing mid-edit would
  // otherwise wipe out a change the user hasn't saved yet.
  if (active !== instanceEl) instanceEl.value = dir ? 'custom' : 'default';
  if (active !== configDirEl) configDirEl.value = dir;
  if (active !== colorModeEl) colorModeEl.value = color ? 'custom' : 'none';
  if (active !== colorEl) colorEl.value = color || '#d77757';
  toggleConfigDirRow();
  toggleColorRow();
}

function save() {
  // Don't persist until we've loaded existing settings, or the initial blank
  // form state could overwrite a saved config before it arrives.
  if (!loaded) return;
  const isCustom = instanceEl.value === 'custom';
  const hasColor = colorModeEl.value === 'custom';
  settings = {
    ...settings,
    // A blank config dir means the default ~/.claude account.
    configDir: isCustom ? configDirEl.value.trim() : '',
    // A blank color means no accent stripe is drawn.
    color: hasColor ? colorEl.value : '',
  };
  lastSent = { configDir: settings.configDir, color: settings.color };
  $UD.setSettings(settings);
}

const debouncedSave = Utils.debounce(save, 300);

$UD.connect();

$UD.onConnected(() => {
  const fromUrl = readInitialSettings();
  if (fromUrl) {
    settings = fromUrl;
    loaded = true;
    populate();
  }
  // Ask the deck for the persisted settings; they arrive via didReceiveSettings.
  $UD.getSettings();
  // Fallback: if the deck never answers (e.g. a brand-new button with no saved
  // settings), unblock saving so user input still persists.
  setTimeout(() => { loaded = true; }, 600);
  document.querySelector('.udpi-wrapper').classList.remove('hidden');
});

// Saved settings arrive here (in response to getSettings, and on external
// edits). Only adopt params that carry our keys — the deck sometimes sends {}.
$UD.onDidReceiveSettings((msg) => {
  const p = msg && (msg.param || msg.settings);
  if (p && (('configDir' in p) || ('color' in p))) {
    const isSelfEcho = loaded && lastSent
      && (p.configDir || '') === lastSent.configDir
      && (p.color || '') === lastSent.color;
    settings = p;
    loaded = true;
    // Skip re-populating on our own echo — the form already reflects this
    // value (or something newer the user changed since), so writing it back
    // would only reset the input under the user's cursor.
    if (!isSelfEcho) populate();
  } else {
    // No saved settings yet (fresh button) — allow saving from now on.
    loaded = true;
  }
});

instanceEl.addEventListener('change', () => {
  toggleConfigDirRow();
  save();
});
configDirEl.addEventListener('input', debouncedSave);
colorModeEl.addEventListener('change', () => {
  toggleColorRow();
  save();
});
colorEl.addEventListener('input', debouncedSave);
