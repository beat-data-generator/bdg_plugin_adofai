import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const ADOFAI = require('adofai')

const parser = new ADOFAI.Parsers.StringParser()

function isEventActive(event) {
  if (event.active === false || event.active === 'Disabled') return false
  if (event.disabled?.active === true) return false
  if (event.editorOnly === true) return false
  return true
}

function computeTimeline(level) {
  const tiles = level.tiles
  const settings = level.settings || {}
  const n = tiles.length
  const eventsByFloor = new Map()
  for (const action of level.actions || []) {
    if (!action) continue
    let list = eventsByFloor.get(action.floor)
    if (!list) eventsByFloor.set(action.floor, (list = []))
    list.push(action)
  }

  const startTimes = new Array(n).fill(0)
  const bpmAt = new Array(n).fill(settings.bpm || 100)
  const isCWAt = new Array(n).fill(true)
  let totalTime = 0
  let currentBPM = settings.bpm || 100
  let isCW = true

  for (let i = 0; i < n - 1; i++) {
    let extraRotation = 0
    const events = eventsByFloor.get(i)
    if (events) {
      for (const event of events) {
        if (!isEventActive(event)) continue
        if (event.eventType === 'Twirl') isCW = !isCW
        else if (event.eventType === 'SetSpeed') {
          currentBPM =
            event.speedType === 'Multiplier'
              ? currentBPM * event.bpmMultiplier
              : event.beatsPerMinute
        } else if (event.eventType === 'Pause') {
          extraRotation += (event.duration || 0) / 2
        }
      }
    }
    isCWAt[i] = isCW
    bpmAt[i] = currentBPM

    const pivot = tiles[i]
    let totalAngle
    if (i === 0) {
      const cdTicks = settings.countdownTicks || 4
      const angleDeg = pivot.angle !== undefined ? pivot.angle : 180
      const movedDeg = (((180 + angleDeg) % 360) + 360) % 360
      totalAngle = (((cdTicks - 1) * 180 + movedDeg) * Math.PI) / 180
    } else if (pivot.direction === 999) {
      totalAngle = 0
    } else {
      const relativeAngle = pivot.angle !== undefined ? pivot.angle : 180
      totalAngle = (relativeAngle * Math.PI) / 180
    }
    if (isCW) totalAngle = -totalAngle
    if (isCW) totalAngle -= extraRotation * 2 * Math.PI
    else totalAngle += extraRotation * 2 * Math.PI

    const rotationAmount = Math.abs(totalAngle) / (2 * Math.PI)
    const duration = rotationAmount * 2 * (60 / currentBPM)
    totalTime += duration
    startTimes[i + 1] = totalTime
  }

  const lastEvents = eventsByFloor.get(n - 1)
  if (lastEvents) {
    for (const event of lastEvents) {
      if (!isEventActive(event)) continue
      if (event.eventType === 'Twirl') isCW = !isCW
      else if (event.eventType === 'SetSpeed') {
        currentBPM =
          event.speedType === 'Multiplier'
            ? currentBPM * event.bpmMultiplier
            : event.beatsPerMinute
      }
    }
  }
  isCWAt[n - 1] = isCW
  bpmAt[n - 1] = currentBPM

  return { startTimes, bpmAt, isCWAt }
}

