/**
 * 不等式 —— 题目导入
 *
 * 纯 TS，无 DOM 依赖，浏览器与 Node 脚本共用。
 * 支持三种题面格式：JSON、紧凑串 `givens|relations`、三段表格。
 */

import type { Difficulty } from '../core/types'
import {
  decodeBoard,
  encodeBoard,
  encodeCells,
  edgeCount,
  horizontalEdgeIndex,
  verticalEdgeIndex,
  type FutoPuzzle,
} from './types.ts'
import { initialGrid, propagate, solveByRules } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface ParsedPuzzle {
  puzzle: FutoPuzzle | null
  errors: string[]
  warnings: string[]
}

export interface PuzzleAnalysis {
  unique: boolean
  count: number
  timedOut: boolean
  contradiction: boolean
  logicSolved: boolean
  logicSaturated: boolean
  logicProbing: boolean
  solution: number[] | null
  nodes: number
}

export interface ParseOptions {
  name?: string
  id?: string
  minSize?: number
  maxSize?: number
}

const MIN_SIZE = 4
const MAX_SIZE = 12
const DEFAULT_MAX_NODES = 1_500_000

const EMPTY_TOKENS = new Set(['.', '0', '_', '·'])
const DASH_TOKENS = new Set(['.', '0', '-', '_', '·'])

function cleanLine(line: string): string {
  const hash = line.indexOf('#')
  return hash >= 0 ? line.slice(0, hash) : line
}

function tokens(line: string): string[] {
  return cleanLine(line)
    .trim()
    .split(/[\s,，]+/)
    .filter(Boolean)
}

function parseCell(token: string, line: number, col: number, n: number, errors: string[]): number {
  if (EMPTY_TOKENS.has(token)) return 0
  const v = Number(token)
  if (Number.isInteger(v) && v >= 1 && v <= n) return v
  errors.push(`第 ${line} 行第 ${col} 列：无法识别的数字「${token}」`)
  return 0
}

function parseHorizontal(
  token: string,
  line: number,
  col: number,
  errors: string[],
): number {
  if (DASH_TOKENS.has(token)) return 0
  if (token === '<') return 1
  if (token === '>') return 2
  errors.push(`第 ${line} 行第 ${col} 列：无法识别的横向符号「${token}」`)
  return 0
}

function parseVertical(token: string, line: number, col: number, errors: string[]): number {
  if (DASH_TOKENS.has(token)) return 0
  if (token === '^' || token === '∧' || token === '↑') return 1
  if (token === 'v' || token === 'V' || token === '∨' || token === '↓') return 2
  errors.push(`第 ${line} 行第 ${col} 列：无法识别的竖向符号「${token}」`)
  return 0
}

function validatePuzzle(
  n: number,
  givens: number[],
  relations: number[],
  errors: string[],
  minSize: number,
  maxSize: number,
): void {
  if (!Number.isInteger(n) || n < minSize || n > maxSize) {
    errors.push(`题面尺寸 ${n}×${n} 超出支持范围 ${minSize}..${maxSize}`)
    return
  }
  if (givens.length !== n * n) {
    errors.push(`预填数量为 ${givens.length}，应为 ${n * n}`)
    return
  }
  if (relations.length !== edgeCount(n)) {
    errors.push(`关系数量为 ${relations.length}，应为 ${edgeCount(n)}`)
    return
  }
  const grid = initialGrid(givens, n * n)
  if (!propagate(grid, relations, n)) {
    errors.push('预填数字与大小号关系立即矛盾')
  }
}

interface Draft {
  n: number
  givens: number[]
  relations: number[]
  name?: string
  id?: string
}

