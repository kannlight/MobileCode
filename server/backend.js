// backend.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('ssh2'); // ssh2 ライブラリをインポート

const app = express();
const PORT = 3000; // バックエンドサーバーがリッスンするポート

// CORSを許可（開発用）。本番環境ではフロントエンドのオリジンに限定すべき
app.use(cors());
// JSONリクエストボディをパース。ファイルアップロードのためにリミットを増やす
app.use(bodyParser.json({ limit: '50mb' }));

// アクティブなSSH接続と設定を保持する変数
let sshClient = null;
let sshConfig = null;

/**
 * SSHクライアントを作成し、サーバーに接続する
 * @param {object} config - SSH接続設定 (host, port, username, password)
 * @returns {Promise<Client>} 接続成功時に解決されるPromise
 */
function createSshClient(config) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            console.log('SSH Client Ready');
            resolve(conn);
        })
        .on('error', (err) => {
            console.error('SSH Client Error:', err.message);
            reject(err);
        })
        .on('end', () => {
            console.log('SSH Client Ended');
            sshClient = null; // 接続終了時に変数をクリア
            sshConfig = null;
        })
        .connect(config);
    });
}

/**
 * SSH経由でコマンドを実行する
 * @param {Client} client - SSHクライアントインスタンス
 * @param {string} cmd - 実行するコマンド
 * @returns {Promise<string>} コマンドの標準出力
 */
function execCommand(client, cmd) {
    return new Promise((resolve, reject) => {
        client.exec(cmd, (err, stream) => {
            if (err) {
                console.error(`Error executing command "${cmd}":`, err.message);
                return reject(err);
            }
            let stdout = '';
            let stderr = '';

            stream.on('close', (code, signal) => {
                if (code !== 0) {
                    // 終了コードが0でない場合、エラーとして標準エラー出力を返す
                    return reject(new Error(stderr.trim() || `Command exited with code ${code}`));
                }
                resolve(stdout);
            });
            stream.on('data', (data) => {
                stdout += data.toString();
            });
            stream.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        });
    });
}

// [POST] /connect - SSH接続を確立するAPI
app.post('/connect', async (req, res) => {
    const { ip, port, username, password } = req.body;
    // 新しい接続情報を保存
    sshConfig = { host: ip, port: parseInt(port) || 22, username, password };

    // 既存の接続があれば閉じる
    if (sshClient) {
        try {
            sshClient.end();
            console.log('Existing SSH connection closed.');
        } catch (e) {
            console.warn('Error closing existing SSH connection:', e.message);
        }
    }

    try {
        sshClient = await createSshClient(sshConfig);
        console.log(`Successfully connected to ${username}@${ip}:${port}`);
        res.json({ success: true, message: 'SSH接続が確立されました' });
    } catch (err) {
        console.error('SSH connection failed:', err.message);
        res.status(500).json({ success: false, message: `SSH接続に失敗しました: ${err.message}` });
    }
});

// [POST] /list - 指定されたパスのファイルとディレクトリを一覧表示するAPI
app.post('/list', async (req, res) => {
    const { path } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH接続がありません。先に接続してください。' });
    }

    try {
        // -p オプションでディレクトリの末尾に / をつける, -F でタイプ別に記号をつける
        const lsOutput = await execCommand(sshClient, `ls -lAF "${path}"`);
        const files = lsOutput.split('\n')
            .slice(1) // 1行目（total行）をスキップ
            .filter(line => line.trim() !== '' && !line.endsWith('/.') && !line.endsWith('/..')) // 空行と . .. を除外
            .map(line => {
                const parts = line.split(/\s+/);
                const permissions = parts[0];
                const name = parts.slice(8).join(' '); // スペースを含むファイル名に対応
                const isDir = permissions.startsWith('d');
                return { name, type: isDir ? 'directory' : 'file' };
            });
        res.json({ success: true, files });
    } catch (err) {
        console.error(`Error listing files in "${path}":`, err.message);
        res.status(500).json({ success: false, message: `ファイル一覧の取得に失敗しました: ${err.message}` });
    }
});

// [POST] /download - 指定されたファイルをダウンロードするAPI
app.post('/download', (req, res) => {
    const { path } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH接続がありません。' });
    }

    sshClient.sftp((err, sftp) => {
        if (err) {
            console.error('SFTP error:', err.message);
            return res.status(500).json({ success: false, message: `SFTPセッションの開始に失敗しました: ${err.message}` });
        }

        const chunks = [];
        const readStream = sftp.createReadStream(path);

        readStream.on('data', chunk => chunks.push(chunk));
        readStream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            // ファイル内容をBase64でエンコードして返す
            res.json({ success: true, fileContent: buffer.toString('base64') });
        });
        readStream.on('error', err => {
            console.error(`Error downloading file "${path}":`, err.message);
            res.status(500).json({ success: false, message: `ファイルのダウンロードに失敗しました: ${err.message}` });
        });
    });
});

// [POST] /upload - 指定されたパスにファイルをアップロード（更新）するAPI
app.post('/upload', (req, res) => {
    const { path, content } = req.body; // contentはBase64エンコードされている想定
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH接続がありません。' });
    }
    if (typeof path !== 'string' || typeof content !== 'string') {
        return res.status(400).json({ success: false, message: 'パスとコンテントは必須です。' });
    }

    sshClient.sftp((err, sftp) => {
        if (err) {
            console.error('SFTP error:', err.message);
            return res.status(500).json({ success: false, message: `SFTPセッションの開始に失敗しました: ${err.message}` });
        }
        
        // Base64からBufferにデコード
        const buffer = Buffer.from(content, 'base64');
        const writeStream = sftp.createWriteStream(path);

        writeStream.on('error', (err) => {
            console.error(`Error uploading file to "${path}":`, err.message);
            res.status(500).json({ success: false, message: `ファイルのアップロードに失敗しました: ${err.message}` });
        });

        writeStream.on('finish', () => {
            console.log(`Successfully uploaded to ${path}`);
            res.json({ success: true, message: 'ファイルが正常に更新されました。' });
        });

        // Bufferを書き込んでストリームを閉じる
        writeStream.end(buffer);
    });
});

// [POST] /execute - コマンドを実行するAPI
app.post('/execute', async (req, res) => {
    const { command } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH接続がありません。' });
    }

    try {
        const output = await execCommand(sshClient, command);
        res.json({ success: true, output });
    } catch (err) {
        console.error(`Error executing command "${command}":`, err.message);
        // コマンドの実行に失敗しても、エラー情報をJSONで返す
        res.status(200).json({ success: false, error: err.message, output: '' });
    }
});

// [POST] /delete-multiple - 複数のファイルを削除するAPI（変更なし）
app.post('/delete-multiple', async (req, res) => {
    const { files } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH not connected. Please connect first.' });
    }
    if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files provided for deletion.' });
    }
    let results = [];
    let allSuccess = true;
    for (const file of files) {
        try {
            const rmCommand = `rm -f "${file}"`;
            const rmOutput = await execCommand(sshClient, rmCommand);
            results.push({ file, success: true, message: rmOutput || 'File deleted successfully.' });
        } catch (err) {
            allSuccess = false;
            results.push({ file, success: false, message: err.message });
        }
    }
    res.status(allSuccess ? 200 : 207).json({ success: allSuccess, message: 'Deletion process finished.', results });
});


// サーバーを起動
app.listen(PORT, '0.0.0.0', () => { // '0.0.0.0' で外部からのアクセスを許可
    console.log(`Backend SSH server running on http://0.0.0.0:${PORT}`);
    console.log('フロントエンドがこのアドレスとポートに接続するように設定してください。');
});