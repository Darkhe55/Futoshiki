/**
 * 不等式（Futoshiki）题图导入命令行工具。
 *
 * 用法：
 *   node scripts/import-image.mjs <题图.(png|jpg)> [选项]
 *
 * 选项：
 *   --name 名称        题库名称（默认「识图 · n×n」）
 *   --id ID            指定题目 id（覆盖同 id 条目）
 *   --append           写入 data/library.json（默认只预览、不写盘）
 *   --verify           校验解：唯一解 / 多个解 / 无解 / 超时（--append 时默认必须唯一解）
 *   --allow-multi      允许多解题目入库
 *   --map 修正         人工修正识别结果，逗号分隔，可重复：
 *                        r3c5=2   第 3 行第 5 列填 2（0 清除）
 *                        h3e2=1   第 3 行、第 2 与第 3 列之间：1=<，2=>，0 清除
 *                        v3e2=2   第 3 与第 4 行之间、第 2 列：1=∧，2=∨，0 清除
 *   --max-nodes N      解计数搜索节点上限（默认 1500000）
 *   --out FILE         题库文件（默认 data/library.json）
 *   --json             输出机器可读结果
 *
 * 识别用的是与网页「导入」面板同一份 src/game/image-import.ts
 * （Playwright 打开本机 Edge/Chrome 解码图片，再把 TS 注入页面执行）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  analyzePuzzle,
  describeAnalysis,
  formatPuzzleText,
  parsePuzzleText,
  toLibraryEntry,
} from '../src/game/import.ts'
import { horizontalEdgeIndex, verticalEdgeIndex, encodeBoard } from '../src/game/types.ts'

function usage(msg) {
  if (msg) console.error(`\n[import] ${msg}`)
  console.error(
    `\n用法：node scripts/import-image.mjs <题图> [--name 名称] [--id ID] [--append] [--verify]
      [--allow-multi] [--map r3c5=2,h3e2=1,v3e2=2] [--max-nodes N] [--out FILE] [--json]

  默认只预览识别结果；--append 才写入题库。--map 用于人工修正个别格子/大小号。
  例：node scripts/import-image.mjs month.png --verify --append --map r1c1=8`,
  )
  process.exit(1)
}

function parseArgs(argv) {
  const out = {
    image: null,
    name: null,
    id: null,
    append: false,
    verify: false,
    allowMulti: false,
    maxNodes: 1_500_000,
    out: 'data/library.json',
    json: false,
    maps: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) usage(`参数 ${a} 缺少值`)
      return v
    }
    if (a === '--name') out.name = next()
    else if (a === '--id') out.id = next()
    else if (a === '--append') out.append = true
    else if (a === '--verify') out.verify = true
    else if (a === '--allow-multi') out.allowMulti = true
    else if (a === '--json') out.json = true
    else if (a === '--max-nodes') out.maxNodes = Number(next()) || 1_500_000
    else if (a === '--out') out.out = next()
    else if (a === '--map') {
      for (const token of next().split(',')) if (token.trim()) out.maps.push(token.trim())
    } else if (a === '--dry-run') {
      /* 兼容旧参数：预览本来就是默认行为 */
    } else if (a.startsWith('--')) usage(`未知参数 ${a}`)
    else if (!out.image) out.image = a
    else usage(`多余参数 ${a}`)
  }
  if (!out.image) usage('请指定题图路径')
  if (!Number.isInteger(out.maxNodes) || out.maxNodes < 1000) usage('--max-nodes 需要 ≥ 1000')
  return out
}

/** 把 --map token 应用到一个 n×n 题面上；返回错误说明或 null */
function applyMaps(puzzle, tokens) {
  const n = puzzle.width
  for (const token of tokens) {
    let m = /^r(\d+)c(\d+)=(-?\d+)$/.exec(token)
    if (m) {
      const r = Number(m[1]) - 1
      const c = Number(m[2]) - 1
      const v = Number(m[3])
      if (r < 0 || r >= n || c < 0 || c >= n) return `--map ${token}：坐标超出 ${n}×${n}`
      if (v < 0 || v > n) return `--map ${token}：数字应在 0..${n}（0 表示清除）`
      puzzle.givens[r * n + c] = v
      continue
    }
    m = /^h(\d+)e(\d+)=(-?\d+)$/.exec(token)
    if (m) {
      const row = Number(m[1]) - 1
      const col = Number(m[2]) - 1
      const v = Number(m[3])
      if (row < 0 || row >= n || col < 0 || col >= n - 1) {
        return `--map ${token}：横向位置超出 ${n}×${n}（行 1..${n}，边 1..${n - 1}）`
      }
      if (v < 0 || v > 2) return `--map ${token}：大小号应为 0/1/2（1=<，2=>）`
      puzzle.relations[horizontalEdgeIndex(n, col, row)] = v
      continue
    }
    m = /^v(\d+)e(\d+)=(-?\d+)$/.exec(token)
    if (m) {
      const row = Number(m[1]) - 1
      const col = Number(m[2]) - 1
      const v = Number(m[3])
      if (row < 0 || row >= n - 1 || col < 0 || col >= n) {
        return `--map ${token}：竖向位置超出 ${n}×${n}（行 1..${n - 1}，列 1..${n}）`
      }
      if (v < 0 || v > 2) return `--map ${token}：大小号应为 0/1/2（1=∧，2=∨）`
      puzzle.relations[verticalEdgeIndex(n, col, row)] = v
      continue
    }
    return `--map 格式无法识别：「${token}」（示例 r3c5=2 / h3e2=1 / v3e2=2）`
  }
  return null
}

