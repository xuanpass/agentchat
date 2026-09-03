// ── 凭据加密 (§7: AES-GCM, 主密钥存环境变量) ──
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  const secret = process.env.AOC_SECRET;
  if (!secret) throw new Error('AOC_SECRET 环境变量未设置 — 凭据加密/解密需要它');
  return scryptSync(secret, 'agent-ops-console-salt', KEY_LEN);
}

/** 明文 → { encrypted, iv, tag } (全部 hex 字符串) */
export function encryptCredential(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted: encrypted.toString('hex'), iv: iv.toString('hex'), tag: tag.toString('hex') };
}

/** { encrypted, iv, tag } (hex) → 明文 */
export function decryptCredential(args: { encrypted: string; iv: string; tag: string }): string {
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(args.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(args.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(args.encrypted, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** 生成 session token / 基础密钥 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
