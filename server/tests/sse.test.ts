import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── SSE Delta 逻辑测试 ──

describe('SSE Stream Delta', () => {
  // 模拟 SSE 端点的 delta 计算逻辑
  function computeDelta(lastSent: string, currentText: string): string | null {
    if (currentText.length > lastSent.length && currentText.startsWith(lastSent)) {
      return currentText.slice(lastSent.length);
    } else if (currentText !== lastSent) {
      return currentText;
    }
    return null;
  }

  let lastSent = '';

  beforeEach(() => { lastSent = ''; });

  it('should send full text on first message', () => {
    const delta = computeDelta(lastSent, 'Hello');
    expect(delta).toBe('Hello');
    lastSent = 'Hello';
  });

  it('should send delta when text grows', () => {
    lastSent = 'Hello';
    const delta = computeDelta(lastSent, 'Hello World');
    expect(delta).toBe(' World');
  });

  it('should return null when text unchanged', () => {
    lastSent = 'Hello';
    const delta = computeDelta(lastSent, 'Hello');
    expect(delta).toBeNull();
  });

  it('should send full text on new message (different prefix)', () => {
    lastSent = 'First response';
    const delta = computeDelta(lastSent, 'Second response');
    expect(delta).toBe('Second response');
  });

  it('should handle empty initial state', () => {
    const delta = computeDelta('', 'Start');
    expect(delta).toBe('Start');
  });

  it('should handle multi-line content delta', () => {
    lastSent = 'Line 1\n';
    const delta = computeDelta(lastSent, 'Line 1\nLine 2\nLine 3');
    expect(delta).toBe('Line 2\nLine 3');
  });

  it('should handle markdown content', () => {
    lastSent = '# Title\n\n';
    const delta = computeDelta(lastSent, '# Title\n\nParagraph **bold** text');
    expect(delta).toBe('Paragraph **bold** text');
  });
});

// ── Stream ID 生成测试 ──

describe('Stream ID Generator', () => {
  function generateStreamId(): string {
    return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateStreamId()));
    expect(ids.size).toBe(100);
  });

  it('should start with stream-', () => {
    expect(generateStreamId()).toMatch(/^stream-/);
  });

  it('should contain timestamp', () => {
    const before = Date.now();
    const id = generateStreamId();
    const after = Date.now();
    const ts = parseInt(id.split('-')[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ── 会话消息解析测试 ──

describe('Session Message Parsing', () => {
  interface RawMessage {
    type: string;
    id?: string;
    timestamp?: string | number;
    message?: {
      role: string;
      content: Array<{ type: string; text?: string; thinking?: string }>;
    };
  }

  function parseMessages(jsonl: string): Array<{ id: string; role: string; content: string; timestamp: number }> {
    const messages: Array<{ id: string; role: string; content: string; timestamp: number }> = [];
    for (const line of jsonl.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj: RawMessage;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== 'message' || !obj.message?.role) continue;
      const role = obj.message.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = (obj.message.content || [])
        .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('')
        .trim();
      if (!text) continue;
      const ts = typeof obj.timestamp === 'number' ? obj.timestamp : Date.now();
      messages.push({ id: obj.id ?? `m-${messages.length}`, role, content: text, timestamp: ts });
    }
    return messages;
  }

  it('should parse valid jsonl messages', () => {
    const jsonl = [
      '{"type":"message","id":"1","timestamp":1700000000000,"message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"message","id":"2","timestamp":1700000001000,"message":{"role":"assistant","content":[{"type":"text","text":"Hi there"}]}}',
    ].join('\n');
    const msgs = parseMessages(jsonl);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hello');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Hi there');
  });

  it('should skip non-message lines', () => {
    const jsonl = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","id":"1","message":{"role":"user","content":[{"type":"text","text":"Hi"}]}}',
    ].join('\n');
    const msgs = parseMessages(jsonl);
    expect(msgs).toHaveLength(1);
  });

  it('should skip thinking blocks', () => {
    const jsonl = '{"type":"message","id":"1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."},{"type":"text","text":"Answer"}]}}';
    const msgs = parseMessages(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Answer');
  });

  it('should skip empty content', () => {
    const jsonl = '{"type":"message","id":"1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."}]}}';
    const msgs = parseMessages(jsonl);
    expect(msgs).toHaveLength(0);
  });

  it('should skip system messages', () => {
    const jsonl = '{"type":"message","id":"1","message":{"role":"system","content":[{"type":"text","text":"Status update"}]}}';
    const msgs = parseMessages(jsonl);
    expect(msgs).toHaveLength(0);
  });

  it('should handle malformed JSON gracefully', () => {
    const jsonl = 'not json\n{"type":"message","id":"1","message":{"role":"user","content":[{"type":"text","text":"OK"}]}}';
    const msgs = parseMessages(jsonl);
    expect(msgs).toHaveLength(1);
  });

  it('should join multiple text blocks', () => {
    const jsonl = '{"type":"message","id":"1","message":{"role":"assistant","content":[{"type":"text","text":"Part 1"},{"type":"text","text":"Part 2"}]}}';
    const msgs = parseMessages(jsonl);
    expect(msgs[0].content).toBe('Part 1Part 2');
  });
});
