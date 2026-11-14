/**
 * 不等式 —— 截图识别
 *
 * 输入一张干净的题板截图（方格 + 数字 + 大小号），输出 givens/relations。
 * 无神经网络、无第三方依赖：二值化 + 连通域 + 字形模板匹配 + 几何校验。
 *
 * 同一份代码同时用于浏览器（ImageData）和 CLI（Playwright 页面内执行）。
 */

import { horizontalEdgeIndex, verticalEdgeIndex } from './types'

export interface RecognizeOverlay {
  kind: 'cell' | 'edge'
  x: number
  y: number
  w: number
  h: number
  label: string
  confidence: number
}

export interface RecognizeResult {
  n: number
  givens: number[]
  relations: number[]
  confidence: number
  warnings: string[]
  overlay: RecognizeOverlay[]
  bounds: { x: number; y: number; cell: number }
  image: { width: number; height: number }
  debug?: {
    threshold: number
    inkRatio: number
    boxes: Array<{ x0: number; y0: number; x1: number; y1: number; area: number }>
    xs: number[]
    ys: number[]
    digits?: Array<{
      r: number
      c: number
      value: number
      scores: Array<{ ch: string; score: number }>
      mask: string
    }>
  }
}

interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Blob extends Bounds {
  area: number
}

interface Template {
  ch: string
  mask: Float32Array
  size: number
}

const DIGIT_SIZE = 24
const SIGN_SIZE = 20
const FONT_FAMILIES = ['"Segoe UI"', 'Arial', 'Helvetica', '"Times New Roman"', 'Georgia', 'Verdana']
const FONT_WEIGHTS = ['400', '700']

let digitTemplates: Template[] | null = null
let signTemplates: Template[] | null = null

function grayFromImage(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p]! * 0.299 + data[p + 1]! * 0.587 + data[p + 2]! * 0.114) | 0
  }
  return out
}

function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  let sum = 0
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!
    hist[v]!++
    sum += v
  }
  const total = gray.length
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

function blobsIn(
  ink: Uint8Array,
  width: number,
  height: number,
  rect: Bounds,
): Blob[] {
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(width - 1, rect.x1)
  const y1 = Math.min(height - 1, rect.y1)
  if (x1 < x0 || y1 < y0) return []
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const seen = new Uint8Array(w * h)
  const blobs: Blob[] = []
  const stack = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const local = y * w + x
      if (seen[local] || !ink[(y0 + y) * width + x0 + x]) continue
      let top = 0
      stack[top++] = local
      seen[local] = 1
      let area = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      while (top > 0) {
        const cur = stack[--top]!
        const cx = cur % w
        const cy = (cur / w) | 0
        area++
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const ni = ny * w + nx
            if (seen[ni]) continue
            if (!ink[(y0 + ny) * width + x0 + nx]) continue
            seen[ni] = 1
            stack[top++] = ni
          }
        }
      }
      blobs.push({
        area,
        x0: x0 + minX,
        y0: y0 + minY,
        x1: x0 + maxX,
        y1: y0 + maxY,
      })
    }
  }
  return blobs
}

function normalize(
  ink: Uint8Array,
  width: number,
  height: number,
  box: Bounds,
  size: number,
  preserveAspect = true,
): Float32Array {
  const out = new Float32Array(size * size)
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  if (bw <= 0 || bh <= 0) return out

  let bx = box.x0
  let by = box.y0
  let sw = bw
  let sh = bh
  if (preserveAspect) {
    const side = Math.max(bw, bh)
    bx -= Math.floor((side - bw) / 2)
    by -= Math.floor((side - bh) / 2)
    sw = side
    sh = side
  }

  for (let oy = 0; oy < size; oy++) {
    const rowStart = Math.floor((oy * sh) / size)
    const rowEnd = Math.max(rowStart + 1, Math.floor(((oy + 1) * sh) / size))
    const sy0 = by + rowStart
    const sy1 = by + rowEnd
    for (let ox = 0; ox < size; ox++) {
      const colStart = Math.floor((ox * sw) / size)
      const colEnd = Math.max(colStart + 1, Math.floor(((ox + 1) * sw) / size))
      const sx0 = bx + colStart
      const sx1 = bx + colEnd
      let count = 0
      let total = 0
      for (let y = sy0; y < sy1; y++) {
        if (y < 0 || y >= height) continue
        for (let x = sx0; x < sx1; x++) {
          if (x < 0 || x >= width) continue
          total++
          if (ink[y * width + x]) count++
        }
      }
      out[oy * size + ox] = total ? count / total : 0
    }
  }
  return out
}

