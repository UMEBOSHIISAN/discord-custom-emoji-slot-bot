const express = require('express');
const { getConfig, updateConfig } = require('./config');
const { getStats } = require('./stats');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CSS = `body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;max-width:960px;margin:0 auto;padding:20px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:8px;text-align:left}
th{background:#16213e}tr:nth-child(even){background:#0f3460}a{color:#4fc3f7;margin-right:16px}
input[type=number],input[type=text]{background:#222;color:#fff;border:1px solid #555;padding:4px 8px;width:120px}
button{background:#4fc3f7;color:#000;border:none;padding:8px 20px;cursor:pointer;font-weight:bold;margin-top:10px}
.nav{margin-bottom:20px;padding:12px;background:#16213e;border-radius:4px}
.jp{color:#ff4444}.sm{color:#ffd700}.lo{color:#888}h1{margin-top:0}`;

const NAV = '<div class="nav"><a href="/">Dashboard</a><a href="/users">Users</a><a href="/config">Config</a></div>';

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Basic Auth
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'change_me';
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Slot Bot Admin"');
      return res.status(401).send('Unauthorized');
    }
    const [u, p] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (u !== adminUser || p !== adminPass) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Slot Bot Admin"');
      return res.status(401).send('Unauthorized');
    }
    next();
  });

  // --- Dashboard ---
  app.get('/', (_req, res) => {
    const s = getStats();
    const g = s.global;
    const rate = g.totalSpins > 0
      ? (((g.jackpotCount + g.smallHitCount) / g.totalSpins) * 100).toFixed(1) : '0.0';
    const hist = (s.history || []).slice(-20).reverse();
    const histRows = hist.map(h => {
      const cls = h.resultType === 'jackpot' ? 'jp' : h.resultType === 'small' ? 'sm' : 'lo';
      const fl = [h.rareEvent && 'RARE', h.pity && 'PITY'].filter(Boolean).join(' ');
      return `<tr><td>${esc(h.ts.slice(0, 19))}</td><td>${esc(h.userName)}</td>` +
        `<td class="${cls}">${h.resultType}</td><td>${fl}</td></tr>`;
    }).join('');

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slot Bot</title>
<style>${CSS}</style></head><body>${NAV}<h1>🎰 Dashboard</h1>
<table>
<tr><th>Total Spins</th><td>${g.totalSpins}</td></tr>
<tr><th>Jackpot</th><td class="jp">${g.jackpotCount}</td></tr>
<tr><th>Small Hit</th><td class="sm">${g.smallHitCount}</td></tr>
<tr><th>Lose</th><td>${g.loseCount}</td></tr>
<tr><th>Rare Event</th><td>${g.rareEventCount}</td></tr>
<tr><th>Pity Jackpot</th><td>${g.pityJackpotCount}</td></tr>
<tr><th>Win Rate</th><td>${rate}%</td></tr>
</table>
<h2>Recent History (20)</h2>
<table><tr><th>Time</th><th>User</th><th>Result</th><th>Flags</th></tr>${histRows}</table>
</body></html>`);
  });

  // --- Users ---
  app.get('/users', (_req, res) => {
    const s = getStats();
    const users = Object.entries(s.users || {})
      .map(([id, u]) => ({
        id, ...u,
        wins: u.jackpots + u.smallHits,
        rate: u.spins > 0 ? ((u.jackpots + u.smallHits) / u.spins * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.spins - a.spins);
    const rows = users.map((u, i) => {
      const m = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`;
      return `<tr><td>${m}</td><td>${esc(u.name)}</td><td>${u.spins}</td>` +
        `<td class="jp">${u.jackpots}</td><td class="sm">${u.smallHits}</td>` +
        `<td>${u.loses}</td><td>${u.rate}%</td></tr>`;
    }).join('');

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Users</title>
<style>${CSS}</style></head><body>${NAV}<h1>👥 User Ranking</h1>
<table><tr><th>#</th><th>Name</th><th>Spins</th><th>JP</th><th>Small</th><th>Lose</th><th>Rate</th></tr>
${rows}</table></body></html>`);
  });

  // --- Config GET ---
  app.get('/config', (_req, res) => {
    const c = getConfig();
    const nums = [
      ['JACKPOT_PROB', 'JACKPOT確率', '0.001'],
      ['SMALL_HIT_PROB', '小当たり確率', '0.01'],
      ['RARE_EVENT_PROB', 'レア演出確率', '0.001'],
      ['FAKE_MATCH_PROB', 'フェイク揃い確率', '0.01'],
      ['PITY_LIMIT', '天井（連続ハズレ）', '1'],
      ['COOLDOWN_SEC', 'クールダウン（秒）', '1'],
      ['SPIN_COUNT', 'スピン回数', '1'],
    ];
    const bools = [
      ['enableTease', '煽り演出'],
      ['enableFake', 'フェイク演出'],
      ['enableRare', 'レア演出'],
    ];
    const nRows = nums.map(([k, l, s]) =>
      `<tr><td>${l}</td><td><input type="number" name="${k}" value="${c[k]}" step="${s}"></td></tr>`
    ).join('');
    const bRows = bools.map(([k, l]) =>
      `<tr><td>${l}</td><td><input type="checkbox" name="${k}" value="true" ${c[k] ? 'checked' : ''}></td></tr>`
    ).join('');

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Config</title>
<style>${CSS}</style></head><body>${NAV}<h1>⚙️ Config</h1>
<form method="POST" action="/config">
<table>${nRows}${bRows}</table>
<button type="submit">保存</button>
</form></body></html>`);
  });

  // --- Config POST ---
  app.post('/config', (req, res) => {
    const b = req.body;
    updateConfig({
      JACKPOT_PROB: parseFloat(b.JACKPOT_PROB),
      SMALL_HIT_PROB: parseFloat(b.SMALL_HIT_PROB),
      RARE_EVENT_PROB: parseFloat(b.RARE_EVENT_PROB),
      FAKE_MATCH_PROB: parseFloat(b.FAKE_MATCH_PROB),
      PITY_LIMIT: parseInt(b.PITY_LIMIT, 10),
      COOLDOWN_SEC: parseInt(b.COOLDOWN_SEC, 10),
      SPIN_COUNT: parseInt(b.SPIN_COUNT, 10),
      enableTease: b.enableTease === 'true',
      enableFake: b.enableFake === 'true',
      enableRare: b.enableRare === 'true',
    });
    res.redirect('/config');
  });

  return app;
}

module.exports = { createApp };
