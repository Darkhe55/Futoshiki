/**
 * 图片识别（CLI 用）
 *
 * 用 Playwright 打开本机 Edge/Chrome 解码图片，把 src/game/image-import.ts
 * 通过 esbuild 注入页面执行识别，避免引入原生图像依赖。
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function sniffMime(buf, file) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    throw new Error('找不到 Edge/Chrome。可用 EDGE_PATH 指定浏览器路径，或改用 --text 导入')
  }
  return found
}

export async function recognizeImageFile(file) {
  const buf = readFileSync(file)
  const mime = sniffMime(buf, file)
  const url = `data:${mime};base64,${buf.toString('base64')}`

  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    throw new Error('缺少 playwright-core；请先 npm install，或改用 --text 导入')
  }

  let esbuild
  try {
    esbuild = await import('esbuild')
  } catch {
    throw new Error('缺少 esbuild；请先 npm install，或改用 --text 导入')
  }

  const bundled = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../../src/game/image-import.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'FutoImage',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  })
  const code = bundled.outputFiles?.[0]?.text
  if (!code) throw new Error('图片识别代码打包失败')

  const browser = await chromium.launch({ headless: true, executablePath: findBrowser() })
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    await page.addScriptTag({ content: code })
    const result = await page.evaluate(async (dataUrl) => {
      const img = new Image()
      img.src = dataUrl
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建 canvas 2d 上下文')
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return window.FutoImage.recognizeBoard(image)
    }, url)

    const board = `${result.givens.join('')}|${result.relations.join('')}`
    return {
      text: board,
      warnings: [
        `图片识别：${result.n}×${result.n}，平均置信度 ${(result.confidence * 100).toFixed(0)}%`,
        ...(result.warnings ?? []),
      ],
      recognition: result,
    }
  } finally {
    await browser.close()
  }
}
