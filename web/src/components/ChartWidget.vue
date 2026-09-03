<template>
  <div class="chart-container">
    <!-- 柱状图 -->
    <div v-if="type === 'bar'" class="bar-chart">
      <div v-for="(item, i) in data" :key="i" class="bar-item">
        <div class="bar-value">{{ item.value }}</div>
        <div class="bar-track">
          <div class="bar-fill" :style="{ height: `${(item.value / maxValue) * 100}%`, background: item.color || colors[i % colors.length] }"></div>
        </div>
        <div class="bar-label">{{ item.label }}</div>
      </div>
    </div>

    <!-- 环形图 -->
    <div v-else-if="type === 'donut'" class="donut-chart">
      <svg viewBox="0 0 100 100" class="donut-svg">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" stroke-width="12" />
        <circle v-for="(seg, i) in donutSegments" :key="i" cx="50" cy="50" r="40" fill="none" :stroke="seg.color" stroke-width="12" :stroke-dasharray="`${seg.length} ${251.2 - seg.length}`" :stroke-dashoffset="-seg.offset" transform="rotate(-90 50 50)" class="donut-segment" />
      </svg>
      <div class="donut-center">
        <div class="donut-total">{{ total }}</div>
        <div class="donut-label">{{ centerLabel }}</div>
      </div>
    </div>

    <!-- 趋势图 -->
    <div v-else-if="type === 'trend'" class="trend-chart">
      <svg viewBox="0 0 300 80" class="trend-svg" preserveAspectRatio="none">
        <path :d="trendAreaPath" :fill="fillColor" opacity="0.15" />
        <path :d="trendLinePath" fill="none" :stroke="lineColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-for="(pt, i) in trendPoints" :key="i" :cx="pt.x" :cy="pt.y" r="3" :fill="lineColor" />
      </svg>
      <div class="trend-labels">
        <span v-for="(item, i) in data" :key="i" class="trend-label">{{ item.label }}</span>
      </div>
    </div>

    <!-- 折线图 (多系列) -->
    <div v-else-if="type === 'line'" class="line-chart">
      <svg viewBox="0 0 300 100" class="line-svg" preserveAspectRatio="none">
        <!-- 网格线 -->
        <line v-for="g in 4" :key="g" x1="0" :y1="g * 25" x2="300" :y2="g * 25" stroke="var(--border)" stroke-width="0.5" />
        <!-- 各系列折线 -->
        <template v-for="(series, si) in lineSeries" :key="si">
          <path :d="series.path" fill="none" :stroke="series.color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle v-for="(pt, pi) in series.points" :key="pi" :cx="pt.x" :cy="pt.y" r="2.5" :fill="series.color" />
        </template>
      </svg>
      <div class="line-legend">
        <span v-for="(series, si) in lineSeries" :key="si" class="legend-item">
          <span class="legend-dot" :style="{ background: series.color }"></span>{{ series.name }}
        </span>
      </div>
    </div>

    <!-- 横向柱状图 -->
    <div v-else-if="type === 'hbar'" class="hbar-chart">
      <div v-for="(item, i) in data" :key="i" class="hbar-item">
        <div class="hbar-label">{{ item.label }}</div>
        <div class="hbar-track">
          <div class="hbar-fill" :style="{ width: `${(item.value / maxValue) * 100}%`, background: item.color || colors[i % colors.length] }"></div>
        </div>
        <div class="hbar-value">{{ item.value }}</div>
      </div>
    </div>

    <!-- 雷达图 -->
    <div v-else-if="type === 'radar'" class="radar-chart">
      <svg viewBox="0 0 200 200" class="radar-svg">
        <!-- 网格 -->
        <polygon v-for="level in 4" :key="level" :points="gridPoints(level * 0.25)" fill="none" stroke="var(--border)" stroke-width="0.5" />
        <!-- 轴线 -->
        <line v-for="(axis, i) in radarAxes" :key="i" x1="100" y1="100" :x2="axis.x" :y2="axis.y" stroke="var(--border)" stroke-width="0.5" />
        <!-- 数据区 -->
        <polygon :points="radarDataPoints" fill="rgba(99,102,241,0.2)" stroke="#6366f1" stroke-width="1.5" />
        <circle v-for="(pt, i) in radarPlotPoints" :key="i" :cx="pt.x" :cy="pt.y" r="3" fill="#6366f1" />
        <!-- 标签 -->
        <text v-for="(axis, i) in radarAxes" :key="'l'+i" :x="axis.lx" :y="axis.ly" text-anchor="middle" class="radar-label">{{ axis.label }}</text>
      </svg>
    </div>

    <!-- 热力图 -->
    <div v-else-if="type === 'heatmap'" class="heatmap-chart">
      <div class="heatmap-grid" :style="{ gridTemplateColumns: `repeat(${heatmapCols}, 1fr)` }">
        <div v-for="(cell, i) in heatmapCells" :key="i" class="heatmap-cell" :style="{ background: heatmapColor(cell.value) }" :title="`${cell.label}: ${cell.value}`"></div>
      </div>
      <div class="heatmap-labels">
        <span v-for="(item, i) in data.slice(0, 7)" :key="i" class="heatmap-label">{{ item.label }}</span>
      </div>
    </div>

    <!-- 饼图 -->
    <div v-else-if="type === 'pie'" class="donut-chart">
      <svg viewBox="0 0 100 100" class="donut-svg">
        <circle v-for="(seg, i) in pieSegments" :key="i" cx="50" cy="50" r="40" fill="none" :stroke="seg.color" stroke-width="20" :stroke-dasharray="`${seg.length} ${251.2 - seg.length}`" :stroke-dashoffset="-seg.offset" transform="rotate(-90 50 50)" />
      </svg>
      <div class="donut-center">
        <div class="donut-total">{{ total }}</div>
        <div class="donut-label">{{ centerLabel }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  type?: 'bar' | 'donut' | 'trend' | 'line' | 'hbar' | 'radar' | 'heatmap' | 'pie';
  data: Array<{ label: string; value: number; color?: string }>;
  colors?: string[];
  centerLabel?: string;
  lineColor?: string;
  fillColor?: string;
  series?: Array<{ name: string; values: number[]; color?: string }>;
  radarLabels?: string[];
}>(), {
  type: 'bar',
  colors: () => ['#6366f1', '#22c55e', '#eab308', '#ef4444', '#06b6d4', '#a855f7', '#f97316', '#ec4899'],
  centerLabel: '总计',
  lineColor: '#6366f1',
  fillColor: '#6366f1',
  series: () => [],
  radarLabels: () => [],
});