function formatTimecode(ms) {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3600000)
  const m = Math.floor((total % 3600000) / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const milli = total % 1000
  const pad = (value, width) => String(value).padStart(width, '0')
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`
}

function formatSeconds(seconds) {
  return seconds.toFixed(3)
}

function formatMs(ms) {
  return String(Math.round(ms))
}

async function readChart(inputPath) {
  const buffer = fs.readFileSync(inputPath)
  const ext = path.extname(inputPath).toLowerCase()
  const isZip = ext === '.zip' || (buffer[0] === 0x50 && buffer[1] === 0x4b)
  if (!isZip) return buffer.toString('utf8')

  const zip = await JSZip.loadAsync(buffer)
  const priority = ['level.adofai', 'main.adofai', 'backup.adofai']
  const names = Object.keys(zip.files)
  let target = priority.find((name) => names.includes(name))
  if (!target) target = names.find((name) => name.toLowerCase().endsWith('.adofai'))
  if (!target) target = names.find((name) => name.toLowerCase().endsWith('.json'))
  if (!target) throw new Error('压缩包内没有找到 .adofai / .json 谱面文件')
  return zip.files[target].async('string')
}

function parseArgs(argv) {
  const opts = {
    input: null,
    out: null,
    format: 'tc',
    index: false,
    offset: false,
    startFirst: false,
    includeMidspin: false,
    includeStart: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '-o':
      case '--out':
        opts.out = argv[++i]
        break
      case '--format':
        opts.format = argv[++i]
        break
      case '--index':
        opts.index = true
        break
      case '--offset':
        opts.offset = true
        break
      case '--start-first':
        opts.startFirst = true
        break
      case '--include-midspin':
        opts.includeMidspin = true
        break
      case '--include-start':
        opts.includeStart = true
        break
      case '-h':
      case '--help':
        opts.help = true
        break
      default:
        if (!arg.startsWith('-') && !opts.input) opts.input = arg
        else throw new Error(`未知参数: ${arg}`)
    }
  }
  return opts
}

const USAGE = `用法: node scripts/adofai-to-timestamps.mjs <谱面.adofai|谱面.zip> [选项]

将 ADOFAI 谱面转换为每个砖块的打击时刻（时间戳）列表。
默认输出每个砖块落地的时刻（跳过起点砖块与 midspin 即瞬时砖块）。

选项:
  -o, --out <文件>      输出到文件（默认写到标准输出）
  --format <tc|sec|ms>  输出格式 tc=HH:MM:SS.mmm(默认), sec=秒, ms=毫秒
  --index               在每行前加上砖块序号
  --offset              叠加 settings.offset（对齐音乐时间）
  --start-first         以第一个打击点为 0 重新计时
  --include-midspin     同时输出 midspin 等瞬时砖块
  --include-start       同时输出起点砖块(floor 0)
  -h, --help            显示帮助

示例:
  node scripts/adofai-to-timestamps.mjs main.adofai > times.txt
  node scripts/adofai-to-timestamps.mjs chart.zip --format sec --index`

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || !opts.input) {
    process.stdout.write(USAGE + '\n')
    process.exit(opts.help ? 0 : 1)
  }

  if (!['tc', 'sec', 'ms'].includes(opts.format)) {
    throw new Error(`不支持的格式: ${opts.format}（可选 tc / sec / ms）`)
  }

  const content = await readChart(opts.input)
  const level = new ADOFAI.Level(content, parser)
  await level.load()

  const settings = level.settings || {}
  const { startTimes, bpmAt } = computeTimeline(level)
  const offsetSeconds = opts.offset ? (settings.offset || 0) / 1000 : 0

  const records = []
  if (opts.includeStart) {
    records.push({ index: 0, time: startTimes[0] + offsetSeconds, bpm: bpmAt[0] })
  }
  for (let i = 1; i < level.tiles.length; i++) {
    const tile = level.tiles[i]
    const isMidspin = tile.direction === 999 || tile.angle === 0
    if (isMidspin && !opts.includeMidspin) continue
    records.push({ index: i, time: startTimes[i] + offsetSeconds, bpm: bpmAt[i] })
  }

  const base = opts.startFirst && records.length > 0 ? records[0].time : 0

  const lines = records.map((record) => {
    const seconds = record.time - base
    const value =
      opts.format === 'tc'
        ? formatTimecode(seconds * 1000)
        : opts.format === 'sec'
          ? formatSeconds(seconds)
          : formatMs(seconds * 1000)
    if (!opts.index) return value
    return `${String(record.index).padStart(6, '0')}  ${value}`
  })

  const text = lines.join('\n') + (lines.length ? '\n' : '')
  if (opts.out) {
    fs.writeFileSync(opts.out, text, 'utf8')
  } else {
    process.stdout.write(text)
  }

  const lastTime = records.length ? records[records.length - 1].time - base : 0
  process.stderr.write(
    `[adofai-to-timestamps] 文件: ${path.basename(opts.input)}\n` +
      `[adofai-to-timestamps] 砖块总数: ${level.tiles.length}, 打击点: ${records.length}\n` +
      `[adofai-to-timestamps] BPM: ${settings.bpm || 100}, countdownTicks: ${settings.countdownTicks || 4}` +
      `${opts.offset ? `, offset: ${settings.offset || 0}ms` : ''}\n` +
      `[adofai-to-timestamps] 时长: ${formatTimecode(lastTime * 1000)}\n` +
      `[adofai-to-timestamps] 输出: ${opts.out || 'stdout'}\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`错误: ${error && error.message ? error.message : error}\n`)
  process.exit(1)
})
