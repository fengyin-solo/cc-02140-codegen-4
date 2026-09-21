import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { useBorrowStore } from '@/stores/borrow'
import { useBookStore } from '@/stores/book'
import { useCategoryStore } from '@/stores/category'
import {
  buildCirculationReport,
  filterDetailRecords,
  describeDrill
} from '@/utils/circulationStats'

// 仅持久化筛选条件（不含结果快照），切换页面后条件仍保留
const CONDITIONS_KEY = 'library_circulation_conditions'
const DRILL_KEY = 'library_circulation_drill'

// 模拟远端计算耗时
const CALC_LATENCY = 500

function defaultConditions() {
  // 默认覆盖全部既有数据：以最早/最晚借阅日期为界
  const borrowStore = useBorrowStore()
  const dates = borrowStore.records
    .map(r => r.borrowDate)
    .filter(Boolean)
    .sort()
  if (dates.length > 0) {
    return {
      start: dates[0],
      end: dates[dates.length - 1],
      granularity: 'week',
      categoryIds: [],
      statuses: []
    }
  }
  return {
    start: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
    end: dayjs().format('YYYY-MM-DD'),
    granularity: 'day',
    categoryIds: [],
    statuses: []
  }
}

function loadConditions() {
  try {
    const stored = localStorage.getItem(CONDITIONS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && parsed.start && parsed.end && parsed.granularity) {
        return {
          start: parsed.start,
          end: parsed.end,
          granularity: parsed.granularity,
          categoryIds: Array.isArray(parsed.categoryIds) ? parsed.categoryIds : [],
          statuses: Array.isArray(parsed.statuses) ? parsed.statuses : []
        }
      }
    }
  } catch (e) {
    console.warn('Failed to restore circulation conditions:', e)
  }
  return defaultConditions()
}

function loadDrill() {
  try {
    const stored = localStorage.getItem(DRILL_KEY)
    if (stored) return JSON.parse(stored)
  } catch (e) {
    console.warn('Failed to restore circulation drill:', e)
  }
  return null
}

export const useCirculationStore = defineStore('circulation', () => {
  // 筛选条件是唯一数据源；图表与明细都对同一份 report 结果渲染
  const conditions = ref(loadConditions())
  const drill = ref(loadDrill())
  const report = ref(null)
  const loading = ref(false)
  const error = ref('')
  const lastLoadedAt = ref('')

  // 加载序号：新条件发起的加载会使旧加载失效；可被显式中断
  let loadSeq = 0
  let loadTimer = null

  const hasResult = computed(() => !!report.value)
  const isEmpty = computed(() => {
    if (!report.value) return false
    const t = report.value.totals
    return t.totalBorrow + t.totalReturn + t.totalOverdue === 0
  })
  const isInvalidRange = computed(() => conditions.value.start > conditions.value.end)

  // 明细始终派生自当前已生成的 report，切换条件重新生成后自动一致
  const detailRecords = computed(() => {
    if (!report.value) return []
    return filterDetailRecords(report.value, drill.value)
  })

  const drillDescription = computed(() => {
    if (!report.value || !drill.value) return ''
    return describeDrill(drill.value, report.value)
  })

  function persistConditions() {
    localStorage.setItem(CONDITIONS_KEY, JSON.stringify(conditions.value))
  }

  function updateConditions(patch) {
    // 仅更新条件；不自动发起计算，由页面在合法时显式调用 runReport
    conditions.value = { ...conditions.value, ...patch }
    persistConditions()
  }

  function resetConditions() {
    conditions.value = defaultConditions()
    drill.value = null
    localStorage.removeItem(DRILL_KEY)
    persistConditions()
  }

  // 中断正在进行的加载：保留当前条件与上一次结果，仅提示加载被中断
  function abortLoad() {
    if (!loading.value) return
    clearTimeout(loadTimer)
    loadSeq += 1
    loading.value = false
    error.value = '统计计算加载中断，当前筛选条件已保留，可点击“重新计算”继续。'
  }

  // 依据当前条件重新计算；options.replace=true 时先丢弃旧结果（模拟重新进入）
  function runReport() {
    if (isInvalidRange.value) {
      error.value = ''
      return Promise.resolve()
    }

    clearTimeout(loadTimer)
    const seq = ++loadSeq
    loading.value = true
    error.value = ''

    return new Promise(resolve => {
      loadTimer = setTimeout(() => {
        // 序号过期：已被更新的条件加载或显式中断取代，静默丢弃
        if (seq !== loadSeq) {
          resolve()
          return
        }
        try {
          const borrowStore = useBorrowStore()
          const bookStore = useBookStore()
          const categoryStore = useCategoryStore()

          // 只读引用三个业务 store，计算过程中不调用任何写方法
          const result = buildCirculationReport(
            { ...conditions.value },
            {
              records: borrowStore.records,
              books: bookStore.books,
              categories: categoryStore.categories
            }
          )

          // 清理已失效的钻取（如被钻取的分类/时间桶在新条件下不存在）
          if (drill.value && !isDrillValid(drill.value, result)) {
            drill.value = null
            localStorage.removeItem(DRILL_KEY)
          }

          report.value = result
          lastLoadedAt.value = result.generatedAt
          loading.value = false
        } catch (e) {
          console.error('Circulation report failed:', e)
          loading.value = false
          // 加载失败同样保留条件，允许重试
          error.value = `报表计算失败：${e.message || '未知错误'}，当前条件已保留，请重试。`
        } finally {
          resolve()
        }
      }, CALC_LATENCY)
    })
  }

  // 重新计算（含错误重试），沿用当前条件
  function retry() {
    return runReport()
  }

  function setDrill(nextDrill) {
    drill.value = nextDrill
    if (nextDrill) {
      localStorage.setItem(DRILL_KEY, JSON.stringify(nextDrill))
    } else {
      localStorage.removeItem(DRILL_KEY)
    }
  }

  function clearDrill() {
    setDrill(null)
  }

  return {
    conditions,
    drill,
    report,
    loading,
    error,
    lastLoadedAt,
    hasResult,
    isEmpty,
    isInvalidRange,
    detailRecords,
    drillDescription,
    updateConditions,
    resetConditions,
    runReport,
    retry,
    abortLoad,
    setDrill,
    clearDrill
  }
})

// 校验旧钻取在新结果中仍可解释
function isDrillValid(drill, result) {
  switch (drill.type) {
    case 'bucket':
      return result.buckets.some(b => b.key === drill.bucketKey)
    case 'bucketRange':
      return result.buckets.some(b => b.key === drill.startKey)
        && result.buckets.some(b => b.key === drill.endKey)
    case 'category':
      return result.categoryFlow.some(c => c.key === drill.categoryKey)
    default:
      return true
  }
}
