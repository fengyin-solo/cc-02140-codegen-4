<template>
  <div class="trend-chart" ref="wrapperRef">
    <div class="chart-legend">
      <span
        v-for="series in seriesDefs"
        :key="series.key"
        class="legend-item"
        :class="{ active: activeSeries === series.key }"
        @click="toggleSeries(series.key)"
      >
        <i class="legend-dot" :style="{ backgroundColor: series.color }"></i>
        {{ series.label }}
      </span>
      <span class="legend-item previous">
        <i class="legend-line"></i>
        上周期合计（灰）
      </span>
    </div>

    <div v-if="!hasData" class="chart-empty">
      <InboxOutlined />
      <span>区间内无趋势数据</span>
    </div>

    <svg
      v-else
      :viewBox="`0 0 ${width} ${height}`"
      :style="{ width: '100%', height: height + 'px' }"
      @mouseleave="hoverIndex = -1"
    >
      <!-- 网格线与 Y 轴刻度 -->
      <g v-for="tick in yTicks" :key="'grid-' + tick">
        <line
          :x1="padding.left"
          :x2="width - padding.right"
          :y1="y(tick)"
          :y2="y(tick)"
          stroke="#f0f0f0"
          stroke-dasharray="4 4"
        />
        <text
          :x="padding.left - 8"
          :y="y(tick) + 4"
          text-anchor="end"
          class="axis-text"
        >{{ tick }}</text>
      </g>

      <!-- X 轴标签（稀疏显示，最多 8 个） -->
      <text
        v-for="(label, i) in visibleXLabels"
        :key="'x-' + i"
        :x="x(label.index)"
        :y="height - padding.bottom + 18"
        text-anchor="middle"
        class="axis-text"
      >{{ label.label }}</text>

      <!-- 环比区间折线（虚线灰） -->
      <polyline
        v-for="series in seriesDefs"
        :key="'prev-' + series.key"
        :points="prevPoints(series.key)"
        fill="none"
        stroke="#bfbfbf"
        stroke-width="1.5"
        stroke-dasharray="5 4"
      />

      <!-- 当前区间折线 -->
      <polyline
        v-for="series in seriesDefs"
        v-show="activeSeries === 'all' || activeSeries === series.key"
        :key="'line-' + series.key"
        :points="points(series.key)"
        fill="none"
        :stroke="series.color"
        stroke-width="2.5"
        stroke-linejoin="round"
      />

      <!-- 悬停辅助线 -->
      <line
        v-if="hoverIndex >= 0"
        :x1="x(hoverIndex)"
        :x2="x(hoverIndex)"
        :y1="padding.top"
        :y2="height - padding.bottom"
        stroke="#d9d9d9"
      />

      <!-- 数据点（可点击钻取） -->
      <template v-for="series in seriesDefs" :key="'dots-' + series.key">
        <circle
          v-for="(bucket, i) in buckets"
          v-show="activeSeries === 'all' || activeSeries === series.key"
          :key="series.key + '-' + i"
          :cx="x(i)"
          :cy="y(bucket[series.field])"
          :r="hoverIndex === i ? 5.5 : 3.5"
          :fill="series.color"
          stroke="#fff"
          stroke-width="1.5"
          class="data-dot"
          @mouseenter="hoverIndex = i"
          @click="$emit('drill', { type: 'bucket', metric: series.key, bucketKey: bucket.key })"
        />
      </template>
    </svg>

    <!-- 悬停提示 -->
    <div
      v-if="hoverIndex >= 0 && hasData && hoveredBucket"
      class="chart-tooltip"
      :style="tooltipStyle"
    >
      <div class="tooltip-title">{{ hoveredBucket.label }}</div>
      <div v-for="series in seriesDefs" :key="series.key" class="tooltip-row">
        <i class="legend-dot" :style="{ backgroundColor: series.color }"></i>
        <span class="tooltip-label">{{ series.label }}</span>
        <span class="tooltip-value">{{ hoveredBucket[series.field] }}</span>
      </div>
      <div class="tooltip-tip">点击数据点可查看该周期明细</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { InboxOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  buckets: { type: Array, default: () => [] },
  previousBuckets: { type: Array, default: () => [] }
})

const emit = defineEmits(['drill'])

const seriesDefs = [
  { key: 'borrow', label: '借出', field: 'borrowCount', color: '#1890ff' },
  { key: 'return', label: '归还', field: 'returnCount', color: '#52c41a' },
  { key: 'overdue', label: '逾期', field: 'overdueCount', color: '#ff4d4f' }
]

const activeSeries = ref('all')
const hoverIndex = ref(-1)
const wrapperRef = ref(null)
const width = ref(640)
const height = 300
const padding = { top: 20, right: 16, bottom: 36, left: 36 }

function toggleSeries(key) {
  activeSeries.value = activeSeries.value === key ? 'all' : key
}

const buckets = computed(() => props.buckets || [])

