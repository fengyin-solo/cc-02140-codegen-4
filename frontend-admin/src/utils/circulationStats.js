// ========================================
// 流通分析报表 - 纯函数统计引擎
// 所有计算均为只读：不修改借阅记录、图书、分类等任何入参数据
// ========================================
import dayjs from 'dayjs'

// 已删除分类（或图书已删除导致分类无法解析）的虚拟分类 id
export const DELETED_CATEGORY_ID = '__deleted_category__'

const DATE_FMT = 'YYYY-MM-DD'

// ----------------------------------------
// 数据补全：为每条借阅记录解析当前分类信息
// 分类被删除 / 图书被删除时归入“已删除分类”，不丢弃记录
// ----------------------------------------
export function enrichRecords(records, books, categories) {
  return records.map(record => {
    const book = books.find(b => b.id === record.bookId)
    let categoryId = null
    let categoryName = '未分类'
    let categoryDeleted = false

    if (book) {
      const category = categories.find(c => c.id === book.categoryId)
      if (category) {
        categoryId = category.id
        categoryName = category.name
      } else {
        categoryId = DELETED_CATEGORY_ID
        categoryName = `已删除分类（原：${book.categoryName || '未知分类'}）`
        categoryDeleted = true
      }
    } else {
      categoryId = DELETED_CATEGORY_ID
      categoryName = '图书已删除（分类不可考）'
      categoryDeleted = true
    }

    return { ...record, categoryId, categoryName, categoryDeleted }
  })
}

// ----------------------------------------
// 区间工具
// ----------------------------------------
export function getEffectiveRange(startDate, endDate, records = []) {
  let start = startDate
  let end = endDate
  if (!start || !end) {
    const dates = records.map(r => r.borrowDate).filter(Boolean).sort()
    start = start || dates[0] || dayjs().format(DATE_FMT)
    end = end || dates[dates.length - 1] || dayjs().format(DATE_FMT)
  }
  return { startDate: start, endDate: end }
}

export function isRangeReversed(startDate, endDate) {
  return !!(startDate && endDate && dayjs(startDate).isAfter(dayjs(endDate), 'day'))
}

function inRange(date, startDate, endDate) {
  return !!date && date >= startDate && date <= endDate
}

export function matchCategory(record, categoryIds) {
  if (!categoryIds || categoryIds.length === 0) return true
  if (categoryIds.includes(DELETED_CATEGORY_ID)) return record.categoryDeleted
  return categoryIds.includes(record.categoryId)
}

// ----------------------------------------
// 趋势分桶：<=45 天按日，<=180 天按周，更长按月
// ----------------------------------------
export function chooseGranularity(startDate, endDate) {
  const days = dayjs(endDate).diff(dayjs(startDate), 'day') + 1
  if (days <= 45) return 'day'
  if (days <= 180) return 'week'
  return 'month'
}

function bucketStartOf(d, granularity) {
  if (granularity === 'day') return d.startOf('day')
  if (granularity === 'month') return d.startOf('month')
  // 周一为一周起点（手动计算，避免引入 isoWeek 插件）
  const weekday = d.day()
  return d.subtract(weekday === 0 ? 6 : weekday - 1, 'day').startOf('day')
}

function addBucket(d, granularity) {
  if (granularity === 'month') return d.add(1, 'month')
  return d.add(granularity === 'week' ? 7 : 1, 'day')
}

function bucketLabel(d, granularity) {
  if (granularity === 'day') return d.format('MM-DD')
  if (granularity === 'week') return `${d.format('MM/DD')} 周`
  return d.format('YYYY年MM月')
}

export function buildBuckets(startDate, endDate, granularity) {
  const buckets = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)
  let cursor = bucketStartOf(start, granularity)

  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const next = addBucket(cursor, granularity)
    const rawEnd = next.subtract(1, 'day')
    buckets.push({
      key: cursor.format(DATE_FMT),
      label: bucketLabel(cursor, granularity),
      start: cursor.isBefore(start) ? startDate : cursor.format(DATE_FMT),
      end: rawEnd.isAfter(end) ? endDate : rawEnd.format(DATE_FMT)
    })
    cursor = next
  }
  return buckets
}

