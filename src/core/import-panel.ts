/**
 * 通用题目导入面板
 *
 * 游戏通过 CustomSupport.textImport / imageImport 提供解析与识别，
 * 核心只负责界面、预览、入库与“填入编辑器修正”。
 */

import type { GameAdapter, ImportCandidate, ImportOverlay, Puzzle } from './types'
import { $, on } from './ui'

export interface ImportHost {
  message(text: string, tone?: string): void
  loadPuzzle(p: Puzzle): void
  savePuzzle(p: Puzzle): void
  editPuzzle(p: Puzzle): void
  renderBoard(p: Puzzle): string
}

export class ImportPanel {
  private candidate: ImportCandidate | null = null
  private bitmap: ImageBitmap | null = null

  constructor(
    private adapter: GameAdapter,
    private host: ImportHost,
  ) {
    const panel = this.panel()
    if (!panel) return

    on($('#import-tab-text'), 'click', () => this.selectTab('text'))
    on($('#import-tab-image'), 'click', () => this.selectTab('image'))
    on($('#import-sample'), 'click', () => {
      const sample = this.adapter.custom.textImport?.sample
      if (!sample) return
      this.textarea().value = sample
      this.host.message('已填入示例题面。')
    })
    on($('#import-format'), 'click', () => this.formatText())
    on($('#import-parse'), 'click', () => this.parseText())
    on($('#import-load'), 'click', () => this.load())
    on($('#import-save'), 'click', () => this.save())
    on($('#import-edit'), 'click', () => this.edit())
    on($('#import-close'), 'click', () => this.close())

    const file = $('#import-file') as HTMLInputElement | null
    file?.addEventListener('change', () => {
      const f = file.files?.[0]
      if (f) void this.loadImage(f)
    })

    if (!this.adapter.custom.textImport) {
      const tab = $('#import-tab-text') as HTMLButtonElement | null
      if (tab) {
        tab.disabled = true
        tab.textContent = '文本（未支持）'
      }
      this.selectTab(this.adapter.custom.imageImport ? 'image' : 'text')
    } else if (!this.adapter.custom.imageImport) {
      const tab = $('#import-tab-image') as HTMLButtonElement | null
      if (tab) {
        tab.disabled = true
        tab.textContent = '图片（未支持）'
      }
    }
    this.updateActions()
  }

  private panel(): HTMLElement | null {
    return document.getElementById('import-editor')
  }

  private textarea(): HTMLTextAreaElement {
    return $('#import-text') as HTMLTextAreaElement
  }

  private canvas(): HTMLCanvasElement {
    return $('#import-canvas') as HTMLCanvasElement
  }

  isOpen(): boolean {
    const panel = this.panel()
    return !!panel && !panel.hidden
  }

  open(): void {
    const panel = this.panel()
    if (!panel) return
    panel.hidden = false
    const text = this.adapter.custom.textImport
    if (text) {
      const ta = this.textarea()
      ta.placeholder = text.placeholder
      if (!ta.value.trim()) ta.value = text.sample
    }
    this.selectTab(this.adapter.custom.textImport ? 'text' : 'image')
    this.host.message('粘贴题面后点「解析预览」，或用图片识别。')
    document.getElementById('import-text')?.focus()
  }

