/**
 * 导入链路回归测试
 *
 * 1. 文本 fixture -> 与期望紧凑串逐字符相等
 * 2. 唯一解 / 参考解合法
 * 3. 图片识别 -> 与文本结果完全相等
 * 4. 浏览器导入面板（dev server 已启动时）：文本解析、图片识别、填入编辑器、载入、逻辑解题
 *
 * 用法：node scripts/verify-import.mjs
 *      node scripts/verify-import.mjs --no-browser
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { analyzePuzzle, formatPuzzleText, parsePuzzleText } from '../src/game/import.ts'
import { isValidSolution } from '../src/game/rules.ts'
import { PORT } from './_port.mjs'

const ROOT = process.cwd()
const TEXT_FILE = path.resolve(ROOT, 'scripts/fixtures/9x9.txt')
const IMAGE_FILE = path.resolve(ROOT, 'scripts/fixtures/futoshiki-9x9.jpg')

const EXPECTED_GIVENS =
  '000000000000050000000000600000000000080700000004000000000000300000020000000000000'
const H = '222001120201000010012002000020020100000000010200000020000200000100010201'
const V = '000100012000020010000000200000100000100000010200010010002000000102100001'
const EXPECTED_RELATIONS = H + V

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

function boardOf(puzzle) {
  return `${puzzle.givens.join('')}|${puzzle.relations.join('')}`
}

// —— 1. 文本解析 ——

const text = readFileSync(TEXT_FILE, 'utf8')
const parsed = parsePuzzleText(text, { name: '九阶不等式（导入）' })
check('文本解析无错误', parsed.errors.length === 0, parsed.errors.join('；'))
const puzzle = parsed.puzzle
check('文本解析得到题面', !!puzzle)
if (!puzzle) {
  process.exit(1)
}
check('givens 与期望一致', puzzle.givens.join('') === EXPECTED_GIVENS)
check('relations 与期望一致', puzzle.relations.join('') === EXPECTED_RELATIONS)
check(
  '题面长度',
  puzzle.givens.length === 81 && puzzle.relations.length === 144,
  `${puzzle.givens.length}/${puzzle.relations.length}`,
)

const compact = `${EXPECTED_GIVENS}|${EXPECTED_RELATIONS}`
const compactParsed = parsePuzzleText(compact)
check(
  '紧凑串解析一致',
  !!compactParsed.puzzle && boardOf(compactParsed.puzzle) === compact,
)
const jsonParsed = parsePuzzleText(
  JSON.stringify({ name: 'json 导入', width: 9, height: 9, board: compact }),
)
check('JSON 解析一致', !!jsonParsed.puzzle && boardOf(jsonParsed.puzzle) === compact)
const roundTrip = parsePuzzleText(formatPuzzleText(puzzle))
check('格式化往返一致', !!roundTrip.puzzle && boardOf(roundTrip.puzzle) === compact)

// —— 2. 唯一解 ——

const analysis = analyzePuzzle(puzzle)
check('解唯一', analysis.unique && analysis.count === 1, `count=${analysis.count}`)
check('逻辑可推满', analysis.logicSolved && analysis.logicSaturated)
check('有参考解', !!analysis.solution)
if (analysis.solution) {
  check('参考解长度', analysis.solution.length === 81)
  check('参考解合法', isValidSolution(analysis.solution, puzzle.relations, 9))
  const solution = analysis.solution
  const givenOk = puzzle.givens.every((v, i) => v === 0 || v === solution[i])
  check('预填与参考解一致', givenOk)
}

// —— 3. 图片识别 ——

let imageBoard = null
try {
  const { recognizeImageFile } = await import('./lib/recognize-image.mjs')
  const recognized = await recognizeImageFile(IMAGE_FILE)
  imageBoard = recognized.text
  check('图片识别结果与文本一致', imageBoard === `${EXPECTED_GIVENS}|${EXPECTED_RELATIONS}`)
  const imageParsed = parsePuzzleText(imageBoard, { name: '图片识别' })
  check('图片识别解析无错误', imageParsed.errors.length === 0, imageParsed.errors.join('；'))
  if (imageParsed.puzzle) {
    const imageAnalysis = analyzePuzzle(imageParsed.puzzle)
    check('图片识别题面唯一解', imageAnalysis.unique)
  }
} catch (err) {
  check('图片识别', false, err instanceof Error ? err.message : String(err))
}

// —— 4. 浏览器导入面板 ——

const skipBrowser = process.argv.includes('--no-browser')
if (!skipBrowser) {
  const url = `http://127.0.0.1:${PORT}/`
  let reachable = false
  try {
    const res = await fetch(url, { cache: 'no-store' })
    reachable = res.ok
  } catch {
    reachable = false
  }
  if (!reachable) {
    console.log('SKIP  浏览器导入面板（dev server 未启动）')
  } else {
    const { chromium } = await import('playwright-core')
    const executablePath =
      process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    const browser = await chromium.launch({ headless: true, executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    try {
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForSelector('svg.board-svg')
      check('导入按钮存在', (await page.locator('#btn-import').count()) === 1)

      await page.click('#btn-import')
      await page.fill('#import-name', '九阶不等式（导入）')
      await page.fill('#import-text', text)
      await page.click('#import-parse')
      await page.waitForFunction(
        () => (document.querySelector('#import-summary')?.textContent ?? '').includes('解唯一'),
        { timeout: 30000 },
      )
      const summary = await page.locator('#import-summary').textContent()
      check('文本导入预览为唯一解', (summary ?? '').includes('解唯一'), summary ?? '')
      check('文本导入预览有棋盘', (await page.locator('#import-preview svg').count()) === 1)

      await page.click('#import-edit')
      await page.waitForSelector('.custom-hybrid-grid')
      const cells = await page.locator('.custom-hybrid-grid .custom-cell').count()
      const edges = await page.locator('.custom-hybrid-grid .custom-edge').count()
      check('编辑器回填 81 格', cells === 81, String(cells))
      check('编辑器回填 144 边', edges === 144, String(edges))
      await page.screenshot({ path: 'output/playwright/import-editor.png', fullPage: true })
      await page.click('#custom-close')

      await page.click('#btn-import')
      await page.click('#import-tab-image')
      await page.setInputFiles('#import-file', IMAGE_FILE)
      await page.waitForFunction(
        () => {
          const summaryText = document.querySelector('#import-summary')?.textContent ?? ''
          const canvas = document.querySelector('#import-canvas')
          return summaryText.includes('解唯一') && canvas && canvas.width > 0
        },
        { timeout: 60000 },
      )
      const imageSummary = await page.locator('#import-summary').textContent()
      check('图片导入预览为唯一解', (imageSummary ?? '').includes('解唯一'), imageSummary ?? '')
      const overlayPainted = await page.evaluate(() => {
        const canvas = document.querySelector('#import-canvas')
        if (!canvas) return false
        const ctx = canvas.getContext('2d')
        if (!ctx) return false
        const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 60), Math.min(canvas.height, 60))
        return sample.data.some((v) => v !== 255 && v !== 0)
      })
      check('图片预览已绘制', overlayPainted)
      await page.screenshot({ path: 'output/playwright/import-image.png', fullPage: true })

      await page.click('#import-save')
      await page.waitForTimeout(500)
      await page.click('#import-load')
      await page.waitForFunction(
        () => (document.querySelector('#status')?.textContent ?? '').includes('已载入'),
        { timeout: 10000 },
      )
      const loaded = await page.locator('#status').textContent()
      check('载入导入题面', (loaded ?? '').includes('9×9'), loaded ?? '')
      const hasSolution = await page.evaluate(() =>
        Array.isArray(window.__game.getSession().puzzle.solution),
      )
      check('载入题目自带参考解', hasSolution)

      await page.click('#btn-logic')
      await page.waitForFunction(
        () => {
          const status = document.querySelector('#status')?.textContent ?? ''
          return status.includes('逻辑解题完成') || status.includes('回放完毕')
        },
        { timeout: 120000 },
      )
      const solved = await page.locator('#status').textContent()
      check('逻辑解题完成', (solved ?? '').includes('逻辑解题完成'), solved ?? '')

      await page.click('#btn-clear')
      await page.waitForTimeout(120)
      const beforeHint = await page.evaluate(
        () => window.__game.getSession().state.cells.filter((v) => v === 0).length,
      )
      await page.click('#btn-hint')
      await page.waitForTimeout(120)
      const afterHint = await page.evaluate(
        () => window.__game.getSession().state.cells.filter((v) => v === 0).length,
      )
      check('提示一格使用题面自带解', afterHint === beforeHint - 1, `${beforeHint} -> ${afterHint}`)

      await page.click('#btn-solve')
      await page.waitForTimeout(120)
      const ownSolved = await page.evaluate(() => {
        const session = window.__game.getSession()
        return window.__game.adapter.validate(session.state, session.puzzle).solved
      })
      check('显示解使用题面自带解', ownSolved)

      check('页面无 JS 错误', pageErrors.length === 0, pageErrors.join('；'))
      await page.screenshot({ path: 'output/playwright/import-panel.png', fullPage: true })
    } catch (err) {
      check('浏览器导入面板', false, err instanceof Error ? err.message : String(err))
      await page.screenshot({ path: 'output/playwright/import-panel-fail.png', fullPage: true }).catch(() => {})
    } finally {
      await browser.close()
    }
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
if (failures > 0) process.exitCode = 1