function tableParse(
  lines: string[],
  options: ParseOptions,
  errors: string[],
): Draft | null {
  const sections: Record<'size' | 'givens' | 'horizontal' | 'vertical', string[]> = {
    size: [],
    givens: [],
    horizontal: [],
    vertical: [],
  }
  let current: keyof typeof sections | null = null
  let labeled = false

  for (const raw of lines) {
    const line = cleanLine(raw).trim()
    if (!line) continue
    const m = /^(size|givens|horizontal|vertical|尺寸|预填|横向|竖向)\s*[:：]\s*(.*)$/i.exec(line)
    if (m) {
      labeled = true
      const key = m[1]!.toLowerCase()
      current =
        key === 'size' || key === '尺寸'
          ? 'size'
          : key === 'givens' || key === '预填'
            ? 'givens'
            : key === 'horizontal' || key === '横向'
              ? 'horizontal'
              : 'vertical'
      const rest = m[2]!.trim()
      if (rest) sections[current].push(rest)
      continue
    }
    if (!current) {
      errors.push(`无法确定分区，请先写「givens:」等分区标签：「${line}」`)
      return null
    }
    sections[current].push(line)
  }

  if (!labeled) {
    // 无标签时按行数推断：givens n 行 + 横向 n 行 + 竖向 (n-1) 行
    const body = lines.map((l) => cleanLine(l).trim()).filter(Boolean)
    for (let n = options.minSize ?? MIN_SIZE; n <= (options.maxSize ?? MAX_SIZE); n++) {
      if (body.length !== n + n + (n - 1)) continue
      const g = body.slice(0, n)
      const h = body.slice(n, n + n)
      const v = body.slice(n + n)
      if (
        g.every((l) => tokens(l).length === n) &&
        h.every((l) => tokens(l).length === n - 1) &&
        v.every((l) => tokens(l).length === n)
      ) {
        sections.givens = g
        sections.horizontal = h
        sections.vertical = v
        labeled = true
        break
      }
    }
    if (!labeled) {
      errors.push('无法识别题面格式：请使用带 givens/horizontal/vertical 标签的三段表格，或 `预填|关系` 紧凑串')
      return null
    }
  }

  let n = 0
  if (sections.size.length) {
    const sizeText = sections.size[0]!.trim()
    const m = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(sizeText) ?? /^(\d+)$/.exec(sizeText)
    if (!m) {
      errors.push(`无法识别尺寸「${sizeText}」`)
      return null
    }
    const w = Number(m[1])
    const h = m[2] !== undefined ? Number(m[2]) : w
    if (w !== h) {
      errors.push(`只支持方阵，当前为 ${w}×${h}`)
      return null
    }
    n = w
  }
  if (!n) n = sections.givens.length

  if (!n) {
    errors.push('题面为空')
    return null
  }

  const givens: number[] = []
  for (let y = 0; y < n; y++) {
    const row = sections.givens[y]
    if (row === undefined) {
      errors.push(`预填区缺少第 ${y + 1} 行（需要 ${n} 行）`)
      return null
    }
    const list = tokens(row)
    if (list.length !== n) {
      errors.push(`预填区第 ${y + 1} 行有 ${list.length} 列，应为 ${n}`)
      return null
    }
    for (let x = 0; x < n; x++) givens.push(parseCell(list[x]!, y + 1, x + 1, n, errors))
  }

  const horizontal: number[] = []
  for (let y = 0; y < n; y++) {
    const row = sections.horizontal[y]
    if (row === undefined) {
      errors.push(`横向关系区缺少第 ${y + 1} 行（需要 ${n} 行）`)
      return null
    }
    const list = tokens(row)
    if (list.length !== n - 1) {
      errors.push(`横向关系区第 ${y + 1} 行有 ${list.length} 个符号，应为 ${n - 1}`)
      return null
    }
    for (let x = 0; x < n - 1; x++) {
      horizontal.push(parseHorizontal(list[x]!, y + 1, x + 1, errors))
    }
  }

  const vertical: number[] = []
  for (let y = 0; y < n - 1; y++) {
    const row = sections.vertical[y]
    if (row === undefined) {
      errors.push(`竖向关系区缺少第 ${y + 1} 行（需要 ${n - 1} 行）`)
      return null
    }
    const list = tokens(row)
    if (list.length !== n) {
      errors.push(`竖向关系区第 ${y + 1} 行有 ${list.length} 个符号，应为 ${n}`)
      return null
    }
    for (let x = 0; x < n; x++) {
      vertical.push(parseVertical(list[x]!, y + 1, x + 1, errors))
    }
  }

  const relations = new Array<number>(edgeCount(n)).fill(0)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n - 1; x++) {
      relations[horizontalEdgeIndex(n, x, y)] = horizontal[y * (n - 1) + x] ?? 0
    }
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n; x++) {
      relations[verticalEdgeIndex(n, x, y)] = vertical[y * n + x] ?? 0
    }
  }

  return { n, givens, relations, name: options.name, id: options.id }
}

