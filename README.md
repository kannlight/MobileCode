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
