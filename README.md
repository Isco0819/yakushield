# 🛡️ YakuShield（訳シールド）

AIエージェント（**Claude Code / Codex**）が暴走ループでAPIを叩き続け、気づいたら数百ドル——を、設定した**1日の上限で物理的に遮断**するローカルの安全弁。さらに、日本語で使うほど膨らむ**トークンの浪費を見える化**します。

🔗 **紹介ページ**: https://yakushield-lp.vercel.app

---

## 🚀 導入は、コピペ1行（30秒）

### 必要なもの
Claude Code か Codex を**すでに使っているなら、もう揃っています**。

- **Node.js** … `node -v` でバージョンが出ればOK（Claude Code / Codex が動く環境なら入っています）
- **Claude Code**（コマンド `claude`）か **OpenAI Codex**（コマンド `codex`）

### Claude Code を守る
```bash
npx github:Isco0819/yakushield claude
```

### Codex（OpenAI）を守る
```bash
npx github:Isco0819/yakushield codex
```

この1コマンドで「**プロキシ起動 → 接続先の自動配線 → エージェント起動**」まで全部やります。
**手動の環境変数設定は不要**です。いつも通りに `claude` / `codex` が立ち上がり、裏で予算ブレーカーと計測がONになります。

> 💡 初回はダウンロードで **30秒〜1分** ほどかかります（2回目以降は速い）。

ダッシュボードは **http://localhost:4040** で開けます（予算スライダー＋消費ログ）。

> 🔐 **認証について**: あなたの Claude Code / Codex が普段使っている認証（**APIキーでも、Claude/ChatGPTのサブスクでも**）を、そのまま素通しで中継します。YakuShield がキーを保存・外部送信することは一切ありません。

---

## 🧪 まず触ってみる（APIキー不要・無料デモ）

エージェントに繋がず、プロキシ単体で挙動を試せます。

```bash
npx github:Isco0819/yakushield
```

→ ブラウザで **http://localhost:4040** を開く → 画面の「デモ用リクエスト送信」を押すと、
コストがリアルタイムに上昇し、上限を超えた瞬間に**予算ブレーカーが赤く点滅して遮断**する様子を体験できます。

---

## ✨ できること

1. **物理予算ブレーカー** — 1日の累積コスト（USD）が上限（デフォルト $5.00）を超えた瞬間に中継を遮断。エージェントには `HTTP 429` を返して安全に止めます。**サプライズ請求が物理的に起きません。**
2. **リアルタイム計測** — 中継した `usage` から Input / Output トークンを正確に集計。主要モデル（Opus / Sonnet / Haiku / GPT-4o / GPT-4.1 / o3 等）の単価を内蔵。ストリーミング（SSE）も解析。
3. **日本語トークン浪費の見える化** — 日本語は英語の約3倍トークンを消費。「日本語の壁で損している額」をダッシュボードに可視化。
4. **ゼロ設定ダッシュボード**（http://localhost:4040）— 予算スライダー＋消費ログ。APIキー無しのデモモード内蔵。

---

## 🔧 オプション

| やりたいこと | コマンド / 方法 |
|---|---|
| 予算上限を変える | ダッシュボードのスライダー（デフォルト $5/日） |
| ポートを変える | `PORT=4099 npx github:Isco0819/yakushield claude` |
| プロキシだけ起動して手動配線 | `npx github:Isco0819/yakushield` → `export ANTHROPIC_BASE_URL=http://localhost:4040`（Claude）/ `export OPENAI_BASE_URL=http://localhost:4040/v1`（Codex） |
| 認証無しリクエストの補完キー | プロジェクトに `.env` を置き `ANTHROPIC_API_KEY=sk-ant-...`（通常は不要） |

---

## 👩‍💻 開発者向け（クローンして動かす）

```bash
git clone https://github.com/Isco0819/yakushield.git
cd yakushield
npm install && npm run build
npm start                  # プロキシのみ起動
node dist/index.js claude  # ラッパー経由で Claude Code 起動
node dist/index.js codex   # ラッパー経由で Codex 起動
```

* **Runtime**: Node.js + TypeScript（ESM）。標準 `http`/`https` のみで超軽量（依存は `dotenv` だけ）。
* **Dashboard**: Vanilla HTML + 少量JS + グラスモルフィズムCSS。

---

## 🔒 セキュリティとプライバシー

* `yakushield` はローカル（`localhost`）だけで動きます。外部へのログ送信は一切ありません。
* APIキー／サブスク認証は、お使いのクライアントから送られたものを**そのまま中継するだけ**で、ディスクに保存しません。

---

## 📄 ライセンス

* **無料版**（現行）: トークン/コスト計測・物理予算ブレーカー・可視化ダッシュボード。すべて無料でローカル動作。
* **Pro版**（$29 想定・近日）: 翻訳によるトークン圧縮（最大70%節約）、チーム予算共有 など。

---

🛠️ 個人開発・build in public。フィードバック歓迎です。