const hasData = computed(() =>
  buckets.value.some(b => b.borrowCount + b.returnCount + b.overdueCount > 0)
)

const maxValue = computed(() => {
  let max = 0
  buckets.value.forEach(b => {
    max = Math.max(max, b.borrowCount, b.returnCount, b.overdueCount)
  })
  ;(props.previousBuckets || []).forEach(b => {
    max = Math.max(max, b.borrowCount, b.returnCount, b.overdueCount)
  })
  return Math.max(max, 2)
})

// 4 条网格线
const yTicks = computed(() => {
  const max = maxValue.value
  const ticks = []
  for (let i = 0; i <= 4; i++) {
    ticks.push(Math.round((max / 4) * i))
  }
  return [...new Set(ticks)]
})

function y(value) {
  const max = maxValue.value
  const usable = height - padding.top - padding.bottom
  return height - padding.bottom - (value / max) * usable
}

function x(index) {
  const count = Math.max(buckets.value.length, 1)
  const usable = width.value - padding.left - padding.right
  if (count === 1) return padding.left + usable / 2
  return padding.left + (usable / (count - 1)) * index
}

function points(key) {
  const field = fieldOf(key)
  return buckets.value
    .map((b, i) => `${x(i)},${y(b[field])}`)
    .join(' ')
}

// 环比折线：与当前桶一一对应（聚合时桶数通常相同，最后一个不足周期的桶可能缺失）
function prevPoints(key) {
  const field = fieldOf(key)
  return (props.previousBuckets || [])
    .slice(0, buckets.value.length)
    .map((b, i) => `${x(i)},${y(b[field])}`)
    .join(' ')
}

function fieldOf(key) {
  return seriesDefs.find(s => s.key === key)?.field || 'borrowCount'
}

const visibleXLabels = computed(() => {
  const count = buckets.value.length
  if (count <= 8) {
    return buckets.value.map((b, i) => ({ index: i, label: b.label }))
  }
  const step = Math.ceil(count / 8)
  const result = []
  for (let i = 0; i < count; i += step) {
    result.push({ index: i, label: buckets.value[i].label })
  }
  result.push({ index: count - 1, label: buckets.value[count - 1].label })
  // 去重
  const seen = new Set()
  return result.filter(item => {
    if (seen.has(item.index)) return false
    seen.add(item.index)
    return true
  })
})

const hoveredBucket = computed(() =>
  hoverIndex.value >= 0 ? buckets.value[hoverIndex.value] : null
)

const tooltipStyle = computed(() => {
  if (hoverIndex.value < 0 || !wrapperRef.value) return {}
  const count = Math.max(buckets.value.length, 1)
  const usable = width.value - padding.left - padding.right
  const ratio = count === 1 ? 0.5 : hoverIndex.value / (count - 1)
  const wrapperWidth = wrapperRef.value.clientWidth || width.value
  const leftPx = (padding.left + usable * ratio) / width.value * wrapperWidth
  return { left: leftPx + 'px' }
})

let resizeObserver = null
onMounted(() => {
  const update = () => {
    width.value = Math.max((wrapperRef.value?.clientWidth || 640), 320)
  }
  update()
  if (typeof ResizeObserver !== 'undefined' && wrapperRef.value) {
    resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(wrapperRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

watch(buckets, () => { hoverIndex.value = -1 })
</script>

<style lang="less" scoped>
.trend-chart {
  position: relative;
  width: 100%;

  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 8px;
    padding: 0 4px;

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #666;
      cursor: pointer;
      user-select: none;
      opacity: 0.75;
      transition: opacity 0.2s;

      &.active {
        opacity: 1;
        font-weight: 600;
        color: #1a1a1a;
      }

      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
      }

      .legend-line {
        width: 16px;
        height: 0;
        border-top: 2px dashed #bfbfbf;
        display: inline-block;
      }

      &.previous {
        cursor: default;
      }
    }
  }

  .chart-empty {
    height: 240px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #999;
    font-size: 14px;

    .anticon {
      font-size: 40px;
      color: #d9d9d9;
    }
  }

  .axis-text {
    font-size: 11px;
    fill: #999;
  }

  .data-dot {
    cursor: pointer;
    transition: r 0.15s ease;

    &:hover {
      stroke-width: 2;
    }
  }

  .chart-tooltip {
    position: absolute;
    top: 40px;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 10px 12px;
    min-width: 132px;
    pointer-events: none;
    z-index: 5;

    .tooltip-title {
      font-size: 13px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 6px;
      white-space: nowrap;
    }

    .tooltip-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      line-height: 20px;

      .tooltip-label {
        color: #666;
        flex: 1;
      }

      .tooltip-value {
        font-weight: 600;
        color: #1a1a1a;
      }
    }

    .tooltip-tip {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #f0f0f0;
      font-size: 11px;
      color: #faad14;
      white-space: nowrap;
    }
  }
}
</style>
