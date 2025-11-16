import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import './App.css'
import {
  availableMonths,
  dailyGameByDate,
  eventById,
  eventDatesLookup,
  formatDisplayDate,
  formatMonthLabel,
  playerPointsByMonth,
  eventBreakdownByMonth,
  dailyBreakdownByMonth,
  type BoardTile,
  type DailyGame,
  type EventDetails,
  type PlayerPoints as PlayerPointsRow,
  type EventBreakdownMonth,
  type DailyBreakdownMonth,
  lastUpdateByMonth,
} from './data'
import { Link, useRouter } from './router'

type Route =
  | { kind: 'home' }
  | { kind: 'month'; monthKey: string }
  | { kind: 'daily'; date: string }
  | { kind: 'event'; eventId: string }
  | { kind: 'not-found'; message?: string }

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EVENT_COLORS = [
  'event-a',
  'event-b',
  'event-c',
  'event-d',
  'event-e',
  'event-f',
]
const eventColorMap = new Map<string, string>()

export default function App() {
  const { path } = useRouter()
  const route = matchRoute(path)

  let content: JSX.Element

  switch (route.kind) {
    case 'home':
      content = <HomeView />
      break
    case 'month':
      content = <MonthView monthKey={route.monthKey} />
      break
    case 'daily':
      content = <DailyView date={route.date} />
      break
    case 'event':
      content = <EventView eventId={route.eventId} />
      break
    default:
      content = (
        <NotFound
          message={route.message ?? 'We could not find the page you requested.'}
        />
      )
      break
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Wordblitz</p>
          <h1 className="brand-title">Community Leaderboards</h1>
          <p className="tagline">
            Browse daily boards, follow week-long events, and celebrate every
            point.
          </p>
          <p className='update-note'>New change: Rankings are changed to dense ranks (ties keep the same rank, next position increments by 1)</p>
        </div>
        <nav className="primary-nav">
          <Link to="/">Home</Link>
        </nav>
      </header>
      <main className="app-main">{content}</main>
      <footer className="app-footer">
        Data sources: daily_scores.csv · daily_details.json · event_rankings.json
        · event_details.json · points.json
      </footer>
    </div>
  )
}

function HomeView() {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Pick a month</p>
          <h2>Where do you want to start?</h2>
          <p className="subtle">
            Choose any month to see its calendar, daily boards, and events.
          </p>
        </div>
      </div>
      <MonthButtons months={availableMonths} />
    </section>
  )
}

