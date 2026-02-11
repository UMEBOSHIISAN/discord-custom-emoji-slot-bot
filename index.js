require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// --- 設定 ---
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID;
const JACKPOT_GIF_URL = process.env.JACKPOT_GIF_URL || '';
const COOLDOWN_SEC = parseInt(process.env.COOLDOWN_SEC, 10) || 15;
const SPIN_COUNT = parseInt(process.env.SPIN_COUNT, 10) || 10;
const JACKPOT_PROB = parseFloat(process.env.JACKPOT_PROB) || 0.01;
const NEAR_MISS_PROB = parseFloat(process.env.NEAR_MISS_PROB) || 0.1;
const SPECIAL_EMOJI_ID = process.env.SPECIAL_EMOJI_ID || '';
const BOOSTED_EMOJI_ID = process.env.BOOSTED_EMOJI_ID || '';
const BOOSTED_WEIGHT = parseInt(process.env.BOOSTED_WEIGHT, 10) || 5;
const PAIR_TRIGGER_EMOJI_ID = process.env.PAIR_TRIGGER_EMOJI_ID || '';
const PAIR_REACTION_EMOJI_ID = process.env.PAIR_REACTION_EMOJI_ID || '';

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

// デイリー統計（日付ごと）
const dailyStats = new Map(); // { date: Map<userId, { spins, jackpots, username }> }

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function recordSpin(userId, username, isJackpot) {
  const today = getTodayKey();
  if (!dailyStats.has(today)) {
    dailyStats.clear(); // 前日分をクリア
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
const lastPairUser = new Map(); // userId -> 連続ペア回数

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

function pickWeighted(emojis) {
  if (!BOOSTED_EMOJI_ID) return pickRandom(emojis);
  const pool = [];
  for (const e of emojis) {
    const count = e.id === BOOSTED_EMOJI_ID ? BOOSTED_WEIGHT : 1;
    for (let i = 0; i < count; i++) pool.push(e);
  }
  return pool[Math.floor(Math.random() * pool.length)];
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
  const roll = Math.random();
  const isJackpot = roll < JACKPOT_PROB;
  const isNearMiss = !isJackpot && roll < JACKPOT_PROB + NEAR_MISS_PROB;
  const [finalLeft, finalMid, finalRight] = determineFinalReels(emojis, isJackpot, isNearMiss);

  // 統計記録
  recordSpin(message.author.id, message.author.displayName || message.author.username, isJackpot);

  const intervals = getIntervals();
  const { phase1End, phase2End } = getPhases();

  // リーチ判定（左中が同じ絵文字か）
  const isReach = finalLeft.id === finalMid.id;

  const initDisplay = `🎰 ｶﾗｶﾗ… [1/${SPIN_COUNT}]\n${emojiToString(pickWeighted(emojis))} ${emojiToString(pickWeighted(emojis))} ${emojiToString(pickWeighted(emojis))}`;
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
      right = pickWeighted(emojis);
    } else if (step > phase1End) {
      left = finalLeft;
      mid = pickWeighted(emojis);
      right = pickWeighted(emojis);
    } else {
      left = pickWeighted(emojis);
      mid = pickWeighted(emojis);
      right = pickWeighted(emojis);
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

  // JACKPOT 時の GIF 送信（初回のみ）
  if (isJackpot && JACKPOT_GIF_URL && !gifSent) {
    gifSent = true;
    await message.channel.send(JACKPOT_GIF_URL);
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
    .sort((a, b) => b[1].spins - a[1].spins);

  const medals = ['🥇', '🥈', '🥉'];
  let text = '🏆 **今日のシャーマン発表** 🏆\n\n';

  sorted.forEach(([, data], i) => {
    const medal = medals[i] || `${i + 1}.`;
    const jackpotText = data.jackpots > 0 ? ` (JACKPOT ${data.jackpots}回!)` : '';
    text += `${medal} **${data.username}** — ${data.spins}回${jackpotText}\n`;
  });

  const topUser = sorted[0][1];
  text += `\n👑 今日のシャーマンは **${topUser.username}** （${topUser.spins}回）`;

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
  if (message.author.bot) return;
  if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

  const content = message.content.trim();

  // ランキング表示
  if (RANKING_TRIGGERS.includes(content)) {
    await message.channel.send(buildRanking());
    return;
  }

  // スロットトリガー判定
  if (!TRIGGERS.includes(content)) return;

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
  cooldowns.set(userId, now);

  const emojis = message.guild.emojis.cache.filter((e) => !e.managed).map((e) => e);
  if (emojis.length < 3) {
    await message.reply('❌ カスタム絵文字が3つ以上必要です');
    return;
  }

  try {
    await runSlot(message, emojis);
  } catch (err) {
    console.error('スロット実行エラー:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
