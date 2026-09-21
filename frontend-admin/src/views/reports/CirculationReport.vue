<template>
  <div class="circulation-report">
    <div class="page-header">
      <h2 class="page-title">流通分析报表</h2>
      <a-space>
        <a-tooltip title="统计计算进行中可随时中断；当前条件与上次结果会保留">
          <a-button v-if="store.loading" danger @click="store.abortLoad()">
            <PauseOutlined /> 中断加载
          </a-button>
          <a-button v-else :disabled="store.isInvalidRange" @click="handleRetry">
            <ReloadOutlined /> 重新计算
          </a-button>
        </a-tooltip>
      </a-space>
    </div>

    <!-- 筛选条件区：异常 / 中断 / 反向时条件均不清空、不重置 -->
    <div class="filter-card">
      <a-row :gutter="[16, 12]" align="middle">
        <a-col :xs="24" :md="9" :lg="8">
          <div class="filter-field">
            <span class="field-label"><CalendarOutlined /> 统计区间</span>
            <a-range-picker
              v-model:value="dateRange"
              value-format="YYYY-MM-DD"
              :allow-clear="false"
              style="width: 100%"
              :status="store.isInvalidRange ? 'error' : ''"
              @change="handleRangeChange"
            />
          </div>
        </a-col>
        <a-col :xs="24" :md="7" :lg="6">
          <div class="filter-field">
            <span class="field-label">快捷区间</span>
            <a-radio-group
              v-model:value="activePreset"
              button-style="solid"
              size="middle"
              @change="handlePreset"
            >
              <a-radio-button value="all">全部数据</a-radio-button>
              <a-radio-button value="month">近30天</a-radio-button>
              <a-radio-button value="custom">自定义</a-radio-button>
            </a-radio-group>
          </div>
        </a-col>
        <a-col :xs="12" :md="4" :lg="3">
          <div class="filter-field">
            <span class="field-label">统计粒度</span>
            <a-select
              :value="store.conditions.granularity"
              style="width: 100%"
              @change="handleGranularity"
            >
              <a-select-option value="day">按日</a-select-option>
              <a-select-option value="week">按周</a-select-option>
              <a-select-option value="month">按月</a-select-option>
            </a-select>
          </div>
        </a-col>
        <a-col :xs="12" :md="4" :lg="3">
          <div class="filter-field">
            <span class="field-label">借阅状态</span>
            <a-select
              :value="store.conditions.statuses"
              mode="multiple"
              allow-clear
              max-tag-count="responsive"
              placeholder="全部状态"
              style="width: 100%"
              @change="handleStatuses"
            >
              <a-select-option value="borrowed">借阅中</a-select-option>
              <a-select-option value="returned">已归还</a-select-option>
              <a-select-option value="overdue">已逾期</a-select-option>
            </a-select>
          </div>
        </a-col>
        <a-col :xs="24" :md="24" :lg="4">
          <div class="filter-field">
            <span class="field-label">图书分类</span>
            <a-select
              :value="store.conditions.categoryIds"
              mode="multiple"
              allow-clear
              show-search
              option-filter-prop="label"
              max-tag-count="responsive"
              placeholder="全部分类"
              style="width: 100%"
              @change="handleCategories"
            >
              <a-select-option
                v-for="cat in categoryOptions"
                :key="cat.id"
                :value="cat.id"
                :label="cat.name"
              >
                {{ cat.name }}
              </a-select-option>
              <a-select-option
                v-for="id in missingCategoryIds"
                :key="`missing-${id}`"
                :value="id"
                :label="`#${id}（已删除）`"
              >
                #{{ id }}（已删除）
              </a-select-option>
            </a-select>
          </div>
        </a-col>
      </a-row>

      <div class="filter-footer">
        <div class="filter-meta">
          <a-alert
            v-if="store.isInvalidRange"
            type="error"
            show-icon
            banner
            message="开始日期晚于结束日期，请调整统计区间；当前条件已保留，暂不执行计算。"
            class="range-alert"
          />
          <a-space v-else size="small" wrap>
            <a-tag color="blue">{{ store.conditions.start }} ~ {{ store.conditions.end }}</a-tag>
            <a-tag>{{ granularityText }}</a-tag>
            <a-tag v-if="store.conditions.statuses.length">{{ statusesText }}</a-tag>
            <a-tag v-if="store.conditions.categoryIds.length">{{ categoriesText }}</a-tag>
            <span v-if="store.lastLoadedAt" class="generated-at">
              计算完成于 {{ store.lastLoadedAt }}
            </span>
          </a-space>
        </div>
        <a-space>
          <a-button @click="handleReset"><ClearOutlined /> 重置条件</a-button>
          <a-button
            type="primary"
            :loading="store.loading"
            :disabled="store.isInvalidRange"
            @click="handleRetry"
          >
            <SearchOutlined /> 生成报表
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 加载中断 / 计算失败提示：条件保留，可重试 -->
    <a-alert
      v-if="store.error"
      class="status-alert"
      type="warning"
      show-icon
      :message="store.error"
    >
      <template #action>
        <a-button size="small" type="primary" @click="handleRetry">重新计算</a-button>
      </template>
    </a-alert>

    <a-spin :spinning="store.loading" tip="正在统计流通数据...">
      <!-- 日期反向时不展示旧口径结果误导用户 -->
      <template v-if="!store.isInvalidRange">
        <!-- 区间无数据：条件保留 -->
        <a-empty
          v-if="store.hasResult && store.isEmpty && !store.loading"
          class="empty-block"
          description="当前统计区间内暂无借出 / 归还 / 逾期数据，筛选条件已保留"
        >
          <a-space>
            <a-button type="primary" @click="handleReset">重置为全部数据</a-button>
            <a-button @click="handleRetry"><ReloadOutlined /> 重新计算</a-button>
          </a-space>
        </a-empty>

        <template v-else-if="store.hasResult">
          <!-- 汇总卡片：对比归还、逾期，点击钻取 -->
          <a-row :gutter="[16, 16]" class="stat-row">
            <a-col :xs="12" :md="6">
              <div class="metric-card borrow" @click="drillMetric('borrow')">
                <div class="metric-top">
                  <span class="metric-label">借出总量</span>
                  <a-tooltip title="查看该指标明细">
                    <EyeOutlined class="metric-action" />
                  </a-tooltip>
                </div>
                <div class="metric-value">{{ report.totals.totalBorrow }}</div>
                <div class="metric-compare">
                  <CompareTag :delta="report.comparison.borrow" />
                  <span class="compare-hint">上周期 {{ report.previousTotals.totalBorrow }}</span>
                </div>
              </div>
            </a-col>
            <a-col :xs="12" :md="6">
              <div class="metric-card returned" @click="drillMetric('return')">
                <div class="metric-top">
                  <span class="metric-label">归还总量</span>
                  <a-tooltip title="查看该指标明细">
                    <EyeOutlined class="metric-action" />
                  </a-tooltip>
                </div>
                <div class="metric-value">{{ report.totals.totalReturn }}</div>
                <div class="metric-compare">
                  <CompareTag :delta="report.comparison.return" />
                  <span class="compare-hint">上周期 {{ report.previousTotals.totalReturn }}</span>
                </div>
              </div>
            </a-col>
            <a-col :xs="12" :md="6">
              <div class="metric-card overdue" @click="drillMetric('overdue')">
                <div class="metric-top">
                  <span class="metric-label">逾期事件</span>
                  <a-tooltip title="查看该指标明细">
                    <EyeOutlined class="metric-action" />
                  </a-tooltip>
                </div>
                <div class="metric-value">{{ report.totals.totalOverdue }}</div>
                <div class="metric-compare">
                  <CompareTag :delta="report.comparison.overdue" invert />
                  <span class="compare-hint">上周期 {{ report.previousTotals.totalOverdue }}</span>
                </div>
              </div>
            </a-col>
            <a-col :xs="12" :md="6">
              <div class="metric-card rate">
                <div class="metric-top">
                  <span class="metric-label">逾期率 / 归还率</span>
                </div>
                <div class="metric-value dual">
                  <span class="rate-overdue">{{ report.totals.overdueRate }}%</span>
                  <span class="rate-sep">/</span>
                  <span class="rate-return">{{ report.totals.returnRate }}%</span>
                </div>
                <div class="metric-compare">
                  <span class="rate-note">逾期 ÷ (归还+逾期)<br/>归还 ÷ 借出</span>
                </div>
              </div>
            </a-col>
          </a-row>

          <!-- 图表区：趋势对比 + 分类流向 -->
          <a-row :gutter="[16, 16]">
            <a-col :xs="24" :xl="15">
              <div class="chart-card">
                <div class="card-title">
                  <LineChartOutlined /> 趋势对比
                  <span class="title-sub">
                    当前 {{ store.conditions.start }} ~ {{ store.conditions.end }}
                    ／ 上周期 {{ report.comparison.start }} ~ {{ report.comparison.end }}
                  </span>
                </div>
                <TrendChart
                  :buckets="report.buckets"
                  :previous-buckets="report.previousBuckets"
                  @drill="handleChartDrill"
                />
              </div>
            </a-col>
            <a-col :xs="24" :xl="9">
              <div class="chart-card">
                <div class="card-title">
                  <BarChartOutlined /> 分类流向
                  <span class="title-sub">点击条形或行查看明细</span>
                </div>
                <CategoryFlowChart
                  :data="report.categoryFlow"
                  @drill="handleChartDrill"
                />
              </div>
            </a-col>
          </a-row>

          <!-- 异常点说明 -->
          <div class="anomaly-card">
            <div class="card-title">
              <WarningOutlined class="anomaly-title-icon" /> 异常点说明
              <a-tag :color="report.anomalies.length ? 'warning' : 'success'">
                {{ report.anomalies.length ? `${report.anomalies.length} 项` : '未发现异常' }}
              </a-tag>
            </div>
            <a-empty
              v-if="!report.anomalies.length"
              :image="simpleImage"
              description="本区间未检测到流通峰值、断档、逾期率异常或已删除分类流向"
              class="anomaly-empty"
            />
            <a-list v-else size="small" :data-source="report.anomalies" split>
              <template #renderItem="{ item }">
                <a-list-item class="anomaly-item">
                  <a-list-item-meta>
                    <template #avatar>
                      <a-badge :status="badgeStatus(item.level)" />
                    </template>
                    <template #title>
                      <a-space size="small" wrap>
                        <span class="anomaly-name">{{ item.title }}</span>
                        <a-tag :color="levelColor(item.level)">{{ levelText(item.level) }}</a-tag>
                      </a-space>
                    </template>
                    <template #description>{{ item.message }}</template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button type="link" size="small" @click="handleChartDrill(item.drill)">
                      <SearchOutlined /> 定位明细
                    </a-button>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </div>

          <!-- 明细钻取 -->
          <div class="detail-card">
            <div class="detail-header">
              <div class="card-title">
                <TableOutlined /> 借阅明细
                <span v-if="store.drillDescription" class="title-sub">
                  {{ store.drillDescription }}
                </span>
                <span v-else class="title-sub muted">当前区间全部流通记录（与图表同一统计条件）</span>
              </div>
              <a-space>
                <a-tag v-if="store.drill" color="processing" closable @close="store.clearDrill()">
                  钻取筛选中 · {{ store.detailRecords.length }} 条
                </a-tag>
                <a-tag v-else color="default">{{ store.detailRecords.length }} 条记录</a-tag>
                <a-button
                  v-if="store.drill"
                  size="small"
                  @click="store.clearDrill()"
                >
                  返回全部明细
                </a-button>
              </a-space>
            </div>
            <a-table
              :columns="detailColumns"
              :data-source="store.detailRecords"
              row-key="id"
              size="middle"
              :pagination="{ pageSize: 8, showTotal: total => `共 ${total} 条` }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'reader'">
                  <div class="cell-primary">{{ record.readerName }}</div>
                  <div class="cell-secondary">{{ record.cardNo }}</div>
                </template>
                <template v-else-if="column.key === 'book'">
                  <div class="cell-primary">{{ record.bookTitle }}</div>
                  <div class="cell-secondary">{{ record.isbn }}</div>
                </template>
                <template v-else-if="column.key === 'category'">
                  <a-space :size="4" wrap>
                    <span>{{ record.resolvedCategoryName }}</span>
                    <a-tag v-if="record.categoryDeleted" color="error" class="mini-tag">分类已删除</a-tag>
                    <a-tag v-else-if="record.bookDeleted" color="warning" class="mini-tag">图书已删除</a-tag>
                  </a-space>
                </template>
                <template v-else-if="column.key === 'dates'">
                  <div class="date-line">借：{{ record.borrowDate }}</div>
                  <div class="date-line">应还：{{ record.dueDate }}</div>
                  <div class="date-line" :class="{ 'date-late': isLateReturn(record) }">
                    还：{{ record.returnDate || '—' }}
                  </div>
                </template>
                <template v-else-if="column.key === 'status'">
                  <a-tag :color="statusColor(record.status)">{{ statusText(record.status) }}</a-tag>
                  <a-tag v-if="isOverdueEvent(record)" color="error" class="mini-tag">区间内逾期</a-tag>
                </template>
              </template>
            </a-table>
          </div>
        </template>

        <!-- 尚未生成 -->
        <a-empty
          v-else-if="!store.loading"
          class="empty-block"
          description="点击“生成报表”开始统计"
        />
      </template>
    </a-spin>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { Empty } from 'ant-design-vue'
