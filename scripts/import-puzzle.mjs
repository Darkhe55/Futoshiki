/**
 * 不等式题目导入工具
 *
 * 文本：
 *   node scripts/import-puzzle.mjs --text scripts/fixtures/9x9.txt --name "九阶不等式（导入）"
 *   node scripts/import-puzzle.mjs --text -   # 从 stdin
 * 图片：
 *   node scripts/import-puzzle.mjs --image path/to/board.jpg --dry-run
 *
 * 选项：
 *   --dry-run       只解析/校验，不写盘
 *   --allow-multi   允许多解
 *   --max-nodes N   解计数上限（默认 1500000）
 *   --out FILE      目标题库文件（默认 data/library.json）
 *   --json          输出机器可读结果
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
import { encodeBoard } from '../src/game/types.ts'

function parseArgs(argv) {
  const out = {
    text: null,
    image: null,
    name: null,
    id: null,
    out: 'data/library.json',
    dryRun: false,
    allowMulti: false,
    maxNodes: 1_500_000,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`参数 ${arg} 缺少值`)
      return v
    }
    switch (arg) {
      case '--text':
        out.text = next()
        break
      case '--image':
        out.image = next()
        break
      case '--name':
        out.name = next()
        break
      case '--id':
        out.id = next()
        break
      case '--out':
        out.out = next()
        break
      case '--max-nodes':
        out.maxNodes = Number(next())
        break
      case '--dry-run':
        out.dryRun = true
        break
      case '--allow-multi':
        out.allowMulti = true
        break
      case '--json':
        out.json = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`未知参数：${arg}`)
    }
  }
  return out
}

function printHelp() {
  console.log(`不等式题目导入工具

用法：
  node scripts/import-puzzle.mjs --text <file|-> [--name 名称]
  node scripts/import-puzzle.mjs --image <file> [--name 名称]

选项：
  --dry-run        只解析/校验，不写盘
  --allow-multi    允许多解（默认要求唯一解）
  --max-nodes N    解计数节点上限（默认 1500000）
  --out FILE       题库文件（默认 data/library.json）
  --json           输出机器可读结果

文本格式：
  1) 带标签的三段表格：size / givens / horizontal / vertical
  2) 紧凑串：givens|relations
  3) JSON：{ name, width, height, board }`)
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function readLibrary(file) {
  try {
    const text = readFileSync(file, 'utf8')
    const data = JSON.parse(text)
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

async function readInput(options) {
  if (options.image) {
    const { recognizeImageFile } = await import('./lib/recognize-image.mjs')
    const file = path.resolve(options.image)
    if (!existsSync(file)) throw new Error(`图片不存在：${file}`)
    return recognizeImageFile(file)
  }
  if (options.text === '-') return readStdin()
  if (options.text) {
    const file = path.resolve(options.text)
    if (!existsSync(file)) throw new Error(`文本不存在：${file}`)
    return readFileSync(file, 'utf8')
  }
  if (process.stdin.isTTY) {
    printHelp()
    throw new Error('请用 --text <file>、--image <file> 或管道输入题面')
  }
  return readStdin()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const input = await readInput(options)
  const text = typeof input === 'string' ? input : input.text
  const inputWarnings = typeof input === 'string' ? [] : (input.warnings ?? [])
  const parsed = parsePuzzleText(text, {
    name: options.name ?? undefined,
    id: options.id ?? undefined,
  })
  parsed.warnings.push(...inputWarnings)

  if (parsed.errors.length) {
    for (const err of parsed.errors) console.error(`[import] 错误：${err}`)
    if (options.json) {
      console.log(JSON.stringify({ ok: false, errors: parsed.errors }, null, 2))
    }
    process.exitCode = 1
    return
  }

  const puzzle = parsed.puzzle
  if (!puzzle) {
    console.error('[import] 没有得到题面')
    process.exitCode = 1
    return
  }

  const analysis = analyzePuzzle(puzzle, options.maxNodes)
  const n = puzzle.width
  const givenCount = puzzle.givens.filter((v) => v !== 0).length
  const horizontal = puzzle.relations
    .slice(0, n * (n - 1))
    .filter((v) => v !== 0).length
  const vertical = puzzle.relations
    .slice(n * (n - 1))
    .filter((v) => v !== 0).length

  if (!options.json) {
    console.log(`[import] ${n}×${n} · 预填 ${givenCount} · 横向 ${horizontal} · 竖向 ${vertical}`)
    console.log(`[import] ${describeAnalysis(analysis).join(' · ')}`)
    if (analysis.solution) console.log(`[import] 解：${analysis.solution.join('')}`)
    for (const w of parsed.warnings) console.warn(`[import] 提示：${w}`)
  }

  const result = {
    ok: true,
    id: puzzle.id,
    name: puzzle.name,
    width: n,
    height: n,
    givens: puzzle.givens.join(puzzle.givens.some((v) => v > 9) ? ',' : ''),
    relations: puzzle.relations.join(''),
    board: encodeBoard(puzzle.givens, puzzle.relations),
    givenCount,
    horizontal,
    vertical,
    analysis,
    warnings: parsed.warnings,
    written: false,
  }

  if (!analysis.unique && !options.allowMulti) {
    if (analysis.count === 0) console.error('[import] 无解，拒绝入库')
    else if (analysis.timedOut) console.error('[import] 解计数超时，拒绝入库（可调大 --max-nodes）')
    else console.error(`[import] 解不唯一（至少 ${analysis.count} 个），拒绝入库（可加 --allow-multi）`)
    if (options.json) console.log(JSON.stringify({ ...result, ok: false }, null, 2))
    process.exitCode = 1
    return
  }

  if (!options.dryRun) {
    const outFile = path.resolve(options.out)
    const library = readLibrary(outFile)
    const entry = toLibraryEntry(puzzle, puzzle.name, analysis.solution)
    const index = library.findIndex((x) => x && x.id === entry.id)
    if (index >= 0) library[index] = entry
    else library.push(entry)
    writeLibrary(outFile, library)
    result.written = true
    if (!options.json) {
      console.log(
        `[import] 写入 ${options.out}：${entry.id}（${entry.name}）${index >= 0 ? '（覆盖）' : ''}`,
      )
      console.log('[import] 浏览器里刷新页面即可看到新题（题库只在启动时加载一次）')
    }
  } else if (!options.json) {
    console.log('[import] dry-run：未写盘')
    console.log(formatPuzzleText(puzzle))
  }

  if (options.json) console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(`[import] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
