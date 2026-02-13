const { EmbedBuilder } = require('discord.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];

function pickN(a, n) {
  const c = [...a], r = [];
  for (let i = 0; i < n && c.length; i++) {
    const j = Math.floor(Math.random() * c.length);
    r.push(c[j]); c[j] = c[c.length - 1]; c.pop();
  }
  return r;
}

const eStr = e => e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;

// --- 絵文字プール ---
function getEmojiPool(guild, fixedIds, randomCount) {
  const all = guild.emojis.cache.filter(e => !e.managed).map(e => e);
  if (fixedIds.size > 0) {
    const fixed = all.filter(e => fixedIds.has(e.id));
    const others = all.filter(e => !fixedIds.has(e.id));
    return [...fixed, ...pickN(others, randomCount)];
  }
  return pickN(all, randomCount);
}

// --- 抽選 ---
function rollOutcome(cfg, consecutiveLosses) {
  const flags = { rareEvent: false, pity: false };
  if (cfg.enableRare && Math.random() < cfg.RARE_EVENT_PROB) flags.rareEvent = true;
  if (consecutiveLosses >= cfg.PITY_LIMIT) {
    flags.pity = true;
    return { result: 'jackpot', flags };
  }
  const r = Math.random();
  if (r < cfg.JACKPOT_PROB) return { result: 'jackpot', flags };
  if (r < cfg.JACKPOT_PROB + cfg.SMALL_HIT_PROB) return { result: 'small', flags };
  return { result: 'lose', flags };
}

// --- 最終結果確定 ---
function decideFinal(pool, result) {
  if (result === 'jackpot') {
    const e = pick(pool);
    return [e, e, e];
  }
  if (result === 'small') {
    const m = pick(pool);
    const d = pool.filter(e => e.id !== m.id);
    const reels = [m, m, m];
    reels[Math.floor(Math.random() * 3)] = d.length ? pick(d) : pick(pool);
    return reels;
  }
  // lose: 3つバラバラ
  for (let i = 0; i < 50; i++) {
    const a = pick(pool), b = pick(pool), c = pick(pool);
    if (a.id !== b.id && b.id !== c.id && a.id !== c.id) return [a, b, c];
  }
  const s = pickN(pool, 3);
  return s.length >= 3 ? s : [pick(pool), pick(pool), pick(pool)];
}

// --- 減速インターバル ---
function makeIntervals(n) {
  return Array.from({ length: n }, (_, i) =>
    Math.round(200 + (i / (n - 1)) * 800 + Math.random() * 20 - 10)
  );
}

// --- ハズレメッセージ ---
const LOSE_MSGS = ['ざんねん！', 'もう一回！', 'ドンマイ！', 'おしい！', '次こそ…！'];

// --- メイン演出 ---
async function animateSpin(message, pool, final, cfg, outcome, winInfo) {
  const [fL, fM, fR] = final;
  const n = cfg.SPIN_COUNT;
  const iv = makeIntervals(n);
  const phB = Math.floor(n * 0.4);  // Phase B 開始
  const phC = Math.floor(n * 0.7);  // Phase C 開始
  const msgJackpot = process.env.MSG_JACKPOT_HIT || '💥 ドンッ！！\nケツアナ確定‼️';

  // フェイク揃いステップ決定
  let fakeStep = -1;
  if (cfg.enableFake && Math.random() < cfg.FAKE_MATCH_PROB && phB > 2) {
    fakeStep = 2 + Math.floor(Math.random() * (phB - 2));
  }

  // 初期表示
  const embed0 = new EmbedBuilder()
    .setTitle(`🎰 ｶﾗｶﾗ… [1/${n}]`)
    .setDescription(`${eStr(pick(pool))} ${eStr(pick(pool))} ${eStr(pick(pool))}`)
    .setColor(0x808080);
  const msg = await message.channel.send({ embeds: [embed0] });

  for (let step = 2; step <= n; step++) {
    await sleep(iv[step - 1]);
    const isStop = step === n;
    const isTease = cfg.enableTease && step === n - 1;
    let L, M, R;

    if (isStop) {
      // Phase D: 全停止
      L = fL; M = fM; R = fR;
    } else if (step === fakeStep) {
      // フェイク揃い
      const fe = pick(pool);
      L = fe; M = fe; R = fe;
    } else if (step >= phC) {
      // Phase C: L,M 固定、R 回転
      L = fL; M = fM;
      if (isTease) {
        // 煽り: 必ず2つ揃いを見せる
        if (fL.id === fM.id) {
          // L=M で既にリーチ → R を別にして煽る
          const diff = pool.filter(e => e.id !== fL.id);
          R = diff.length ? pick(diff) : pick(pool);
        } else {
          // L≠M → R を L か M に合わせて2つ揃い
          R = Math.random() < 0.5 ? fL : fM;
        }
      } else {
        R = pick(pool);
      }
    } else if (step >= phB) {
      // Phase B: L 固定、M,R 回転
      L = fL; M = pick(pool); R = pick(pool);
    } else {
      // Phase A: 全回転
      L = pick(pool); M = pick(pool); R = pick(pool);
    }

    const isReach = !isStop && step >= phC && L.id === M.id;
    let title, desc, color = 0x808080;

    if (isStop) {
      title = outcome.flags.rareEvent ? '✨ 神演出 ✨ STOP!' : '🎰 STOP!';
      desc = `${eStr(L)} ${eStr(M)} ${eStr(R)}`;
      if (outcome.result === 'jackpot') {
        desc += '\n' + msgJackpot;
        color = 0xFF0000;
      } else if (outcome.result === 'small') {
        desc += '\n🎯 小当たり！';
        color = 0xFFD700;
      } else {
        desc += '\n' + pick(LOSE_MSGS);
      }
    } else {
      title = `🎰 ｶﾗｶﾗ… [${step}/${n}]`;
      if (isReach) title += ' リーチ？';
      desc = `${eStr(L)} ${eStr(M)} ${eStr(R)}`;
    }

    const em = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
    if (isStop) {
      const rate = winInfo.spins > 0
        ? ((winInfo.wins / winInfo.spins) * 100).toFixed(1) : '0.0';
      em.setFooter({ text: `勝率: ${rate}% (${winInfo.wins}/${winInfo.spins})` });
    }
    await msg.edit({ embeds: [em] }).catch(() => {});
  }

  return msg;
}

// --- GIF送信（初回のみ） ---
function maybeSendGifOnce(ch, url, state) {
  if (!url || state.gifSent) return Promise.resolve();
  state.gifSent = true;
  return ch.send(url);
}

module.exports = {
  getEmojiPool, rollOutcome, decideFinal,
  animateSpin, maybeSendGifOnce, eStr, pick,
};
