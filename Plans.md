# Plans.md — discord-slot-bot v2.1 品質改善

Codex レビュー指摘（Security B / Performance B / Quality B）を修正し、全 A を目指す。

## タスク一覧

### 1. [feature:security] 管理者認証の強化 `cc:done`
- `lib/web.js:78-79`: デフォルトフォールバック削除、`process.env` のみ参照
- `index.js:11-16`: 起動時に未設定/デフォルト値なら `process.exit(1)`

### 2. [feature:security] Express を loopback にバインド `cc:done`
- `index.js:171`: `WEB_HOST` 環境変数対応、デフォルト `127.0.0.1`
- `.env.example` に `WEB_HOST` 注記追加

### 3. [feature:performance] stats 永続化を非同期バッファリングに変更 `cc:done`
- `lib/stats.js`: `_flush()` async + dirty フラグ + 1秒 debounce
- `recordSpin()` は同期のまま（`_dirty=true` + `_scheduleFlush()`）
- `index.js:177-184`: SIGINT/SIGTERM で `flushStats()` 最終 flush

### 4. [feature:security] XSS エスケープ漏れ修正 `cc:done`
- `lib/web.js:101`: `CLS_MAP` allowlist で CSS クラス解決
- `lib/web.js:106`: `esc(h.resultType)` と `esc(fl)` 追加

### 5. [feature:security] セキュリティヘッダー追加 `cc:done`
- `lib/web.js:70-75`: X-Content-Type-Options / X-Frame-Options / CSP ミドルウェア

### 6. [feature:performance] config I/O を非同期化 `cc:done`
- `lib/config.js:39-44`: `save()` async 化 (`fsp.writeFile` + `fsp.rename`)
- `lib/config.js:72`: `updateConfig()` async 化
- `lib/web.js:181`: POST `/config` ハンドラ async + await

### 7. [feature:quality] Config POST バリデーション強化 `cc:done`
- `lib/web.js:20-62`: `validateConfigInput()` — NaN/範囲チェック + 日本語エラーメッセージ
- `lib/web.js:182-188`: エラー時 400 + エスケープ付き HTML

### 8. [feature:quality] クールダウン TTL をコンフィグ連動に `cc:done`
- `index.js:45-57`: 再帰 `setTimeout` パターン、`getConfig()` で最新値使用
- TTL: `COOLDOWN_SEC * 2 * 1000`、間隔: `Math.max(60000, COOLDOWN_SEC * 1000)`