import {
  CalendarOutlined,
  ReloadOutlined,
  PauseOutlined,
  ClearOutlined,
  SearchOutlined,
  EyeOutlined,
  LineChartOutlined,
  BarChartOutlined,
  WarningOutlined,
  TableOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined
} from '@ant-design/icons-vue'
import { useBorrowStore } from '@/stores/borrow'
import { useCategoryStore } from '@/stores/category'
import { useCirculationStore } from '@/stores/circulation'
import TrendChart from './components/TrendChart.vue'
import CategoryFlowChart from './components/CategoryFlowChart.vue'

const borrowStore = useBorrowStore()
const categoryStore = useCategoryStore()
const store = useCirculationStore()

// 区间选择器与 conditions 同源
const dateRange = ref([store.conditions.start, store.conditions.end])
const activePreset = ref(calcPreset(store.conditions))

// 图表与明细都基于这一份计算结果渲染（切换条件后整体刷新）
const report = computed(() => store.report)

const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE

const detailColumns = [
  { title: '读者', key: 'reader', width: 150 },
  { title: '图书', key: 'book', width: 210 },
  { title: '分类', key: 'category', width: 160 },
  { title: '日期信息', key: 'dates', width: 200 },
  { title: '状态', key: 'status', width: 140 }
]

// 当前存在的分类；已被删除但条件中残留的 ID 单独展示，避免“条件消失”
const categoryOptions = computed(() => categoryStore.categories)

