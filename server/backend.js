// backend.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

let sshClient = null;
let sshConfig = null;
let GEMINI_API_KEY = null;
let currentDirectory = '/'; // 在服务器端保存当前工作目录

try {
    const configData = fs.readFileSync('./config.json', 'utf8');
    const config = JSON.parse(configData);
    GEMINI_API_KEY = config.GEMINI_API_KEY;
    console.log('Successfully loaded Gemini API Key from config.json');
} catch (err) {
    console.error('Error loading config.json:', err.message);
    console.error('Please create a config.json file with your Gemini API key: { "GEMINI_API_KEY": "YOUR_API_KEY" }');
}

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
            sshClient = null;
            sshConfig = null;
            currentDirectory = '/'; // 连接关闭时重置目录
        })
        .connect(config);
    });
}

/**
 * SSH経由でシェルコマンドを実行する
 * @param {string} cmd - 実行するコマンド
 * @returns {Promise<string>} コマンドの標準出力とエラー出力
 */
function execShellCommand(cmd) {
    return new Promise((resolve, reject) => {
        if (!sshClient) {
            return reject(new Error('SSH Client not active.'));
        }

        sshClient.exec(cmd, (err, stream) => {
            if (err) return reject(err);

            let output = '';
            let errorOutput = '';

            stream.on('data', (data) => {
                output += data.toString();
            });

            stream.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            stream.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(errorOutput || `Command exited with code ${code}`));
                } else {
                    resolve(output);
                }
            });
        });
    });
}

// [POST] /connect - SSH接続を確立するAPI
app.post('/connect', async (req, res) => {
    const { ip, port, username, password } = req.body;
    sshConfig = { host: ip, port: parseInt(port) || 22, username, password };

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
        // 连接成功后，获取初始工作目录
        const initialDir = await execShellCommand('pwd');
        currentDirectory = initialDir.trim();
        console.log(`Successfully opened client for ${username}@${ip}:${port} at initial directory: ${currentDirectory}`);
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
        // 构建完整的带目录切换的命令
        const fullCommand = `cd "${currentDirectory}" && ls -lAF "${path}"`;
        const lsOutput = await execShellCommand(fullCommand);

        const files = lsOutput.split('\n')
            .slice(1)
            .filter(line => line.trim() !== '' && !line.endsWith('/.') && !line.endsWith('/..'))
            .map(line => {
                const parts = line.split(/\s+/);
                const permissions = parts[0];
                const name = parts.slice(8).join(' ');
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
    const { path, content } = req.body;
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
        
        const buffer = Buffer.from(content, 'base64');
        const writeStream = sftp.createWriteStream(path);

        writeStream.on('error', (err) => {
            console.error(`Error uploading file to "${path}":`, err.message);
            res.status(500).json({ success: false, message: `ファイルのアップロードに失敗しました: ${err.message}` });
        });

        writeStream.on('close', () => {
            console.log(`Successfully uploaded to ${path}`);
            res.json({ success: true, message: 'ファイルが正常に更新されました。' });
        });

        writeStream.end(buffer);
    });
});

// [POST] /execute - コマンドを実行するAPI
app.post('/execute', async (req, res) => {
    const { command } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH接続がありません。' });
    }
    
    // 特殊处理 cd 命令，更新服务器端的工作目录状态
    if (command.trim().startsWith('cd ')) {
        const path = command.trim().substring(3).trim();
        try {
            // 在新的子进程中执行 cd，并获取新的工作目录
            const newDir = await execShellCommand(`cd "${currentDirectory}" && cd "${path}" && pwd`);
            currentDirectory = newDir.trim();
            res.json({ success: true, output: `Changed directory to: ${currentDirectory}` });
        } catch (err) {
            res.status(200).json({ success: false, error: err.message, output: '' });
        }
    } else {
        try {
            // 对于其他命令，在执行前切换到当前目录
            const fullCommand = `cd "${currentDirectory}" && ${command}`;
            const output = await execShellCommand(fullCommand);
            res.json({ success: true, output });
        } catch (err) {
            console.error(`Error executing command "${command}":`, err.message);
            res.status(200).json({ success: false, error: err.message, output: '' });
        }
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
            const rmCommand = `cd "${currentDirectory}" && rm -f "${file}"`;
            const rmOutput = await new Promise((resolve, reject) => {
                sshClient.exec(rmCommand, (err, stream) => {
                    if (err) return reject(err);
                    let output = '';
                    stream.on('data', (data) => output += data);
                    stream.on('close', () => resolve(output));
                    stream.stderr.on('data', (data) => reject(new Error(data.toString())));
                });
            });
            results.push({ file, success: true, message: rmOutput || 'File deleted successfully.' });
        } catch (err) {
            allSuccess = false;
            results.push({ file, success: false, message: err.message });
        }
    }
    res.status(allSuccess ? 200 : 207).json({ success: allSuccess, message: 'Deletion process finished.', results });
});

