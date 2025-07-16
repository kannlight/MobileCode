# MobileCode

## サーバー（Node.js）構築・起動方法

### 必要条件

- Node.js（推奨バージョン：16.x 以上）
- npm（Node.js に同梱）

### セットアップ手順

1. `server/` ディレクトリに移動：

   ```bash
   cd server
   ```

2. 依存パッケージをインストール：

   ```bash
   npm install
   ```

3. サーバーを起動：

   ```bash
   node backend.js
   ```

4. 起動後、以下でアクセス可能：

   ```
   http://localhost:3000
   ```

> `backend.js` は SSH ブリッジ機能を提供する Node.js サーバーです。  
> フロントエンドやモバイルアプリからの SSH 操作リクエストを受け付けて処理します。

---

## クライアント（Android / Capacitor）構成

### ディレクトリ構成（client/）

```
client/
├── android/                 # Android Studio プロジェクト（Capacitor により生成）
├── www/                    # WebView に読み込まれる Web ビルド成果物
├── capacitor.config.ts     # Capacitor 設定ファイル（.json の場合もあり）
├── package.json            # Node.js 依存定義
└── package-lock.json       # 依存バージョン固定ファイル
```

---

## Android アプリ（Capacitor）実行手順

### 必要条件

- Node.js（推奨バージョン：16.x 以上）
- npm
- Android Studio（最新版）

### 実行ステップ

1. `client/` ディレクトリに移動：

   ```bash
   cd client
   ```

2. 依存パッケージをインストール：

   ```bash
   npm install
   ```

3. 必要に応じて Web フロントエンドをビルド（Vue/React 等を使用している場合）：

   ```bash
   npm run build
   ```

4. Capacitor 用にビルド成果物をコピー：

   ```bash
   npx cap copy android
   ```

5. Android プロジェクトを同期：

   ```bash
   npx cap sync android
   ```

6. Android Studio を起動：

   ```bash
   npx cap open android
   ```

7. 実機またはエミュレータを使って Run ▶ ボタンでビルド・起動

> `client/www/` は Web リソースの出力先です。フロントエンドを修正した場合は `npm run build` の後に `npx cap copy` を実行してください。
