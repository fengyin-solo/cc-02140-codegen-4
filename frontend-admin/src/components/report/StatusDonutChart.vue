<template>
  <div class="status-donut">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        v-for="(seg, i) in segments"
        :key="seg.key"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke="seg.color"
        :stroke-width="thickness"
        :stroke-dasharray="`${seg.length} ${circumference - seg.length}`"
        :stroke-dashoffset="-seg.offset"
        transform="rotate(-90 100 100)"
        :class="['donut-seg', { dim: activeKey && activeKey !== seg.key }]"
        @click="$emit('drill', seg.key)"
      >
        <title>{{ seg.name }}：{{ seg.value }} 笔（{{ seg.percent }}%）</title>
      </circle>
      <text
        :x="center"
        :y="center - 4"
        text-anchor="middle"
        class="donut-total"
      >{{ total }}</text>
      <text
        :x="center"
        :y="center + 16"
        text-anchor="middle"
        class="donut-label"
      >到期处置</text>
    </svg>

    <div class="donut-legend">
      <span
        v-for="seg in segments"
        :key="seg.key"
        :class="['legend-item', { off: activeKey && activeKey !== seg.key }]"
        @click="$emit('drill', seg.key)"
      >
        <i class="dot" :style="{ background: seg.color }"></i>
        {{ seg.name }}
        <b>{{ seg.value }}</b>
        <em>{{ seg.percent }}%</em>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  onTime: { type: Number, default: 0 },
  overdue: { type: Number, default: 0 },
  pending: { type: Number, default: 0 },
  activeKey: { type: String, default: '' }
})

defineEmits(['drill'])

const size = 200
const center = 100
const radius = 72
const thickness = 22
const circumference = 2 * Math.PI * radius

const total = computed(() => props.onTime + props.overdue + props.pending)

const segments = computed(() => {
  const raw = [
    { key: 'returned', name: '按时归还', value: props.onTime, color: '#52c41a' },
    { key: 'overdue', name: '到期逾期', value: props.overdue, color: '#ff4d4f' },
    { key: 'pending', name: '未到期在借', value: props.pending, color: '#1890ff' }
  ]
  let acc = 0
  return raw.map(seg => {
    const percent = total.value ? (seg.value / total.value) * 100 : 0
    const length = total.value ? (seg.value / total.value) * circumference : 0
    const item = {
      ...seg,
      percent: Math.round(percent * 10) / 10,
      length,
      offset: acc
    }
    acc += length
    return item
  })
})
</script>

<style lang="less" scoped>
.status-donut {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
}

.donut-seg {
  cursor: pointer;
  transition: opacity 0.2s ease, stroke-width 0.2s ease;

  &:hover {
    stroke-width: 26px;
  }

  &.dim {
    opacity: 0.3;
  }
}

.donut-total {
  font-size: 28px;
  font-weight: 700;
  fill: #1a1a1a;
}

.donut-label {
  font-size: 12px;
  fill: #999;
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #555;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 0.2s ease;

    &:hover {
      background: #f5f7fa;
    }

    &.off {
      opacity: 0.4;
    }

    b {
      font-weight: 600;
      color: #1a1a1a;
    }

    em {
      font-style: normal;
      font-size: 12px;
      color: #999;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
  }
}
</style>
