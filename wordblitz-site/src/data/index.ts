import dailyScoresCsv from '../../../daily_scores.csv?raw'
import pointsJson from '../../../points.json'
import dailyDetailsJson from '../../../daily_details.json'
import eventDetailsJson from '../../../event_details.json'
import eventRankingsJson from '../../../event_rankings.json'
import eventBreakdownJson from '../../../event_breakdown.json'
import dailyBreakdownJson from '../../../daily_breakdown.json'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const MAX_EVENT_DETAIL_GAP_MS = 3 * DAY_IN_MS

type CsvRow = Record<string, string>

export interface PlayerPoints {
  playerId: string
  name: string
  avatar: string
  dailyPoints: number
  eventPoints: number
  dailyGamesPlayed: number
  eventGamesPlayed: number
  averageDailyRank: number
  averageDailyScore: number
  averageEventRank: number
  averageEventScore: number
  goldCount: number
  silverCount: number
  bronzeCount: number
  medalCount: number
  medalBonus: number
  streakBonus: number
  totalPoints: number
  longestTop10Streak: number
  medalSetRank: number | null
  medalSetCompletedOn: string
}

export interface BoardTile {
  letter: string
  bonus: string
  active?: boolean
}

export interface DailyRanking {
  dailyDate: string
  rank: number
  playerId: string
  name: string
  points: number
  avatarUrl: string
}

export interface DailyGame {
  date: string
  wordCount: number | null
  board: BoardTile[]
  words: string[]
  rankings: DailyRanking[]
}

export interface EventBoard {
  date: string
  wordCount: number
  board: BoardTile[]
}

export interface EventRankingEntry {
  rank: number
  name: string
  points: number
  playerId: string
  avatar: string
}

export interface EventDetails {
  id: string
  name: string
  finalDate: string
  boards: EventBoard[]
  rankings: EventRankingEntry[]
  coveredDates: string[]
}

export interface EventBreakdownEvent {
  id: string
  name: string
  date: string
}

export interface EventBreakdownPlayer {
  playerId: string
  name: string
  avatar: string
  scores: Record<string, ScoreCell>
  total: number
  totalScore?: number
}

export interface EventBreakdownMonth {
  events: EventBreakdownEvent[]
  players: EventBreakdownPlayer[]
}

export interface DailyBreakdownDay {
  date: string
}

export interface DailyBreakdownPlayer {
  playerId: string
  name: string
  avatar: string
  scores: Record<string, ScoreCell>
  total: number
  totalScore?: number
}

export interface DailyBreakdownMonth {
  days: DailyBreakdownDay[]
  players: DailyBreakdownPlayer[]
}

interface ScoreCell {
  rank: number | null
  score: number | null
  points: number
}

type RawDailyDetail = {
  date: string
  wordCount: number
  board: BoardTile[]
  words?: string[]
}

type RawEventDetail = {
  eventName: string
  boards: EventBoard[]
}

type RawEventDetailWithMeta = RawEventDetail & {
  finalDate: string
  sortedBoards: EventBoard[]
}

type RawEventRanking = {
  date: string
  name: string
  rankings: EventRankingEntry[]
}

type RawEventBreakdown = Record<
  string,
  {
    events: EventBreakdownEvent[]
    players: Array<
      Omit<EventBreakdownPlayer, 'scores'> & {
        scores?: Record<string, Partial<ScoreCell>>
      }
    >
  }
>

type RawDailyBreakdown = Record<
  string,
  {
    days: DailyBreakdownDay[]
    players: Array<
      Omit<DailyBreakdownPlayer, 'scores'> & {
        scores?: Record<string, Partial<ScoreCell>>
      }
    >
  }
>

type RawPlayerPoints = {
  playerId: string
  name: string
  avatar?: string
  dailyPoints: number
  eventPoints: number
  dailyGamesPlayed?: number
  eventGamesPlayed?: number
  averageDailyRank?: number
  averageDailyScore?: number
  averageEventRank?: number
  averageEventScore?: number
  goldCount: number
  silverCount: number
  bronzeCount: number
  medalCount: number
  medalBonus: number
  streakBonus: number
  totalPoints: number
  longestTop10Streak: number
  medalSetRank?: number | null
  medalSetCompletedOn?: string | null
}

type RawPointsByMonth = Record<string, RawPlayerPoints[]>

const rawPointsByMonth = pointsJson as RawPointsByMonth
const parsedDailyScores = parseCsv(dailyScoresCsv)
const dailyRankings = parsedDailyScores.map((row) => ({
  dailyDate: row.dailyDate,
  rank: toNumber(row.rank),
  playerId: row.playerId,
  name: row.name ?? '',
  points: toNumber(row.points),
  avatarUrl: row.avatarUrl ?? '',
}))
const dailyDetails = dailyDetailsJson as RawDailyDetail[]
const eventDetails = eventDetailsJson as RawEventDetail[]
const eventRankings = eventRankingsJson as RawEventRanking[]
const rawEventBreakdown = eventBreakdownJson as RawEventBreakdown
const rawDailyBreakdown = dailyBreakdownJson as RawDailyBreakdown
const monthLastUpdated = new Map<string, string>()

