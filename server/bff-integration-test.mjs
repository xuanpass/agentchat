/**
 * BFF API 全链路联调
 * 启动 BFF 服务器，通过 HTTP API 测试连接/会话/消息全流程
 */
import { execSync, spawn } from 'child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(__dirname);
const BASE_URL = 'http://127.0.0.1:3001';

let serverProc;

function http(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await http('GET', '/api/health');
      if (r.ok) return true;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Server did not start in time');
}

async function main() {
  console.log('=== BFF API 全链路联调 ===\n');

  // 启动服务器
  console.log('0. 启动 BFF 服务器');
  serverProc = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AOC_SECRET: 'bff-integration-test-secret-32chars',
      AOC_PORT: '3001',
      AOC_HOST: '127.0.0.1',
      AOC_DB_PATH: './data-bff-test.db',
    },
  });
  serverProc.stdout.on('data', d => process.stdout.write(`   [bff] ${d}`));
  serverProc.stderr.on('data', d => process.stderr.write(`   [bff:err] ${d}`));
  await waitForServer();
  console.log('   ✅ BFF 已启动\n');

  // 1. 创建连接
  console.log('1. 创建 OpenClaw 连接');
  const connRes = await http('POST', '/api/connections', {
    name: 'Integration Test',
    kind: 'openclaw',
    endpoint: { baseUrl: 'http://localhost:10089' },
    auth: { type: 'none' },
  });
  const conn = await connRes.json();
  console.log(`   ✅ 连接已创建: ${conn.id} (status=${conn.status})\n`);

  // 2. 列出会话
  console.log('2. 列出会话');
  const sessionsRes = await http('GET', '/api/sessions');
  const sessions = await sessionsRes.json();
  console.log(`   ✅ 共 ${sessions.length} 个会话\n`);

  // 3. 创建会话 (使用唯一标签)
  console.log('3. 创建会话');
  const uniqueLabel = `BFF Test ${Date.now()}`;
  const createRes = await http('POST', '/api/sessions', {
    title: uniqueLabel,
    connectionId: conn.id,
  });
  if (!createRes.ok) {
    const err = await createRes.json();
    throw new Error(`创建会话失败: ${err.error} (${createRes.status})`);
  }
  const session = await createRes.json();
  console.log(`   ✅ 会话已创建: ${session.id}\n`);

  // 4. 发送消息 (通过 BFF)
  console.log('4. 发送消息');
  const msgRes = await http('POST', `/api/sessions/${session.id}/messages`, {
    text: '你好，请简短回复。',
  });
  const msgResult = await msgRes.json();
  if (msgResult.response) {
    console.log(`   ✅ 响应 (${msgResult.response.length} 字):`);
    console.log(`      "${msgResult.response.slice(0, 150)}${msgResult.response.length > 150 ? '...' : ''}"`);
  } else if (msgResult.streamId) {
    console.log(`   ⏳ 流式响应 streamId=${msgResult.streamId}`);
  } else if (msgResult.error) {
    console.log(`   ❌ 错误: ${msgResult.error}`);
  } else {
    console.log(`   ⚠️ 响应格式: ${JSON.stringify(msgResult).slice(0, 100)}`);
  }

  // 5. 清理
  console.log('\n5. 清理');
  try {
    await http('DELETE', `/api/sessions/${session.id}`);
  } catch { /* ignore */ }
  try {
    await http('DELETE', `/api/connections/${conn.id}`);
  } catch { /* ignore */ }
  console.log('   ✅ 测试数据已清理');

  console.log('\n=== BFF 联调完成 ===');
}

main()
  .catch(e => { console.error('❌ 失败:', e.message); process.exitCode = 1; })
  .finally(() => {
    if (serverProc) {
      serverProc.kill();
      console.log('\n   BFF 服务器已停止');
    }
  });
