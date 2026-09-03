import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/index.js';
import { emitAlert } from '../src/routes/alerts.js';

// ── 告警 + 指标测试 ──

describe('Alerts System', () => {
  beforeEach(() => {
    // 清理测试告警
    getDb().prepare("DELETE FROM alerts WHERE type LIKE 'test_%'").run();
  });

  it('should create an alert', () => {
    emitAlert({
      type: 'test_info',
      severity: 'info',
      message: 'Test info alert',
      sourceType: 'system',
      sourceId: 'test-1',
    });
    const alert = getDb().prepare("SELECT * FROM alerts WHERE type = 'test_info'").get() as any;
    expect(alert).toBeDefined();
    expect(alert.message).toBe('Test info alert');
    expect(alert.acknowledged).toBe(0);
  });

  it('should list alerts filtered by severity', () => {
    emitAlert({ type: 'test_warning', severity: 'warning', message: 'Warn 1' });
    emitAlert({ type: 'test_critical', severity: 'critical', message: 'Crit 1' });
    emitAlert({ type: 'test_warning2', severity: 'warning', message: 'Warn 2' });

    const warnings = getDb().prepare("SELECT * FROM alerts WHERE severity = 'warning'").all();
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('should acknowledge alert', () => {
    const id = 'test-ack-' + Date.now();
    getDb().prepare(`
      INSERT INTO alerts (id, type, severity, message, acknowledged, created_at)
      VALUES (?, 'test_ack', 'warning', 'Ack me', 0, ?)
    `).run(id, Date.now());

    getDb().prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(id);
    const alert = getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(id) as any;
    expect(alert.acknowledged).toBe(1);
  });

  it('should delete acknowledged alerts', () => {
    // 插入已确认告警
    for (let i = 0; i < 3; i++) {
      getDb().prepare(`
        INSERT INTO alerts (id, type, severity, message, acknowledged, created_at)
        VALUES (?, 'test_cleanup', 'info', 'Clean me', 1, ?)
      `).run(`test-clean-${i}`, Date.now());
    }
    // 清理已确认
    const result = getDb().prepare('DELETE FROM alerts WHERE acknowledged = 1 AND type = ?').run('test_cleanup');
    expect(result.changes).toBeGreaterThanOrEqual(3);
  });

  it('should acknowledge all filtered by severity', () => {
    for (let i = 0; i < 3; i++) {
      getDb().prepare(`
        INSERT INTO alerts (id, type, severity, message, acknowledged, created_at)
        VALUES (?, 'test_bulk', 'critical', ?, 0, ?)
      `).run(`test-bulk-${i}`, `Bulk ${i}`, Date.now());
    }
    const result = getDb().prepare("UPDATE alerts SET acknowledged = 1 WHERE acknowledged = 0 AND severity = 'critical'").run();
    expect(result.changes).toBeGreaterThanOrEqual(3);
  });
});

describe('Metrics Data', () => {
  it('should have alerts table', () => {
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'").all();
    expect(tables.length).toBe(1);
  });

  it('should have alert indexes', () => {
    const indexes = getDb().prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_alerts%'").all();
    expect(indexes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Batch Operations', () => {
  const testIds: string[] = [];

  beforeEach(() => {
    // 创建测试会话
    for (let i = 0; i < 3; i++) {
      const id = `test-batch-${Date.now()}-${i}`;
      getDb().prepare(`
        INSERT INTO sessions (id, connection_id, remote_session_id, title, created_at, last_active_at, status, meta)
        VALUES (?, '52d562c4-cd3e-4886-ad71-380d57de52d9', ?, ?, ?, ?, 'idle', '{}')
      `).run(id, `remote-${id}`, `Batch ${i}`, Date.now(), Date.now());
      testIds.push(id);
    }
  });

  it('should batch delete sessions', () => {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
    let deleted = 0;
    for (const id of testIds) {
      const r = stmt.run(id);
      deleted += r.changes;
    }
    expect(deleted).toBe(3);
  });

  it('should batch update session status', () => {
    const db = getDb();
    const stmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
    let updated = 0;
    for (const id of testIds) {
      const r = stmt.run('done', id);
      updated += r.changes;
    }
    expect(updated).toBe(3);
    // 清理
    db.prepare('DELETE FROM sessions WHERE id LIKE ?').run('test-batch-%');
  });
});
