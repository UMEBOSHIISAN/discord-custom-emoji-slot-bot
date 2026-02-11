const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const MAX_HIST = 1000;
const FLUSH_INTERVAL_MS = 1000;

function blank() {
  return {
    global: {
      totalSpins: 0, jackpotCount: 0, smallHitCount: 0,
      loseCount: 0, rareEventCount: 0, pityJackpotCount: 0,
    },
    users: {},
    history: [],
  };
}

let _s = null;
let _writeRev = 0;   // recordSpin ごとにインクリメント
let _flushedRev = 0;  // flush 完了時の rev を記録
let _flushTimer = null;
let _flushing = false;

async function _flush() {
  if (_writeRev === _flushedRev || _flushing) return;
  _flushing = true;
  try {
    const revAtStart = _writeRev;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATS_PATH + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(_s, null, 2));
    await fs.promises.rename(tmp, STATS_PATH);
    _flushedRev = revAtStart;
    // flush 中に新しい書き込みがあれば再スケジュール
    if (_writeRev !== _flushedRev) _scheduleFlush();
  } catch (err) {
    console.error('stats flush エラー:', err);
  } finally {
    _flushing = false;
  }
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await _flush();
  }, FLUSH_INTERVAL_MS);
}

// 即時 flush（シャットダウン用）
async function flushStats() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  _flushing = false; // シャットダウン時はガードを解除して確実に書き込む
  await _flush();
}

// 起動時の初回保存のみ同期
function saveSyncOnce() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_s, null, 2));
  fs.renameSync(tmp, STATS_PATH);
}

function loadStats() {
  try {
    if (fs.existsSync(STATS_PATH)) {
      _s = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
      if (!_s.global) _s.global = blank().global;
      if (!_s.users) _s.users = {};
      if (!_s.history) _s.history = [];
    } else {
      _s = blank();
      saveSyncOnce();
    }
  } catch {
    _s = blank();
  }
  return _s;
}

function getStats() { return _s || loadStats(); }

function recordSpin(userId, userName, resultType, emojiIds, flags = {}) {
  const s = getStats();
  const g = s.global;
  g.totalSpins++;
  if (resultType === 'jackpot') g.jackpotCount++;
  else if (resultType === 'small') g.smallHitCount++;
  else g.loseCount++;
  if (flags.rareEvent) g.rareEventCount++;
  if (flags.pity) g.pityJackpotCount++;

  if (!s.users[userId]) {
    s.users[userId] = {
      name: userName, spins: 0, jackpots: 0,
      smallHits: 0, loses: 0, consecutiveLosses: 0,
    };
  }
  const u = s.users[userId];
  u.name = userName;
  u.spins++;
  if (resultType === 'jackpot') { u.jackpots++; u.consecutiveLosses = 0; }
  else if (resultType === 'small') { u.smallHits++; u.consecutiveLosses = 0; }
  else { u.loses++; u.consecutiveLosses++; }

  s.history.push({
    ts: new Date().toISOString(), userId, userName,
    resultType, emojiIds, rareEvent: !!flags.rareEvent, pity: !!flags.pity,
  });
  if (s.history.length > MAX_HIST) s.history = s.history.slice(-MAX_HIST);

  _writeRev++;
  _scheduleFlush();
  return u;
}

module.exports = { loadStats, getStats, recordSpin, flushStats };
