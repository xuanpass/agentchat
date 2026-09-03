<template>
  <div class="skeleton" :class="`skeleton-${type}`">
    <!-- 统计卡片骨架 -->
    <template v-if="type === 'stats'">
      <div v-for="n in 4" :key="n" class="skeleton-stat-card">
        <div class="skeleton-icon"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line skeleton-value"></div>
          <div class="skeleton-line skeleton-label"></div>
        </div>
      </div>
    </template>

    <!-- 卡片列表骨架 -->
    <template v-else-if="type === 'cards'">
      <div v-for="n in count" :key="n" class="skeleton-card">
        <div class="skeleton-card-head">
          <div class="skeleton-dot"></div>
          <div class="skeleton-line skeleton-title"></div>
        </div>
        <div class="skeleton-line skeleton-subtitle"></div>
        <div class="skeleton-card-tags">
          <div class="skeleton-tag"></div>
          <div class="skeleton-tag"></div>
        </div>
      </div>
    </template>

    <!-- 文本行骨架 -->
    <template v-else-if="type === 'lines'">
      <div v-for="n in count" :key="n" class="skeleton-line" :style="{ width: `${60 + (n % 3) * 15}%` }"></div>
    </template>

    <!-- 通用矩形 -->
    <template v-else>
      <div class="skeleton-rect" :style="{ height: height + 'px' }"></div>
    </template>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  type?: 'stats' | 'cards' | 'lines' | 'rect';
  count?: number;
  height?: number;
}>(), {
  type: 'lines',
  count: 3,
  height: 120,
});
</script>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 统计卡片骨架 ── */
.skeleton-stats,
.skeleton-cards {
  display: grid;
  gap: 16px;
}

.skeleton-stats {
  grid-template-columns: repeat(4, 1fr);
}

.skeleton-stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  overflow: hidden;
  position: relative;
}

.skeleton-stat-card::after,
.skeleton-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, var(--surface-hover) 50%, transparent 100%);
  animation: shimmer 1.5s infinite;
  transform: translateX(-100%);
}

@keyframes shimmer {
  100% { transform: translateX(100%); }
}

.skeleton-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--border);
  flex-shrink: 0;
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 12px;
  border-radius: 4px;
  background: var(--border);
  overflow: hidden;
  position: relative;
}

.skeleton-line::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, var(--surface-hover) 50%, transparent 100%);
  animation: shimmer 1.5s infinite;
  transform: translateX(-100%);
}

.skeleton-value { width: 60%; height: 22px; }
.skeleton-label { width: 40%; }
.skeleton-title { width: 50%; height: 14px; }
.skeleton-subtitle { width: 70%; }

/* ── 卡片列表骨架 ── */
.skeleton-cards {
  grid-template-columns: repeat(3, 1fr);
}

.skeleton-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  position: relative;
}

.skeleton-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.skeleton-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}

.skeleton-card-tags {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.skeleton-tag {
  width: 40px;
  height: 18px;
  border-radius: 8px;
  background: var(--border);
}

/* ── 文本行骨架 ── */
.skeleton-lines {
  gap: 14px;
  padding: 8px 0;
}

/* ── 通用矩形 ── */
.skeleton-rect {
  width: 100%;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  overflow: hidden;
  position: relative;
}

.skeleton-rect::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, var(--surface-hover) 50%, transparent 100%);
  animation: shimmer 1.5s infinite;
  transform: translateX(-100%);
}

/* ── 响应式 ── */
@media (max-width: 1200px) {
  .skeleton-stats { grid-template-columns: repeat(2, 1fr); }
  .skeleton-cards { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .skeleton-stats { grid-template-columns: 1fr; }
  .skeleton-cards { grid-template-columns: 1fr; }
}
</style>
