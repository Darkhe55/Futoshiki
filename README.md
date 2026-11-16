# 不等式 Futoshiki

一个基于 Web 的不等式（Futoshiki）谜题游戏，原生 SVG 渲染，内置逻辑解题器。

## 在线体验

```bash
npm install
npm start
```

`npm start` 会等开发服务就绪后用默认浏览器打开 **http://127.0.0.1:5193/**。

> 也可以用 `npm run dev`，但不会自动打开浏览器。

## 游戏规则

- 在 n×n 格中填入 1..n，每行每列数字不重复
- 格间的大小号必须满足：左/上小于右/下，或按题面相反
- 题面预填数字不能修改

## 操作

| 操作 | 说明 |
|------|------|
| 左键点格 | 选中格子 |
| 数字键 1–9 / 0 或 Backspace | 填数 / 清除 |
| 右键点格 | 清除该格 |
| 方向键 | 移动选中格 |
| 滚轮 / 中键拖拽 | 缩放 / 平移画布 |
| Z / Shift+Z / Y | 撤销 / 重做 |
| C / H / S / Esc | 检查 / 提示一格 / 显示解 / 清空 |
| R / L / P / M | 随机抽题 / 逻辑解题 / 暂停回放 / 音效开关 |
| 0 / + / - | 视图复位 / 放大 / 缩小 |

## 数据存放

运行 `npm start` / `npm run dev` 时，题库、进度和上次题目保存在项目内 `data/` 目录；静态部署时自动降级到浏览器 localStorage。

## 题目导入

### 图片识别（自动识别 + 预览 + 入库）

```bash
# 只识别、预览题面（默认不写盘）
npm run import-image -- 题图.png

# 校验唯一解后写入 data/library.json
npm run import-image -- 题图.png --name "识图导入 · 9×9" --append --verify

# 人工修正识别错误：r行c列=数字 / h行e边=大小号 / v行e边=大小号（1 基）
npm run import-image -- 题图.png --map r1c1=8,h2e3=1 --append
```

| 参数 | 说明 |
|------|------|
| `--name 名称` / `--id ID` | 题库名称 / 指定 id（覆盖同 id 条目） |
| `--append` | 写入 `data/library.json`；不加只预览 |
| `--verify` | 唯一解校验（`--append` 时默认也要求唯一解） |
| `--allow-multi` | 允许有多解的题目入库 |
| `--map 修正` | `r3c5=2` 改格子；`h3e2=1` 改横向大小号；`v3e2=2` 改竖向大小号（1 基，0 清除） |
| `--max-nodes N` | 解计数搜索节点上限 |
| `--out FILE` | 题库文件（默认 `data/library.json`） |
| `--json` | 输出机器可读结果 |

识读使用的是与浏览器「导入」面板同一份 `src/game/image-import.ts`（Playwright 打开本机 Edge/Chrome 解码图片）。支持 **4×4–12×12、数字 1–n 的黑白线框题图**；更大尺寸或字母题（如 A–E 表示 10–14）不在当前数据模型内，请改用文本导入。

### 文本 / 其它格式

```bash
npm run import-puzzle -- --text scripts/fixtures/9x9.txt --name "九阶不等式（导入）"
npm run import-puzzle -- --image path/to/board.jpg --dry-run
```

- 文本支持三种格式：`size / givens / horizontal / vertical` 三段表格、`givens|relations` 紧凑串、JSON
- `--dry-run` 只解析不写盘；`--allow-multi` 允许多解
- 浏览器左侧「导入」面板同样支持文本粘贴与图片上传，识别后可“在编辑器中修正”
- 导入后刷新页面即可在题库最前面看到新题

## 功能

- **题库**：内置多道题，题目均校验唯一解
- **实时校验**：冲突与违规位置即时高亮，满足的条件同步变灰
- **逻辑解题**：规则引擎逐帧回放，显示每一步理由；回放中按钮变为停止，按 `P` 暂停/继续
- **提示一格 / 显示解**：提示优先揭示所有解一致的格子，显示解直接填入可行答案
- **撤销/重做**：按手势分组，一次拖拽只需一步撤销
- **进度保存**：自动保存当前题目进度，刷新不丢失
- **音效特效**：Web Audio 合成拨弦、水滴与落子动画，无外部音频资源
- **缩放/平移**：滚轮缩放，中键或 `Shift` 拖拽平移

## 技术栈

- Vite + TypeScript
- 原生 SVG（无框架）
- Web Audio 合成音效（无外部资源）
- localStorage / 项目内 `data/` 存储进度与题库

## 项目结构

```
src/
  main.ts
  core/
    app.ts / ui.ts / view.ts      界面、交互、缩放、回放控制
    store.ts / library.ts         题库、进度、上次题目存储
    audio.ts / fx.ts              音效与落子特效
  game/
    adapter.ts                    游戏规则接入
    rules.ts                      推理规则
    logic.ts                      逻辑解题回放
    render.ts / state.ts          SVG 渲染与盘面状态
    validate.ts / solver.ts       实时校验与回溯求解
    puzzles.ts / puzzles-data.ts  题库加载与静态题库
```

## 命令

```bash
npm run dev       # 开发服务
npm start         # 开发服务 + 自动打开浏览器
npm run build     # tsc --noEmit + vite build
npm run gen       # 重新生成题库
npm run check     # 审计题库
npm run verify    # 参考解、逻辑回放与交互验证
npm run verify-import  # 文本/图片导入与浏览器导入面板回归测试
npm run import-image   # 图片识别导入（预览 / --append / --verify / --map）
npm run import-puzzle  # 文本或图片导入题目（--text / --image）
npm run audit     # 逐题审计逻辑解题
```
