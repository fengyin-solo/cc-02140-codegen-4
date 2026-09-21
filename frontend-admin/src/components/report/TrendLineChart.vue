<template>
  <div class="trend-chart" ref="wrapperRef">
    <div v-if="hidden.size === series.length" class="chart-empty">
      所有系列已隐藏，请点击图例恢复
    </div>
    <svg
      v-else
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      @mouseleave="hoverIndex = -1"
    >
      <!-- 网格与 Y 轴刻度 -->
      <g v-for="(tick, i) in yTicks" :key="`grid-${i}`">
        <line
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="yPos(tick)"
          :y2="yPos(tick)"
          stroke="#f0f0f0"
          stroke-dasharray="4 4"
        />
        <text
          :x="pad.left - 8"
          :y="yPos(tick) + 4"
          text-anchor="end"
          class="axis-text"
        >{{ tick }}</text>
      </g>

      <!-- X 轴标签（自适应抽稀） -->
      <text
        v-for="(b, i) in labelIndexes"
        :key="`xlabel-${i}`"
        :x="pointX(i)"
        :y="height - pad.bottom + 18"
        text-anchor="middle"
        class="axis-text"
      >{{ buckets[b]?.label }}</text>

      <!-- 上一期借出对比（虚线） -->
      <polyline
        v-if="!hidden.has('prevBorrowed')"
        :points="prevBorrowedPoints"
        fill="none"
        stroke="#bfbfbf"
        stroke-width="1.5"
        stroke-dasharray="6 4"
      />

      <!-- 当前期三条线 -->
      <polyline
        v-for="s in activeSeries"
        :key="s.key"
        :points="pointsOf(s.key)"
        fill="none"
        :stroke="s.color"
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <!-- 异常点（零借出 / 高峰）标记 -->
      <template v-for="(b, i) in buckets" :key="`mark-${i}`">
        <circle
          v-if="zeroKeys.has(b.key)"
          :cx="pointX(i)"
          :cy="yPos(0)"
          r="5"
          fill="#fff"
          stroke="#bfbfbf"
          stroke-width="1.5"
        />
        <circle
          v-if="spikeKeys.has(b.key)"
          :cx="pointX(i)"
          :cy="yPos(b.borrowed)"
          r="5"
          fill="#faad14"
          stroke="#fff"
          stroke-width="2"
        >
          <title>{{ b.label }} 借出高峰：{{ b.borrowed }} 笔</title>
        </circle>
      </template>

      <!-- 数据点与交互热区 -->
      <template v-for="(b, i) in buckets" :key="`pts-${i}`">
        <circle
          v-for="s in activeSeries"
          :key="`${s.key}-${i}`"
          :cx="pointX(i)"
          :cy="yPos(b[s.key] ?? 0)"
          r="3.5"
          :fill="s.color"
          stroke="#fff"
          stroke-width="1.5"
        />
        <rect
          :x="pointX(i) - stepX / 2"
          :y1="0"
          :y="pad.top"
          :width="stepX"
          :height="chartHeight"
          fill="transparent"
          @mouseenter="hoverIndex = i"
          @click="$emit('drill', buckets[i])"
          class="hit-rect"
        />
        <line
          v-if="hoverIndex === i"
          :x1="pointX(i)"
          :x2="pointX(i)"
          :y1="pad.top"
          :y2="height - pad.bottom"
          stroke="#1890ff"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
      </template>

      <!-- 悬浮提示 -->
      <g v-if="hoverIndex >= 0 && buckets[hoverIndex]">
        <foreignObject
          :x="tipX"
          :y="pad.top + 6"
          width="180"
          height="120"
        >
          <div class="chart-tooltip" xmlns="http://www.w3.org/1999/xhtml">
            <div class="tip-title">{{ buckets[hoverIndex].label }}</div>
            <div v-if="!hidden.has('borrowed')" class="tip-row">
              <i class="dot" style="background:#1890ff"></i>借出 {{ buckets[hoverIndex].borrowed }}
            </div>
            <div v-if="!hidden.has('returned')" class="tip-row">
              <i class="dot" style="background:#52c41a"></i>归还 {{ buckets[hoverIndex].returned }}
            </div>
            <div v-if="!hidden.has('overdue')" class="tip-row">
              <i class="dot" style="background:#ff4d4f"></i>逾期 {{ buckets[hoverIndex].overdue }}
            </div>
            <div v-if="!hidden.has('prevBorrowed')" class="tip-row muted">
              <i class="dot" style="background:#bfbfbf"></i>上期借出 {{ prevBorrowedSeries[hoverIndex] ?? 0 }}
            </div>
          </div>
        </foreignObject>
      </g>
    </svg>

    <div class="trend-legend">
      <span
        v-for="s in legendItems"
        :key="s.key"
        :class="['legend-item', { off: hidden.has(s.key) }]"
        @click="toggleSeries(s.key)"
      >
        <i class="legend-line" :style="{ background: s.color }"></i>{{ s.name }}
      </span>
    </div>
    <div class="drill-hint">点击数据点可钻取该时间段的借阅明细</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  buckets: { type: Array, default: () => [] },
  prevBorrowedSeries: { type: Array, default: () => [] },
  prevReturnedSeries: { type: Array, default: () => [] },
  spikeKeys: { type: Object, default: () => new Set() },
  zeroKeys: { type: Object, default: () => new Set() }
})