const missingCategoryIds = computed(() =>
  store.conditions.categoryIds.filter(id => !categoryStore.getCategoryById(id))
)

const granularityText = computed(() => ({
  day: '按日统计',
  week: '按周统计',
  month: '按月统计'
}[store.conditions.granularity]))

const statusesText = computed(() =>
  store.conditions.statuses
    .map(s => ({ borrowed: '借阅中', returned: '已归还', overdue: '已逾期' }[s]))
    .join('、')
)

const categoriesText = computed(() =>
  store.conditions.categoryIds
    .map(id => categoryStore.getCategoryById(id)?.name || `#${id}（已删除）`)
    .join('、')
)

function calcPreset(cond) {
  const dates = borrowStore.records.map(r => r.borrowDate).filter(Boolean).sort()
  if (dates.length && cond.start === dates[0] && cond.end === dates[dates.length - 1]) {
    return 'all'
  }
  const monthStart = dayjs().subtract(30, 'day').format('YYYY-MM-DD')
  if (cond.start === monthStart && cond.end === dayjs().format('YYYY-MM-DD')) {
    return 'month'
  }
  return 'custom'
}

function handleRangeChange(values) {
  // 允许反向输入：保留用户输入并提示，不静默纠正、不清空
  if (!values || values.length !== 2) return
  dateRange.value = values
  store.updateConditions({ start: values[0], end: values[1] })
  activePreset.value = 'custom'
  autoRunIfValid()
}