function MonthView({ monthKey }: { monthKey: string }) {
  if (!availableMonths.includes(monthKey)) {
    return (
      <NotFound message="No games or events exist for that month yet." />
    )
  }

  const calendar = buildCalendar(monthKey, dailyGameByDate, eventDatesLookup)
  const monthPoints = playerPointsByMonth.get(monthKey) ?? []
  const eventMatrix = eventBreakdownByMonth.get(monthKey)
  const dailyMatrix = dailyBreakdownByMonth.get(monthKey)
  const lastUpdateDate = lastUpdateByMonth.get(monthKey)
  const lastUpdateDescription = lastUpdateDate
    ? `Last update: ${lastUpdateDate}`
    : 'Last update: Unknown'

  return (
    <>
      <section className="panel">
        <div className="panel-heading panel-heading--stack">
          <div>
            <p className="eyebrow">Monthly overview</p>
            <h2>{formatMonthLabel(monthKey)}</h2>
            <p className="subtle">
              Jump between months at any time using the shortcuts.
            </p>
          </div>
          <MonthButtons months={availableMonths} activeMonth={monthKey} />
        </div>
      </section>

      <CollapsiblePanel
        title="Season standings"
        eyebrow="Total leaderboard"
        description={lastUpdateDescription}
      >
        <PointsTable rows={monthPoints} />
      </CollapsiblePanel>

      {dailyMatrix && dailyMatrix.days.length > 0 && (
        <CollapsiblePanel
          title="Daily standings"
          eyebrow="Daily breakdown"
          description={lastUpdateDescription}
        >
          <DailyMatrixTable matrix={dailyMatrix} />
        </CollapsiblePanel>
      )}

      {eventMatrix && eventMatrix.events.length > 0 && (
        <CollapsiblePanel
          title="Event standings"
          eyebrow="Event breakdown"
          description={lastUpdateDescription}
        >
          <EventMatrixTable matrix={eventMatrix} />
        </CollapsiblePanel>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h3>Daily games & weekly events</h3>
            <p className="subtle">
              Tap a day to open the detailed board or event summary.
            </p>
          </div>
        </div>
        <CalendarView monthKey={monthKey} calendar={calendar} />
      </section>
    </>
  )
}

function DailyView({ date }: { date: string }) {
  const daily = dailyGameByDate.get(date)

  if (!daily) {
    return (
      <>
        <BackLinks />
        <NotFound message="This daily board has not been recorded yet." />
      </>
    )
  }

  const rankings = [...daily.rankings].sort((a, b) => a.rank - b.rank)
  const rankingRows: RankingRow[] = rankings.map((entry) => ({
    rank: entry.rank,
    name: entry.name,
    points: entry.points,
    avatarUrl: entry.avatarUrl,
    playerId: entry.playerId,
  }))

  return (
    <>
      <BackLinks monthKey={date.slice(0, 7)} />
      <section className="panel">
        <p className="eyebrow">Daily game</p>
        <h2>{formatDisplayDate(date)}</h2>
        {typeof daily.wordCount === 'number' && (
          <p className="subtle">{daily.wordCount} possible words</p>
        )}
        <div className="board-layout">
          <div className="board-column">
            {daily.board.length > 0 ? (
              <BoardGrid board={daily.board} />
            ) : (
              <p className="subtle">
                Board data is still loading for this day. Check back soon.
              </p>
            )}
          </div>
          <WordList words={daily.words} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Leaderboard</p>
            <h3>Top players for this board</h3>
          </div>
        </div>
        <RankingTable rows={rankingRows} />
      </section>
    </>
  )
}

function EventView({ eventId }: { eventId: string }) {
  const event = eventById.get(eventId)

  if (!event) {
    return (
      <>
        <BackLinks />
        <NotFound message="We could not find that event." />
      </>
    )
  }

  const rangeStart = event.boards.at(0)?.date ?? event.finalDate
  const rangeEnd = event.finalDate

  const rankingRows: RankingRow[] = event.rankings
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => ({
      rank: entry.rank,
      name: entry.name,
      points: entry.points,
      avatarUrl: entry.avatar,
      playerId: entry.playerId,
    }))

  return (
    <>
      <BackLinks monthKey={event.finalDate.slice(0, 7)} />
      <section className="panel">
        <p className="eyebrow">Event</p>
        <h2>{event.name}</h2>
        <p className="subtle">
          {formatDisplayDate(rangeStart)} – {formatDisplayDate(rangeEnd)}
        </p>
        {event.boards.length > 0 ? (
          <div className="event-board-grid">
            {event.boards.map((board) => (
              <div className="event-board" key={board.date}>
                <div className="event-board__meta">
                  <span>{formatDisplayDate(board.date)}</span>
                  <span>{board.wordCount} words</span>
                </div>
                <BoardGrid board={board.board} compact />
              </div>
            ))}
          </div>
        ) : (
          <p className="subtle">
            The seven boards for this event have not been published yet.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Event leaderboard</p>
            <h3>Weekly totals</h3>
          </div>
        </div>
        <RankingTable rows={rankingRows} />
      </section>
    </>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <section className="panel">
      <p className="eyebrow">Heads up</p>
      <h2>Nothing to show yet</h2>
      <p className="subtle">{message}</p>
      <div className="button-row">
        <Link to="/" className="pill-button">
          Back to home
        </Link>
      </div>
    </section>
  )
}

function BackLinks({ monthKey }: { monthKey?: string }) {
  return (
    <nav className="breadcrumbs">
      <Link to="/">Home</Link>
      {monthKey && (
        <>
          <span className="breadcrumbs__divider">/</span>
          <Link to={`/month/${monthKey}`}>{formatMonthLabel(monthKey)}</Link>
        </>
      )}
    </nav>
  )
}

function MonthButtons({
  months,
  activeMonth,
}: {
  months: string[]
  activeMonth?: string
}) {
  if (months.length === 0) {
    return <p className="subtle">No months on record yet.</p>
  }

  return (
    <div className="month-button-grid">
      {months.map((month) => (
        <Link
          key={month}
          to={`/month/${month}`}
          className={`month-button ${
            month === activeMonth ? 'is-active' : ''
          }`}
        >
          {formatMonthLabel(month)}
        </Link>
      ))}
    </div>
  )
}

function CalendarView({
  monthKey,
  calendar,
}: {
  monthKey: string
  calendar: CalendarCell[][]
}) {
  if (calendar.length === 0) {
    return (
      <p className="subtle">
        We could not build the calendar for {formatMonthLabel(monthKey)}.
      </p>
    )
  }

  const legendEntries = new Map<string, string>()
  calendar.forEach((week) =>
    week.forEach((cell) =>
      cell.events.forEach((event) => {
        const slug = getEventColorSlug(event.name)
        legendEntries.set(event.name, slug)
      }),
    ),
  )

  return (
    <div className="calendar">
      <div className="calendar-legend">
        <div className="legend-item">
          <span className="legend-dot legend-dot--daily">D</span>
          Daily board
        </div>
        {Array.from(legendEntries.entries()).map(([name, slug]) => (
          <div className="legend-item" key={name}>
            <span className={`legend-dot legend-dot--${slug}`}>
              {getEventInitial(name)}
            </span>
            {name}
          </div>
        ))}
      </div>
      <div className="calendar-grid calendar-grid--header">
        {weekdayLabels.map((label) => (
          <div key={label} className="calendar-weekday">
            {label}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
        {calendar.flat().map((cell, index) => (
          <div
            key={`${cell.isoDate ?? 'empty'}-${index}`}
            className={`calendar-cell ${
              cell.inMonth ? '' : 'calendar-cell--muted'
            }`}
          >
            {cell.isoDate && (
              <>
                <div className="calendar-cell__date">
                  {cell.dayNumber}
                </div>
                <div className="calendar-chip-stack">
                  {cell.hasDaily && (
                    <Link
                      to={`/daily/${cell.isoDate}`}
                      className="calendar-chip calendar-chip--daily"
                    >
                      D
                    </Link>
                  )}
                  {cell.events.map((event) => {
                    const slug = getEventColorSlug(event.name)
                    return (
                      <Link
                        key={`${event.id}-${cell.isoDate}`}
                        to={`/event/${event.id}`}
                        className={`calendar-chip calendar-chip--event calendar-chip--${slug}`}
                      >
                        {getEventInitial(event.name)}
                      </Link>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PointsTable({ rows }: { rows: PlayerPointsRow[] }) {
  if (rows.length === 0) {
    return <p className="subtle">No player points have been recorded.</p>
  }

  return (
    <div className="table-wrapper">
      <table className="data-table data-table--stacked">
        <thead>
          <tr>
            <th rowSpan={2} className="rank-column">
              #
            </th>
            <th rowSpan={2} className="player-column">
              Player
            </th>
            <th rowSpan={2}>Total</th>
            <th rowSpan={2}>Daily</th>
            <th rowSpan={2}>Event</th>
            <th colSpan={2}>Daily avg</th>
            <th colSpan={2}>Event avg</th>
            <th rowSpan={2}>Daily plays</th>
            <th rowSpan={2}>Gold</th>
            <th rowSpan={2}>Silver</th>
            <th rowSpan={2}>Bronze</th>
            <th rowSpan={2}>Medals</th>
            <th rowSpan={2}>Medal bonus</th>
            <th rowSpan={2}>Streak bonus</th>
            <th rowSpan={2}>Top 10 streak</th>
          </tr>
          <tr>
            <th className="matrix-subhead">Rank</th>
            <th className="matrix-subhead">Score</th>
            <th className="matrix-subhead">Rank</th>
            <th className="matrix-subhead">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((player, index) => (
            <tr key={player.playerId}>
              <td className="rank-column">{index + 1}</td>
              <td className="player-cell">
                {player.avatar ? (
                  <img
                    src={player.avatar}
                    alt=""
                    className="player-avatar"
                    loading="lazy"
                  />
                ) : null}
                <span>{player.name}</span>
              </td>
              <td>{player.totalPoints.toLocaleString()}</td>
              <td>{player.dailyPoints.toLocaleString()}</td>
              <td>{player.eventPoints.toLocaleString()}</td>
              <td className="matrix-cell">
                {player.dailyGamesPlayed > 0
                  ? player.averageDailyRank.toFixed(2)
                  : '—'}
              </td>
              <td className="matrix-cell">
                {player.dailyGamesPlayed > 0
                  ? player.averageDailyScore.toFixed(2)
                  : '—'}
              </td>
              <td className="matrix-cell">
                {player.eventGamesPlayed > 0
                  ? player.averageEventRank.toFixed(2)
                  : '—'}
              </td>
              <td className="matrix-cell">
                {player.eventGamesPlayed > 0
                  ? player.averageEventScore.toFixed(2)
                  : '—'}
              </td>
              <td>{player.dailyGamesPlayed}</td>
              <td>{player.goldCount}</td>
              <td>{player.silverCount}</td>
              <td>{player.bronzeCount}</td>
              <td>{player.medalCount}</td>
              <td>{player.medalBonus.toLocaleString()}</td>
              <td>{player.streakBonus.toLocaleString()}</td>
              <td>{player.longestTop10Streak}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type RankingRow = {
  rank: number
  name: string
  points: number
  avatarUrl?: string
  playerId: string
}

function RankingTable({ rows }: { rows: RankingRow[] }) {
  if (rows.length === 0) {
    return <p className="subtle">No rankings have been captured.</p>
  }

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th className="rank-column">#</th>
            <th className="player-column">Player</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId}>
              <td className="rank-column">{row.rank}</td>
              <td className="player-cell">
                {row.avatarUrl ? (
                  <img
                    src={row.avatarUrl}
                    alt=""
                    className="player-avatar"
                    loading="lazy"
                  />
                ) : null}
                <span>{row.name}</span>
              </td>
              <td>{row.points.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoardGrid({
  board,
  compact = false,
}: {
  board: BoardTile[]
  compact?: boolean
}) {
  if (board.length === 0) {
    return null
  }

  return (
    <div
      className={`board-grid ${compact ? 'board-grid--compact' : ''}`}
      aria-label="Word grid"
    >
      {board.map((tile, index) => {
        const bonusKey = getBonusKey(tile.bonus)
        return (
          <div
            key={`${tile.letter}-${index}`}
            className={`board-tile ${tile.active ? 'board-tile--active' : ''} ${
              bonusKey ? `board-tile--${bonusKey}` : ''
            }`}
          >
            <span className="board-letter">{tile.letter}</span>
            {tile.bonus && (
              <span
                className={`board-bonus ${
                  bonusKey ? `board-bonus--${bonusKey}` : ''
                }`}
              >
                {tile.bonus.trim().toUpperCase()}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

type WordSortMode = 'alpha' | 'length'

function WordList({ words }: { words: string[] }) {
  const [sortMode, setSortMode] = useState<WordSortMode>('alpha')
  const list = useMemo(() => {
    const copy = words?.slice() ?? []
    if (sortMode === 'alpha') {
      return copy.sort((a, b) => a.localeCompare(b))
    }
    return copy.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length
      return a.localeCompare(b)
    })
  }, [words, sortMode])

  return (
    <div className="word-list-card">
      <div className="word-list-header">
        <h4>Word list</h4>
        <span>{list.length.toLocaleString()} words</span>
      </div>
      <div className="word-sort-controls">
        <span>Sort</span>
        <div className="word-sort-buttons">
          <button
            type="button"
            className={`word-sort-button ${
              sortMode === 'alpha' ? 'is-active' : ''
            }`}
            onClick={() => setSortMode('alpha')}
          >
            A → Z
          </button>
          <button
            type="button"
            className={`word-sort-button ${
              sortMode === 'length' ? 'is-active' : ''
            }`}
            onClick={() => setSortMode('length')}
          >
            Length
          </button>
        </div>
      </div>
      {list.length > 0 ? (
        <ul className="word-list">
          {list.map((word) => (
            <li key={word}>{word}</li>
          ))}
        </ul>
      ) : (
        <p className="subtle">No word list has been published for this board.</p>
      )}
    </div>
  )
}

function CollapsiblePanel({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="panel collapsible-panel">
      <button
        type="button"
        className="collapsible-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          {description && <p className="subtle">{description}</p>}
        </div>
        <span className="collapsible-icon">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="collapsible-content">{children}</div>}
    </section>
  )
}

function EventMatrixTable({ matrix }: { matrix: EventBreakdownMonth }) {
  if (!matrix.events.length || !matrix.players.length) {
    return <p className="subtle">No event data is available for this month.</p>
  }

  const events = matrix.events
  const players = matrix.players

  return (
    <div className="table-wrapper">
      <table className="data-table data-table--stacked">
        <thead>
          <tr>
            <th rowSpan={2} className="rank-column">
              #
            </th>
            <th rowSpan={2} className="player-column">
              Player
            </th>
            <th rowSpan={2}>Total</th>
            {events.map((event) => (
              <th key={event.id} colSpan={3}>
                {event.name}
              </th>
            ))}
          </tr>
          <tr>
            {events.flatMap((event) => [
              <th className="matrix-subhead" key={`${event.id}-rank`}>
                Rank
              </th>,
              <th className="matrix-subhead" key={`${event.id}-score`}>
                Score
              </th>,
              <th className="matrix-subhead" key={`${event.id}-points`}>
                Points
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => (
            <tr key={player.playerId}>
              <td className="rank-column">{index + 1}</td>
              <td className="player-cell">
                {player.avatar ? (
                  <img
                    src={player.avatar}
                    alt=""
                    className="player-avatar"
                    loading="lazy"
                  />
                ) : null}
                <span>{player.name}</span>
              </td>
              <td>{player.total.toLocaleString()}</td>
              {events.flatMap((event) => {
                const score = player.scores[event.id]
                return [
                  <td className="matrix-cell" key={`${player.playerId}-${event.id}-rank`}>
                    {score?.rank ?? '—'}
                  </td>,
                  <td className="matrix-cell" key={`${player.playerId}-${event.id}-score`}>
                    {score?.score !== null && score?.score !== undefined
                      ? score.score.toLocaleString()
                      : '—'}
                  </td>,
                  <td className="matrix-cell" key={`${player.playerId}-${event.id}-points`}>
                    {score ? score.points.toLocaleString() : '—'}
                  </td>,
                ]
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DailyMatrixTable({ matrix }: { matrix: DailyBreakdownMonth }) {
  if (!matrix.days.length || !matrix.players.length) {
    return <p className="subtle">No daily data is available for this month.</p>
  }

  const days = matrix.days
  const players = matrix.players

  const formatDayLabel = (iso: string) => {
    const date = new Date(iso)
    if (Number.isNaN(date.valueOf())) return iso
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="table-wrapper">
      <table className="data-table data-table--stacked">
        <thead>
          <tr>
            <th rowSpan={2} className="rank-column">
              #
            </th>
            <th rowSpan={2} className="player-column">
              Player
            </th>
            <th rowSpan={2}>Total</th>
            {days.map((day) => (
              <th key={day.date} colSpan={3}>
                {formatDayLabel(day.date)}
              </th>
            ))}
          </tr>
          <tr>
            {days.flatMap((day) => [
              <th className="matrix-subhead" key={`${day.date}-rank`}>
                Rank
              </th>,
              <th className="matrix-subhead" key={`${day.date}-score`}>
                Score
              </th>,
              <th className="matrix-subhead" key={`${day.date}-points`}>
                Points
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => (
            <tr key={player.playerId}>
              <td className="rank-column">{index + 1}</td>
              <td className="player-cell">
                {player.avatar ? (
                  <img
                    src={player.avatar}
                    alt=""
                    className="player-avatar"
                    loading="lazy"
                  />
                ) : null}
                <span>{player.name}</span>
              </td>
              <td>{player.total.toLocaleString()}</td>
              {days.flatMap((day) => {
                const score = player.scores[day.date]
                return [
                  <td className="matrix-cell" key={`${player.playerId}-${day.date}-rank`}>
                    {score?.rank ?? '—'}
                  </td>,
                  <td className="matrix-cell" key={`${player.playerId}-${day.date}-score`}>
                    {score?.score !== null && score?.score !== undefined
                      ? score.score.toLocaleString()
                      : '—'}
                  </td>,
                  <td className="matrix-cell" key={`${player.playerId}-${day.date}-points`}>
                    {score ? score.points.toLocaleString() : '—'}
                  </td>,
                ]
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function getBonusKey(bonus?: string) {
  const normalized = bonus?.trim().toUpperCase()
  if (!normalized) return ''
  if (normalized === '3W') return '3w'
  if (normalized === '2W') return '2w'
  if (normalized === '2L') return '2l'
  if (normalized === '3L') return '3l'
  return ''
}

type CalendarCell = {
  isoDate: string | null
  dayNumber: number | null
  inMonth: boolean
  hasDaily: boolean
  events: { id: string; name: string }[]
}

function buildCalendar(
  monthKey: string,
  dailyMap: Map<string, DailyGame>,
  eventLookup: Map<string, EventDetails[]>,
) {
  const [yearStr, monthStr] = monthKey.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
    return [] as CalendarCell[][]
  }

  const firstDay = new Date(year, monthIndex, 1)
  const startWeekday = firstDay.getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7
  const cells: CalendarCell[] = []

  for (let index = 0; index < totalCells; index += 1) {
    const dayNumber = index - startWeekday + 1
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cells.push({
        isoDate: null,
        dayNumber: null,
        inMonth: false,
        hasDaily: false,
        events: [],
      })
      continue
    }
    const isoDate = `${monthKey}-${String(dayNumber).padStart(2, '0')}`
    const eventsForDay =
      eventLookup.get(isoDate)?.map((event) => ({
        id: event.id,
        name: event.name,
      })) ?? []
    eventsForDay.sort((a, b) => a.name.localeCompare(b.name))
    cells.push({
      isoDate,
      dayNumber,
      inMonth: true,
      hasDaily: dailyMap.has(isoDate),
      events: eventsForDay,
    })
  }

  const weeks: CalendarCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

function matchRoute(path: string): Route {
  if (path === '/') {
    return { kind: 'home' }
  }
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) {
    return { kind: 'home' }
  }

  if (segments[0] === 'month' && segments[1]) {
    return { kind: 'month', monthKey: decodeURIComponent(segments[1]) }
  }

  if (segments[0] === 'daily' && segments[1]) {
    return { kind: 'daily', date: decodeURIComponent(segments[1]) }
  }

  if (segments[0] === 'event' && segments[1]) {
    return { kind: 'event', eventId: decodeURIComponent(segments[1]) }
  }

  return { kind: 'not-found' }
}

function getEventInitial(name: string) {
  const specialMap: Record<string, string> = {
    'blitz round': 'B',
    evolution: 'E',
    inspiration: 'I',
    'quadruple bonus': 'Q',
    '5+ bonus': '5',
    '4+ words': '4',
  }
  const key = name.toLowerCase()
  if (specialMap[key]) return specialMap[key]
  const match = key.match(/\p{L}|\d/u)
  return match ? match[0].toUpperCase() : '?'
}

function getEventColorSlug(name: string) {
  const normalized = name.toLowerCase()
  if (!eventColorMap.has(normalized)) {
    const assigned = EVENT_COLORS[eventColorMap.size % EVENT_COLORS.length]
    eventColorMap.set(normalized, assigned)
  }
  return eventColorMap.get(normalized) ?? EVENT_COLORS[0]
}
