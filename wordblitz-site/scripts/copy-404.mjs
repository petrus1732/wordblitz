import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('./dist')
const source = path.join(distDir, 'index.html')
const target = path.join(distDir, '404.html')

if (!fs.existsSync(source)) {
  console.error(`[copy-404] Cannot find ${source}. Run "npm run build" first.`)
  process.exit(1)
}

fs.copyFileSync(source, target)
console.log('[copy-404] Copied index.html to 404.html')
