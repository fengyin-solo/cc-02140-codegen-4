import dayjs from 'dayjs'

// ========================================
// 流通分析报表 - 纯函数统计计算模块
// 所有函数均为只读：接收数据快照，不修改借阅记录 / 运营概览 / 分类等原始数据
// ======================================

// 已删除分类 / 已删除图书（分类流向无法归属时的兜底分组）
export const DELETED_CATEGORY_KEY = '__deleted__'
export const DELETED_CATEGORY_NAME = '已删除/未知分类'

const CATEGORY_COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa541c', '#2f54eb',
  '#a0d911', '#08979c'
]

export function getCategoryColor(index, key) {
  if (key === DELETED_CATEGORY_KEY) return '#ff4d4f'
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}

// 深拷贝借阅快照，保证后续富化过程不触碰 store 原数据
export function snapshotRecords(records) {
  return records.map(r => ({ ...r }))
}

// 为记录补全分类信息：优先借阅记录自带，其次图书，其次分类表；找不到归入“已删除/未知”
export function enrichRecords(records, books, categories) {
  return records.map(record => {
    const book = books.find(b => b.id === record.bookId)
    const categoryId = book?.categoryId ?? record.categoryId ?? null
    const category = categoryId != null
      ? categories.find(c => c.id === categoryId)
      : null
    const categoryName = category?.name
      || book?.categoryName
      || record.categoryName
      || DELETED_CATEGORY_NAME

    return {
      ...record,
      resolvedCategoryId: category ? category.id : (categoryId ?? DELETED_CATEGORY_KEY),
      resolvedCategoryName: categoryName,
      categoryDeleted: !category,
      bookDeleted: !book
    }
  })
}

// 时间粒度对应的步进单位
function stepUnit(granularity) {
  if (granularity === 'month') return 'month'
  if (granularity === 'week') return 'week'
  return 'day'
}

// 生成区间内的时间桶
export function buildBuckets(start, end, granularity) {
  const buckets = []
  let cursor = dayjs(start).startOf('day')
  const endDay = dayjs(end).startOf('day')
  const unit = stepUnit(granularity)

  while (cursor.isBefore(endDay) || cursor.isSame(endDay, 'day')) {
    const bucketStart = cursor
    const next = cursor.add(1, unit)
    const bucketEnd = next.isAfter(endDay) ? endDay : next.subtract(1, 'day')
    let label
    if (granularity === 'month') {
      label = cursor.format('YYYY-MM')
    } else if (granularity === 'week') {
      const sameYear = cursor.year() === endDay.year()
      label = sameYear
        ? `${cursor.format('MM/DD')} 周`
        : `${cursor.format('YY/MM/DD')} 周`
    } else {
      const sameYear = cursor.year() === endDay.year()
      label = sameYear ? cursor.format('MM-DD') : cursor.format('YYYY-MM-DD')
    }
    buckets.push({
      key: cursor.format('YYYY-MM-DD'),
      label,
      start: bucketStart.format('YYYY-MM-DD'),
      end: bucketEnd.format('YYYY-MM-DD'),
      borrowCount: 0,
      returnCount: 0,
      overdueCount: 0
    })
    cursor = next
  }
  return buckets
}

// 判断日期字符串是否位于 [start, end]
function inRange(date, start, end) {
  return !!date && date >= start && date <= end
}

// 判断记录在当前区间是否已构成“逾期事件”：
// 1) 仍处逾期状态（未归还且越过应还日期），应还日落入区间
// 2) 已归还但归还日期晚于应还日期（区间内曾发生逾期归还）
function getOverdueEventDate(record, start, end) {
  if (record.status === 'overdue' && inRange(record.dueDate, start, end)) {
    return record.dueDate
  }
  if (record.returnDate && record.dueDate && record.returnDate > record.dueDate) {
    if (inRange(record.dueDate, start, end)) return record.dueDate
  }
  return null
}