function handlePreset(e) {
  const value = e.target.value
  activePreset.value = value
  if (value === 'all') {
    const dates = borrowStore.records.map(r => r.borrowDate).filter(Boolean).sort()
    if (dates.length) {
      const next = { start: dates[0], end: dates[dates.length - 1] }
      dateRange.value = [next.start, next.end]
      store.updateConditions(next)
      autoRunIfValid()
    }
  } else if (value === 'month') {
    const start = dayjs().subtract(30, 'day').format('YYYY-MM-DD')
    const end = dayjs().format('YYYY-MM-DD')
    dateRange.value = [start, end]
    store.updateConditions({ start, end })
    autoRunIfValid()
  }
}

function handleGranularity(value) {
  store.updateConditions({ granularity: value })
  autoRunIfValid()
}

function handleStatuses(values) {
  store.updateConditions({ statuses: values })
  autoRunIfValid()
}

function handleCategories(values) {
  store.updateConditions({ categoryIds: values })
  autoRunIfValid()
}

// 条件变化后：仅当区间合法才重新计算；图表与明细随后基于同一份新结果刷新
function autoRunIfValid() {
  if (!store.isInvalidRange) store.runReport()
}

function handleRetry() {
  store.runReport()
}

function handleReset() {
  store.resetConditions()
  dateRange.value = [store.conditions.start, store.conditions.end]
  activePreset.value = calcPreset(store.conditions)
  store.runReport()
}

