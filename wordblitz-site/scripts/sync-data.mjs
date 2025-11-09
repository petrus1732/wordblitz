import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(process.cwd(), '..')
const siteRoot = process.cwd()
const publicDataDir = path.join(siteRoot, 'public', 'data')

const filesToCopy = [
  'daily_scores.csv',
  'daily_details.json',
  'event_details.json',
  'event_rankings.json',
  'points.json',
]

fs.mkdirSync(publicDataDir, { recursive: true })

filesToCopy.forEach((fileName) => {
  const source = path.join(projectRoot, fileName)
  const destination = path.join(publicDataDir, fileName)
  if (!fs.existsSync(source)) {
    console.warn(`Skipping ${fileName}; source file not found at ${source}`)
    return
  }
  fs.copyFileSync(source, destination)
  console.log(`Copied ${fileName} -> public/data/${fileName}`)
})
