import fs from 'node:fs'
import path from 'node:path'

const INPUT = path.resolve('./event_rankings.json')
const OUTPUT = path.resolve('./event_breakdown.json')

const UNIT_POINTS = new Map(
  Array.from({ length: 15 }, (_, i) => {
    const rank = i + 1
    return [rank, 64 - rank * 4]
  }),
)

function getEventPoints(rank) {
  return UNIT_POINTS.get(rank) ?? 0
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function loadEvents() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Cannot find event rankings at ${INPUT}`)
  }
  const raw = fs.readFileSync(INPUT, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('event_rankings.json must be an array')
  }
  return parsed
}

function buildBreakdown(events) {
  const months = new Map()

  events.forEach((event) => {
    const finalDate = event?.date
    if (!finalDate || finalDate.length !== 10) return
    const monthKey = finalDate.slice(0, 7)
    const eventName = event?.name || 'Unknown'
    const eventId = `${slugify(eventName)}-${finalDate}`
    const monthEntry =
      months.get(monthKey) ??
      {
        events: [],
        players: new Map(),
      }

    if (!monthEntry.events.find((evt) => evt.id === eventId)) {
      monthEntry.events.push({
        id: eventId,
        name: eventName,
        date: finalDate,
      })
    }

    ensureArray(event?.rankings).forEach((entry) => {
      const rank = Number(entry?.rank)
      const points = getEventPoints(rank)
      if (!points) return
      const playerId = entry?.playerId || `name:${entry?.name || 'Unknown'}`
      if (!monthEntry.players.has(playerId)) {
        monthEntry.players.set(playerId, {
          playerId,
          name: entry?.name || 'Unknown',
          avatar: entry?.avatar || '',
          scores: {},
        })
      }
      const player = monthEntry.players.get(playerId)
      if (entry?.avatar && !player.avatar) {
        player.avatar = entry.avatar
      }
      player.scores[eventId] = points
    })

    months.set(monthKey, monthEntry)
  })

  const output = {}
  months.forEach((entry, monthKey) => {
    const eventsList = entry.events.sort((a, b) => a.date.localeCompare(b.date))
    const eventIds = eventsList.map((evt) => evt.id)
    const players = Array.from(entry.players.values()).map((player) => {
      const total = eventIds.reduce(
        (sum, eventId) => sum + (player.scores[eventId] ?? 0),
        0,
      )
      return {
        ...player,
        total,
      }
    })
    players.sort((a, b) => b.total - a.total)
    output[monthKey] = {
      events: eventsList,
      players,
    }
  })

  return output
}

function main() {
  try {
    const events = loadEvents()
    const breakdown = buildBreakdown(events)
    fs.writeFileSync(OUTPUT, `${JSON.stringify(breakdown, null, 2)}\n`)
    console.log(`Saved event breakdown to ${OUTPUT}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

main()