// 按条件过滤事件（分类 / 状态），并产出三类事件流
function buildEvents(records, start, end, categoryIds, statuses) {
  const borrowEvents = []
  const returnEvents = []
  const overdueEvents = []

  records.forEach(record => {
    if (categoryIds.length && !categoryIds.includes(record.resolvedCategoryId)) return
    if (statuses.length && !statuses.includes(record.status)) return

    const recordEvents = []

    if (inRange(record.borrowDate, start, end)) {
      const event = { date: record.borrowDate, record, type: 'borrow' }
      borrowEvents.push(event)
      recordEvents.push(event)
    }
    if (inRange(record.returnDate, start, end)) {
      const event = { date: record.returnDate, record, type: 'return' }
      returnEvents.push(event)
      recordEvents.push(event)
    }
    const overdueDate = getOverdueEventDate(record, start, end)
    if (overdueDate) {
      const event = { date: overdueDate, record, type: 'overdue' }
      overdueEvents.push(event)
      recordEvents.push(event)
    }

    record.__events = recordEvents
  })

  return { borrowEvents, returnEvents, overdueEvents }
}

// 核心聚合：事件 -> 时间桶 + 分类流向 + 汇总
function aggregate(records, start, end, granularity, categoryIds, statuses) {
  const buckets = buildBuckets(start, end, granularity)
  const bucketIndex = new Map(buckets.map(b => [b.key, b]))
  const unit = stepUnit(granularity)

  // 与 buildBuckets 相同的“锚定”规则：事件归属到从区间起点步进得到的桶
  const assignBucket = date => {
    const d = dayjs(date).startOf('day')
    const anchor = dayjs(start).startOf('day')
    let key
    if (granularity === 'month') {
      key = anchor.add(diffMonths(anchor, d), 'month')
    } else if (granularity === 'week') {
      key = anchor.add(Math.floor(d.diff(anchor, 'day', true) / 7), 'week')
    } else {
      key = d
    }
    return bucketIndex.get(key.format('YYYY-MM-DD'))
  }

  const { borrowEvents, returnEvents, overdueEvents } = buildEvents(
    records, start, end, categoryIds, statuses
  )

  borrowEvents.forEach(e => {
    const bucket = assignBucket(e.date)
    if (bucket) {
      bucket.borrowCount += 1
      bucket.borrowEvents = bucket.borrowEvents || []
      bucket.borrowEvents.push(e)
    }
  })
  returnEvents.forEach(e => {
    const bucket = assignBucket(e.date)
    if (bucket) {
      bucket.returnCount += 1
      bucket.returnEvents = bucket.returnEvents || []
      bucket.returnEvents.push(e)
    }
  })
  overdueEvents.forEach(e => {
    const bucket = assignBucket(e.date)
    if (bucket) {
      bucket.overdueCount += 1
      bucket.overdueEvents = bucket.overdueEvents || []
      bucket.overdueEvents.push(e)
    }
  })

  // 分类流向聚合
  const categoryMap = new Map()
  const pushCategory = (event) => {
    const record = event.record
    const key = record.resolvedCategoryId
    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        key,
        name: record.resolvedCategoryName,
        deleted: record.categoryDeleted,
        borrowCount: 0,
        returnCount: 0,
        overdueCount: 0,
        events: []
      })
    }
    const item = categoryMap.get(key)
    item.events.push(event)
    if (event.type === 'borrow') item.borrowCount += 1
    else if (event.type === 'return') item.returnCount += 1
    else item.overdueCount += 1
  }
  borrowEvents.forEach(pushCategory)
  returnEvents.forEach(pushCategory)
  overdueEvents.forEach(pushCategory)

  const categories = [...categoryMap.values()]
    .map(c => ({ ...c, total: c.borrowCount + c.returnCount + c.overdueCount }))
    .sort((a, b) => b.total - a.total)
    .map((c, index) => ({ ...c, color: getCategoryColor(index, c.key) }))

  const totalBorrow = borrowEvents.length
  const totalReturn = returnEvents.length
  const totalOverdue = overdueEvents.length
  const overdueRate = (totalReturn + totalOverdue) > 0
    ? Math.round((totalOverdue / (totalReturn + totalOverdue)) * 1000) / 10
    : 0
  const returnRate = totalBorrow > 0
    ? Math.round((totalReturn / totalBorrow) * 1000) / 10
    : 0

  return {
    buckets,
    categories,
    events: { borrowEvents, returnEvents, overdueEvents },
    totals: { totalBorrow, totalReturn, totalOverdue, overdueRate, returnRate }
  }
}