const maxValue = computed(() => Math.max(...props.data.map(d => d.value), 1));
const total = computed(() => props.data.reduce((s, d) => s + d.value, 0));

// ── 环形图 ──
const donutSegments = computed(() => {
  const c = 2 * Math.PI * 40;
  let offset = 0;
  return props.data.map((d, i) => {
    const length = (d.value / Math.max(total.value, 1)) * c;
    const seg = { length, offset, color: d.color || props.colors[i % props.colors.length] };
    offset += length;
    return seg;
  });
});

// ── 饼图 ──
const pieSegments = computed(() => {
  const c = 2 * Math.PI * 40;
  let offset = 0;
  return props.data.map((d, i) => {
    const length = (d.value / Math.max(total.value, 1)) * c;
    const seg = { length, offset, color: d.color || props.colors[i % props.colors.length] };
    offset += length;
    return seg;
  });
});

// ── 趋势图 ──
const trendPoints = computed(() => {
  const vals = props.data.map(d => d.value);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0), range = max - min || 1;
  return vals.map((v, i) => ({
    x: 5 + (i / Math.max(vals.length - 1, 1)) * 290,
    y: 75 - ((v - min) / range) * 70,
  }));
});
const trendLinePath = computed(() => trendPoints.value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '));
const trendAreaPath = computed(() => {
  const pts = trendPoints.value;
  return pts.length ? `M ${pts[0].x} 80 L ${pts.map(p => `${p.x} ${p.y}`).join(' L ')} L ${pts[pts.length - 1].x} 80 Z` : '';
});

// ── 折线图 (多系列) ──
const lineSeries = computed(() => {
  if (!props.series?.length) return [];
  const allVals = props.series.flatMap(s => s.values);
  const max = Math.max(...allVals, 1), min = Math.min(...allVals, 0), range = max - min || 1;
  const n = Math.max(...props.series.map(s => s.values.length), 1);
  return props.series.map((s, si) => {
    const pts = s.values.map((v, i) => ({
      x: 10 + (i / Math.max(n - 1, 1)) * 280,
      y: 90 - ((v - min) / range) * 80,
    }));
    return { name: s.name, color: s.color || props.colors[si % props.colors.length], points: pts, path: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') };
  });
});

// ── 雷达图 ──
const radarAxes = computed(() => {
  const labels = props.radarLabels?.length ? props.radarLabels : props.data.map(d => d.label);
  const n = labels.length;
  return labels.map((label, i) => {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    const r = 80;
    const lr = 95;
    return {
      x: 100 + r * Math.cos(angle),
      y: 100 + r * Math.sin(angle),
      lx: 100 + lr * Math.cos(angle),
      ly: 100 + lr * Math.sin(angle),
      label,
    };
  });
});

const gridPoints = (scale: number) => {
  const n = props.radarLabels?.length || props.data.length || 1;
  return Array.from({ length: n }, (_, i) => {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    return `${100 + 80 * scale * Math.cos(angle)},${100 + 80 * scale * Math.sin(angle)}`;
  }).join(' ');
};

const radarPlotPoints = computed(() => {
  const labels = props.radarLabels?.length ? props.radarLabels : props.data.map(d => d.label);
  const n = labels.length;
  const max = maxValue.value;
  return props.data.map((d, i) => {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    const r = (d.value / max) * 80;
    return { x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle) };
  });
});

const radarDataPoints = computed(() => radarPlotPoints.value.map(p => `${p.x},${p.y}`).join(' '));

// ── 热力图 ──
const heatmapCols = computed(() => Math.ceil(Math.sqrt(props.data.length)));
const heatmapCells = computed(() => props.data);
const heatmapMax = computed(() => Math.max(...props.data.map(d => d.value), 1));
const heatmapColor = (value: number) => {
  const intensity = value / heatmapMax.value;
  const r = Math.round(99 + (239 - 99) * intensity);
  const g = Math.round(102 + (68 - 102) * intensity);
  const b = Math.round(241 + (68 - 241) * intensity);
  return `rgb(${r},${g},${b})`;
};
</script>

<style scoped>
.chart-container { width: 100%; height: 100%; display: flex; flex-direction: column; }

/* ── 柱状图 ── */
.bar-chart { display: flex; align-items: flex-end; gap: 12px; height: 140px; padding: 8px 0; }
.bar-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
.bar-value { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.bar-track { flex: 1; width: 100%; max-width: 32px; background: var(--surface-hover); border-radius: 4px 4px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
.bar-fill { width: 100%; border-radius: 4px 4px 0 0; transition: height 0.4s ease; min-height: 2px; }
.bar-label { font-size: 10px; color: var(--text-dim); text-align: center; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 环形图/饼图 ── */
.donut-chart { position: relative; width: 120px; height: 120px; margin: 0 auto; }
.donut-svg { width: 100%; height: 100%; }
.donut-segment { transition: stroke-dasharray 0.4s ease; }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.donut-total { font-size: 22px; font-weight: 700; color: var(--text); }
.donut-label { font-size: 11px; color: var(--text-muted); }

/* ── 趋势图 ── */
.trend-chart { display: flex; flex-direction: column; gap: 4px; }
.trend-svg { width: 100%; height: 80px; }
.trend-labels { display: flex; justify-content: space-between; }
.trend-label { font-size: 10px; color: var(--text-dim); text-align: center; }

/* ── 折线图 ── */
.line-chart { display: flex; flex-direction: column; gap: 6px; }
.line-svg { width: 100%; height: 100px; }
.line-legend { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }

/* ── 横向柱状图 ── */
.hbar-chart { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; }
.hbar-item { display: flex; align-items: center; gap: 8px; }
.hbar-label { font-size: 11px; color: var(--text-muted); min-width: 60px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hbar-track { flex: 1; height: 14px; background: var(--surface-hover); border-radius: 3px; overflow: hidden; }
.hbar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; min-width: 2px; }
.hbar-value { font-size: 11px; font-weight: 600; color: var(--text); min-width: 28px; text-align: right; }

/* ── 雷达图 ── */
.radar-chart { display: flex; justify-content: center; align-items: center; }
.radar-svg { width: 160px; height: 160px; }
.radar-label { font-size: 7px; fill: var(--text-muted); }

/* ── 热力图 ── */
.heatmap-chart { display: flex; flex-direction: column; gap: 4px; }
.heatmap-grid { display: grid; gap: 2px; }
.heatmap-cell { aspect-ratio: 1; border-radius: 2px; min-width: 14px; transition: opacity 0.2s; }
.heatmap-cell:hover { opacity: 0.7; }
.heatmap-labels { display: flex; gap: 2px; }
.heatmap-label { flex: 1; font-size: 9px; color: var(--text-dim); text-align: center; overflow: hidden; text-overflow: ellipsis; }
</style>