function recordMonthActivity(date?: string | null) {
  if (!date || typeof date !== 'string' || date.length !== 10) return
  const monthKey = date.slice(0, 7)
  if (!monthKey) return
  const current = monthLastUpdated.get(monthKey)
  if (!current || date.localeCompare(current) > 0) {
    monthLastUpdated.set(monthKey, date)
  }
}

export const playerPointsByMonth = new Map(
  Object.entries(rawPointsByMonth).map(([month, rows]) => [
    month,
    rows
      .map((row) => ({
        playerId: row.playerId,
        name: row.name,
        avatar: row.avatar ?? '',
        dailyPoints: toNumber(row.dailyPoints),
        eventPoints: toNumber(row.eventPoints),
        dailyGamesPlayed: toNumber(row.dailyGamesPlayed),
        eventGamesPlayed: toNumber(row.eventGamesPlayed),
        averageDailyRank: toNumber(row.averageDailyRank),
        averageDailyScore: toNumber(row.averageDailyScore),
        averageEventRank: toNumber(row.averageEventRank),
        averageEventScore: toNumber(row.averageEventScore),
        goldCount: toNumber(row.goldCount),
        silverCount: toNumber(row.silverCount),
        bronzeCount: toNumber(row.bronzeCount),
        medalCount: toNumber(row.medalCount),
        medalBonus: toNumber(row.medalBonus),
        streakBonus: toNumber(row.streakBonus),
        totalPoints: toNumber(row.totalPoints),
        longestTop10Streak: toNumber(row.longestTop10Streak),
        medalSetRank:
          row.medalSetRank === null || row.medalSetRank === undefined
            ? null
            : toNumber(row.medalSetRank),
        medalSetCompletedOn: row.medalSetCompletedOn ?? '',
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints),
  ]),
)

const dailyScoresByDate = groupBy(dailyRankings, (row) => row.dailyDate)

const dailyDetailsByDate = new Map(
  dailyDetails.map((detail) => [detail.date, detail]),
)

const allDailyDates = Array.from(
  new Set([
    ...dailyScoresByDate.keys(),
    ...dailyDetailsByDate.keys(),
  ]),
).filter(Boolean)

export const dailyGames: DailyGame[] = allDailyDates
  .map((date) => {
    const detail = dailyDetailsByDate.get(date)
    return {
      date,
      wordCount: detail?.wordCount ?? null,
      board: detail?.board ?? [],
      words: detail?.words ?? [],
      rankings: dailyScoresByDate.get(date) ?? [],
    }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

export const dailyGameByDate = new Map(dailyGames.map((game) => [game.date, game]))
dailyGames.forEach((game) => recordMonthActivity(game.date))

const eventDetailsWithMeta: RawEventDetailWithMeta[] = eventDetails.map(
  (detail) => {
    const sortedBoards = [...(detail.boards ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date),
    )
    const finalDate =
      sortedBoards.length > 0 ? sortedBoards.at(-1)!.date : '1970-01-01'
    return {
      ...detail,
      finalDate,
      sortedBoards,
    }
  },
)

const eventDetailsByName = eventDetailsWithMeta.reduce<
  Map<string, RawEventDetailWithMeta[]>
>((acc, detail) => {
  const key = normalizeEventName(detail.eventName)
  const list = acc.get(key) ?? []
  list.push(detail)
  acc.set(key, list)
  return acc
}, new Map())

export const events: EventDetails[] = eventRankings
  .map((event) => {
    const detail = findEventDetail(event.name, event.date)
    const boards = detail?.sortedBoards ?? []
    const finalDate = detail?.finalDate ?? event.date
    const id = `${slugify(event.name)}-${event.date}`
    const coveredDates =
      boards.length > 0
        ? boards.map((board) => board.date)
        : generateFallbackDates(finalDate, boards.length || 7)
    return {
      id,
      name: event.name,
      finalDate,
      boards,
      rankings: event.rankings,
      coveredDates,
    }
  })
  .sort((a, b) => b.finalDate.localeCompare(a.finalDate))

export const eventById = new Map(events.map((event) => [event.id, event]))
events.forEach((event) => {
  recordMonthActivity(event.finalDate)
  event.coveredDates.forEach((date) => recordMonthActivity(date))
})

export const eventDatesLookup = events.reduce<Map<string, EventDetails[]>>(
  (acc, event) => {
    event.coveredDates.forEach((date) => {
      const list = acc.get(date) ?? []
      list.push(event)
      acc.set(date, list)
    })
    return acc
  },
  new Map(),
)

const monthSet = new Set<string>()
dailyGames.forEach((game) => monthSet.add(game.date.slice(0, 7)))
events.forEach((event) =>
  event.coveredDates.forEach((date) => monthSet.add(date.slice(0, 7))),
)
playerPointsByMonth.forEach((_, month) => monthSet.add(month))

export const eventBreakdownByMonth = new Map(
  Object.entries(rawEventBreakdown).map(([month, payload]) => [
    month,
    {
      events: payload.events ?? [],
      players: (payload.players ?? []).map((player) => ({
        playerId: player.playerId,
        name: player.name,
        avatar: player.avatar ?? '',
        scores: mapScoreRecord(player.scores),
        total: toNumber(player.total),
        totalScore: toNumber(player.totalScore),
      })),
    },
  ]),
)

eventBreakdownByMonth.forEach((_, month) => monthSet.add(month))

export const dailyBreakdownByMonth = new Map(
  Object.entries(rawDailyBreakdown).map(([month, payload]) => [
    month,
    {
      days: payload.days ?? [],
      players: (payload.players ?? []).map((player) => ({
        playerId: player.playerId,
        name: player.name,
        avatar: player.avatar ?? '',
        scores: mapScoreRecord(player.scores),
        total: toNumber(player.total),
        totalScore: toNumber(player.totalScore),
      })),
    },
  ]),
)

dailyBreakdownByMonth.forEach((_, month) => monthSet.add(month))

export const availableMonths = Array.from(monthSet).sort((a, b) =>
  b.localeCompare(a),
)

export const lastUpdateByMonth = monthLastUpdated

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, (month ?? 1) - 1)
  return date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(year, (month ?? 1) - 1, day)
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function parseCsv(raw: string): CsvRow[] {
  const rows = toRows(raw)
  if (rows.length === 0) return []
  const [header, ...rest] = rows
  return rest.map((line) => {
    const row: CsvRow = {}
    header.forEach((key, index) => {
      row[key] = line[index] ?? ''
    })
    return row
  })
}

function toRows(raw: string) {
  const rows: string[][] = []
  let current = ''
  let inQuotes = false
  const currentRow: string[] = []

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]
    if (char === '"') {
      const next = raw[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(current)
      current = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && raw[i + 1] === '\n') {
        i += 1
      }
      currentRow.push(current)
      rows.push([...currentRow])
      currentRow.length = 0
      current = ''
    } else {
      current += char
    }
  }

  if (current.length > 0 || currentRow.length > 0) {
    currentRow.push(current)
    rows.push([...currentRow])
  }

  return rows.filter((row) => row.some((value) => value.trim().length > 0))
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim().length === 0) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function mapScoreRecord(record?: Record<string, Partial<ScoreCell>>) {
  if (!record) return {}
  const entries: Array<[string, ScoreCell]> = []
  Object.entries(record).forEach(([key, value]) => {
    if (!value) return
    entries.push([
      key,
      {
        rank:
          typeof value.rank === 'number' && Number.isFinite(value.rank)
            ? value.rank
            : null,
        score:
          typeof value.score === 'number' && Number.isFinite(value.score)
            ? value.score
            : null,
        points: toNumber(value.points),
      },
    ])
  })
  return Object.fromEntries(entries)
}

function groupBy<T>(rows: T[], getter: (row: T) => string) {
  return rows.reduce<Map<string, T[]>>((acc, row) => {
    const key = getter(row)
    if (!key) return acc
    const list = acc.get(key) ?? []
    list.push(row)
    acc.set(key, list)
    return acc
  }, new Map())
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeEventName(name: string) {
  return name.toLowerCase().trim()
}

function findEventDetail(name: string, rankingDate: string) {
  const key = normalizeEventName(name)
  const candidates = eventDetailsByName.get(key)
  if (!candidates || candidates.length === 0) return null
  const targetTime = toTime(rankingDate)
  let best = candidates[0]
  let bestDiff = Math.abs(toTime(best.finalDate) - targetTime)

  for (const candidate of candidates) {
    const diff = Math.abs(toTime(candidate.finalDate) - targetTime)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }

  return bestDiff <= MAX_EVENT_DETAIL_GAP_MS ? best : null
}

function toTime(dateStr: string) {
  return Number(new Date(dateStr).getTime())
}

function generateFallbackDates(finalDate: string, days = 7) {
  const parsed = new Date(finalDate)
  if (Number.isNaN(parsed.valueOf())) return []
  const dates: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const current = new Date(parsed)
    current.setDate(parsed.getDate() - offset)
    dates.push(formatDate(current))
  }
  return dates
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
