/**
 * 不等式（Futoshiki）—— 游戏专用类型
 *
 * 规则：在 n×n 中填入 1..n，每行每列不重复；格间 `<` / `>` 必须满足。
 *
 * 状态：0 = 未填，1..n = 数字。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export interface FutoPuzzle extends Puzzle {
  givens: number[]
  /** 关系：0 无，1 = a<b，2 = a>b；先水平边（逐行），再竖直边（逐行） */
  relations: number[]
  solution?: number[]
}

export interface FutoState extends GameState {
  cells: number[]
  givens: number[]
}

export interface DuplicateIssue {
  orientation: 'row' | 'col'
  index: number
  value: number
  cells: number[]
}

export interface RelationIssue {
  a: number
  b: number
  relation: number
}

export interface FutoResult extends ValidationResult {
  empty: number
  complete: boolean
  duplicateIssues: DuplicateIssue[]
  relationIssues: RelationIssue[]
  changedGivens: number[]
  badCells: number[]
}

export function asFutoPuzzle(p: Puzzle): FutoPuzzle {
  return p as FutoPuzzle
}

export function asFutoState(s: GameState): FutoState {
  return s as FutoState
}

export function horizontalEdgeCount(n: number): number {
  return n > 1 ? n * (n - 1) : 0
}

export function verticalEdgeCount(n: number): number {
  return n > 1 ? (n - 1) * n : 0
}

export function edgeCount(n: number): number {
  return horizontalEdgeCount(n) + verticalEdgeCount(n)
}

export function horizontalEdgeIndex(n: number, x: number, y: number): number {
  return y * (n - 1) + x
}

export function verticalEdgeIndex(n: number, x: number, y: number): number {
  return horizontalEdgeCount(n) + y * n + x
}

export function edgeCells(edge: number, n: number): { a: number; b: number } | null {
  const hCount = horizontalEdgeCount(n)
  if (edge < 0) return null
  if (edge < hCount) {
    const y = Math.floor(edge / (n - 1))
    const x = edge % (n - 1)
    const a = y * n + x
    return { a, b: a + 1 }
  }
  const v = edge - hCount
  if (v >= verticalEdgeCount(n)) return null
  const y = Math.floor(v / n)
  const x = v % n
  const a = y * n + x
  return { a, b: a + n }
}

/**
 * 支持的最小 / 最大阶数。
 *
 * 旧题库（≤ 9×9，值 0–9）使用「逐字符」编码；超过 9 的值会自动改用
 * `v2:` 前缀的逗号分隔编码，两种编码都能被 decode* 读回。
 */
export const MIN_SIZE = 4
export const MAX_SIZE = 15

/** 多值编码前缀：`v2:1,0,12,...|0,1,...`（givens 与 relations 都用逗号分隔） */
export const MULTI_VALUE_PREFIX = 'v2:'

function maxValue(values: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! | 0
    if (v > max) max = v
  }
  return max
}

/** 是否还能用旧的逐字符编码（所有值都是 0–9 的单字符） */
function isSingleCharEncoded(values: ArrayLike<number>): boolean {
  return maxValue(values) <= 9
}

function joinValues(values: ArrayLike<number>, sep: string): string {
  let out = ''
  for (let i = 0; i < values.length; i++) {
    if (i) out += sep
    out += String(values[i]! | 0)
  }
  return out
}

/** 解析 `v2:` 编码的数值列表（逗号分隔） */
function parseValueList(text: string, expected: number, max: number): number[] | null {
  if (!text.length) return null
  const parts = text.split(',')
  if (parts.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const v = Number(parts[i])
    if (!Number.isInteger(v) || v < 0 || v > max) return null
    out[i] = v
  }
  return out
}

/** 字符串是否使用 `v2:` 多值编码 */
export function isMultiValueEncoded(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(MULTI_VALUE_PREFIX)
}

/** 编码串里包含多少个值（legacy 逐字符 = 字符数；v2 = 逗号分隔项数） */
export function encodedValueCount(text: string): number {
  if (isMultiValueEncoded(text)) return text.slice(MULTI_VALUE_PREFIX.length).split(',').length
  return text.length
}

export function encodeBoard(givens: ArrayLike<number>, relations: ArrayLike<number>): string {
  if (isSingleCharEncoded(givens)) {
    let out = ''
    for (let i = 0; i < givens.length; i++) out += String(givens[i]! | 0)
    out += '|'
    for (let i = 0; i < relations.length; i++) out += String(relations[i]! | 0)
    return out
  }
  return `${MULTI_VALUE_PREFIX}${joinValues(givens, ',')}|${joinValues(relations, ',')}`
}

export function decodeBoard(
  text: string,
  n: number,
): { givens: number[]; relations: number[] } | null {
  if (typeof text !== 'string') return null
  if (isMultiValueEncoded(text)) {
    const parts = text.slice(MULTI_VALUE_PREFIX.length).split('|')
    if (parts.length !== 2) return null
    const givens = parseValueList(parts[0]!, n * n, n)
    const relations = parseValueList(parts[1]!, edgeCount(n), 2)
    if (!givens || !relations) return null
    return { givens, relations }
  }
  const parts = text.split('|')
  if (parts.length !== 2) return null
  const givensText = parts[0]!
  if (givensText.length !== n * n) return null
  const givens = new Array<number>(n * n).fill(0)
  for (let i = 0; i < n * n; i++) {
    const v = givensText.charCodeAt(i) - 48
    if (v < 0 || v > n) return null
    givens[i] = v
  }
  const relationText = parts[1]!
  if (relationText.length !== edgeCount(n)) return null
  const relations = new Array<number>(relationText.length).fill(0)
  for (let i = 0; i < relationText.length; i++) {
    const v = relationText.charCodeAt(i) - 48
    if (v < 0 || v > 2) return null
    relations[i] = v
  }
  return { givens, relations }
}

export function encodeCells(cells: ArrayLike<number>): string {
  if (isSingleCharEncoded(cells)) return joinValues(cells, '')
  return `${MULTI_VALUE_PREFIX}${joinValues(cells, ',')}`
}

export function decodeCells(text: string, expected: number, n: number): number[] | null {
  if (typeof text !== 'string') return null
  if (isMultiValueEncoded(text)) {
    return parseValueList(text.slice(MULTI_VALUE_PREFIX.length), expected, n)
  }
  if (text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const v = text.charCodeAt(i) - 48
    if (v < 0 || v > n) return null
    out[i] = v
  }
  return out
}
