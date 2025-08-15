# ベースとなるNode.jsのバージョンを指定（package.jsonに合わせるのがベスト）
FROM node:18-slim

# アプリケーションの作業ディレクトリを設定
WORKDIR /usr/src/app

# 依存関係のファイルをコピー
COPY package*.json ./

# 依存パッケージをインストール
RUN npm install

# アプリケーションのソースコードをコピー
COPY . .

# アプリケーションがリッスンするポートを指定
EXPOSE 3000

# サーバーを起動するコマンド
CMD [ "node", "backend.js" ]