function bucketIndexOf(date, buckets) {
  for (let i = 0; i < buckets.length; i += 1) {
    if (date >= buckets[i].start && date <= buckets[i].end) return i
  }
  return -1
}

// 逾期判定：未归还且已过应还日，或实际归还晚于应还日
function isEffectivelyOverdue(record, anchor) {
  if (record.returnDate) return record.returnDate > record.dueDate
  return record.dueDate < anchor
}

// ----------------------------------------
// 分类流向汇总
// ----------------------------------------
function buildCategoryFlow(borrowRecs, returnRecs, overdueRecs) {
  const map = new Map()

  const ensure = record => {
    if (!map.has(record.categoryId)) {
      map.set(record.categoryId, {
        categoryId: record.categoryId,
        categoryName: record.categoryName,
        categoryDeleted: record.categoryDeleted,
        borrowed: 0,
        returned: 0,
        overdue: 0,
        borrowIds: [],
        returnIds: [],
        overdueIds: []
      })
    }
    return map.get(record.categoryId)
  }

  borrowRecs.forEach(r => {
    const item = ensure(r)
    item.borrowed += 1
    item.borrowIds.push(r.id)
  })
  returnRecs.forEach(r => {
    const item = ensure(r)
    item.returned += 1
    item.returnIds.push(r.id)
  })
  overdueRecs.forEach(r => {
    const item = ensure(r)
    item.overdue += 1
    item.overdueIds.push(r.id)
  })

  return [...map.values()].sort((a, b) => b.borrowed - a.borrowed || b.overdue - a.overdue)
}

