require('dotenv').config();
const { Client, GatewayIntentBits, escapeMarkdown } = require('discord.js');

// --- 設定 ---
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID;
const JACKPOT_GIF_URL = process.env.JACKPOT_GIF_URL || '';
const COOLDOWN_SEC = parseInt(process.env.COOLDOWN_SEC, 10) || 15;
const SPIN_COUNT = Math.max(4, parseInt(process.env.SPIN_COUNT, 10) || 10);
const JACKPOT_PROB = Math.min(1, Math.max(0, parseFloat(process.env.JACKPOT_PROB) || 0.01));
const NEAR_MISS_PROB = Math.min(1, Math.max(0, parseFloat(process.env.NEAR_MISS_PROB) || 0.1));
const SPECIAL_EMOJI_ID = process.env.SPECIAL_EMOJI_ID || '';
const BOOSTED_EMOJI_ID = process.env.BOOSTED_EMOJI_ID || '';
const BOOSTED_WEIGHT = Math.max(1, parseInt(process.env.BOOSTED_WEIGHT, 10) || 5);
const PAIR_TRIGGER_EMOJI_ID = process.env.PAIR_TRIGGER_EMOJI_ID || '';
const PAIR_REACTION_EMOJI_ID = process.env.PAIR_REACTION_EMOJI_ID || '';
const MAX_CONCURRENT_SPINS = 3;
const RANDOM_EMOJI_COUNT = 5;

// 固定絵文字（必ずスロットに含まれる）
const FIXED_EMOJI_IDS = new Set([
  '1460302647956607018',
  '1460560813046628556',
  '1461568806819463310',
  '1468991450074321039',
  '1470971524231073995',
  '1469916905493106801',
  '1469558140608450581',
]);

// トリガーワード（完全一致）
const TRIGGERS = ['りよ', 'リヨ', 'びっぐらぶ', '小林', 'シャーマン', 'スロット', '🎰', '回す'];

// ランキングトリガー
const RANKING_TRIGGERS = ['今日のシャーマン', 'ランキング'];

// 減速インターバル（ms） — SPIN_COUNT=10 用
const DEFAULT_INTERVALS = [150, 150, 200, 250, 300, 350, 450, 600, 750, 900];

// クールダウン管理
const cooldowns = new Map();

// GIF送信済みフラグ（Bot起動中1回だけ）
let gifSent = false;

// アナルアサシン獲得カウント（ユーザー単位、永続ではない）
const assassinCounts = new Map();

// チャンネル同時実行数
let activeSpins = 0;

// デイリー統計（日付ごと）
const dailyStats = new Map();

function getTodayKey() {
  // JST固定 (UTC+9)
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function recordSpin(userId, username, isJackpot) {
  const today = getTodayKey();
  if (!dailyStats.has(today)) {
    dailyStats.clear();
    dailyStats.set(today, new Map());
  }
  const stats = dailyStats.get(today);
  if (!stats.has(userId)) {
    stats.set(userId, { spins: 0, jackpots: 0, username });
  }
  const user = stats.get(userId);
  user.spins++;
  user.username = username;
  if (isJackpot) user.jackpots++;
}

// 連続ペア記録
const lastPairUser = new Map();

// 確率2倍バフ（ユーザー単位、1回限り）
const doubleChanceUsers = new Set();

// BIG LOVE 演出（リール前に稀に発生、3連続で確定当たり）
const BIG_LOVE_PROB = 0.08; // 約1/12
const BIG_LOVE_STREAK_TARGET = 3;
const bigLoveStreaks = new Map();

// メスイキモード（次回スピンで特定絵文字がリーチ出まくり）
const MESUIKI_EMOJI_ID = '1471023091416174684';
const MESUIKI_WEIGHT = 15; // 通常の15倍出現
const mesuikiModeUsers = new Set();

// 特殊ハズレメッセージ（確率2倍トリガー）
const DOUBLE_CHANCE_MSG = 'ケツ穴が見つかりません';

// ハズレメッセージ（ランダム表示）
const LOSE_MESSAGES = [
  'ざんねん！',
  'もう一回！',
  'ドンマイ！',
  'おしい！',
  '次こそ…！',
  'まだまだ！',
  'くやしい！',
  '🫶 BIG LOVE',
  'メスイキ',
  DOUBLE_CHANCE_MSG,
];

// --- ユーティリティ ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getIntervals() {
  if (SPIN_COUNT === 10) return DEFAULT_INTERVALS;
  const intervals = [];
  for (let i = 0; i < SPIN_COUNT; i++) {
    const ratio = i / (SPIN_COUNT - 1);
    intervals.push(Math.round(150 + ratio * 750));
  }
  return intervals;
}

