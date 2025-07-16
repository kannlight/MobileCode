// backend.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('ssh2'); // 确保您已安装 ssh2 库

const app = express();
const PORT = 3000; // 后端服务监听的端口

// 允许所有CORS请求，实际生产环境中应限制为您的前端域名
app.use(cors());
app.use(bodyParser.json()); // 解析JSON格式的请求体

let sshClient = null; // 用于存储当前活跃的SSH连接客户端
let sshConfig = null; // 用于存储当前活跃的SSH连接配置

/**
 * 创建并连接SSH客户端
 * @param {object} config - SSH连接配置 (host, port, username, password)
 * @returns {Promise<Client>} 连接成功的SSH客户端实例
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
            sshClient = null; // 连接断开时清除客户端实例
            sshConfig = null;
        })
        .connect(config);
    });
}

/**
 * 在SSH客户端上执行命令
 * @param {Client} client - SSH客户端实例
 * @param {string} cmd - 要执行的命令
 * @returns {Promise<string>} 命令的stdout输出
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
                    // 如果命令执行失败（非零退出码），则返回stderr作为错误
                    return reject(new Error(`Command exited with code ${code}: ${stderr || 'Unknown error'}`));
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

// SSH连接API
app.post('/connect', async (req, res) => {
    const { ip, port, username, password } = req.body;
    // 存储配置，以便后续请求可以重用连接
    sshConfig = { host: ip, port: parseInt(port), username, password };

    // 如果已经有连接，先尝试断开
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
        res.json({ success: true, message: 'SSH connection established' });
    } catch (err) {
        console.error('SSH connection failed:', err.message);
        res.status(500).json({ success: false, message: `SSH connection failed: ${err.message}` });
    }
});

// 列出文件API
app.post('/list', async (req, res) => {
    const { path } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH not connected. Please connect first.' });
    }

    try {
        // 使用 ls -la 命令获取详细列表，包括隐藏文件
        const lsOutput = await execCommand(sshClient, `ls -la "${path}"`);
        const files = lsOutput.split('\n')
            .slice(1) // 跳过总计行
            .filter(line => line.trim() && !line.includes(' .') && !line.includes(' ..')) // 过滤空行和 . .. 目录
            .map(line => {
                const parts = line.split(/\s+/); // 使用一个或多个空格分割
                const permissions = parts[0];
                const name = parts.slice(8).join(' '); // 文件名可能包含空格，所以重新组合
                const isDir = permissions.startsWith('d');
                return { name, type: isDir ? 'directory' : 'file' };
            });
        res.json({ success: true, files });
    } catch (err) {
        console.error(`Error listing files in "${path}":`, err.message);
        res.status(500).json({ success: false, message: `Failed to list files: ${err.message}` });
    }
});

// 下载文件API
app.post('/download', async (req, res) => {
    const { path } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH not connected. Please connect first.' });
    }

    sshClient.sftp((err, sftp) => {
        if (err) {
            console.error('SFTP error:', err.message);
            return res.status(500).json({ success: false, message: `SFTP error: ${err.message}` });
        }

        let chunks = [];
        const stream = sftp.createReadStream(path);

        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            // 将文件内容以Base64编码返回，前端可以解码
            res.json({ success: true, fileContent: buffer.toString('base64') });
        });
        stream.on('error', err => {
            console.error(`Error downloading file "${path}":`, err.message);
            res.status(500).json({ success: false, message: `Failed to download file: ${err.message}` });
        });
    });
});

// 上传文件API (当前未实现，仅为占位符)
app.post('/upload', async (req, res) => {
    // 实际上传功能需要处理文件流或Base64编码的文件内容
    // 并且需要SFTP put方法
    res.status(501).json({ success: false, message: 'アップロード機能は未実装です。' });
});

// 执行命令API
app.post('/execute', async (req, res) => {
    const { command } = req.body;
    if (!sshClient) {
        return res.status(400).json({ success: false, message: 'SSH not connected. Please connect first.' });
    }

    try {
        const output = await execCommand(sshClient, command);
        res.json({ success: true, output: output });
    } catch (err) {
        console.error(`Error executing command "${command}":`, err.message);
        // 即使命令执行失败，也返回JSON格式的错误信息
        res.status(200).json({ success: false, error: err.message, output: '' }); // 返回200，但标记success: false
    }
});

// 批量删除文件API (已实现真正的删除)
app.post('/delete-multiple', async (req, res) => {
    const { files } = req.body; // files 是一个包含完整路径的数组
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
            // 实际执行 SSH rm -f 命令来删除文件
            // -f 选项表示强制删除，不提示确认
            const rmCommand = `rm -f "${file}"`;
            const rmOutput = await execCommand(sshClient, rmCommand);
            results.push({ file, success: true, message: rmOutput || 'File deleted successfully.' });
            console.log(`Successfully deleted: ${file}`);

        } catch (err) {
            allSuccess = false;
            results.push({ file, success: false, message: err.message });
            console.error(`Failed to delete ${file}:`, err.message);
        }
    }

    if (allSuccess) {
        res.json({ success: true, message: 'All selected files deleted successfully.', results });
    } else {
        // 即使有部分失败，也返回200，但 success 字段为 false，并提供详细结果
        res.status(200).json({ success: false, message: 'Some files failed to delete.', results });
    }
});


// 启动服务器
app.listen(PORT, '0.0.0.0', () => { // '0.0.0.0' 允许从任何网络接口访问
    console.log(`Backend SSH server running on http://0.0.0.0:${PORT}`);
    console.log('Make sure your frontend is configured to connect to this address and port.');
});