// ----------------------------------------
// 核心计算：按统计区间生成流通报表快照
// 快照是一份不可变（约定只读）的计算结果，图表与明细共享同一条件
// ----------------------------------------
export function computeCirculation(enrichedRecords, condition = {}) {
  const { startDate, endDate } = getEffectiveRange(
    condition.startDate,
    condition.endDate,
    enrichedRecords
  )
  const categoryIds = condition.categoryIds || []
  const granularity = chooseGranularity(startDate, endDate)
  // 统计锚点：区间结束日晚于今天时以今天为准（未来到期不算逾期）
  const anchor = dayjs(endDate).isAfter(dayjs(), 'day')
    ? dayjs().format(DATE_FMT)
    : endDate

  const inCategory = record => matchCategory(record, categoryIds)

  // 三套口径分别按各自的业务日期落入区间，保证“借出 / 归还 / 逾期”可比
  const borrowRecs = enrichedRecords.filter(
    r => inCategory(r) && inRange(r.borrowDate, startDate, endDate)
  )
  const returnRecs = enrichedRecords.filter(
    r => inCategory(r) && r.returnDate && inRange(r.returnDate, startDate, endDate)
  )
  const dueRecs = enrichedRecords.filter(
    r => inCategory(r) && inRange(r.dueDate, startDate, endDate)
  )
  const onTimeRecs = dueRecs.filter(r => r.returnDate && r.returnDate <= r.dueDate)
  const overdueRecs = dueRecs.filter(r => isEffectivelyOverdue(r, anchor))
  const pendingRecs = dueRecs.filter(
    r => !r.returnDate && r.dueDate >= anchor
  )
  const activeOverdueRecs = overdueRecs.filter(r => !r.returnDate)

  const buckets = buildBuckets(startDate, endDate, granularity)
  buckets.forEach(b => {
    b.borrowed = 0
    b.returned = 0
    b.overdue = 0
  })
  borrowRecs.forEach(r => {
    const i = bucketIndexOf(r.borrowDate, buckets)
    if (i >= 0) buckets[i].borrowed += 1
  })
  returnRecs.forEach(r => {
    const i = bucketIndexOf(r.returnDate, buckets)
    if (i >= 0) buckets[i].returned += 1
  })
  overdueRecs.forEach(r => {
    const i = bucketIndexOf(r.dueDate, buckets)
    if (i >= 0) buckets[i].overdue += 1
  })

  // 上一等长统计区间，用于趋势对比
  const length = dayjs(endDate).diff(dayjs(startDate), 'day') + 1
  const prevEnd = dayjs(startDate).subtract(1, 'day')
  const prevStart = prevEnd.subtract(length - 1, 'day')
  const prevBorrow = enrichedRecords.filter(
    r => inCategory(r) && inRange(r.borrowDate, prevStart.format(DATE_FMT), prevEnd.format(DATE_FMT))
  )
  const prevReturn = enrichedRecords.filter(
    r => inCategory(r) && r.returnDate && inRange(r.returnDate, prevStart.format(DATE_FMT), prevEnd.format(DATE_FMT))
  )
  const prevOverdue = enrichedRecords.filter(
    r => inCategory(r)
      && inRange(r.dueDate, prevStart.format(DATE_FMT), prevEnd.format(DATE_FMT))
      && isEffectivelyOverdue(r, prevEnd.format(DATE_FMT))
  )
  const prevBuckets = buildBuckets(prevStart.format(DATE_FMT), prevEnd.format(DATE_FMT), granularity)
  const prevBorrowedSeries = prevBuckets.map(() => 0)
  const prevReturnedSeries = prevBuckets.map(() => 0)
  prevBorrow.forEach(r => {
    const i = bucketIndexOf(r.borrowDate, prevBuckets)
    if (i >= 0) prevBorrowedSeries[i] += 1
  })
  prevReturn.forEach(r => {
    const i = bucketIndexOf(r.returnDate, prevBuckets)
    if (i >= 0) prevReturnedSeries[i] += 1
  })

  const dueTotal = dueRecs.length
  const totalBorrow = borrowRecs.length
  const totalReturn = returnRecs.length
  const totalOverdue = overdueRecs.length

  const loanDaysList = returnRecs
    .map(r => dayjs(r.returnDate).diff(dayjs(r.borrowDate), 'day'))
  const avgLoanDays = loanDaysList.length
    ? Math.round((loanDaysList.reduce((s, n) => s + n, 0) / loanDaysList.length) * 10) / 10
    : 0

  let peakBucket = null
  buckets.forEach(b => {
    if (!peakBucket || b.borrowed > peakBucket.borrowed) peakBucket = b
  })

  const summary = {
    totalBorrow,
    totalReturn,
    dueTotal,
    onTime: onTimeRecs.length,
    overdue: totalOverdue,
    activeOverdue: activeOverdueRecs.length,
    pending: pendingRecs.length,
    returnRate: dueTotal ? Math.round((onTimeRecs.length / dueTotal) * 1000) / 10 : 0,
    overdueRate: dueTotal ? Math.round((totalOverdue / dueTotal) * 1000) / 10 : 0,
    avgLoanDays,
    renewCount: borrowRecs.reduce((s, r) => s + (r.renewCount || 0), 0),
    peakBucket
  }

  const prevSummary = {
    totalBorrow: prevBorrow.length,
    totalReturn: prevReturn.length,
    overdue: prevOverdue.length
  }

  const categoryFlow = buildCategoryFlow(borrowRecs, returnRecs, overdueRecs)

  // ---------------- 异常点检测 ----------------
  const anomalies = []
  const drillOf = list => list.map(r => r.id)

  // 1. 当前仍有逾期未还（最高优先级）
  if (activeOverdueRecs.length > 0) {
    const detail = activeOverdueRecs
      .map(r => ({
        id: r.id,
        days: dayjs(anchor).diff(dayjs(r.dueDate), 'day')
      }))
      .sort((a, b) => b.days - a.days)
    anomalies.push({
      type: 'overdue',
      level: 'error',
      title: `区间内 ${activeOverdueRecs.length} 笔借阅逾期未还`,
      desc: `最长逾期 ${detail[0].days} 天（${detail[0].days >= 30 ? '建议立即催还' : '请跟进归还进度'}）`,
      drill: { tab: 'overdue', ids: drillOf(activeOverdueRecs) }
    })
  }

  // 2. 借出过峰（均值 + 2 倍标准差，且不少于 3 笔）
  const counts = buckets.map(b => b.borrowed)
  const mean = counts.length ? counts.reduce((s, n) => s + n, 0) / counts.length : 0
  const variance = counts.length
    ? counts.reduce((s, n) => s + (n - mean) ** 2, 0) / counts.length
    : 0
  const std = Math.sqrt(variance)
  const threshold = Math.max(3, mean + 2 * std)
  const spikes = buckets.filter(b => b.borrowed >= threshold)
  spikes.forEach(b => {
    const ids = drillOf(
      borrowRecs.filter(r => r.borrowDate >= b.start && r.borrowDate <= b.end)
    )
    anomalies.push({
      type: 'spike',
      level: 'warning',
      title: `借出高峰：${b.label} 借出 ${b.borrowed} 笔`,
      desc: `显著高于区间均值（${mean.toFixed(1)} 笔/${granularity === 'day' ? '日' : granularity === 'week' ? '周' : '月'}）`,
      drill: { tab: 'borrow', ids }
    })
  })

  // 3. 零借出时间段（区间内有其他借出时才有提示意义）
  if (totalBorrow > 0) {
    const zeroBuckets = buckets.filter(b => b.borrowed === 0)
    if (zeroBuckets.length > 0) {
      const first = zeroBuckets[0]
      const last = zeroBuckets[zeroBuckets.length - 1]
      const span = first.key === last.key ? first.label : `${first.label} ~ ${last.label}`
      anomalies.push({
        type: 'zero',
        level: 'info',
        title: `${zeroBuckets.length} 个时间段零借出`,
        desc: `集中在 ${span}，可关注借阅空档期`,
        drill: {
          tab: 'borrow',
          ids: drillOf(borrowRecs.filter(() => false))
        },
        emptyDrill: true,
        zeroBucketKeys: zeroBuckets.map(b => b.key)
      })
    }
  }

  // 4. 逾期率偏高
  if (dueTotal >= 3 && summary.overdueRate >= 30) {
    anomalies.push({
      type: 'rate',
      level: 'warning',
      title: `逾期率 ${summary.overdueRate}% 偏高`,
      desc: `区间到期 ${dueTotal} 笔，其中 ${totalOverdue} 笔逾期`,
      drill: { tab: 'overdue', ids: drillOf(overdueRecs) }
    })
  }

  // 5. 分类流向高度集中
  if (totalBorrow > 0 && categoryFlow.length > 0) {
    const top = categoryFlow[0]
    const share = Math.round((top.borrowed / totalBorrow) * 100)
    if (share >= 60) {
      anomalies.push({
        type: 'concentration',
        level: 'info',
        title: `分类流向集中：${top.categoryName} 占 ${share}%`,
        desc: `区间借出 ${top.borrowed}/${totalBorrow} 笔流向该分类`,
        drill: { tab: 'borrow', ids: top.borrowIds }
      })
    }
  }

  // 6. 分类（或图书）已被删除，历史记录仍参与统计
  const deletedRecs = borrowRecs.filter(r => r.categoryDeleted)
  if (deletedRecs.length > 0) {
    anomalies.push({
      type: 'deleted',
      level: 'warning',
      title: `${deletedRecs.length} 笔记录关联的分类/图书已删除`,
      desc: '记录未被丢弃，统一归入“已删除分类”参与统计',
      drill: { tab: 'borrow', ids: drillOf(deletedRecs) }
    })
  }

  return {
    generatedAt: Date.now(),
    condition: {
      startDate,
      endDate,
      categoryIds: [...categoryIds]
    },
    granularity,
    anchor,
    buckets,
    prevRange: {
      startDate: prevStart.format(DATE_FMT),
      endDate: prevEnd.format(DATE_FMT)
    },
    prevBorrowedSeries,
    prevReturnedSeries,
    summary,
    prevSummary,
    categoryFlow,
    anomalies,
    records: {
      borrow: borrowRecs,
      returned: returnRecs,
      overdue: overdueRecs
    }
  }
}