function draftFromBoard(
  board: string,
  n: number,
  options: ParseOptions,
  errors: string[],
): Draft | null {
  const decoded = decodeBoard(board, n)
  if (!decoded) {
    errors.push('紧凑串解码失败：请检查预填/关系长度与尺寸')
    return null
  }
  return { n, givens: decoded.givens, relations: decoded.relations, name: options.name, id: options.id }
}

export function parsePuzzleText(text: string, options: ParseOptions = {}): ParsedPuzzle {
  const errors: string[] = []
  const warnings: string[] = []
  const raw = text.trim()
  if (!raw) return { puzzle: null, errors: ['题面为空'], warnings }

  const minSize = options.minSize ?? MIN_SIZE
  const maxSize = options.maxSize ?? MAX_SIZE

  let draft: Draft | null = null

  if (raw.startsWith('{')) {
    let record: Record<string, unknown>
    try {
      record = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      return { puzzle: null, errors: [`JSON 解析失败：${String(err)}`], warnings }
    }
    const width = typeof record.width === 'number' ? record.width : undefined
    const height = typeof record.height === 'number' ? record.height : width
    if (width !== undefined && height !== undefined && width !== height) {
      errors.push(`只支持方阵，当前为 ${width}×${height}`)
    } else if (typeof record.board === 'string' && width !== undefined) {
      draft = draftFromBoard(
        record.board,
        width,
        {
          ...options,
          name: typeof record.name === 'string' ? record.name : options.name,
          id: typeof record.id === 'string' ? record.id : options.id,
        },
        errors,
      )
    } else if (Array.isArray(record.givens) && Array.isArray(record.relations)) {
      const n = width ?? Math.round(Math.sqrt(record.givens.length))
      draft = {
        n,
        givens: record.givens.map((v) => Number(v)),
        relations: record.relations.map((v) => Number(v)),
        name: typeof record.name === 'string' ? record.name : options.name,
        id: typeof record.id === 'string' ? record.id : options.id,
      }
    } else if (typeof record.givens === 'string' && typeof record.relations === 'string') {
      const n = width ?? Math.round(Math.sqrt(record.givens.length))
      draft = {
        n,
        givens: Array.from(record.givens, (c) => Number(c) || 0),
        relations: Array.from(record.relations, (c) => Number(c) || 0),
        name: typeof record.name === 'string' ? record.name : options.name,
        id: typeof record.id === 'string' ? record.id : options.id,
      }
    } else {
      errors.push('JSON 需要 board+width，或 givens+relations')
    }
  } else {
    const compact = /^([0-9]+)\|([0-9]+)$/.exec(raw.replace(/\s+/g, ''))
    if (compact) {
      const givens = compact[1]!
      const relationText = compact[2]!
      const n = Math.round(Math.sqrt(givens.length))
      if (n * n !== givens.length) {
        errors.push(`紧凑串预填长度 ${givens.length} 不是完全平方数`)
      } else if (relationText.length !== edgeCount(n)) {
        errors.push(`紧凑串关系长度 ${relationText.length}，应为 ${edgeCount(n)}`)
      } else {
        draft = draftFromBoard(`${givens}|${relationText}`, n, options, errors)
      }
    } else {
      draft = tableParse(raw.split(/\r?\n/), options, errors)
    }
  }

  if (!draft) return { puzzle: null, errors, warnings }

  validatePuzzle(draft.n, draft.givens, draft.relations, errors, minSize, maxSize)
  if (errors.length) return { puzzle: null, errors, warnings }

  const n = draft.n
  const board = encodeBoard(draft.givens, draft.relations)
  const diff: Difficulty = 'custom'
  const puzzle: FutoPuzzle = {
    id: draft.id ?? `futoshiki-custom-${n}x${n}-${boardHash(board)}`,
    name: draft.name?.trim() || `导入 · ${n}×${n}`,
    width: n,
    height: n,
    difficulty: diff,
    givens: draft.givens,
    relations: draft.relations,
  }

  const givenCount = puzzle.givens.filter((v) => v !== 0).length
  if (givenCount === 0) warnings.push('题面没有预填数字，可能依赖大量大小号')

  return { puzzle, errors, warnings }
}