function bboxFromAlpha(alpha: Uint8ClampedArray, width: number, size: number): Bounds | null {
  let x0 = size
  let y0 = size
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (alpha[y * width + x]! < 96) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < x0 || y1 < y0 ? null : { x0, y0, x1, y1 }
}

function templateMask(
  alpha: Uint8ClampedArray,
  width: number,
  canvasSize: number,
  target: number,
): Float32Array | null {
  const box = bboxFromAlpha(alpha, width, canvasSize)
  if (!box) return null
  const ink = new Uint8Array(canvasSize * canvasSize)
  for (let i = 0; i < canvasSize * canvasSize; i++) ink[i] = alpha[i]! >= 96 ? 1 : 0
  return normalize(ink, canvasSize, canvasSize, box, target, true)
}

function renderTemplates(chars: string[], canvasSize: number, target: number): Template[] {
  const canvas = document.createElement('canvas')
  canvas.width = canvasSize
  canvas.height = canvasSize
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  const out: Template[] = []
  for (const family of FONT_FAMILIES) {
    for (const weight of FONT_WEIGHTS) {
      for (const ch of chars) {
        ctx.clearRect(0, 0, canvasSize, canvasSize)
        ctx.fillStyle = '#000'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `${weight} ${Math.round(canvasSize * 0.7)}px ${family}`
        ctx.fillText(ch, canvasSize / 2, canvasSize / 2 + canvasSize * 0.02)
        const pixels = ctx.getImageData(0, 0, canvasSize, canvasSize).data
        const alpha = new Uint8ClampedArray(canvasSize * canvasSize)
        for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]!
        const mask = templateMask(alpha, canvasSize, canvasSize, target)
        if (mask) out.push({ ch, mask, size: target })
      }
    }
  }
  return out
}

function getDigitTemplates(): Template[] {
  if (!digitTemplates) digitTemplates = renderTemplates('123456789'.split(''), 96, DIGIT_SIZE)
  return digitTemplates
}

function getSignTemplates(): Template[] {
  if (!signTemplates) signTemplates = renderTemplates(['<', '>', '^', 'v'], 72, SIGN_SIZE)
  return signTemplates
}

/** 取区域内最大的、没有贴着裁剪边的连通域（贴边的大概率是方框边框） */
function pickInnerBlob(blobs: Blob[], rect: Bounds): Blob | null {
  const inner = blobs.filter(
    (b) =>
      b.x0 > rect.x0 + 1 &&
      b.y0 > rect.y0 + 1 &&
      b.x1 < rect.x1 - 1 &&
      b.y1 < rect.y1 - 1,
  )
  const pool = inner.length ? inner : blobs
  pool.sort((a, b) => b.area - a.area)
  return pool[0] ?? null
}

function shiftedIoU(a: Float32Array, b: Float32Array, size: number, dx: number, dy: number): number {
  let inter = 0
  let union = 0
  for (let y = 0; y < size; y++) {
    const by = y + dy
    if (by < 0 || by >= size) {
      for (let x = 0; x < size; x++) union += a[y * size + x]!
      continue
    }
    for (let x = 0; x < size; x++) {
      const bx = x + dx
      const av = a[y * size + x]!
      const bv = bx < 0 || bx >= size ? 0 : b[by * size + bx]!
      inter += Math.min(av, bv)
      union += Math.max(av, bv)
    }
  }
  return union > 0 ? inter / union : 0
}

