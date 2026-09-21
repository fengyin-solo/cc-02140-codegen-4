import { defineStore } from 'pinia'
import { ref } from 'vue'
import dayjs from 'dayjs'
import { useBorrowStore } from './borrow'
import { useBookStore } from './book'
import { useCategoryStore } from './category'
import {
  computeCirculation,
  enrichRecords,
  isRangeReversed
} from '@/utils/circulationStats'

// 模拟后端统计耗时；加载中断/快速切换区间时通过令牌丢弃过期结果
const COMPUTE_DELAY = 450

export const useReportStore = defineStore('report', () => {
  // 当前筛选条件（任何异常路径下都保留，不被计算结果改写）
  const condition = ref({
    preset: 'all',
    startDate: null,
    endDate: null,
    categoryIds: []
  })

  // 最近一次成功计算的报表快照；null 表示尚未成功生成
  const snapshot = ref(null)
  const loading = ref(false)
  const interrupted = ref(false)
  const error = ref('')
  const lastUpdated = ref(null)

  let loadToken = 0

  // ----------------------------------------
  // 区间预设（仅设置条件，不直接清空结果）
  // ----------------------------------------
  const PRESETS = {
    '7d': () => ({
      preset: '7d',
      startDate: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
      endDate: dayjs().format('YYYY-MM-DD')
    }),
    '30d': () => ({
      preset: '30d',
      startDate: dayjs().subtract(29, 'day').format('YYYY-MM-DD'),
      endDate: dayjs().format('YYYY-MM-DD')
    }),
    month: () => ({
      preset: 'month',
      startDate: dayjs().startOf('month').format('YYYY-MM-DD'),
      endDate: dayjs().endOf('month').format('YYYY-MM-DD')
    }),
    all: () => ({ preset: 'all', startDate: null, endDate: null })
  }

  function applyPreset(key) {
    const patch = PRESETS[key] ? PRESETS[key]() : PRESETS.all()
    condition.value = {
      ...condition.value,
      ...patch
    }
  }

  // 自定义区间：保留用户输入（含反向区间），由 loadReport 拒绝计算
  function setCustomRange(startDate, endDate) {
    condition.value = {
      ...condition.value,
      preset: 'custom',
      startDate: startDate || null,
      endDate: endDate || null
    }
  }

  function setCategoryIds(ids) {
    condition.value = {
      ...condition.value,
      categoryIds: ids || []
    }
  }

  function resetCondition() {
    condition.value = {
      preset: 'all',
      startDate: null,
      endDate: null,
      categoryIds: []
    }
  }

  // 主动中断：保留当前条件与上一份可用快照
  function cancelLoad() {
    if (loading.value) {
      loadToken += 1
      loading.value = false
      interrupted.value = true
      error.value = ''
    }
  }

  // ----------------------------------------
  // 生成报表：只读联动借阅 / 图书 / 分类数据
  // 任何情况下都不修改源数据，仅产出独立快照
  // ----------------------------------------
  async function loadReport() {
    const { startDate, endDate } = condition.value

    // 日期反向：保留条件，拒绝计算，不清空已有快照
    if (isRangeReversed(startDate, endDate)) {
      loadToken += 1
      loading.value = false
      interrupted.value = false
      error.value = '日期反向：开始日期不能晚于结束日期'
      return { success: false, reason: 'reversed' }
    }

    const token = loadToken + 1
    loadToken = token
    loading.value = true
    interrupted.value = false
    error.value = ''

    try {
      // 浅拷贝源数据快照，确保异步计算期间不被页面上的归还/借阅操作干扰
      const borrowStore = useBorrowStore()
      const bookStore = useBookStore()
      const categoryStore = useCategoryStore()

      const recordsCopy = borrowStore.records.map(r => ({ ...r }))
      const booksCopy = bookStore.books.map(b => ({ ...b }))
      const categoriesCopy = categoryStore.categories.map(c => ({ ...c }))

      await new Promise(resolve => setTimeout(resolve, COMPUTE_DELAY))

      // 加载中断 / 已被新的区间请求取代：保留当前条件
      if (token !== loadToken) {
        return { success: false, reason: 'interrupted' }
      }

      const enriched = enrichRecords(recordsCopy, booksCopy, categoriesCopy)
      const result = computeCirculation(enriched, {
        startDate,
        endDate,
        categoryIds: condition.value.categoryIds
      })

      snapshot.value = result
      lastUpdated.value = new Date()
      loading.value = false
      return { success: true, empty: result.summary.totalBorrow === 0 }
    } catch (e) {
      if (token !== loadToken) {
        return { success: false, reason: 'interrupted' }
      }
      loading.value = false
      error.value = '报表计算失败，请重试'
      return { success: false, reason: 'error', message: e?.message }
    }
  }

  return {
    condition,
    snapshot,
    loading,
    interrupted,
    error,
    lastUpdated,
    applyPreset,
    setCustomRange,
    setCategoryIds,
    resetCondition,
    loadReport,
    cancelLoad
  }
})
