import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.AOC_SECRET = 'test-secret-key-for-unit-tests-only';
});

describe('Crypto - 凭据加密', () => {
  it('应该加密和解密文本', async () => {
    const { encryptCredential, decryptCredential } = await import('../src/crypto.js');
    const plaintext = 'my-secret-token-123';
    const encrypted = encryptCredential(plaintext);

    expect(encrypted.encrypted).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(encrypted.encrypted).not.toBe(plaintext);

    const decrypted = decryptCredential(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('应该处理空字符串', async () => {
    const { encryptCredential, decryptCredential } = await import('../src/crypto.js');
    const encrypted = encryptCredential('');
    const decrypted = decryptCredential(encrypted);
    expect(decrypted).toBe('');
  });

  it('应该处理中文字符', async () => {
    const { encryptCredential, decryptCredential } = await import('../src/crypto.js');
    const plaintext = '中文密码@#$%^&*()';
    const encrypted = encryptCredential(plaintext);
    const decrypted = decryptCredential(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('不同加密结果应该不同 (随机 IV)', async () => {
    const { encryptCredential } = await import('../src/crypto.js');
    const encrypted1 = encryptCredential('same-text');
    const encrypted2 = encryptCredential('same-text');
    expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
  });

  it('缺少 AOC_SECRET 应该抛出错误', async () => {
    delete process.env.AOC_SECRET;
    const { encryptCredential } = await import('../src/crypto.js');
    expect(() => encryptCredential('test')).toThrow('AOC_SECRET');
  });

  it('应该生成随机 token', async () => {
    const { randomToken } = await import('../src/crypto.js');
    const t1 = randomToken();
    const t2 = randomToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBe(64); // 32 bytes = 64 hex chars
  });
});