function similarity(a: Float32Array, b: Float32Array, size: number): number {
  let best = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const score = shiftedIoU(a, b, size, dx, dy)
      if (score > best) best = score
    }
  }
  return best
}

function holesOf(mask: Float32Array, size: number): number {
  const bin = new Uint8Array(size * size)
  for (let i = 0; i < bin.length; i++) bin[i] = mask[i]! >= 0.4 ? 1 : 0
  const seen = new Uint8Array(size * size)
  const stack: number[] = []
  const push = (i: number): void => {
    if (seen[i] || bin[i]) return
    seen[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < size; x++) {
    push(x)
    push((size - 1) * size + x)
  }
  for (let y = 0; y < size; y++) {
    push(y * size)
    push(y * size + size - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % size
    const y = (i / size) | 0
    if (x > 0) push(i - 1)
    if (x + 1 < size) push(i + 1)
    if (y > 0) push(i - size)
    if (y + 1 < size) push(i + size)
  }
  let holes = 0
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] || seen[i]) continue
    holes++
    const local: number[] = [i]
    seen[i] = 1
    while (local.length) {
      const j = local.pop()!
      const x = j % size
      const y = (j / size) | 0
      const visit = (k: number): void => {
        if (seen[k] || bin[k]) return
        seen[k] = 1
        local.push(k)
      }
      if (x > 0) visit(j - 1)
      if (x + 1 < size) visit(j + 1)
      if (y > 0) visit(j - size)
      if (y + 1 < size) visit(j + size)
    }
  }
  return holes
}

function maskAscii(mask: Float32Array, size: number): string {
  const rows: string[] = []
  for (let y = 0; y < size; y++) {
    let row = ''
    for (let x = 0; x < size; x++) row += mask[y * size + x]! >= 0.4 ? '#' : '.'
    rows.push(row)
  }
  return rows.join('\n')
}

const EXPECTED_HOLES: Record<string, number> = {
  '1': 0,
  '2': 0,
  '3': 0,
  '4': 1,
  '5': 0,
  '6': 1,
  '7': 0,
  '8': 2,
  '9': 1,
}

function cluster1D(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const v of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(v - last[last.length - 1]!) <= tolerance) last.push(v)
    else groups.push([v])
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length)
}

/** 区域内的纵向墨迹跨度（maxY - minY）；用于判断箭头开口朝左还是朝右 */
function inkExtentY(ink: Uint8Array, width: number, rect: Bounds): number {
  let min = Infinity
  let max = -Infinity
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (!ink[y * width + x]) continue
      if (y < min) min = y
      if (y > max) max = y
    }
  }
  return max >= min ? max - min : 0
}

/** 区域内的横向墨迹跨度；用于判断箭头开口朝上还是朝下 */
function inkExtentX(ink: Uint8Array, width: number, rect: Bounds): number {
  let min = Infinity
  let max = -Infinity
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (!ink[y * width + x]) continue
      if (x < min) min = x
      if (x > max) max = x
    }
  }
  return max >= min ? max - min : 0
}

function shrink(image: ImageData, maxSide: number): {
  data: Uint8ClampedArray
  width: number
  height: number
  scale: number
} {
  const longest = Math.max(image.width, image.height)
  if (longest <= maxSide) {
    return { data: image.data, width: image.width, height: image.height, scale: 1 }
  }
  const scale = maxSide / longest
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const src = document.createElement('canvas')
  src.width = image.width
  src.height = image.height
  const srcCtx = src.getContext('2d')
  if (!srcCtx) {
    return { data: image.data, width: image.width, height: image.height, scale: 1 }
  }
  srcCtx.putImageData(image, 0, 0)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { data: image.data, width: image.width, height: image.height, scale: 1 }
  }
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(src, 0, 0, width, height)
  return { data: ctx.getImageData(0, 0, width, height).data, width, height, scale }
}