defineEmits(['drill'])

const height = 300
const pad = { top: 20, right: 16, bottom: 34, left: 36 }

const wrapperRef = ref(null)
const width = ref(640)
const hoverIndex = ref(-1)
const hidden = ref(new Set())

const SERIES = [
  { key: 'borrowed', name: '本期借出', color: '#1890ff' },
  { key: 'returned', name: '本期归还', color: '#52c41a' },
  { key: 'overdue', name: '到期逾期', color: '#ff4d4f' },
  { key: 'prevBorrowed', name: '上期借出对比', color: '#bfbfbf' }
]
const activeSeries = computed(() => SERIES.filter(s => s.key !== 'prevBorrowed' && !hidden.value.has(s.key)))
const legendItems = SERIES

let ro = null
onMounted(() => {
  ro = new ResizeObserver(entries => {
    const w = entries[0]?.contentRect.width
    if (w) width.value = Math.max(320, w)
  })
  if (wrapperRef.value) ro.observe(wrapperRef.value)
})
onBeforeUnmount(() => ro?.disconnect())

function toggleSeries(key) {
  const next = new Set(hidden.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hidden.value = next
}

const maxValue = computed(() => {
  let max = 1
  props.buckets.forEach(b => {
    max = Math.max(max, b.borrowed || 0, b.returned || 0, b.overdue || 0)
  })
  props.prevBorrowedSeries.forEach(v => { max = Math.max(max, v || 0) })
  return max
})

const yTicks = computed(() => {
  const max = maxValue.value
  const step = Math.max(1, Math.ceil(max / 4))
  const niceMax = Math.ceil(max / step) * step
  const ticks = []
  for (let v = 0; v <= niceMax; v += step) ticks.push(v)
  return ticks
})

const chartHeight = computed(() => height - pad.top - pad.bottom)
const stepX = computed(() => {
  const n = props.buckets.length
  const inner = width.value - pad.left - pad.right
  return n <= 1 ? inner : inner / (n - 1)
})

function pointX(i) {
  return pad.left + stepX.value * i
}
function yPos(v) {
  const max = yTicks.value[yTicks.value.length - 1] || 1
  const ratio = Math.min(1, v / max)
  return pad.top + chartHeight.value * (1 - ratio)
}

function pointsOf(key) {
  return props.buckets
    .map((b, i) => `${pointX(i)},${yPos(b[key] ?? 0)}`)
    .join(' ')
}
const prevBorrowedPoints = computed(() =>
  props.buckets
    .map((b, i) => `${pointX(i)},${yPos(props.prevBorrowedSeries[i] ?? 0)}`)
    .join(' ')
)

const labelIndexes = computed(() => {
  const n = props.buckets.length
  if (n <= 12) return props.buckets.map((_, i) => i)
  const target = Math.min(n, 8)
  const gap = Math.ceil(n / target)
  const list = []
  for (let i = 0; i < n; i += gap) list.push(i)
  if (list[list.length - 1] !== n - 1) list.push(n - 1)
  return list
})

const tipX = computed(() => {
  if (hoverIndex.value < 0) return pad.left
  const x = pointX(hoverIndex.value) + 10
  return Math.min(x, width.value - 190)
})
</script>

<style lang="less" scoped>
.trend-chart {
  width: 100%;

  svg {
    display: block;
  }

  .axis-text {
    font-size: 11px;
    fill: #999;
  }

  .hit-rect {
    cursor: pointer;
  }
}

.chart-empty {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 13px;
}

.chart-tooltip {
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 8px 10px;
  font-size: 12px;
  pointer-events: none;

  .tip-title {
    font-weight: 600;
    margin-bottom: 4px;
    color: #1a1a1a;
  }

  .tip-row {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #555;
    line-height: 1.9;

    &.muted { color: #999; }
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
}

.trend-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  margin-top: 8px;

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #666;
    cursor: pointer;
    user-select: none;

    &.off {
      color: #bfbfbf;
      .legend-line { opacity: 0.3; }
    }
  }

  .legend-line {
    width: 16px;
    height: 3px;
    border-radius: 2px;
    display: inline-block;
  }
}

.drill-hint {
  text-align: center;
  font-size: 11px;
  color: #bbb;
  margin-top: 4px;
}
</style>
