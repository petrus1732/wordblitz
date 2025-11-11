import fs from 'node:fs'
import path from 'node:path'

const DAILY_POINTS = new Map([
  [1, 19],
  [2, 15],
  [3, 11],
  [4, 7],
  [5, 6],
  [6, 5],
  [7, 4],
  [8, 3],
  [9, 2],
  [10, 1],
])

const MEDAL_SET_BONUS = [50, 40, 30, 20, 10]
const STREAK_BONUS = 25
const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_OUTPUT = 'points.json'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      if (!Array.isArray(args._)) args._ = []
      args._.push(token)
      continue
    }
    const [key, inlineValue] = token.split('=', 2)
    const option = key.slice(2)
    if (inlineValue !== undefined) {
      args[option] = inlineValue
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[option] = next
      i += 1
    } else {
      args[option] = true
    }
  }
  return args
}

function ensureMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    throw new Error('Month must be provided as YYYY-MM via --month')
  }
  return value
}

function monthRange(monthStr) {
  const [yearStr, monthPart] = monthStr.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthPart)
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return {
    start: `${monthStr}-01`,
    end: `${monthStr}-${String(lastDay).padStart(2, '0')}`,
  }
}

function normalizeThrough(through, monthStr) {
  if (!through) return monthRange(monthStr).end
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
    throw new Error('--through must be formatted as YYYY-MM-DD')
  }
  if (!through.startsWith(`${monthStr}-`)) {
    throw new Error('--through must fall within the selected month')
  }
  return through
}

function resolvePath(p) {
  if (!p) return null
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  values.push(current)
  return values
}

function parseDailyRows(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8')
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const [headerLine, ...lines] = normalized.split('\n')
  const header = headerLine.split(',')
  if (!header.length || header[0] !== 'dailyDate') {
    throw new Error(`Unexpected daily CSV header in ${csvPath}`)
  }

  const records = []
  lines.forEach((line, index) => {
    if (!line.trim()) return
    const [
      dailyDate,
      rankStr,
      playerId,
      name,
      scoreText,
      avatarUrl,
    ] = parseCsvLine(line)
    if (!dailyDate || dailyDate.length !== 10) return
    const rank = Number(rankStr)
    if (!Number.isFinite(rank) || rank < 1) return
    if (!avatarUrl) return
    const rawScore = Number(scoreText?.replace(/,/g, ''))

    records.push({
      date: dailyDate,
      month: dailyDate.slice(0, 7),
      rank,
      playerId: playerId || `name:${name || 'Unknown'}`,
      name: name || 'Unknown',
      score: Number.isFinite(rawScore) ? rawScore : null,
      avatarUrl: avatarUrl || '',
      isSaturday: isSaturday(dailyDate),
      rawIndex: index,
    })
  })

  records.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.rawIndex - b.rawIndex
  })
  return records
}

function parseEventRows(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8')
  if (!raw.trim()) return []
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) return []
  const rows = []
  data.forEach((event, eventIdx) => {
    const eventDate = event?.date
    if (!eventDate || eventDate.length !== 10) return
    ;(event.rankings || []).forEach((entry, idx) => {
      const rank = Number(entry?.rank)
      if (!Number.isFinite(rank) || rank < 1) return
      const rawPoints = Number(
        typeof entry?.points === 'string'
          ? entry.points.replace(/,/g, '')
          : entry?.points,
      )
      rows.push({
        date: eventDate,
        month: eventDate.slice(0, 7),
        rank,
        playerId: entry?.playerId || `name:${entry?.name || 'Unknown'}`,
        name: entry?.name || 'Unknown',
        avatar: entry?.avatar || '',
        score: Number.isFinite(rawPoints) ? rawPoints : null,
        rawIndex: eventIdx * 1000 + idx,
      })
    })
  })

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.rawIndex - b.rawIndex
  })
  return rows
}

function collectMonths(dailyRows, eventRows) {
  const set = new Set()
  dailyRows.forEach((row) => set.add(row.month))
  eventRows.forEach((row) => set.add(row.month))
  return Array.from(set).filter(Boolean).sort()
}

