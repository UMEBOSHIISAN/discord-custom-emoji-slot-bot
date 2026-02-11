# Discord Custom Emoji Slot Bot

サーバーのカスタム絵文字で遊ぶスロットBot。3リールが回転・減速して停止する演出付き。

## 機能

- **スロット演出** — メッセージ編集で回転→減速→停止をリアルタイム表示
- **JACKPOT** — 3つ揃いで大当たり（確率・演出カスタム可能）
- **リーチ演出** — 左中が揃った状態で右リール回転中に専用メッセージ表示
- **ニアミス演出** — 特定絵文字が2つ並ぶハズレ（確率設定可能）
- **ブースト絵文字** — 特定絵文字の出現率を上げる
- **ペア演出** — 特定絵文字が2つ並んだらリアクション絵文字を表示
- **BIG LOVE** — 低確率で発生、3連続で確定JACKPOT
- **ボーナスモード** — ハズレ時に抽選、次回スピンで特定絵文字が大量出現
- **確率2倍バフ** — 特定ハズレメッセージで次回JACKPOT確率2倍
- **デイリーランキング** — その日のスピン回数ランキングを発表
- **クールダウン** — ユーザー単位の連打防止（秒数設定可能）
- **同時実行制限** — チャンネル内の同時スロット数を制限

## セットアップ

### 1. Discord Bot を作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot タブでトークンを取得
3. **Privileged Gateway Intents** で以下を ON にする：
   - Message Content Intent

### 2. Bot をサーバーに招待

Developer Portal の OAuth2 → URL Generator で以下を選択：
- Scopes: `bot`
- Permissions: `Send Messages`, `Read Message History`

生成された URL でサーバーに招待。

### 3. インストール & 設定

```bash
git clone https://github.com/UMEBOSHIISAN/discord-custom-emoji-slot-bot.git
cd discord-custom-emoji-slot-bot
npm install
cp .env.example .env
```

`.env` を編集して最低限以下を設定：

```
DISCORD_TOKEN=your-bot-token
ALLOWED_CHANNEL_ID=your-channel-id
```

### 4. 起動

```bash
node index.js
```

## 設定一覧

### 基本設定

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DISCORD_TOKEN` | （必須） | Bot トークン |
| `ALLOWED_CHANNEL_ID` | （必須） | スロットを有効にするチャンネルID |
| `COOLDOWN_SEC` | `15` | クールダウン（秒） |
| `SPIN_COUNT` | `10` | リール回転ステップ数 |
| `JACKPOT_PROB` | `0.01` | JACKPOT確率（0〜1） |
| `NEAR_MISS_PROB` | `0.1` | ニアミス確率 |
| `JACKPOT_GIF_URL` | （空） | JACKPOT時に送信するGIF URL |

### トリガーワード

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `TRIGGERS` | `スロット,🎰,回す` | スロット起動ワード（カンマ区切り） |
| `RANKING_TRIGGERS` | `ランキング` | ランキング表示ワード（カンマ区切り） |

### 絵文字設定

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `FIXED_EMOJI_IDS` | （空） | 固定絵文字ID（カンマ区切り、空なら全絵文字使用） |
| `RANDOM_EMOJI_COUNT` | `5` | ランダム枠の絵文字数 |
| `SPECIAL_EMOJI_ID` | （空） | ニアミス対象絵文字ID |
| `BOOSTED_EMOJI_ID` | （空） | 出現率ブースト絵文字ID |
| `BOOSTED_WEIGHT` | `5` | ブースト倍率 |
| `PAIR_TRIGGER_EMOJI_ID` | （空） | ペア演出トリガー絵文字ID |
| `PAIR_REACTION_EMOJI_ID` | （空） | ペア時表示絵文字ID |
| `BONUS_EMOJI_ID` | （空） | ボーナスモード絵文字ID |
| `BONUS_WEIGHT` | `15` | ボーナスモード時のブースト倍率 |
| `JACKPOT_EMOJI_ID` | （空） | JACKPOT後に追加表示する絵文字ID |

### カスタムメッセージ

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `MSG_JACKPOT_HIT` | `💥 ドンッ！！\nJACKPOT確定‼️` | JACKPOT時メッセージ |
| `MSG_JACKPOT_FORCED` | `💥 JACKPOT確定演出突入‼️` | BIG LOVE確定時メッセージ |
| `MSG_REACH` | `リーチ？` | リーチ演出メッセージ |
| `MSG_JACKPOT_TITLE` | `大当たり` | JACKPOT獲得メッセージの称号 |
| `MSG_BONUS_MODE` | `ボーナスモード` | ボーナスモード名 |
| `MSG_RANKING_HEADER` | `🏆 **今日のランキング発表** 🏆` | ランキングヘッダー |
| `MSG_RANKING_WINNER` | `👑 今日の王者は` | ランキング1位メッセージ |
| `MSG_DOUBLE_CHANCE_TRIGGER` | `次こそいける…？` | 確率2倍バフトリガーメッセージ |
| `LOSE_MESSAGES` | （組み込み10種） | ハズレメッセージ（カンマ区切り） |

## ライセンス

MIT