/** 数值列表转可读字符串：有 >9 的值时用逗号分隔，避免两位数字看串 */
function formatValues(values) {
  return values.some((v) => v > 9) ? values.join(',') : values.join('')
}

function readLibrary(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeLibrary(file, list) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

const options = parseArgs(process.argv.slice(2))
const file = path.resolve(options.image)
if (!existsSync(file)) usage(`图片不存在：${file}`)

// —— 识别 ——
let recognized
try {
  const { recognizeImageFile } = await import('./lib/recognize-image.mjs')
  recognized = await recognizeImageFile(file)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (!options.json) {
    console.error(`[import] 图片识别失败：${msg}`)
    console.error(
      '[import] 提示：不等式识图支持 4×4–15×15、值 1–n 的黑白线框题图（>9 可用 A–F 或两位数字表示）；' +
        '其它情况请用浏览器「导入 → 文本」或 --text 导入。',
    )
  } else {
    console.log(JSON.stringify({ ok: false, errors: [msg] }, null, 2))
  }
  process.exit(1)
}

const recognition = recognized.recognition
for (const w of recognized.warnings) console.warn(`[import] 识别提示：${w}`)

// —— 用识别结果构造题面并校验 ——
let puzzle = {
  id: options.id || `futoshiki-image-${Date.now().toString(36)}`,
  name: options.name || `识图 · ${recognition.n}×${recognition.n}`,
  width: recognition.n,
  height: recognition.n,
  difficulty: 'custom',
  givens: recognition.givens.slice(),
  relations: recognition.relations.slice(),
}

if (options.maps.length) {
  const mapError = applyMaps(puzzle, options.maps)
  if (mapError) usage(mapError)
  console.log(`[import] --map 应用了 ${options.maps.length} 处人工修正`)
}

const board = encodeBoard(puzzle.givens, puzzle.relations)
const parsed = parsePuzzleText(board, { name: puzzle.name, id: puzzle.id })
if (parsed.errors.length) {
  for (const err of parsed.errors) console.error(`[import] 错误：${err}`)
  if (options.json) console.log(JSON.stringify({ ok: false, errors: parsed.errors }, null, 2))
  process.exit(1)
}
if (!parsed.puzzle) usage('识别结果无法解析成题面')
puzzle = parsed.puzzle
for (const w of parsed.warnings) console.warn(`[import] 提示：${w}`)

const n = puzzle.width
const givenCount = puzzle.givens.filter((v) => v !== 0).length
const horizontal = puzzle.relations.slice(0, n * (n - 1)).filter((v) => v !== 0).length
const vertical = puzzle.relations.slice(n * (n - 1)).filter((v) => v !== 0).length

if (!options.json) {
  console.log(
    `[import] 识别：${n}×${n} · 预填 ${givenCount} · 横向 ${horizontal} · 竖向 ${vertical} · ` +
      `平均置信度 ${(recognition.confidence * 100).toFixed(0)}%`,
  )
}

// —— 解题校验（默认只预览；--verify / --append 才做唯一解检查）——
let analysis = null
if (options.verify || options.append) {
  analysis = analyzePuzzle(puzzle, options.maxNodes)
}
if (!options.json) {
  if (analysis) {
    console.log(`[import] ${describeAnalysis(analysis).join(' · ')}`)
    if (analysis.solution) console.log(`[import] 解：${formatValues(analysis.solution)}`)
  } else {
    console.log('[import] 只做识别预览，未校验唯一解（加 --verify 校验）。')
  }
  console.log('[import] 题面预览：')
  console.log(formatPuzzleText(puzzle))
}

if (analysis) {
  const multiAllowed = options.allowMulti && analysis.count > 0
  if (!analysis.unique && !multiAllowed) {
    if (analysis.count === 0) console.error('[import] 无解，拒绝入库（请检查题图或用 --map 修正）')
    else if (analysis.timedOut) {
      console.error('[import] 解计数超时，拒绝入库（可调大 --max-nodes）')
    } else if (analysis.count >= 2) {
      console.error(`[import] 解不唯一（至少 ${analysis.count} 个），拒绝入库（可加 --allow-multi）`)
    } else {
      console.error('[import] 无法确认唯一解，拒绝入库（可加 --allow-multi）')
    }
    if (options.json) {
      console.log(JSON.stringify({ ok: false, board, analysis }, null, 2))
    }
    process.exit(1)
  }
}

if (!options.append) {
  if (!options.json) {
    console.log('[import] 预览模式，未写入。加 --append 写入 data/library.json。')
  }
  process.exit(0)
}

// —— 写题库 ——
const outFile = path.resolve(options.out)
const library = readLibrary(outFile)
const entry = toLibraryEntry(puzzle, puzzle.name, analysis.solution)
const index = library.findIndex((x) => x && x.id === entry.id)
if (index >= 0) library[index] = entry
else library.push(entry)
writeLibrary(outFile, library)

if (options.json) {
  console.log(
    JSON.stringify(
      { ok: true, id: entry.id, name: entry.name, board: entry.board, analysis, written: outFile },
      null,
      2,
    ),
  )
} else {
  console.log(`[import] 已写入 ${options.out}：${entry.id}（${entry.name}）${index >= 0 ? '（覆盖）' : ''}`)
  console.log('[import] 浏览器里刷新页面即可看到新题（题库只在启动时加载一次）')
}