function drillMetric(metric) {
  store.setDrill({ type: 'metric', metric })
}

function handleChartDrill(drill) {
  if (drill) store.setDrill(drill)
}

function statusColor(status) {
  return { borrowed: 'processing', returned: 'success', overdue: 'error' }[status] || 'default'
}

function statusText(status) {
  return { borrowed: '借阅中', returned: '已归还', overdue: '已逾期' }[status] || status
}

function isLateReturn(record) {
  return record.returnDate && record.dueDate && record.returnDate > record.dueDate
}

// 与统计口径一致的“区间内逾期”判定，用于明细行提示
function isOverdueEvent(record) {
  if (!store.report) return false
  const { start, end } = store.conditions
  if (record.status === 'overdue' && record.dueDate >= start && record.dueDate <= end) return true
  if (isLateReturn(record) && record.dueDate >= start && record.dueDate <= end) return true
  return false
}

function badgeStatus(level) {
  return { error: 'error', warning: 'warning', info: 'processing' }[level] || 'default'
}

function levelColor(level) {
  return { error: 'error', warning: 'warning', info: 'blue' }[level] || 'default'
}

function levelText(level) {
  return { error: '高', warning: '中', info: '提示' }[level] || '提示'
}

// 环比变化标签（内联小组件）
const CompareTag = {
  props: {
    delta: { type: Object, required: true },
    invert: { type: Boolean, default: false }
  },
  setup(props) {
    return () => {
      const { percent, direction } = props.delta
      // 逾期指标上升为负面，颜色反转
      const isBad = props.invert ? direction === 'up' : direction === 'down'
      const isGood = props.invert ? direction === 'down' : direction === 'up'
      const cls = direction === 'flat' ? 'flat' : isBad ? 'bad' : isGood ? 'good' : 'flat'
      const icon = direction === 'up'
        ? h(ArrowUpOutlined)
        : direction === 'down'
          ? h(ArrowDownOutlined)
          : h(MinusOutlined)
      const text = direction === 'flat' ? '持平' : `${Math.abs(percent)}%`
      return h('span', { class: ['compare-tag', cls] }, [icon, text])
    }
  }
}

