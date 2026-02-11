const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const MAX_HIST = 1000;

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

function save() {
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
      save();
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

  save();
  return u;
}

module.exports = { loadStats, getStats, recordSpin };
