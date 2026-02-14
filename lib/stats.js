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
let _flushPromise = null; // single-flight ガード

// single-flight: 同時に1つの flush のみ実行
async function _doFlush() {
  while (_writeRev !== _flushedRev) {
    const revAtStart = _writeRev;
    const tmp = STATS_PATH + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(_s, null, 2));
    await fs.promises.rename(tmp, STATS_PATH);
    _flushedRev = revAtStart;
  }
}

function _requestFlush() {
  if (_flushPromise) return _flushPromise; // 既に実行中
  _flushPromise = _doFlush().catch(err => {
    console.error('stats flush エラー:', err);
    // エラー後に未保存データがあれば再スケジュール
    if (_writeRev !== _flushedRev) _scheduleFlush();
  }).finally(() => { _flushPromise = null; });
  return _flushPromise;
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    _requestFlush();
  }, FLUSH_INTERVAL_MS);
}

// 即時 flush（シャットダウン用）— 実行中の flush を待ってから最終 flush
async function flushStats() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_flushPromise) await _flushPromise;
  await _doFlush(); // 最終 flush は直接実行（エラーは呼び出し元に伝播）
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
  } catch (err) {
    console.error('⚠️ stats.json の読み込みに失敗（デフォルトで起動）:', err.message);
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
      smallHits: 0, loses: 0, consecutiveLosses: 0, points: 0,
    };
  }
  const u = s.users[userId];
  if (u.points == null) u.points = 0; // 既存ユーザー互換
  u.name = userName;
  u.spins++;
  if (resultType === 'jackpot') { u.jackpots++; u.consecutiveLosses = 0; u.points += 50; }
  else if (resultType === 'small') { u.smallHits++; u.consecutiveLosses = 0; u.points += 10; }
  else { u.loses++; u.consecutiveLosses++; u.points += 1; }

  s.history.push({
    ts: new Date().toISOString(), userId, userName,
    resultType, emojiIds, rareEvent: !!flags.rareEvent, pity: !!flags.pity,
  });
  if (s.history.length > MAX_HIST) s.history.splice(0, s.history.length - MAX_HIST);

  _writeRev++;
  _scheduleFlush();
  return u;
}

module.exports = { loadStats, getStats, recordSpin, flushStats };