export function analyzePuzzle(p: FutoPuzzle, maxNodes = DEFAULT_MAX_NODES): PuzzleAnalysis {
  const n = p.width
  const counted = countSolutions(p.givens, p.relations, n, 2, maxNodes)
  const rules = solveByRules(p.givens, p.relations, n, true, 240)
  const solution = counted.solution ?? (rules.ok ? rules.solution : null)
  return {
    unique: !counted.timedOut && counted.count === 1,
    count: counted.count,
    timedOut: counted.timedOut,
    contradiction: rules.contradiction,
    logicSolved: rules.ok && !!rules.solution,
    logicSaturated: rules.saturated,
    logicProbing: rules.usedProbing,
    solution,
    nodes: counted.nodes,
  }
}

export function formatPuzzleText(p: FutoPuzzle): string {
  const n = p.width
  const cell = (v: number): string => (v ? String(v) : '.')
  const horizontal = (v: number): string => (v === 1 ? '<' : v === 2 ? '>' : '.')
  const vertical = (v: number): string => (v === 1 ? '^' : v === 2 ? 'v' : '.')

  const lines: string[] = [`size: ${n}`, 'givens:']
  for (let y = 0; y < n; y++) {
    const row: string[] = []
    for (let x = 0; x < n; x++) row.push(cell(p.givens[y * n + x] ?? 0))
    lines.push(row.join(' '))
  }
  lines.push('horizontal:')
  for (let y = 0; y < n; y++) {
    const row: string[] = []
    for (let x = 0; x < n - 1; x++) {
      row.push(horizontal(p.relations[horizontalEdgeIndex(n, x, y)] ?? 0))
    }
    lines.push(row.join(' '))
  }
  lines.push('vertical:')
  for (let y = 0; y < n - 1; y++) {
    const row: string[] = []
    for (let x = 0; x < n; x++) {
      row.push(vertical(p.relations[verticalEdgeIndex(n, x, y)] ?? 0))
    }
    lines.push(row.join(' '))
  }
  return `${lines.join('\n')}\n`
}

export function toLibraryEntry(
  p: FutoPuzzle,
  name: string,
  solution?: number[] | null,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: p.id,
    name,
    width: p.width,
    height: p.height,
    difficulty: 'custom',
    savedAt: Date.now(),
    board: encodeBoard(p.givens, p.relations),
  }
  if (solution && solution.length === p.width * p.height) {
    entry.solution = encodeCells(solution)
  }
  return entry
}

export function boardHash(board: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < board.length; i++) {
    h ^= board.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function describeAnalysis(a: PuzzleAnalysis): string[] {
  const out: string[] = []
  if (a.timedOut) out.push(`解计数超时（${a.nodes} 节点）`)
  else if (a.count === 0) out.push('无解')
  else if (a.count === 1) out.push('解唯一')
  else out.push(`多解（至少 ${a.count} 个）`)
  if (a.contradiction) out.push('规则推导发现矛盾')
  else if (a.logicSolved && a.logicSaturated) out.push('逻辑可推满')
  else if (a.logicSolved) out.push('逻辑可解但需回溯')
  else out.push('逻辑推不动，需要搜索')
  out.push(`搜索 ${a.nodes} 节点`)
  return out
}
