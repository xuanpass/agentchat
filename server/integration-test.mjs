/**
 * 真实智能体联调脚本
 * 直接调用 OpenClaw 适配器连接本地 Gateway
 */
import { execSync } from 'child_process';

const CLI_CMD = process.env.EASYCLAW_CMD ?? 'easyclaw';

function gwCall(method, params = {}) {
  const paramsStr = JSON.stringify(params);
  const escaped = paramsStr.replace(/"/g, '\\"');
  const cmd = `${CLI_CMD} gateway call ${method} --params "${escaped}" --json`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) return {};
  return JSON.parse(output.slice(jsonStart));
}

function gwCallFinal(method, params = {}, timeoutMs = 120_000) {
  const paramsStr = JSON.stringify(params);
  const escaped = paramsStr.replace(/"/g, '\\"');
  const cmd = `${CLI_CMD} gateway call ${method} --params "${escaped}" --json --expect-final --timeout ${timeoutMs}`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: timeoutMs + 10_000, windowsHide: true });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) return {};
  return JSON.parse(output.slice(jsonStart));
}

console.log('=== 真实智能体联调 ===\n');

// 1. 健康检查
console.log('1. 健康检查');
try {
  const h = gwCall('health');
  console.log(`   ✅ Gateway ok=${h.ok}, defaultAgent=${h.defaultAgentId}`);
} catch (e) {
  console.log(`   ❌ 健康检查失败: ${e.message}`);
  process.exit(1);
}

// 2. 列出会话
console.log('\n2. 列出会话');
try {
  const sessions = gwCall('sessions.list');
  const list = sessions.sessions ?? [];
  console.log(`   ✅ 共 ${list.length} 个会话`);
  for (const s of list.slice(0, 3)) {
    console.log(`      - ${s.displayName ?? s.title ?? s.key} (${s.status})`);
  }
} catch (e) {
  console.log(`   ❌ 列出会话失败: ${e.message}`);
}

// 3. 创建会话
console.log('\n3. 创建会话');
let sessionKey;
try {
  const created = gwCall('sessions.create', { label: 'AOC Integration Test' });
  sessionKey = created.sessionId ?? created.key;
  console.log(`   ✅ 会话已创建: ${sessionKey}`);
} catch (e) {
  console.log(`   ❌ 创建会话失败: ${e.message}`);
  process.exit(1);
}

// 4. 发送消息 (同步等待响应)
console.log('\n4. 发送消息');
try {
  const result = gwCallFinal('agent', {
    sessionId: sessionKey,
    message: '你好！请用一句话介绍自己。',
    idempotencyKey: `ik-${Date.now()}`,
  }, 60_000);
  const payloads = result?.result?.payloads;
  let response = '';
  if (Array.isArray(payloads)) {
    response = payloads.map(p => p?.text ?? '').filter(Boolean).join('\n');
  }
  if (!response) {
    response = result?.result?.meta?.finalAssistantVisibleText ?? '';
  }
  console.log(`   ✅ Agent 响应 (${response.length} 字):`);
  console.log(`      "${response.slice(0, 200)}${response.length > 200 ? '...' : ''}"`);
} catch (e) {
  console.log(`   ❌ 发送消息失败: ${e.message}`);
}

// 5. 删除测试会话
console.log('\n5. 清理测试会话');
try {
  gwCall('sessions.delete', { key: sessionKey });
  console.log('   ✅ 测试会话已删除');
} catch (e) {
  console.log(`   ⚠️ 删除会话: ${e.message}`);
}

console.log('\n=== 联调完成 ===');
