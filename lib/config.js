const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function envDefaults() {
  return {
    JACKPOT_PROB: parseFloat(process.env.JACKPOT_PROB) || 0.01,
    SMALL_HIT_PROB: parseFloat(process.env.SMALL_HIT_PROB) || 0.05,
    RARE_EVENT_PROB: parseFloat(process.env.RARE_EVENT_PROB) || 0.001,
    FAKE_MATCH_PROB: parseFloat(process.env.FAKE_MATCH_PROB) || 0.05,
    PITY_LIMIT: parseInt(process.env.PITY_LIMIT, 10) || 50,
    COOLDOWN_SEC: parseInt(process.env.COOLDOWN_SEC, 10) || 15,
    SPIN_COUNT: parseInt(process.env.SPIN_COUNT, 10) || 10,
    enableTease: true,
    enableFake: true,
    enableRare: true,
  };
}

let _c = null;

function clamp(c) {
  c.JACKPOT_PROB = Math.min(1, Math.max(0, Number(c.JACKPOT_PROB) || 0));
  c.SMALL_HIT_PROB = Math.min(1, Math.max(0, Number(c.SMALL_HIT_PROB) || 0));
  c.RARE_EVENT_PROB = Math.min(1, Math.max(0, Number(c.RARE_EVENT_PROB) || 0));
  c.FAKE_MATCH_PROB = Math.min(1, Math.max(0, Number(c.FAKE_MATCH_PROB) || 0));
  c.PITY_LIMIT = Math.max(1, Math.round(Number(c.PITY_LIMIT) || 50));
  c.COOLDOWN_SEC = Math.max(1, Math.round(Number(c.COOLDOWN_SEC) || 15));
  c.SPIN_COUNT = Math.min(20, Math.max(4, Math.round(Number(c.SPIN_COUNT) || 10)));
  c.enableTease = c.enableTease !== false;
  c.enableFake = c.enableFake !== false;
  c.enableRare = c.enableRare !== false;
  return c;
}

async function save(c) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(c, null, 2));
  await fsp.rename(tmp, CONFIG_PATH);
}

// 起動時の初回保存のみ同期
function saveSyncOnce(c) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

function loadConfig() {
  const def = envDefaults();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const j = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      _c = clamp({ ...def, ...j });
    } else {
      _c = clamp(def);
      saveSyncOnce(_c);
    }
  } catch {
    _c = clamp(def);
  }
  return _c;
}

function getConfig() { return _c || loadConfig(); }

async function updateConfig(u) {
  _c = clamp({ ...getConfig(), ...u });
  await save(_c);
  return _c;
}

module.exports = { loadConfig, getConfig, updateConfig };