  close(): void {
    const panel = this.panel()
    if (panel) panel.hidden = true
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen()) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
      return true
    }
    // 面板打开时吞掉游戏快捷键（输入框内的按键已被全局处理器忽略）
    return true
  }

  private selectTab(tab: 'text' | 'image'): void {
    const textPane = document.getElementById('import-pane-text')
    const imagePane = document.getElementById('import-pane-image')
    const textTab = document.getElementById('import-tab-text')
    const imageTab = document.getElementById('import-tab-image')
    const useText = tab === 'text'
    if (textPane) textPane.hidden = !useText
    if (imagePane) imagePane.hidden = useText
    textTab?.classList.toggle('active', useText)
    imageTab?.classList.toggle('active', !useText)
  }

  private setName(candidate: ImportCandidate): void {
    if (!candidate.puzzle) return
    const input = $('#import-name') as HTMLInputElement | null
    const name = input?.value.trim()
    if (name) candidate.puzzle.name = name
  }

  private parseText(): void {
    const hook = this.adapter.custom.textImport
    if (!hook) {
      this.host.message('本游戏未提供文本导入。', 'bad')
      return
    }
    const input = $('#import-name') as HTMLInputElement | null
    let candidate: ImportCandidate
    try {
      candidate = hook.parse(this.textarea().value, input?.value.trim() || undefined)
    } catch (err) {
      this.host.message(`解析失败：${err instanceof Error ? err.message : String(err)}`, 'bad')
      return
    }
    this.setName(candidate)
    this.showCandidate(candidate)
  }

  private formatText(): void {
    const hook = this.adapter.custom.textImport
    if (!hook) return
    const puzzle = this.candidate?.puzzle
    if (!puzzle) {
      this.host.message('先解析出一个有效题面，再格式化。', 'bad')
      return
    }
    this.textarea().value = hook.format(puzzle)
    this.host.message('已格式化为三段表格。', 'ok')
  }

  private async loadImage(file: File): Promise<void> {
    const hook = this.adapter.custom.imageImport
    if (!hook) {
      this.host.message('本游戏未提供图片识别。', 'bad')
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      this.bitmap = bitmap
      const canvas = this.canvas()
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建 canvas 2d 上下文')
      ctx.drawImage(bitmap, 0, 0)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const input = $('#import-name') as HTMLInputElement | null
      const candidate = hook.recognize(image, input?.value.trim() || undefined)
      this.setName(candidate)
      this.showCandidate(candidate)
      this.drawOverlay(candidate.overlay)
      this.selectTab('image')
    } catch (err) {
      this.host.message(`图片识别失败：${err instanceof Error ? err.message : String(err)}`, 'bad')
    }
  }

  private drawOverlay(overlay?: ImportOverlay[]): void {
    const canvas = this.canvas()
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (this.bitmap) ctx.drawImage(this.bitmap, 0, 0)
    if (!overlay?.length) return
    ctx.lineWidth = Math.max(1.5, canvas.width / 480)
    ctx.font = `${Math.max(10, Math.round(canvas.width / 60))}px sans-serif`
    ctx.textBaseline = 'top'
    for (const item of overlay) {
      const low = item.confidence < 0.55
      ctx.strokeStyle = low ? 'rgba(217, 119, 6, 0.95)' : 'rgba(16, 133, 96, 0.9)'
      ctx.fillStyle = low ? 'rgba(217, 119, 6, 0.95)' : 'rgba(16, 133, 96, 0.9)'
      ctx.strokeRect(item.x, item.y, item.w, item.h)
      if (item.label) ctx.fillText(item.label, item.x + 2, item.y + 2)
    }
  }

  private showCandidate(candidate: ImportCandidate): void {
    this.candidate = candidate
    const summary = $('#import-summary')
    summary.innerHTML = ''
    const lines: string[] = [...candidate.summary]
    for (const err of candidate.errors) lines.push(`错误：${err}`)
    for (const warn of candidate.warnings) lines.push(`提示：${warn}`)
    for (const line of lines) {
      const div = document.createElement('div')
      div.className = line.startsWith('错误：')
        ? 'import-line bad'
        : line.startsWith('提示：')
          ? 'import-line warn'
          : 'import-line'
      div.textContent = line
      summary.appendChild(div)
    }

    const preview = $('#import-preview')
    if (candidate.puzzle) {
      preview.innerHTML = this.host.renderBoard(candidate.puzzle)
      this.host.message(
        candidate.errors.length ? '题面有错误，请修正后再导入。' : '预览已生成，可载入或保存。',
        candidate.errors.length ? 'bad' : 'ok',
      )
    } else {
      preview.innerHTML = ''
      this.host.message(candidate.errors[0] ?? '没有得到有效题面。', 'bad')
    }
    this.updateActions()
  }

  private updateActions(): void {
    const disabled = !this.candidate?.puzzle
    for (const id of ['import-load', 'import-save', 'import-edit', 'import-format']) {
      const btn = document.getElementById(id) as HTMLButtonElement | null
      if (btn) btn.disabled = disabled
    }
  }

  private load(): void {
    const puzzle = this.candidate?.puzzle
    if (!puzzle) return
    this.host.loadPuzzle(puzzle)
    this.host.message(`已载入「${puzzle.name}」。`, 'ok')
    this.close()
  }

  private save(): void {
    const puzzle = this.candidate?.puzzle
    if (!puzzle) return
    this.host.savePuzzle(puzzle)
    this.host.message(`已保存到题库：「${puzzle.name}」。`, 'ok')
  }

  private edit(): void {
    const puzzle = this.candidate?.puzzle
    if (!puzzle) return
    this.host.editPuzzle(puzzle)
    this.close()
  }
}
