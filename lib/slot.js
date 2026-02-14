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
function rollOutcome(cfg, consecutiveLosses, kakuhenActive) {
  const flags = { rareEvent: false, pity: false, kakuhen: !!kakuhenActive };
  if (cfg.enableRare && Math.random() < cfg.RARE_EVENT_PROB) flags.rareEvent = true;
  if (consecutiveLosses >= cfg.PITY_LIMIT) {
    flags.pity = true;
    return { result: 'jackpot', flags };
  }
  const mult = kakuhenActive ? (cfg.KAKUHEN_MULTIPLIER || 3) : 1;
  const jp = Math.min(cfg.JACKPOT_PROB * mult, 0.5); // 上限50%
  const r = Math.random();
  if (r < jp) return { result: 'jackpot', flags };
  if (r < jp + cfg.SMALL_HIT_PROB) return { result: 'small', flags };
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

// --- カットインメッセージ ---
const CUTIN_MSGS = ['まだまだ！', 'くるか…？', 'チャンス！', 'あつい！', 'いけぇ！'];

// --- レインボー色 ---
const RAINBOW_COLORS = [0xFF0000, 0xFF8800, 0xFFFF00, 0x00FF00, 0x0088FF, 0x8800FF];

// --- メイン演出 ---
async function animateSpin(message, pool, final, cfg, outcome, winInfo) {
  const [fL, fM, fR] = final;
  const n = cfg.SPIN_COUNT;
  const phB = Math.floor(n * 0.4);  // Phase B 開始
  const phC = Math.floor(n * 0.7);  // Phase C 開始
  const msgJackpot = process.env.MSG_JACKPOT_HIT || '💥 ドンッ！！\nケツアナ確定‼️';

  // --- 予告演出の抽選 ---
  const doReverse = cfg.enableReverse && Math.random() < cfg.REVERSE_PROB;
  const doBlackout = cfg.enableBlackout && Math.random() < cfg.BLACKOUT_PROB;
  const doRainbow = cfg.enableRainbow && Math.random() < cfg.RAINBOW_PROB;
  const doFreeze = cfg.enableFreeze && Math.random() < cfg.FREEZE_PROB;
  const doCutin = cfg.enableCutin && Math.random() < cfg.CUTIN_PROB;

  // フリーズ: Phase C を延長（2〜3ステップ追加）
  const freezeExtra = doFreeze ? (2 + Math.floor(Math.random() * 2)) : 0;
  const totalN = n + freezeExtra;
  const iv = makeIntervals(totalN);
  // フリーズ追加ステップは遅めに（ドラマチック）
  for (let i = n; i < totalN; i++) {
    iv[i] = 900 + Math.round(Math.random() * 300);
  }

  // フェイク揃いステップ決定
  let fakeStep = -1;
  if (cfg.enableFake && Math.random() < cfg.FAKE_MATCH_PROB && phB > 2) {
    fakeStep = 2 + Math.floor(Math.random() * (phB - 2));
  }

  // 逆回転ステップ: Phase A 中のランダム
  let reverseStep = -1;
  if (doReverse && phB > 2) {
    reverseStep = 2 + Math.floor(Math.random() * (phB - 2));
    // フェイクと被ったらずらす
    if (reverseStep === fakeStep) reverseStep = Math.max(2, reverseStep - 1);
  }

  // 暗転ステップ: Phase C 開始時
  const blackoutStep = doBlackout ? phC : -1;

  // レインボー: 2〜3ステップ連続
  let rainbowStart = -1, rainbowLen = 0;
  if (doRainbow) {
    rainbowLen = 2 + Math.floor(Math.random() * 2);
    const range = Math.max(1, phC - 2 - rainbowLen);
    rainbowStart = 2 + Math.floor(Math.random() * range);
  }

  // カットイン: Phase B 中のランダム
  let cutinStep = -1;
  if (doCutin && phC > phB + 1) {
    cutinStep = phB + Math.floor(Math.random() * (phC - phB));
  }

  // 確変中の基本色
  const isKakuhen = outcome.flags.kakuhen;
  const kakuhenColor = 0xFF8C00; // ダークオレンジ
  const baseColor = isKakuhen ? kakuhenColor : 0x808080;
  const kakuhenPrefix = isKakuhen ? '🔥 確変中！ ' : '';

  // 初期表示
  const embed0 = new EmbedBuilder()
    .setTitle(`${kakuhenPrefix}🎰 ｶﾗｶﾗ… [1/${totalN}]`)
    .setDescription(`${eStr(pick(pool))} ${eStr(pick(pool))} ${eStr(pick(pool))}`)
    .setColor(baseColor);
  const msg = await message.channel.send({ embeds: [embed0] });

  for (let step = 2; step <= totalN; step++) {
    await sleep(iv[step - 1]);
    const isStop = step === totalN;
    const isTease = cfg.enableTease && step === totalN - 1;
    let L, M, R;

    if (isStop) {
      // Phase D: 全停止
      L = fL; M = fM; R = fR;
    } else if (step === blackoutStep) {
      // 暗転演出: ⬛⬛⬛
      const em = new EmbedBuilder()
        .setTitle('💀 ブラックアウト…')
        .setDescription('⬛ ⬛ ⬛')
        .setColor(0x000000);
      await msg.edit({ embeds: [em] }).catch(() => {});
      continue;
    } else if (step === cutinStep) {
      // カットイン演出: 絵文字を大きく表示
      const cutinEmoji = pick(pool);
      const cutinMsg = pick(CUTIN_MSGS);
      const em = new EmbedBuilder()
        .setTitle('❗ カットイン！')
        .setDescription(`${eStr(cutinEmoji)}\n💬「${cutinMsg}」`)
        .setColor(0xFF00FF);
      await msg.edit({ embeds: [em] }).catch(() => {});
      continue;
    } else if (step === fakeStep) {
      // フェイク揃い
      const fe = pick(pool);
      L = fe; M = fe; R = fe;
    } else if (step >= phC) {
      // Phase C: L,M 固定、R 回転
      L = fL; M = fM;
      if (isTease) {
        if (fL.id === fM.id) {
          const diff = pool.filter(e => e.id !== fL.id);
          R = diff.length ? pick(diff) : pick(pool);
        } else {
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
    let title, desc, color = baseColor;

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
      // 逆回転演出: 表示順を反転
      if (step === reverseStep) {
        title = `${kakuhenPrefix}🔄 逆回転!? [${step}/${totalN}]`;
        desc = `${eStr(R)} ${eStr(M)} ${eStr(L)}`;
      } else {
        title = `${kakuhenPrefix}🎰 ｶﾗｶﾗ… [${step}/${totalN}]`;
        desc = `${eStr(L)} ${eStr(M)} ${eStr(R)}`;
      }
      // フリーズ中の表示
      if (step > n && !isStop) {
        title = `${kakuhenPrefix}🥶 フリーズ…！ [${step}/${totalN}]`;
      }
      if (isReach) title += ' リーチ？';
      // レインボー演出: Embed 色を虹色に
      if (rainbowStart > 0 && step >= rainbowStart && step < rainbowStart + rainbowLen) {
        color = RAINBOW_COLORS[(step - rainbowStart) % RAINBOW_COLORS.length];
        if (!title.includes('逆回転') && !title.includes('フリーズ')) {
          title = `🌈 レインボー！ [${step}/${totalN}]`;
        }
      }
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

// --- 絵文字パーティクル ---
const PARTICLE_FRAMES_JP = [
  // JACKPOT用: 3フレームで豪華に
  [
    '🎆 ✨ 🎇 ✨ 🎆',
    '✨ {e} ✨ {e} ✨',
    '🎇 ✨ 🎆 ✨ 🎇',
  ],
  [
    '🎊 {e} 🎉 {e} 🎊',
    '{e} 🎆 {e} 🎆 {e}',
    '🎉 {e} 🎊 {e} 🎉',
  ],
  [
    '🌟 🎊 🌟 🎊 🌟',
    '🎊 ✨ 🎉 ✨ 🎊',
    '🌟 🎉 🌟 🎉 🌟',
  ],
];

const PARTICLE_FRAMES_SM = [
  // 小当たり用: 2フレームで控えめに
  [
    '✨ {e} ✨',
    '{e} 🎯 {e}',
  ],
  [
    '🎯 ✨ 🎯',
    '✨ {e} ✨',
  ],
];

async function fireParticles(channel, pool, result) {
  const emoji = eStr(pick(pool));
  const frames = result === 'jackpot' ? PARTICLE_FRAMES_JP : PARTICLE_FRAMES_SM;
  const delays = result === 'jackpot' ? [600, 500, 400] : [500, 400];

  // 最初のフレームを送信
  const firstDesc = frames[0].map(l => l.replace(/\{e\}/g, emoji)).join('\n');
  const msg = await channel.send(firstDesc);

  // 残りフレームをアニメーション
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    const desc = frames[i].map(l => l.replace(/\{e\}/g, emoji)).join('\n');
    await msg.edit(desc).catch(() => {});
  }

  // 最後に少し残して消す
  await sleep(3000);
  await msg.delete().catch(() => {});
}

// --- GIF送信（初回のみ） ---
function maybeSendGifOnce(ch, url, state) {
  if (!url || state.gifSent) return Promise.resolve();
  state.gifSent = true;
  return ch.send(url);
}

module.exports = {
  getEmojiPool, rollOutcome, decideFinal,
  animateSpin, maybeSendGifOnce, fireParticles, eStr, pick,
};
