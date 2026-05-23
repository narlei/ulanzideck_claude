let SETTINGS = {};
let form = null;

const ACTION_5H = 'com.ulanzi.ulanzistudio.claudeusage.fivehour';

$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.udpi-wrapper').classList.remove('hidden');

  form.addEventListener('change', Utils.debounce(() => {
    const value = Utils.getFormValue(form);
    SETTINGS = { ...SETTINGS, ...value };
    $UD.sendParamFromPlugin(SETTINGS);
  }));
});

$UD.onAdd((json) => {
  if (json && json.param) loadSettings(json.param, json.uuid);
  else loadSettings({}, json?.uuid);
});

$UD.onParamFromApp((json) => {
  if (json && json.param) loadSettings(json.param, json.uuid);
});

function loadSettings(params, actionUuid) {
  SETTINGS = { ...params };
  if (!SETTINGS.metric) {
    SETTINGS.metric = actionUuid === ACTION_5H ? '5h' : '7d';
  }
  Utils.setFormValue(SETTINGS, form);
}
