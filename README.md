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
├── android/                 # Android Studio プロジェクト
├── www/                    # WebView に読み込まれる Web ビルド成果物
├── capacitor.config.json   # Capacitor 設定ファイル
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

3. Capacitor を同期：

   ```bash
   npx cap sync android
   ```

4. Android Studio を起動し、以下のディレクトリを開く：

   ```
   client/android/
   ```

5. 実機またはエミュレータを使って Run ▶ ボタンでビルド・起動

---

> `client/www/` はビルド済みの Web リソースを含みます。通常はそのままで OK ですが、フロントエンドを修正する場合は再ビルド後に `npx cap copy` を実行してください。

