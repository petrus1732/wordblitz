import dailyScoresCsv from '../../../daily_scores.csv?raw'
import pointsJson from '../../../points.json'
import dailyDetailsJson from '../../../daily_details.json'
import eventDetailsJson from '../../../event_details.json'
import eventRankingsJson from '../../../event_rankings.json'

type CsvRow = Record<string, string>

export interface PlayerPoints {
  playerId: string
  name: string
  avatar: string
  dailyPoints: number
  eventPoints: number
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

type RawEventRanking = {
  date: string
  name: string
  rankings: EventRankingEntry[]
}

type RawPlayerPoints = {
  playerId: string
  name: string
  avatar?: string
  dailyPoints: number
  eventPoints: number
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

const eventDetailByKey = new Map(
  eventDetails.map((detail) => {
    const finalDate = detail.boards.at(-1)?.date ?? ''
    return [makeEventKey(detail.eventName, finalDate), detail]
  }),
)

export const events: EventDetails[] = eventRankings
  .map((event) => {
    const detail = eventDetailByKey.get(makeEventKey(event.name, event.date))
    const boards = detail?.boards ?? []
    const id = `${slugify(event.name)}-${event.date}`
    return {
      id,
      name: event.name,
      finalDate: event.date,
      boards,
      rankings: event.rankings,
      coveredDates: boards.map((board) => board.date),
    }
  })
  .sort((a, b) => b.finalDate.localeCompare(a.finalDate))

export const eventById = new Map(events.map((event) => [event.id, event]))

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

export const availableMonths = Array.from(monthSet).sort((a, b) =>
  b.localeCompare(a),
)

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

function makeEventKey(name: string, finalDate: string) {
  return `${name}__${finalDate}`
}
