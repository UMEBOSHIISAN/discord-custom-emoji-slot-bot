require('dotenv').config();
const { Client, GatewayIntentBits, escapeMarkdown } = require('discord.js');
const { loadConfig, getConfig } = require('./lib/config');
const { loadStats, getStats, recordSpin } = require('./lib/stats');
const { getEmojiPool, rollOutcome, decideFinal, animateSpin, maybeSendGifOnce } = require('./lib/slot');
const { createApp } = require('./lib/web');

// --- 起動時バリデーション ---
if (!process.env.DISCORD_TOKEN) { console.error('❌ DISCORD_TOKEN missing'); process.exit(1); }
if (!process.env.ALLOWED_CHANNEL_ID) { console.error('❌ ALLOWED_CHANNEL_ID missing'); process.exit(1); }

// --- 永続データ読み込み ---
loadConfig();
loadStats();

// --- 静的 env ---
const CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID;
const GIF_URL = process.env.JACKPOT_GIF_URL || '';
const TRIGGERS = new Set(
  (process.env.TRIGGERS || 'りよ,リヨ,びっぐらぶ,小林,シャーマン,スロット,🎰,回す')
    .split(',').map(s => s.trim()).filter(Boolean)
);
const RANKING_TRIGGERS = new Set(
  (process.env.RANKING_TRIGGERS || 'ランキング,今日のシャーマン')
    .split(',').map(s => s.trim()).filter(Boolean)
);
const FIXED_IDS = new Set(
  (process.env.FIXED_EMOJI_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);
const RANDOM_COUNT = parseInt(process.env.RANDOM_EMOJI_COUNT, 10) || 10;
const MAX_CONCURRENT = 3;

// --- ランタイム ---
const cooldowns = new Map();
const runtimeState = { gifSent: false };
let activeSpins = 0;

// --- クリーンアップ（1時間ごと） ---
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of cooldowns) {
    if (now - ts > 120000) cooldowns.delete(id);
  }
}, 3600000);

// --- ランキング ---
function buildRanking() {
  const s = getStats();
  const users = Object.entries(s.users)
    .map(([id, u]) => ({ ...u, id }))
    .sort((a, b) => b.spins - a.spins)
    .slice(0, 10);
  if (!users.length) return '🎰 まだ誰も回してないよ！';
  const medals = ['🥇', '🥈', '🥉'];
  let txt = '🏆 **ランキング** 🏆\n\n';
  users.forEach((u, i) => {
    const m = medals[i] || `${i + 1}.`;
    const name = escapeMarkdown(u.name);
    const jp = u.jackpots > 0 ? ` (JACKPOT ${u.jackpots}回!)` : '';
    txt += `${m} **${name}** — ${u.spins}回${jp}\n`;
  });
  return txt;
}

// --- Discord Bot ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => console.log(`✅ Bot: ${client.user.tag}`));

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;
    const content = message.content.trim();

    // ランキング
    if (RANKING_TRIGGERS.has(content)) {
      await message.channel.send({ content: buildRanking(), allowedMentions: { parse: [] } });
      return;
    }

    // トリガー判定
    if (!TRIGGERS.has(content)) return;

    // 同時実行制限
    if (activeSpins >= MAX_CONCURRENT) {
      const m = await message.reply('🎰 混み合ってる！ちょっと待ってね');
      setTimeout(() => m.delete().catch(() => {}), 5000);
      return;
    }

    // クールダウン
    const cfg = getConfig();
    const now = Date.now();
    const uid = message.author.id;
    const last = cooldowns.get(uid) || 0;
    const rem = cfg.COOLDOWN_SEC * 1000 - (now - last);
    if (rem > 0) {
      const m = await message.reply(`⏳ あと${Math.ceil(rem / 1000)}秒`);
      setTimeout(() => m.delete().catch(() => {}), 5000);
      return;
    }

    // 絵文字プール
    const pool = getEmojiPool(message.guild, FIXED_IDS, RANDOM_COUNT);
    if (pool.length < 3) {
      await message.reply('❌ カスタム絵文字が3つ以上必要');
      return;
    }

    activeSpins++;
    cooldowns.set(uid, Date.now());
    try {
      // 抽選
      const stats = getStats();
      const uStats = stats.users[uid];
      const consLoss = uStats ? uStats.consecutiveLosses : 0;
      const outcome = rollOutcome(cfg, consLoss);
      const final = decideFinal(pool, outcome.result);

      // 統計記録
      const displayName = message.member?.displayName ?? message.author.username;
      const updated = recordSpin(
        uid, displayName, outcome.result,
        final.map(e => e.id), outcome.flags,
      );

      // 演出
      const wins = updated.jackpots + updated.smallHits;
      await animateSpin(message, pool, final, cfg, outcome, { wins, spins: updated.spins });

      // JACKPOT後処理
      if (outcome.result === 'jackpot') {
        await maybeSendGifOnce(message.channel, GIF_URL, runtimeState);
        const safeName = escapeMarkdown(displayName);
        await message.channel.send({
          content: `🎊 **${safeName}** はJACKPOTを引き当てた！（通算${updated.jackpots}回目）`,
          allowedMentions: { parse: [] },
        });
      }
    } finally {
      activeSpins--;
    }
  } catch (err) {
    console.error('Error:', err);
    try { await message.reply('⚠️ エラーが発生しました'); } catch {}
  }
});

// --- Web管理画面 ---
const port = parseInt(process.env.WEB_PORT, 10) || 8787;
const app = createApp();
app.listen(port, () => console.log(`✅ Web: http://localhost:${port}`));

// --- Bot起動 ---
client.login(process.env.DISCORD_TOKEN);
