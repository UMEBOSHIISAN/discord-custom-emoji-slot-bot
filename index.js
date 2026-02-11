require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// --- 設定 ---
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID;
const JACKPOT_GIF_URL = process.env.JACKPOT_GIF_URL || '';
const COOLDOWN_SEC = parseInt(process.env.COOLDOWN_SEC, 10) || 15;
const SPIN_COUNT = parseInt(process.env.SPIN_COUNT, 10) || 10;
const JACKPOT_PROB = parseFloat(process.env.JACKPOT_PROB) || 0.01;

// トリガーワード（完全一致）
const TRIGGERS = ['りよ', 'リヨ', 'びっぐらぶ', '小林', 'シャーマン', 'スロット', '🎰', '回す'];

// 減速インターバル（ms） — SPIN_COUNT=10 用
const DEFAULT_INTERVALS = [150, 150, 200, 250, 300, 350, 450, 600, 750, 900];

// クールダウン管理
const cooldowns = new Map();

// GIF送信済みフラグ（Bot起動中1回だけ）
let gifSent = false;

// --- ユーティリティ ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getIntervals() {
  if (SPIN_COUNT === 10) return DEFAULT_INTERVALS;
  // SPIN_COUNT が変わった場合、動的に生成
  const intervals = [];
  for (let i = 0; i < SPIN_COUNT; i++) {
    const ratio = i / (SPIN_COUNT - 1);
    intervals.push(Math.round(150 + ratio * 750));
  }
  return intervals;
}

// リール固定境界の計算
function getPhases() {
  // 全リール回転: step 0 〜 phase1End
  // 左固定:       step phase1End+1 〜 phase2End
  // 左中固定:     step phase2End+1 〜 SPIN_COUNT-2
  // 全固定(STOP): step SPIN_COUNT-1
  const phase1End = Math.floor(SPIN_COUNT * 0.4) - 1;  // 40% 全回転
  const phase2End = Math.floor(SPIN_COUNT * 0.7) - 1;  // 70% まで左固定
  return { phase1End, phase2End };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function emojiToString(emoji) {
  return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
}

// --- 最終結果の決定 ---
function determineFinalReels(emojis, isJackpot) {
  if (isJackpot) {
    const winner = pickRandom(emojis);
    return [winner, winner, winner];
  }

  // 非JACKPOT: 3つ揃いを回避
  const maxRetries = 20;
  for (let i = 0; i < maxRetries; i++) {
    const left = pickRandom(emojis);
    const mid = pickRandom(emojis);
    const right = pickRandom(emojis);
    if (!(left.id === mid.id && mid.id === right.id)) {
      return [left, mid, right];
    }
  }
  // 万が一揃ってしまったら右だけ変える
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
  const isJackpot = Math.random() < JACKPOT_PROB;
  const [finalLeft, finalMid, finalRight] = determineFinalReels(emojis, isJackpot);

  const intervals = getIntervals();
  const { phase1End, phase2End } = getPhases();

  // 初期メッセージ送信
  const initDisplay = `🎰 ｶﾗｶﾗ… [1/${SPIN_COUNT}]\n${emojiToString(pickRandom(emojis))} ${emojiToString(pickRandom(emojis))} ${emojiToString(pickRandom(emojis))}`;
  const botMsg = await message.channel.send(initDisplay);

  // ステップ回転
  for (let step = 1; step < SPIN_COUNT; step++) {
    await sleep(intervals[step]);

    let left, mid, right;
    const isLastStep = step === SPIN_COUNT - 1;

    if (isLastStep) {
      // 最終ステップ: 全確定
      left = finalLeft;
      mid = finalMid;
      right = finalRight;
    } else if (step > phase2End) {
      // 左中固定 / 右回転
      left = finalLeft;
      mid = finalMid;
      right = pickRandom(emojis);
    } else if (step > phase1End) {
      // 左固定 / 中右回転
      left = finalLeft;
      mid = pickRandom(emojis);
      right = pickRandom(emojis);
    } else {
      // 全リール回転
      left = pickRandom(emojis);
      mid = pickRandom(emojis);
      right = pickRandom(emojis);
    }

    const label = isLastStep ? 'STOP!' : `ｶﾗｶﾗ… [${step + 1}/${SPIN_COUNT}]`;
    let display = `🎰 ${label}\n${emojiToString(left)} ${emojiToString(mid)} ${emojiToString(right)}`;

    // JACKPOT 演出
    if (isLastStep && isJackpot) {
      display += '\n💥 ドンッ！！\nケツアナ確定‼️';
    }

    await botMsg.edit(display);
  }

  // JACKPOT 時の GIF 送信（初回のみ）
  if (isJackpot && JACKPOT_GIF_URL && !gifSent) {
    gifSent = true;
    await message.channel.send(JACKPOT_GIF_URL);
  }
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
  // Bot自身は無視
  if (message.author.bot) return;

  // チャンネル制限
  if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

  // トリガー判定（trim + 完全一致）
  const content = message.content.trim();
  if (!TRIGGERS.includes(content)) return;

  // クールダウン判定
  const now = Date.now();
  const userId = message.author.id;
  const lastUsed = cooldowns.get(userId) || 0;
  const remaining = COOLDOWN_SEC * 1000 - (now - lastUsed);

  if (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    const cdMsg = await message.reply(`⏳ あと${secs}秒待ってね`);
    // 5秒後にクールダウンメッセージ削除
    setTimeout(() => cdMsg.delete().catch(() => {}), 5000);
    return;
  }
  cooldowns.set(userId, now);

  // カスタム絵文字プール取得
  const emojis = message.guild.emojis.cache.filter((e) => !e.managed).map((e) => e);
  if (emojis.length < 3) {
    await message.reply('❌ カスタム絵文字が3つ以上必要です');
    return;
  }

  // スロット実行
  try {
    await runSlot(message, emojis);
  } catch (err) {
    console.error('スロット実行エラー:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
