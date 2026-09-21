<template>
  <div class="category-flow">
    <div v-if="flow.length === 0" class="flow-empty">区间内暂无分类流向数据</div>
    <template v-else>
      <div
        v-for="item in flow"
        :key="item.categoryId"
        class="flow-row"
        :class="{ deleted: item.categoryDeleted }"
      >
        <div class="flow-name" :title="item.categoryName">
          <span class="name-text">{{ item.categoryName }}</span>
          <a-tag v-if="item.categoryDeleted" color="default">已删除</a-tag>
        </div>
        <div class="flow-track">
          <div
            class="seg seg-borrow"
            :style="{ width: pct(item.borrowed) + '%' }"
            @click="emitDrill('borrow', item.borrowIds)"
          >
            <span v-if="pct(item.borrowed) >= 12">{{ item.borrowed }}</span>
          </div>
          <div
            class="seg seg-return"
            :style="{ width: pct(item.returned) + '%' }"
            @click="emitDrill('returned', item.returnIds)"
          >
            <span v-if="pct(item.returned) >= 12">{{ item.returned }}</span>
          </div>
          <div
            class="seg seg-overdue"
            :style="{ width: pct(item.overdue) + '%' }"
            @click="emitDrill('overdue', item.overdueIds)"
          >
            <span v-if="pct(item.overdue) >= 12">{{ item.overdue }}</span>
          </div>
          <div class="seg-remainder" :style="{ width: 100 - pctTotal(item) + '%' }"></div>
        </div>
        <div class="flow-nums">
          <span @click="emitDrill('borrow', item.borrowIds)">借 {{ item.borrowed }}</span>
          <span @click="emitDrill('returned', item.returnIds)" class="num-return">还 {{ item.returned }}</span>
          <span @click="emitDrill('overdue', item.overdueIds)" class="num-overdue">逾 {{ item.overdue }}</span>
        </div>
      </div>
      <div class="flow-legend">
        <span><i class="swatch borrow"></i>借出</span>
        <span><i class="swatch return"></i>归还</span>
        <span><i class="swatch overdue"></i>逾期</span>
        <span class="legend-tip">柱长按区间借出最大值等比；点击色块/数字钻取明细</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  flow: { type: Array, default: () => [] }
})

const emit = defineEmits(['drill'])

const maxBorrowed = computed(() => Math.max(1, ...props.flow.map(i => i.borrowed)))

function pct(value) {
  return Math.round((value / maxBorrowed.value) * 1000) / 10
}
function pctTotal(item) {
  return Math.min(100, pct(item.borrowed) + pct(item.returned) + pct(item.overdue))
}
function emitDrill(tab, ids) {
  if (ids && ids.length) emit('drill', { tab, ids })
}
</script>

<style lang="less" scoped>
.category-flow {
  width: 100%;
}

.flow-empty {
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 13px;
}

.flow-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;

  &.deleted .name-text {
    color: #999;
    text-decoration: line-through;
  }
}

.flow-name {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #333;

  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.flow-track {
  flex: 1;
  display: flex;
  height: 22px;
  border-radius: 4px;
  overflow: hidden;
  background: #fafafa;
}

.seg {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  transition: filter 0.2s ease;
  min-width: 2px;

  &:hover {
    filter: brightness(1.12);
  }

  &.seg-borrow { background: #1890ff; }
  &.seg-return { background: #52c41a; }
  &.seg-overdue { background: #ff4d4f; }
}

.seg-remainder {
  height: 100%;
}

.flow-nums {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #1890ff;
  justify-content: flex-end;

  span {
    cursor: pointer;

    &.num-return { color: #52c41a; }
    &.num-overdue { color: #ff4d4f; }
  }
}

.flow-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
  font-size: 12px;
  color: #999;
  flex-wrap: wrap;

  span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;

    &.borrow { background: #1890ff; }
    &.return { background: #52c41a; }
    &.overdue { background: #ff4d4f; }
  }

  .legend-tip {
    color: #bbb;
  }
}
</style>
