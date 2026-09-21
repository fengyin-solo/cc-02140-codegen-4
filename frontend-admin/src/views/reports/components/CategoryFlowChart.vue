<template>
  <div class="category-flow">
    <div class="flow-legend">
      <span class="legend-item">
        <i class="legend-block borrow"></i>借出
      </span>
      <span class="legend-item">
        <i class="legend-block returned"></i>归还
      </span>
      <span class="legend-item">
        <i class="legend-block overdue"></i>逾期
      </span>
    </div>

    <div v-if="!flowData.length" class="flow-empty">
      <InboxOutlined />
      <span>区间内无分类流向数据</span>
    </div>

    <div v-else class="flow-list">
      <div
        v-for="item in flowData"
        :key="item.key"
        class="flow-row"
        :class="{ deleted: item.deleted }"
        @click="$emit('drill', { type: 'category', categoryKey: item.key })"
      >
        <div class="flow-label" :title="item.name">
          <i class="label-dot" :style="{ backgroundColor: item.color }"></i>
          <span class="label-name">{{ item.name }}</span>
          <a-tag v-if="item.deleted" color="error" class="deleted-tag">已删除</a-tag>
          <span class="label-total">{{ item.total }}</span>
        </div>
        <div class="flow-bar-wrapper">
          <div class="flow-bar">
            <div
              v-if="item.borrowCount"
              class="seg seg-borrow"
              :style="{ width: pct(item.borrowCount, item.maxTotal) + '%' }"
              :title="`借出 ${item.borrowCount}`"
              @click.stop="$emit('drill', { type: 'category', categoryKey: item.key, metric: 'borrow' })"
            >
              <span v-if="pct(item.borrowCount, item.maxTotal) > 10" class="seg-text">{{ item.borrowCount }}</span>
            </div>
            <div
              v-if="item.returnCount"
              class="seg seg-return"
              :style="{ width: pct(item.returnCount, item.maxTotal) + '%' }"
              :title="`归还 ${item.returnCount}`"
              @click.stop="$emit('drill', { type: 'category', categoryKey: item.key, metric: 'return' })"
            >
              <span v-if="pct(item.returnCount, item.maxTotal) > 10" class="seg-text">{{ item.returnCount }}</span>
            </div>
            <div
              v-if="item.overdueCount"
              class="seg seg-overdue"
              :style="{ width: pct(item.overdueCount, item.maxTotal) + '%' }"
              :title="`逾期 ${item.overdueCount}`"
              @click.stop="$emit('drill', { type: 'category', categoryKey: item.key, metric: 'overdue' })"
            >
              <span v-if="pct(item.overdueCount, item.maxTotal) > 10" class="seg-text">{{ item.overdueCount }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { InboxOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  data: { type: Array, default: () => [] }
})

defineEmits(['drill'])

const flowData = computed(() => {
  const maxTotal = Math.max(...props.data.map(c => c.total), 1)
  // 最多展示 10 个分类；删除分类始终保留
  const sorted = [...props.data].sort((a, b) => {
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1
    return b.total - a.total
  })
  return sorted.slice(0, 10).map(item => ({ ...item, maxTotal }))
})

function pct(value, maxTotal) {
  // 按区间最大值归一化，保证分类间长度可比
  return Math.max((value / maxTotal) * 100, 2)
}
</script>

<style lang="less" scoped>
.category-flow {
  .flow-legend {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #666;

      .legend-block {
        width: 12px;
        height: 12px;
        border-radius: 3px;
        display: inline-block;

        &.borrow { background: #1890ff; }
        &.returned { background: #52c41a; }
        &.overdue { background: #ff4d4f; }
      }
    }
  }

  .flow-empty {
    height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #999;
    font-size: 14px;

    .anticon {
      font-size: 36px;
      color: #d9d9d9;
    }
  }

  .flow-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .flow-row {
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 8px;
    transition: background 0.2s;

    &:hover {
      background: #fafafa;

      .flow-bar {
        box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.12);
      }
    }

    &.deleted {
      .flow-label .label-name {
        color: #ff4d4f;
      }
    }
  }

  .flow-label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;

    .label-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .label-name {
      font-size: 13px;
      color: #1a1a1a;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .deleted-tag {
      margin-inline-end: 0;
      font-size: 11px;
      line-height: 16px;
      padding: 0 4px;
    }

    .label-total {
      margin-left: auto;
      font-size: 13px;
      font-weight: 600;
      color: #1a1a1a;
    }
  }

  .flow-bar-wrapper {
    display: flex;
  }

  .flow-bar {
    display: flex;
    width: 100%;
    height: 22px;
    border-radius: 6px;
    overflow: hidden;
    background: #f5f5f5;
    transition: box-shadow 0.2s;

    .seg {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 2px;
      transition: filter 0.2s;
      cursor: pointer;

      &:hover {
        filter: brightness(1.08);
      }

      .seg-text {
        font-size: 11px;
        color: #fff;
        font-weight: 600;
        line-height: 1;
      }

      &.seg-borrow { background: #1890ff; }
      &.seg-return { background: #52c41a; }
      &.seg-overdue { background: #ff4d4f; }
    }
  }
}
</style>
