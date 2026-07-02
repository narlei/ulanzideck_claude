let settings = {};
let loaded = false;

const form = document.getElementById('property-inspector');
const instanceEl = document.getElementById('instance');
const configDirRow = document.getElementById('configDirRow');
const configDirEl = document.getElementById('configDir');
const labelEl = document.getElementById('label');

// UlanziDeck delivers saved settings via didReceiveSettings, but it may also
// pass them in the URL as `param`. Try the URL first as a fast path.
function readInitialSettings() {
  const raw = Utils.getQueryParams('param');
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && (('configDir' in p) || ('label' in p)) ? p : null;
  } catch (e) {
    return null;
  }
}

function toggleConfigDirRow() {
  configDirRow.style.display = instanceEl.value === 'custom' ? '' : 'none';
}

function populate() {
  const dir = (settings.configDir || '').trim();
  instanceEl.value = dir ? 'custom' : 'default';
  configDirEl.value = dir;
  labelEl.value = settings.label || '';
  toggleConfigDirRow();
}

function save() {
  // Don't persist until we've loaded existing settings, or the initial blank
  // form state could overwrite a saved config before it arrives.
  if (!loaded) return;
  const isCustom = instanceEl.value === 'custom';
  settings = {
    ...settings,
    // A blank config dir means the default ~/.claude account.
    configDir: isCustom ? configDirEl.value.trim() : '',
    label: labelEl.value.trim(),
  };
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
  if (p && (('configDir' in p) || ('label' in p))) {
    settings = p;
    loaded = true;
    populate();
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
labelEl.addEventListener('input', debouncedSave);