export function recognizeBoard(image: ImageData): RecognizeResult {
  const resized = shrink(image, 1400)
  const width = resized.width
  const height = resized.height
  const scale = resized.scale
  const gray = grayFromImage(resized.data, width, height)
  let threshold = otsu(gray)
  if (threshold < 40 || threshold > 220) threshold = 128
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i]! < threshold ? 1 : 0

  const warnings: string[] = []
  const maxSide = Math.max(width, height)
  const minSide = maxSide * 0.04
  const maxCellSide = maxSide * 0.25

  const all = blobsIn(ink, width, height, { x0: 0, y0: 0, x1: width - 1, y1: height - 1 })
  const square = all.filter((b) => {
    const w = b.x1 - b.x0 + 1
    const h = b.y1 - b.y0 + 1
    const ratio = w / h
    if (ratio < 0.8 || ratio > 1.25) return false
    if (w < minSide || w > maxCellSide) return false
    if (h < minSide || h > maxCellSide) return false
    const density = b.area / (w * h)
    return density > 0.015 && density < 0.45
  })

  if (square.length < 16) {
    throw new Error('没有检测到足够多的方格，请换一张更清晰的截图')
  }

  square.sort((a, b) => b.area - a.area)
  const seed = square[0]!
  const seedSide = (seed.x1 - seed.x0 + seed.y1 - seed.y0 + 2) / 2
  const boxes = square.filter((b) => {
    const w = b.x1 - b.x0 + 1
    const h = b.y1 - b.y0 + 1
    return Math.abs(w - seedSide) <= seedSide * 0.22 && Math.abs(h - seedSide) <= seedSide * 0.22
  })

  const cxOf = (b: Blob): number => (b.x0 + b.x1) / 2
  const cyOf = (b: Blob): number => (b.y0 + b.y1) / 2
  const tol = seedSide * 0.5
  let xs = cluster1D(boxes.map(cxOf), tol)
  let ys = cluster1D(boxes.map(cyOf), tol)

  if (xs.length < 4 || ys.length < 4) {
    throw new Error(`识别到的网格过小（${xs.length}×${ys.length}），至少需要 4×4`)
  }
  if (xs.length !== ys.length) {
    warnings.push(`行列数不一致（${ys.length} 行 × ${xs.length} 列），按较大值推断为方阵`)
  }
  const n = Math.max(xs.length, ys.length)
  if (n > 12) throw new Error(`网格过大（${n}×${n}），最多支持 12×12`)

  const pitchX = xs.length > 1 ? (xs[xs.length - 1]! - xs[0]!) / (xs.length - 1) : seedSide
  const pitchY = ys.length > 1 ? (ys[ys.length - 1]! - ys[0]!) / (ys.length - 1) : seedSide
  const pitch = (pitchX + pitchY) / 2

  xs = Array.from({ length: n }, (_, i) =>
    xs.length === n ? xs[i]! : (xs[0] ?? 0) + i * pitch,
  )
  ys = Array.from({ length: n }, (_, i) =>
    ys.length === n ? ys[i]! : (ys[0] ?? 0) + i * pitch,
  )

  const centerX = xs[0]!
  const centerY = ys[0]!
  const bounds = {
    x: (centerX - pitch / 2) / scale,
    y: (centerY - pitch / 2) / scale,
    cell: pitch / scale,
  }

  const overlay: RecognizeOverlay[] = []
  const digitTpl = getDigitTemplates()
  const signTpl = getSignTemplates()
  const givens = new Array<number>(n * n).fill(0)
  const debugDigits: NonNullable<NonNullable<RecognizeResult['debug']>['digits']> = []
  let digitConfidenceSum = 0
  let digitCount = 0

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = xs[c]!
      const cy = ys[r]!
      const half = pitch * 0.25
      const rect: Bounds = {
        x0: Math.round(cx - half),
        y0: Math.round(cy - half),
        x1: Math.round(cx + half),
        y1: Math.round(cy + half),
      }
      overlay.push({
        kind: 'cell',
        x: (cx - pitch / 2) / scale,
        y: (cy - pitch / 2) / scale,
        w: pitch / scale,
        h: pitch / scale,
        label: '',
        confidence: 1,
      })

      const blobs = blobsIn(ink, width, height, rect)
      if (!blobs.length) continue
      const blob = pickInnerBlob(blobs, rect)
      if (!blob) continue
      const bw = blob.x1 - blob.x0 + 1
      const bh = blob.y1 - blob.y0 + 1
      if (bh < pitch * 0.22 || bw < pitch * 0.1 || blob.area < pitch * pitch * 0.004) continue

      const mask = normalize(ink, width, height, blob, DIGIT_SIZE, true)
      const holes = holesOf(mask, DIGIT_SIZE)
      const charScores: Record<string, number> = {}
      let bestCh = ''
      let bestScore = -Infinity
      for (const tpl of digitTpl) {
        let score = similarity(mask, tpl.mask, DIGIT_SIZE)
        const expected = EXPECTED_HOLES[tpl.ch]
        if (expected !== undefined) score -= Math.min(0.18, Math.abs(holes - expected) * 0.1)
        charScores[tpl.ch] = Math.max(charScores[tpl.ch] ?? -Infinity, score)
        if (score > bestScore) {
          bestScore = score
          bestCh = tpl.ch
        }
      }
      debugDigits.push({
        r,
        c,
        value: Number(bestCh) || 0,
        scores: Object.entries(charScores)
          .map(([ch, score]) => ({ ch, score }))
          .sort((a, b) => b.score - a.score),
        mask: maskAscii(mask, DIGIT_SIZE),
      })

      const confidence = Math.max(0, bestScore)
      digitConfidenceSum += confidence
      digitCount++
      const value = Number(bestCh) || 0
      if (value >= 1 && value <= n) {
        givens[r * n + c] = value
        overlay[overlay.length - 1] = {
          ...overlay[overlay.length - 1]!,
          label: String(value),
          confidence,
        }
        if (confidence < 0.55) {
          warnings.push(`第 ${r + 1} 行第 ${c + 1} 列数字置信度低（${confidence.toFixed(2)}），识别为 ${value}`)
        }
      }
    }
  }

  const relations = new Array<number>(2 * n * (n - 1)).fill(0)
  let signConfidenceSum = 0
  let signCount = 0

  const detectSign = (
    rect: Bounds,
    dir: 'h' | 'v',
  ): { value: number; confidence: number } | null => {
    const blobs = blobsIn(ink, width, height, rect)
    if (!blobs.length) return null
    const blob = pickInnerBlob(blobs, rect)
    if (!blob) return null
    const bw = blob.x1 - blob.x0 + 1
    const bh = blob.y1 - blob.y0 + 1
    if (blob.area < 12 || Math.max(bw, bh) < pitch * 0.1) return null
    if (Math.max(bw, bh) > pitch * 0.62) return null

    const mask = normalize(ink, width, height, blob, SIGN_SIZE, true)
    const candidates = dir === 'h' ? ['<', '>'] : ['^', 'v']
    const templateScore: Record<string, number> = {}
    for (const tpl of signTpl) {
      if (!candidates.includes(tpl.ch)) continue
      const score = similarity(mask, tpl.mask, SIGN_SIZE)
      templateScore[tpl.ch] = Math.max(templateScore[tpl.ch] ?? 0, score)
    }

    // 几何校验：箭头尖端一侧的墨迹跨度小，开口一侧跨度大
    let geomLeftTop = 0.5
    if (dir === 'h') {
      const q = Math.max(2, Math.round((blob.x1 - blob.x0 + 1) * 0.25))
      const left = inkExtentY(ink, width, {
        x0: blob.x0,
        x1: blob.x0 + q - 1,
        y0: blob.y0,
        y1: blob.y1,
      })
      const right = inkExtentY(ink, width, {
        x0: blob.x1 - q + 1,
        x1: blob.x1,
        y0: blob.y0,
        y1: blob.y1,
      })
      geomLeftTop = 1 / (1 + Math.exp(-((right - left) / Math.max(1, (blob.y1 - blob.y0 + 1) * 0.5))))
    } else {
      const q = Math.max(2, Math.round((blob.y1 - blob.y0 + 1) * 0.25))
      const top = inkExtentX(ink, width, {
        x0: blob.x0,
        x1: blob.x1,
        y0: blob.y0,
        y1: blob.y0 + q - 1,
      })
      const bottom = inkExtentX(ink, width, {
        x0: blob.x0,
        x1: blob.x1,
        y0: blob.y1 - q + 1,
        y1: blob.y1,
      })
      geomLeftTop = 1 / (1 + Math.exp(-((bottom - top) / Math.max(1, (blob.x1 - blob.x0 + 1) * 0.5))))
    }

    const ranked = candidates
      .map((ch) => {
        const leftTop = ch === '<' || ch === '^'
        const geomScore = leftTop ? geomLeftTop : 1 - geomLeftTop
        return {
          ch,
          score: (templateScore[ch] ?? 0) * 0.55 + geomScore * 0.45,
        }
      })
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]!
    const value = best.ch === '<' || best.ch === '^' ? 1 : 2
    return { value, confidence: best.score }
  }

  const recordSign = (confidence: number, rect: Bounds, label: string): void => {
    signConfidenceSum += confidence
    signCount++
    overlay.push({
      kind: 'edge',
      x: rect.x0 / scale,
      y: rect.y0 / scale,
      w: (rect.x1 - rect.x0 + 1) / scale,
      h: (rect.y1 - rect.y0 + 1) / scale,
      label,
      confidence,
    })
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const cx = (xs[c]! + xs[c + 1]!) / 2
      const cy = ys[r]!
      const rect: Bounds = {
        x0: Math.round(cx - pitch * 0.15),
        y0: Math.round(cy - pitch * 0.15),
        x1: Math.round(cx + pitch * 0.15),
        y1: Math.round(cy + pitch * 0.15),
      }
      const found = detectSign(rect, 'h')
      if (!found) continue
      relations[horizontalEdgeIndex(n, c, r)] = found.value
      recordSign(found.confidence, rect, found.value === 1 ? '<' : '>')
      if (found.confidence < 0.5) {
        warnings.push(`第 ${r + 1} 行第 ${c + 1}–${c + 2} 列横向符号置信度低（${found.confidence.toFixed(2)}）`)
      }
    }
  }

  for (let r = 0; r + 1 < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = xs[c]!
      const cy = (ys[r]! + ys[r + 1]!) / 2
      const rect: Bounds = {
        x0: Math.round(cx - pitch * 0.15),
        y0: Math.round(cy - pitch * 0.15),
        x1: Math.round(cx + pitch * 0.15),
        y1: Math.round(cy + pitch * 0.15),
      }
      const found = detectSign(rect, 'v')
      if (!found) continue
      relations[verticalEdgeIndex(n, c, r)] = found.value
      recordSign(found.confidence, rect, found.value === 1 ? '^' : 'v')
      if (found.confidence < 0.5) {
        warnings.push(`第 ${r + 1}–${r + 2} 行第 ${c + 1} 列竖向符号置信度低（${found.confidence.toFixed(2)}）`)
      }
    }
  }

  const overall =
    (digitConfidenceSum + signConfidenceSum) / Math.max(1, digitCount + signCount)
  return {
    n,
    givens,
    relations,
    confidence: overall,
    warnings,
    overlay,
    bounds,
    image: { width: image.width, height: image.height },
    debug: {
      threshold,
      inkRatio: ink.reduce((a, v) => a + v, 0) / ink.length,
      boxes: boxes.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, area: b.area })),
      xs,
      ys,
      digits: debugDigits,
    },
  }
}
