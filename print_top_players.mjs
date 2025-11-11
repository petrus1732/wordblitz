import fs from 'node:fs'
import path from 'node:path'

function ensureMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    throw new Error('Usage: node print_top_players.mjs YYYY-MM')
  }
  return value
}

function main() {
  try {
    const month = ensureMonth(process.argv[2])
    const pointsPath = path.resolve('./points.json')
    if (!fs.existsSync(pointsPath)) {
      throw new Error(`Cannot find points.json at ${pointsPath}`)
    }

    const raw = fs.readFileSync(pointsPath, 'utf8')
    const data = JSON.parse(raw)
    const rows = data[month]
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`No leaderboard data found for ${month}.`)
      return
    }

    rows
      .slice(0, 20)
      .forEach((player, index) => {
        console.log(`${player.name} - ${player.totalPoints}`)
      })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

main()