function getPhases() {
  const phase1End = Math.floor(SPIN_COUNT * 0.4) - 1;
  const phase2End = Math.floor(SPIN_COUNT * 0.7) - 1;
  return { phase1End, phase2End };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 重み付きプールを事前構築
function buildWeightedPool(emojis) {
  if (!BOOSTED_EMOJI_ID) return emojis;
  const pool = [];
  for (const e of emojis) {
    const count = e.id === BOOSTED_EMOJI_ID ? BOOSTED_WEIGHT : 1;
    for (let i = 0; i < count; i++) pool.push(e);
  }
  return pool;
}

function emojiToString(emoji) {
  return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
}

// --- 最終結果の決定 ---
function determineFinalReels(emojis, isJackpot, isNearMiss) {
  if (isJackpot) {
    const winner = pickRandom(emojis);
    return [winner, winner, winner];
  }

  if (isNearMiss && SPECIAL_EMOJI_ID) {
    const special = emojis.find((e) => e.id === SPECIAL_EMOJI_ID);
    if (special) {
      const others = emojis.filter((e) => e.id !== SPECIAL_EMOJI_ID);
      const diff = others.length > 0 ? pickRandom(others) : pickRandom(emojis);
      const patterns = [
        [special, special, diff],
        [special, diff, special],
        [diff, special, special],
      ];
      return pickRandom(patterns);
    }
  }

  const maxRetries = 20;
  for (let i = 0; i < maxRetries; i++) {
    const left = pickRandom(emojis);
    const mid = pickRandom(emojis);
    const right = pickRandom(emojis);
    if (!(left.id === mid.id && mid.id === right.id)) {
      return [left, mid, right];
    }
  }
  const left = pickRandom(emojis);
  const mid = pickRandom(emojis);
  let right = pickRandom(emojis);
  while (left.id === mid.id && mid.id === right.id && emojis.length > 1) {
    right = pickRandom(emojis);
  }
  return [left, mid, right];
}

// --- スピン実行 ---
async function runSlot(message, emojis) {
  const userId = message.author.id;

  // --- BIG LOVE 演出（リール前） ---
  let forcedJackpot = false;
  if (Math.random() < BIG_LOVE_PROB) {
    const streak = (bigLoveStreaks.get(userId) || 0) + 1;
    bigLoveStreaks.set(userId, streak);
    if (streak >= BIG_LOVE_STREAK_TARGET) {
      // 3連続 → 確定当たり
      bigLoveStreaks.set(userId, 0);
      forcedJackpot = true;
      await message.channel.send('🫶 **BIG LOVE** 🫶\n🫶 **BIG LOVE** 🫶\n🫶 **BIG LOVE** 🫶\n💥 ケツアナ確定演出突入‼️');
      await sleep(1500);
    } else {
      await message.channel.send(`🫶 **BIG LOVE** (${streak}/${BIG_LOVE_STREAK_TARGET})`);
      await sleep(800);
    }
  } else {
    bigLoveStreaks.set(userId, 0);
  }

  // メスイキモード判定・消費
  const hasMesuikiMode = mesuikiModeUsers.has(userId);
  if (hasMesuikiMode) mesuikiModeUsers.delete(userId);

  const hasDoubleChance = doubleChanceUsers.has(userId);
  const effectiveProb = hasDoubleChance ? JACKPOT_PROB * 2 : JACKPOT_PROB;
  // バフ消費（当たってもハズレても1回で消える）
  if (hasDoubleChance) doubleChanceUsers.delete(userId);

  const roll = Math.random();
  const isJackpot = forcedJackpot || roll < effectiveProb;
  const isNearMiss = !isJackpot && roll < effectiveProb + NEAR_MISS_PROB;
  const [finalLeft, finalMid, finalRight] = determineFinalReels(emojis, isJackpot, isNearMiss);

  // 統計記録
  const displayName = message.member?.displayName ?? message.author.username;
  recordSpin(message.author.id, displayName, isJackpot);

  const intervals = getIntervals();
  const { phase1End, phase2End } = getPhases();

  // 重み付きプールを構築（メスイキモード時は特定絵文字を大量ブースト）
  let weightedPool;
  if (hasMesuikiMode) {
    const pool = [];
    for (const e of emojis) {
      const count = e.id === MESUIKI_EMOJI_ID ? MESUIKI_WEIGHT : 1;
      for (let i = 0; i < count; i++) pool.push(e);
    }
    weightedPool = pool;
  } else {
    weightedPool = buildWeightedPool(emojis);
  }

  // リーチ判定（左中が同じ絵文字か）
  const isReach = finalLeft.id === finalMid.id;

  const initDisplay = `🎰 ｶﾗｶﾗ… [1/${SPIN_COUNT}]\n${emojiToString(pickRandom(weightedPool))} ${emojiToString(pickRandom(weightedPool))} ${emojiToString(pickRandom(weightedPool))}`;
  const botMsg = await message.channel.send(initDisplay);

  for (let step = 1; step < SPIN_COUNT; step++) {
    await sleep(intervals[step]);

    let left, mid, right;
    const isLastStep = step === SPIN_COUNT - 1;

    if (isLastStep) {
      left = finalLeft;
      mid = finalMid;
      right = finalRight;
    } else if (step > phase2End) {
      left = finalLeft;
      mid = finalMid;
      right = pickRandom(weightedPool);
    } else if (step > phase1End) {
      left = finalLeft;
      mid = pickRandom(weightedPool);
      right = pickRandom(weightedPool);
    } else {
      left = pickRandom(weightedPool);
      mid = pickRandom(weightedPool);
      right = pickRandom(weightedPool);
    }

    let label = isLastStep ? 'STOP!' : `ｶﾗｶﾗ… [${step + 1}/${SPIN_COUNT}]`;

    // リーチ演出: 左中固定フェーズで左中が揃っている場合
    if (!isLastStep && step > phase2End && isReach) {
      label = `ｶﾗｶﾗ… [${step + 1}/${SPIN_COUNT}] ケツアナ？`;
    }

    let display = `🎰 ${label}\n${emojiToString(left)} ${emojiToString(mid)} ${emojiToString(right)}`;

    // JACKPOT 演出
    if (isLastStep && isJackpot) {
      display += '\n💥 ドンッ！！\nケツアナ確定‼️';
    }

    // ハズレ演出
    if (isLastStep && !isJackpot) {
      const loseMsg = pickRandom(LOSE_MESSAGES);
      display += `\n${loseMsg}`;
      // 「ケツ穴が見つかりません」→ 次回確率2倍バフ付与
      if (loseMsg === DOUBLE_CHANCE_MSG) {
        doubleChanceUsers.add(userId);
        display += '\n⚡ 次回の当選確率が2倍！';
      }
      // 「メスイキ」→ メスイキモード突入
      if (loseMsg === 'メスイキ') {
        const mesuikiEmoji = emojis.find((e) => e.id === MESUIKI_EMOJI_ID);
        if (mesuikiEmoji) {
          display += `\n${emojiToString(mesuikiEmoji)} メスイキモード突入‼️`;
        }
        mesuikiModeUsers.add(userId);
      }
    }

    // メスイキモード中の表示（最初のステップのみ）
    if (step === 1 && hasMesuikiMode) {
      const mesuikiEmoji = emojis.find((e) => e.id === MESUIKI_EMOJI_ID);
      const prefix = mesuikiEmoji ? `${emojiToString(mesuikiEmoji)} メスイキモード！\n` : 'メスイキモード！\n';
      display = prefix + display;
    }

    // 確率2倍バフ中の表示（最初のステップのみ）
    if (step === 1 && hasDoubleChance) {
      display = `⚡ 確率2倍チャンス！\n` + display;
    }

    // ペア演出
    if (isLastStep && PAIR_TRIGGER_EMOJI_ID && PAIR_REACTION_EMOJI_ID) {
      const finals = [finalLeft, finalMid, finalRight];
      const pairCount = finals.filter((e) => e.id === PAIR_TRIGGER_EMOJI_ID).length;
      if (pairCount >= 2) {
        const reactionEmoji = emojis.find((e) => e.id === PAIR_REACTION_EMOJI_ID);
        if (reactionEmoji) {
          display += `\n${emojiToString(reactionEmoji)}`;
        }

        // 連続ペアチェック → BIG LOVE
        const userId = message.author.id;
        const streak = (lastPairUser.get(userId) || 0) + 1;
        lastPairUser.set(userId, streak);
        if (streak >= 2) {
          display += '\n🫶 BIG LOVE';
        }
      } else {
        lastPairUser.set(message.author.id, 0);
      }
    }

    await botMsg.edit(display);
  }

  // JACKPOT 時の GIF 送信 + 追い絵文字
  if (isJackpot) {
    if (JACKPOT_GIF_URL) {
      if (forcedJackpot) {
        await message.channel.send(JACKPOT_GIF_URL);
      } else if (!gifSent) {
        gifSent = true;
        await message.channel.send(JACKPOT_GIF_URL);
      }
    }
    // GIF 後に絵文字表示
    const jackpotEmoji = emojis.find((e) => e.id === '1471013241491689473');
    if (jackpotEmoji) {
      await message.channel.send(emojiToString(jackpotEmoji));
    }
    // アナルアサシン獲得カウント
    const count = (assassinCounts.get(userId) || 0) + 1;
    assassinCounts.set(userId, count);
    const safeName = escapeMarkdown(displayName);
    await message.channel.send({ content: `🗡️ **${safeName}** はアナルアサシンを手に入れた（${count}回目）`, allowedMentions: { parse: [] } });
  }
}

// --- ランキング表示 ---
function buildRanking() {
  const today = getTodayKey();
  const stats = dailyStats.get(today);
  if (!stats || stats.size === 0) {
    return '🎰 今日はまだ誰も回してないよ！';
  }

  const sorted = [...stats.entries()]
    .sort((a, b) => b[1].spins - a[1].spins)
    .slice(0, 10); // 上位10名に制限

  const medals = ['🥇', '🥈', '🥉'];
  let text = '🏆 **今日のシャーマン発表** 🏆\n\n';

  sorted.forEach(([, data], i) => {
    const medal = medals[i] || `${i + 1}.`;
    const safeName = escapeMarkdown(data.username);
    const jackpotText = data.jackpots > 0 ? ` (JACKPOT ${data.jackpots}回!)` : '';
    text += `${medal} **${safeName}** — ${data.spins}回${jackpotText}\n`;
  });

  const topUser = sorted[0][1];
  const safeTopName = escapeMarkdown(topUser.username);
  text += `\n👑 今日のシャーマンは **${safeTopName}** （${topUser.spins}回）`;

  return text;
}

// --- Bot 起動 ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content.trim();

    // ランキング表示
    if (RANKING_TRIGGERS.includes(content)) {
      await message.channel.send({ content: buildRanking(), allowedMentions: { parse: [] } });
      return;
    }

    // スロットトリガー判定
    if (!TRIGGERS.includes(content)) return;

    // 同時実行制限
    if (activeSpins >= MAX_CONCURRENT_SPINS) {
      const cdMsg = await message.reply('🎰 混み合ってるよ！ちょっと待ってね');
      setTimeout(() => cdMsg.delete().catch(() => {}), 5000);
      return;
    }

    // クールダウン判定
    const now = Date.now();
    const userId = message.author.id;
    const lastUsed = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN_SEC * 1000 - (now - lastUsed);

    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      const cdMsg = await message.reply(`⏳ あと${secs}秒待ってね`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 5000);
      return;
    }

    const allEmojis = message.guild.emojis.cache.filter((e) => !e.managed);
    const fixed = allEmojis.filter((e) => FIXED_EMOJI_IDS.has(e.id)).map((e) => e);
    const others = allEmojis.filter((e) => !FIXED_EMOJI_IDS.has(e.id)).map((e) => e);

    // others からランダムに RANDOM_EMOJI_COUNT 個選出
    const shuffled = others.sort(() => Math.random() - 0.5);
    const randomPicks = shuffled.slice(0, RANDOM_EMOJI_COUNT);

    const emojis = [...fixed, ...randomPicks];
    if (emojis.length < 3) {
      await message.reply('❌ カスタム絵文字が3つ以上必要です');
      return;
    }

    activeSpins++;
    cooldowns.set(userId, Date.now());
    try {
      await runSlot(message, emojis);
    } finally {
      activeSpins--;
    }
  } catch (err) {
    console.error('エラー:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