// 首次进入：按已持久化条件直接生成，图表与明细一进来即对应同一条件
onMounted(() => {
  if (!store.isInvalidRange) store.runReport()
})

// 离开页面中断尚未完成的模拟加载，避免落地旧结果
onBeforeUnmount(() => {
  store.abortLoad()
})
</script>

<style lang="less" scoped>
@primary: #1890ff;
@success: #52c41a;
@warning: #faad14;
@danger: #ff4d4f;

.circulation-report {
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 0;
    }
  }
}

.filter-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #f0f0f0;
  padding: 16px 20px;
  margin-bottom: 16px;

  .filter-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;

    .field-label {
      font-size: 12px;
      color: #999;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
  }

  .filter-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px dashed #f0f0f0;
    flex-wrap: wrap;

    .filter-meta {
      flex: 1;
      min-width: 240px;

      .range-alert { margin: 0; }

      .generated-at {
        font-size: 12px;
        color: #bbb;
      }
    }
  }
}

.status-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

.empty-block {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  padding: 64px 0;
  margin-bottom: 16px;
}

.stat-row {
  margin-bottom: 16px;
}

.metric-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  border-top: 3px solid @primary;
  padding: 16px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  height: 100%;
  transition: all 0.25s ease;

  &:hover {
    box-shadow: 0 6px 20px rgba(24, 144, 255, 0.16);
    transform: translateY(-2px);

    .metric-action { color: @primary; }
  }

  &.returned { border-top-color: @success; }
  &.overdue { border-top-color: @danger; }
  &.rate {
    border-top-color: #722ed1;
    cursor: default;
    &:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      transform: none;
    }
  }

  .metric-top {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .metric-label {
      font-size: 13px;
      color: #999;
    }

    .metric-action {
      color: #bfbfbf;
      transition: color 0.2s;
    }
  }

  .metric-value {
    font-size: 30px;
    font-weight: 700;
    color: #1a1a1a;
    line-height: 1.3;
    margin: 4px 0 8px;

    &.dual {
      font-size: 24px;
      display: flex;
      align-items: baseline;
      gap: 6px;

      .rate-overdue { color: @danger; }
      .rate-sep { color: #d9d9d9; font-size: 18px; }
      .rate-return { color: @success; }
    }
  }

  .metric-compare {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;

    .compare-hint {
      font-size: 12px;
      color: #bbb;
    }

    .rate-note {
      font-size: 11px;
      color: #bbb;
      line-height: 1.5;
    }
  }
}

.compare-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  line-height: 18px;

  &.good { background: #f6ffed; color: @success; }
  &.bad { background: #fff2f0; color: @danger; }
  &.flat { background: #f5f5f5; color: #999; }
}

.chart-card,
.anomaly-card,
.detail-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 16px 20px;
  margin-bottom: 16px;
  height: 100%;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 16px;
  flex-wrap: wrap;

  .title-sub {
    font-size: 12px;
    font-weight: 400;
    color: #999;

    &.muted { color: #bbb; }
  }

  .anomaly-title-icon { color: @warning; }
}

.anomaly-empty {
  margin: 8px 0;

  :deep(.ant-empty-description) {
    font-size: 13px;
  }
}

.anomaly-item {
  align-items: flex-start !important;

  .anomaly-name {
    font-weight: 600;
    color: #1a1a1a;
    font-size: 13px;
  }

  :deep(.ant-list-item-meta-description) {
    font-size: 13px;
    color: #666;
  }
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;

  .card-title { margin-bottom: 12px; }
}

.cell-primary {
  font-weight: 500;
  color: #1a1a1a;
}

.cell-secondary {
  font-size: 12px;
  color: #999;
}

.date-line {
  font-size: 12px;
  color: #666;
  line-height: 18px;

  &.date-late {
    color: @danger;
    font-weight: 500;
  }
}

.mini-tag {
  font-size: 11px;
  line-height: 16px;
  padding: 0 4px;
  margin-inline-end: 0;
}
</style>