// 月份差（用于月桶锚定）
function diffMonths(from, to) {
  return (to.year() - from.year()) * 12 + (to.month() - from.month())
}

// 环比：取紧邻当前区间之前、等长的一段区间
function previousRange(start, end) {
  const s = dayjs(start)
  const e = dayjs(end)
  const days = e.diff(s, 'day') + 1
  const prevEnd = s.subtract(1, 'day')
  const prevStart = prevEnd.subtract(days - 1, 'day')
  return { start: prevStart.format('YYYY-MM-DD'), end: prevEnd.format('YYYY-MM-DD') }
}

// 环比变化百分比
export function deltaPercent(current, previous) {
  if (previous === 0 && current === 0) return { value: 0, percent: 0, direction: 'flat' }
  if (previous === 0) return { value: current - previous, percent: 100, direction: 'up' }
  const percent = Math.round(((current - previous) / previous) * 1000) / 10
  return {
    value: current - previous,
    percent,
    direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
  }
}

function median(nums) {
  if (!nums.length) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// 异常点检测（确定性规则，全部可解释、可钻取）
function detectAnomalies(agg) {
  const anomalies = []
  const { buckets, categories, totals } = agg

  // 规则 1：借阅峰值 —— 显著高于其他时间桶
  if (buckets.length >= 3) {
    const borrowVals = buckets.map(b => b.borrowCount)
    const max = Math.max(...borrowVals)
    if (max >= 2) {
      const peakIndex = borrowVals.indexOf(max)
      const others = borrowVals.filter((_, i) => i !== peakIndex)
      const med = median(others)
      if (max >= med * 2 && max > med + 1) {
        const bucket = buckets[peakIndex]
        anomalies.push({
          id: 'peak-borrow',
          level: 'info',
          title: '借阅峰值',
          message: `${bucket.label} 借阅 ${max} 次，明显高于其他区间（中位数约 ${formatNum(med)} 次/桶），可关注是否存在集中借阅活动。`,
          drill: { type: 'bucket', metric: 'borrow', bucketKey: bucket.key }
        })
      }
    }
  }

  // 规则 2：流通断档 —— 区间中部出现空桶（前后均有流通）
  const hasFlow = buckets.map(b => b.borrowCount + b.returnCount + b.overdueCount > 0)
  const firstActive = hasFlow.indexOf(true)
  const lastActive = hasFlow.lastIndexOf(true)
  if (firstActive !== -1 && lastActive - firstActive >= 3) {
    const gapBuckets = []
    for (let i = firstActive + 1; i < lastActive; i++) {
      if (!hasFlow[i]) gapBuckets.push(buckets[i])
    }
    if (gapBuckets.length >= 2) {
      anomalies.push({
        id: 'flow-gap',
        level: 'warning',
        title: '流通断档',
        message: `${gapBuckets[0].label} 至 ${gapBuckets[gapBuckets.length - 1].label} 连续 ${gapBuckets.length} 个统计周期无借出/归还/逾期记录，请确认数据是否缺失或流通停滞。`,
        drill: {
          type: 'bucketRange',
          startKey: gapBuckets[0].key,
          endKey: gapBuckets[gapBuckets.length - 1].key
        }
      })
    }
  }

  // 规则 3：逾期率异常桶
  if (buckets.length >= 2) {
    const target = buckets
      .map(b => {
        const settled = b.returnCount + b.overdueCount
        return {
          bucket: b,
          settled,
          rate: settled > 0 ? b.overdueCount / settled : 0
        }
      })
      .filter(x => x.settled >= 2)
    const found = target.find(x =>
      x.rate >= 0.6 && (totals.overdueRate / 100) + 0.3 <= x.rate
    )
    if (found) {
      anomalies.push({
        id: 'overdue-spike',
        level: 'error',
        title: '逾期率偏高',
        message: `${found.bucket.label} 逾期 ${found.bucket.overdueCount} 笔、归还 ${found.bucket.returnCount} 笔，桶内逾期率 ${Math.round(found.rate * 1000) / 10}%，显著高于全区间 ${totals.overdueRate}%。`,
        drill: { type: 'bucket', metric: 'overdue', bucketKey: found.bucket.key }
      })
    }
  }

  // 规则 4：分类被删除但仍有流向
  const deleted = categories.find(c => c.key === DELETED_CATEGORY_KEY)
  if (deleted && deleted.total > 0) {
    anomalies.push({
      id: 'deleted-category',
      level: 'warning',
      title: '分类已删除',
      message: `有 ${deleted.total} 笔流通记录的分类已被删除（涉及借出 ${deleted.borrowCount}、归还 ${deleted.returnCount}、逾期 ${deleted.overdueCount}），已归入“${DELETED_CATEGORY_NAME}”，建议核对书目分类。`,
      drill: { type: 'category', categoryKey: DELETED_CATEGORY_KEY }
    })
  }

  return anomalies
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ========================================
// 入口：依据条件构建完整流通报表
// conditions: { start, end, granularity, categoryIds: [], statuses: [] }
// 返回结果携带快照记录，图表与明细共用同一结果，保证口径一致
// ========================================
export function buildCirculationReport(conditions, { records, books, categories }) {
  const start = conditions.start
  const end = conditions.end
  const granularity = conditions.granularity || 'day'
  const categoryIds = conditions.categoryIds || []
  const statuses = conditions.statuses || []

  const enriched = enrichRecords(snapshotRecords(records), books, categories)

  const current = aggregate(enriched, start, end, granularity, categoryIds, statuses)
  const prev = previousRange(start, end)
  const previous = aggregate(
    enriched, prev.start, prev.end, granularity, categoryIds, statuses
  )

  const comparison = {
    start: prev.start,
    end: prev.end,
    borrow: deltaPercent(current.totals.totalBorrow, previous.totals.totalBorrow),
    return: deltaPercent(current.totals.totalReturn, previous.totals.totalReturn),
    overdue: deltaPercent(current.totals.totalOverdue, previous.totals.totalOverdue)
  }

  const anomalies = detectAnomalies(current)

  // 清理聚合时挂在记录上的临时事件标记，保持明细快照干净
  enriched.forEach(r => { delete r.__events })

  return {
    conditions: { ...conditions, start, end, granularity },
    generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    snapshotRecords: enriched,
    totals: current.totals,
    buckets: current.buckets,
    categoryFlow: current.categories,
    previousBuckets: previous.buckets,
    previousTotals: previous.totals,
    comparison,
    anomalies
  }
}

// 明细钻取：依据 drill 条件过滤当前报表快照
export function filterDetailRecords(report, drill) {
  if (!drill || !drill.type) return report.snapshotRecords
  const { buckets, granularity } = report
  const unit = stepUnit(granularity)

  const eventMatchers = []
  let statusOnly = false

  switch (drill.type) {
    case 'metric': {
      // 汇总卡片：整个区间内的某类事件
      if (drill.metric === 'borrow') {
        eventMatchers.push(r => inRange(r.borrowDate, report.conditions.start, report.conditions.end))
      } else if (drill.metric === 'return') {
        eventMatchers.push(r => inRange(r.returnDate, report.conditions.start, report.conditions.end))
      } else if (drill.metric === 'overdue') {
        eventMatchers.push(r => !!getOverdueEventDate(r, report.conditions.start, report.conditions.end))
      }
      break
    }
    case 'bucket': {
      const bucket = buckets.find(b => b.key === drill.bucketKey)
      if (!bucket) return []
      if (drill.metric === 'borrow') eventMatchers.push(r => r.borrowDate >= bucket.start && r.borrowDate <= bucket.end)
      else if (drill.metric === 'return') eventMatchers.push(r => r.returnDate >= bucket.start && r.returnDate <= bucket.end)
      else if (drill.metric === 'overdue') eventMatchers.push(r => {
        const d = getOverdueEventDate(r, bucket.start, bucket.end)
        return !!d
      })
      else {
        // 点击时间桶（非具体序列）：任一事件落入桶内
        eventMatchers.push(r =>
          inRange(r.borrowDate, bucket.start, bucket.end) ||
          inRange(r.returnDate, bucket.start, bucket.end) ||
          !!getOverdueEventDate(r, bucket.start, bucket.end)
        )
      }
      break
    }
    case 'bucketRange': {
      const startBucket = buckets.find(b => b.key === drill.startKey)
      const endBucket = buckets.find(b => b.key === drill.endKey)
      if (!startBucket || !endBucket) return []
      const s = startBucket.start
      const e = endBucket.end
      eventMatchers.push(r =>
        inRange(r.borrowDate, s, e) ||
        inRange(r.returnDate, s, e) ||
        !!getOverdueEventDate(r, s, e)
      )
      break
    }
    case 'category': {
      eventMatchers.push(r => r.resolvedCategoryId === drill.categoryKey)
      // 分类钻取默认仍限定在当前区间内（与图表同一条件）
      const cs = report.conditions.start
      const ce = report.conditions.end
      const rangeLimit = r =>
        inRange(r.borrowDate, cs, ce) ||
        inRange(r.returnDate, cs, ce) ||
        !!getOverdueEventDate(r, cs, ce)
      const base = eventMatchers.pop()
      eventMatchers.push(r => base(r) && rangeLimit(r))
      if (drill.metric && drill.metric !== 'all') {
        const metricCheck = drill.metric === 'borrow'
          ? r => inRange(r.borrowDate, cs, ce)
          : drill.metric === 'return'
            ? r => inRange(r.returnDate, cs, ce)
            : r => !!getOverdueEventDate(r, cs, ce)
        const prev = eventMatchers.pop()
        eventMatchers.push(r => prev(r) && metricCheck(r))
      }
      break
    }
    case 'status': {
      statusOnly = true
      break
    }
  }

  return report.snapshotRecords.filter(r => {
    if (statusOnly) return r.status === drill.status
    return eventMatchers.some(matcher => matcher(r))
  })
}

// 生成钻取条件的人类可读描述
export function describeDrill(drill, report) {
  if (!drill || !drill.type) return ''
  const metricText = { borrow: '借出', return: '归还', overdue: '逾期' }
  switch (drill.type) {
    case 'metric':
      return `全区间 · ${metricText[drill.metric] || ''}明细`
    case 'bucket': {
      const bucket = report.buckets.find(b => b.key === drill.bucketKey)
      return drill.metric
        ? `${bucket?.label || ''} · ${metricText[drill.metric]}明细`
        : `${bucket?.label || ''} · 全部流通明细`
    }
    case 'bucketRange': {
      const s = report.buckets.find(b => b.key === drill.startKey)
      const e = report.buckets.find(b => b.key === drill.endKey)
      return `${s?.label || ''} ~ ${e?.label || ''} · 流通断档期`
    }
    case 'category': {
      const cat = report.categoryFlow.find(c => c.key === drill.categoryKey)
      const name = cat?.name || '已删除/未知分类'
      return drill.metric && drill.metric !== 'all'
        ? `分类「${name}」· ${metricText[drill.metric]}明细`
        : `分类「${name}」· 全部分类流向明细`
    }
    case 'status':
      return `状态「${drill.status === 'borrowed' ? '借阅中' : drill.status === 'returned' ? '已归还' : '已逾期'}」`
    default:
      return ''
  }
}
