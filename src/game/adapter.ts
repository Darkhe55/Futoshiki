/**
 * ════════════════════════════════════════════════════════════════════
 *  不等式（Futoshiki）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：0 = 未填，1..n = 数字。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  decodeBoard,
  decodeCells,
  edgeCount,
  encodeBoard,
  encodeCells,
  type FutoPuzzle,
} from './types'
import { analyzePuzzle, formatPuzzleText, parsePuzzleText, type ParsedPuzzle } from './import'
import { recognizeBoard } from './image-import'

const meta = {
  title: '不等式',
  tagline: '拉丁方填数 —— 让每一个 < 与 > 都成立',
  footerNote:
    '规则：在 n×n 格中填入 1..n，每行每列数字不重复；格间的大小号必须满足（左/上 < 右/下 或相反）。预填数字不能修改。',
  storageKeyPrefix: 'futoshiki',
  customIdPrefix: 'futoshiki-custom-',
  customMinW: 4,
  customMinH: 4,
  customMaxW: 9,
  customMaxH: 9,
  targetKind: 'cell' as const,
}

const VALUE_CYCLE: Array<number | null> = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9]

function edgeSign(v: number | null, dir: 'h' | 'v'): string {
  if (v !== 1 && v !== 2) return ''
  if (dir === 'h') return v === 1 ? '<' : '>'
  return v === 1 ? '∧' : '∨'
}

const custom: CustomSupport = {
  mode: 'hybrid',
  valueCycle: VALUE_CYCLE,
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : String(v)),
  cellClass: (v) => (v == null ? '' : `r${v}`),
  hint: '点击格子循环填数；点击格间符号循环：无 → < → >（竖向为 ∧ / ∨）。',
  edgeValueCycle: [null, 1, 2],
  edgeLabel: (v) => edgeSign(v, 'h'),
  edgeLabelFor: (v, dir) => edgeSign(v, dir),
  makePuzzle: (w, h, grid, existingId) => ({
    id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    givens: grid.map((v) => v ?? 0),
    relations: new Array<number>(edgeCount(w)).fill(0),
  }),
  makePuzzleHybrid: (w, h, grid, edges, existingId) => ({
    id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    givens: grid.map((v) => v ?? 0),
    relations: edges.map((v) => v ?? 0),
  }),
  splitPuzzle: (p) => {
    const fp = p as FutoPuzzle
    const n = fp.width
    if (fp.height !== n) return null
    if ((fp.givens?.length ?? 0) !== n * n || (fp.relations?.length ?? 0) !== edgeCount(n)) {
      return null
    }
    return {
      grid: fp.givens.map((v) => (v ? v : null)),
      edges: fp.relations.map((v) => (v ? v : null)),
    }
  },
  encodePuzzle: (p) => {
    const fp = p as FutoPuzzle
    const out: Record<string, unknown> = {
      board: encodeBoard(fp.givens ?? [], fp.relations ?? []),
    }
    if (fp.solution && fp.solution.length === fp.width * fp.height) {
      out.solution = encodeCells(fp.solution)
    }
    return out
  },
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    if (record.width !== record.height) return null
    const n = record.width
    if (typeof record.board !== 'string') return null
    const decoded = decodeBoard(record.board, n)
    if (!decoded) return null
    const solution =
      typeof record.solution === 'string'
        ? decodeCells(record.solution, n * n, n) ?? undefined
        : undefined
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${n}×${n}`,
      width: n,
      height: n,
      difficulty: 'custom',
      givens: decoded.givens,
      relations: decoded.relations,
      solution,
    } satisfies FutoPuzzle
  },
  textImport: {
    placeholder: '粘贴题面：支持 givens/horizontal/vertical 三段表格、givens|relations 紧凑串或 JSON',
    sample: builtinPuzzles[0] ? formatPuzzleText(builtinPuzzles[0] as FutoPuzzle) : '',
    parse: (text, name) => importCandidate(parsePuzzleText(text, { name }), name),
    format: (p) => formatPuzzleText(p as FutoPuzzle),
  },
  imageImport: {
    recognize: (image, name) => {
      try {
        const result = recognizeBoard(image)
        const parsed = parsePuzzleText(`${result.givens.join('')}|${result.relations.join('')}`, {
          name,
        })
        const candidate = importCandidate(parsed, name)
        return {
          ...candidate,
          overlay: result.overlay,
          warnings: [...result.warnings, ...candidate.warnings],
        }
      } catch (err) {
        return {
          puzzle: null,
          summary: [],
          errors: [err instanceof Error ? err.message : String(err)],
          warnings: [],
        }
      }
    },
  },
}

function importCandidate(parsed: ParsedPuzzle, name?: string): {
  puzzle: FutoPuzzle | null
  summary: string[]
  errors: string[]
  warnings: string[]
} {
  if (!parsed.puzzle) {
    return { puzzle: null, summary: [], errors: parsed.errors, warnings: parsed.warnings }
  }
  const puzzle = parsed.puzzle
  if (name?.trim()) puzzle.name = name.trim()
  const analysis = analyzePuzzle(puzzle)
  if (!puzzle.solution && analysis.solution) puzzle.solution = analysis.solution
  const n = puzzle.width
  const givens = puzzle.givens.filter((v) => v !== 0).length
  const horizontal = puzzle.relations.slice(0, n * (n - 1)).filter((v) => v !== 0).length
  const vertical = puzzle.relations.slice(n * (n - 1)).filter((v) => v !== 0).length
  const summary = [
    `尺寸 ${n}×${n}`,
    `预填 ${givens} · 横向 ${horizontal} · 竖向 ${vertical}`,
    analysis.timedOut
      ? `解计数超时（${analysis.nodes} 节点）`
      : analysis.count === 1
        ? '解唯一'
        : analysis.count === 0
          ? '无解'
          : `多解（至少 ${analysis.count} 个）`,
    analysis.contradiction
      ? '规则推导发现矛盾'
      : analysis.logicSolved && analysis.logicSaturated
        ? '逻辑可推满'
        : analysis.logicSolved
          ? '逻辑可解但需回溯'
          : '逻辑推不动，需要搜索',
  ]
  const warnings = [...parsed.warnings]
  if (!analysis.unique) {
    if (analysis.count === 0) warnings.push('该题面当前无解，请检查预填与大小号')
    else if (!analysis.timedOut) warnings.push('该题面当前不唯一，可继续编辑修正')
  }
  return { puzzle, summary, errors: [], warnings }
}

function playForMove(move: Move, streak: number): void {
  if (move.from === 0) playPluck(streak, 1.1)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  getPuzzleSolution: (puzzle) => (puzzle as FutoPuzzle).solution ?? null,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