// [POST] /gemini - Gemini APIとの通信を処理する新しいエンドポイント
app.post('/gemini', async (req, res) => {
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ success: false, message: 'Gemini APIキーが設定されていません。' });
    }

    const { userPrompt, currentChatHistory, currentFullCode, linesToEditInfo } = req.body;

    const transformChatMessagesForApi = (messages) => {
        return messages
            .filter(msg => msg.sender === 'user' || msg.sender === 'gemini')
            .map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }],
            }));
    };

    let systemInstruction = `あなたは優秀なAIコーディングアシスタントです。ユーザーの指示に基づいてコードスニペットを生成または変更します。生成するコードは、簡潔で、ユーザーの要求に直接応えるものにしてください。自身の解説やマークダウンフォーマット（例: \`\`\`）を含めず、要求されたコードそのものだけを返してください。`;
    let constructedPrompt = userPrompt;

    if (linesToEditInfo && linesToEditInfo.lines.length > 0) {
        systemInstruction = `あなたは優秀なAIコーディングアシスタントです。ユーザーは既存のコードの特定部分の編集を指示します。現在のコード全体と編集指示、注目すべき行番号を提示します。これらを考慮し、指示を反映した上で、修正後の完全なコード全体を返してください。あなたの解説や追加のテキスト、マークダウンフォーマット（例: \`\`\`）は一切不要です。必ずコード全体を返してください。`;
        constructedPrompt = `ユーザーは、現在エディタにある以下のコード全体について、特に（${linesToEditInfo.lines.join(', ')}行目 付近）に対する編集を希望しています。\n\n編集指示は「${userPrompt}」です。\n\n現在のコード全体は次のとおりです:\n\`\`\`\n${currentFullCode}\`\`\`\n\nこの編集指示を考慮し、上記のコード全体を修正した最終的な完全なコードのみを返してください。`;
    } else {
        constructedPrompt = `以下の指示に基づいてコードを生成してください: 「${userPrompt}」\n生成されたコードそのものだけを返してください。`;
    }

    const apiChatHistory = transformChatMessagesForApi(currentChatHistory);
    const payload = {
        contents: [
            { role: "user", parts: [{ text: `System Instruction: ${systemInstruction}` }] },
            { role: "model", parts: [{ text: "はい、承知いたしました。" }] },
            ...apiChatHistory,
            { role: "user", parts: [{ text: constructedPrompt }] }
        ],
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`APIエラー: ${errorData.error?.message || response.statusText}`);
        }
        const result = await response.json();
        if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts) {
            let generatedText = result.candidates[0].content.parts[0].text;
            generatedText = generatedText.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
            res.json({ success: true, responseText: generatedText });
        } else {
            throw new Error('Geminiからの応答が予期した形式ではありません。');
        }
    } catch (e) {
        console.error('Gemini API Call failed:', e);
        res.status(500).json({ success: false, message: e.message || 'Gemini APIの呼び出し中にエラーが発生しました。' });
    }
});

// サーバーを起動
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend SSH server running on http://0.0.0.0:${PORT}`);
    console.log('フロントエンドがこのアドレスとポートに接続するように設定してください。');
});