function groupByMonth(rows) {
  return rows.reduce((map, row) => {
    if (!row.month) return map
    if (!map.has(row.month)) {
      map.set(row.month, [])
    }
    map.get(row.month).push(row)
    return map
  }, new Map())
}

function getDailyPoints(rank, isSaturday) {
  const base = DAILY_POINTS.get(rank) || 0
  if (!base) return 0
  return isSaturday ? base * 2 : base
}

function getEventPoints(rank) {
  if (rank < 1 || rank > 15) return 0
  return 64 - rank * 4
}

function isSaturday(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return dow === 6
}

function toDayIndex(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

function computeStreakLength(dates) {
  if (!dates.size) return 0
  const sorted = Array.from(dates).sort()
  let longest = 1
  let current = 1
  for (let i = 1; i < sorted.length; i += 1) {
    const prevIdx = toDayIndex(sorted[i - 1])
    const currIdx = toDayIndex(sorted[i])
    if (currIdx - prevIdx === 1) {
      current += 1
    } else {
      current = 1
    }
    if (current > longest) longest = current
  }
  return longest
}

function computeMonthLeaderboard(month, dailyRows, eventRows, throughDate) {
  const filteredDaily = (dailyRows || []).filter((row) => row.date <= throughDate)
  const filteredEvents = (eventRows || []).filter(
    (row) => row.date <= throughDate,
  )

  if (!filteredDaily.length && !filteredEvents.length) {
    return []
  }

  const players = new Map()
  const medalCompletions = []

  function getPlayer(playerId, name = 'Unknown', avatarUrl = '') {
    if (!players.has(playerId)) {
      players.set(playerId, {
        playerId,
        name,
        avatar: avatarUrl || '',
        dailyPoints: 0,
        eventPoints: 0,
        medalBonus: 0,
        streakBonus: 0,
        medalCounts: { gold: 0, silver: 0, bronze: 0 },
        medalSetRank: null,
        medalSetCompletedOn: null,
        top10Dates: new Set(),
        longestTop10Streak: 0,
        totalPoints: 0,
        dailyGamesPlayed: 0,
        eventGamesPlayed: 0,
        totalDailyScore: 0,
        totalEventScore: 0,
      })
    }
    const player = players.get(playerId)
    if (name && name !== 'Unknown' && player.name !== name) {
      player.name = name
    }
    if (avatarUrl && !player.avatar) {
      player.avatar = avatarUrl
    }
    return player
  }

  filteredDaily.forEach((row) => {
    const player = getPlayer(row.playerId, row.name, row.avatarUrl)
    const earned = getDailyPoints(row.rank, row.isSaturday)
    player.dailyPoints += earned
    player.dailyGamesPlayed += 1
    if (row.score !== null && row.score !== undefined) {
      player.totalDailyScore += row.score
    }
    if (row.rank <= 10) {
      player.top10Dates.add(row.date)
    }

    if (row.rank === 1) player.medalCounts.gold += 1
    if (row.rank === 2) player.medalCounts.silver += 1
    if (row.rank === 3) player.medalCounts.bronze += 1

    const hasAllMedals =
      player.medalCounts.gold > 0 &&
      player.medalCounts.silver > 0 &&
      player.medalCounts.bronze > 0
    if (hasAllMedals && !player.medalSetCompletedOn) {
      player.medalSetCompletedOn = row.date
      medalCompletions.push({
        playerId: player.playerId,
        date: row.date,
        rawIndex: row.rawIndex,
      })
    }
  })

  medalCompletions
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.rawIndex - b.rawIndex
    })
    .slice(0, MEDAL_SET_BONUS.length)
    .forEach((entry, idx) => {
      const player = players.get(entry.playerId)
      if (!player) return
      const bonus = MEDAL_SET_BONUS[idx]
      player.medalBonus += bonus
      player.medalSetRank = idx + 1
    })

  filteredEvents.forEach((row) => {
    const points = getEventPoints(row.rank)
    if (!points) return
    const player = getPlayer(row.playerId, row.name, row.avatar)
    player.eventPoints += points
    player.eventGamesPlayed += 1
    if (row.score !== null && row.score !== undefined) {
      player.totalEventScore += row.score
    }
  })

  let bestStreak = 0
  players.forEach((player) => {
    player.longestTop10Streak = computeStreakLength(player.top10Dates)
    if (player.longestTop10Streak > bestStreak) {
      bestStreak = player.longestTop10Streak
    }
  })

  if (bestStreak > 0) {
    players.forEach((player) => {
      if (player.longestTop10Streak === bestStreak) {
        player.streakBonus += STREAK_BONUS
      }
    })
  }

  const leaderboard = Array.from(players.values()).map((player) => {
    const medalCount =
      player.medalCounts.gold +
      player.medalCounts.silver +
      player.medalCounts.bronze
    const total =
      player.dailyPoints +
      player.eventPoints +
      player.medalBonus +
      player.streakBonus
    return {
      playerId: player.playerId,
      name: player.name,
      avatar: player.avatar,
      dailyPoints: player.dailyPoints,
      eventPoints: player.eventPoints,
      dailyGamesPlayed: player.dailyGamesPlayed,
      averageDailyScore:
        player.dailyGamesPlayed > 0
          ? Number((player.totalDailyScore / player.dailyGamesPlayed).toFixed(2))
          : 0,
      averageEventScore:
        player.eventGamesPlayed > 0
          ? Number((player.totalEventScore / player.eventGamesPlayed).toFixed(2))
          : 0,
      goldCount: player.medalCounts.gold,
      silverCount: player.medalCounts.silver,
      bronzeCount: player.medalCounts.bronze,
      medalCount,
      medalBonus: player.medalBonus,
      streakBonus: player.streakBonus,
      totalPoints: total,
      longestTop10Streak: player.longestTop10Streak,
      medalSetRank: player.medalSetRank,
      medalSetCompletedOn: player.medalSetCompletedOn,
    }
  })

  leaderboard.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
    if (b.dailyPoints !== a.dailyPoints) return b.dailyPoints - a.dailyPoints
    if (b.eventPoints !== a.eventPoints) return b.eventPoints - a.eventPoints
    return a.name.localeCompare(b.name)
  })

  return leaderboard
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    const month = args.month ? ensureMonth(args.month) : null
    if (args.through && !month) {
      throw new Error('--through can only be used together with --month')
    }
    const throughOverride = month
      ? normalizeThrough(args.through, month)
      : null

    const dailyPath = resolvePath(args.daily ?? 'daily_scores.csv')
    const eventPath = resolvePath(args.event ?? 'event_rankings.json')
    const outputPath = resolvePath(args.output ?? DEFAULT_OUTPUT)

    if (!fs.existsSync(dailyPath)) {
      throw new Error(`Cannot find daily scores file at ${dailyPath}`)
    }
    if (!fs.existsSync(eventPath)) {
      throw new Error(`Cannot find event rankings file at ${eventPath}`)
    }

    const dailyRows = parseDailyRows(dailyPath)
    const eventRows = parseEventRows(eventPath)

    const allMonths = collectMonths(dailyRows, eventRows)
    if (!allMonths.length) {
      fs.writeFileSync(outputPath, '{}\n', 'utf8')
      console.log(`No data found. Wrote empty JSON to ${outputPath}`)
      return
    }

    const targetMonths = month ? [month] : allMonths
    const uniqueMonths = Array.from(new Set(targetMonths)).sort()
    const dailyByMonth = groupByMonth(dailyRows)
    const eventByMonth = groupByMonth(eventRows)
    const results = {}

    uniqueMonths.forEach((monthKey) => {
      const throughDate =
        month && monthKey === month && throughOverride
          ? throughOverride
          : monthRange(monthKey).end
      const leaderboard = computeMonthLeaderboard(
        monthKey,
        dailyByMonth.get(monthKey),
        eventByMonth.get(monthKey),
        throughDate,
      )
      if (leaderboard.length) {
        results[monthKey] = leaderboard
      }
    })

    fs.writeFileSync(`${outputPath}`, `${JSON.stringify(results, null, 2)}\n`)
    const monthList = Object.keys(results)
    console.log(
      `Calculated leaderboards for ${
        monthList.length
      } month(s): ${monthList.join(', ')} -> ${outputPath}`,
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

main()
