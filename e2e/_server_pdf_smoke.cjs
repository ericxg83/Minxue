/**
 * _server_pdf_smoke.cjs — 后端 /api/exam-pdf 烟雾测试
 *
 * 流程：
 *  1. 读取 e2e/fixtures/real-wrong-pdf-questions.json（真实 20 道错题）
 *  2. 用 Playwright 在 Chromium 里渲染（KaTeX auto-render + 二维码 + 字体内联）
 *  3. 抓 outerHTML，POST 给后端 /api/exam-pdf
 *  4. 保存返回的 PDF 到 e2e/_server_pdf_out/wrongbook-server.pdf
 *  5. 用 pdfjs 渲染第 1 页为 PNG 快照保存到 e2e/_server_pdf_out/wrongbook-server-page1.png
 *
 * 用法：
 *   cd e2e
 *   node _server_pdf_smoke.cjs
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const API_BASE = process.env.API_BASE || 'http://localhost:3001'
const OUT_DIR = path.join(__dirname, '_server_pdf_out')
fs.mkdirSync(OUT_DIR, { recursive: true })

const FIXTURE = path.join(__dirname, 'fixtures', 'real-wrong-pdf-questions.json')
const questions = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).questions
console.log(`[smoke] 加载 ${questions.length} 道题`)

;(async () => {
  // ============ Step 1: 渲染完整 HTML（客户端 KaTeX + QR） ============
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  try {
    // 用 vite dev server 提供 KaTeX 字体
    await page.goto(process.env.VITE_ORIGIN || 'http://localhost:5173', { waitUntil: 'load' })

    // 调用 client 端的 serverPdfExporter.exportServerPDF
    // 但 e2e 测试直接复制其核心逻辑（避免 import 路径复杂性）
    const html = await page.evaluate(async (qs) => {
      // 简化的渲染：直接调 client 端 buildPaperBody + renderMathInContainer
      const mod = await import('/src/utils/pdfGenerator.js')
      const katexCssMod = await import('/node_modules/.vite/deps/katex_dist_katex_min_css.js').catch(() => null)

      // 内联字体
      const katexCss = mod.KATEX_FONT_FAMILIES // 仅占位
      // 实际：直接 fetch KaTeX CSS 并替换字体路径为绝对 URL（dev server 已代理）
      const cssUrl = '/node_modules/katex/dist/katex.min.css'
      const cssResp = await fetch(cssUrl)
      let cssText = await cssResp.text()
      const fontRe = /url\(fonts\/(KaTeX_[A-Za-z0-9_-]+\.woff2)\)/g
      const matches = [...cssText.matchAll(fontRe)]
      const fontNames = [...new Set(matches.map(m => m[1]))]

      // base64 inline 字体
      const fontMap = {}
      await Promise.all(fontNames.map(async (name) => {
        const url = `/node_modules/katex/dist/fonts/${name}`
        const resp = await fetch(url)
        if (!resp.ok) return
        const buf = await resp.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
        }
        fontMap[name] = `data:font/woff2;base64,${btoa(binary)}`
      }))
      for (const [name, dataUrl] of Object.entries(fontMap)) {
        const re = new RegExp(`url\\(fonts\\/${name.replace(/\./g, '\\.')}\\)`, 'g')
        cssText = cssText.replace(re, `url(${dataUrl})`)
      }
      console.log(`[smoke] 内联 ${Object.keys(fontMap).length} 个 KaTeX 字体`)

      // hidden iframe 渲染
      const holder = document.createElement('div')
      holder.style.cssText = 'position:fixed;left:0;top:0;width:794px;z-index:2147483647;background:#fff;opacity:0;pointer-events:none;'
      document.body.appendChild(holder)
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'width:794px;height:1200px;border:0;background:#fff;display:block;'
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
      holder.appendChild(iframe)

      const iwin = iframe.contentWindow
      const idoc = iwin.document
      idoc.open()
      idoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${cssText}\n${mod.buildPaperCSS()}</style></head><body>${mod.buildPaperBody({
        title: '蔡怡希 - 错题再测-0812',
        studentName: '蔡怡希',
        questions: qs,
        showAnswers: false,
      })}</body></html>`)
      idoc.close()

      if (idoc.readyState === 'loading') {
        await new Promise((resolve) => {
          const onReady = () => resolve()
          idoc.addEventListener('DOMContentLoaded', onReady, { once: true })
          setTimeout(resolve, 1000)
        })
      }
      mod.renderMathInContainer(idoc)
      await mod.preloadKatexFonts(idoc)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      void idoc.body?.offsetWidth
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 400))

      const html = idoc.documentElement.outerHTML
      setTimeout(() => { try { document.body.removeChild(holder) } catch (e) {} }, 100)
      return { html, size: html.length }
    }, questions)

    const fs_path = path.join(OUT_DIR, 'rendered.html')
    fs.writeFileSync(fs_path, html.html)
    console.log(`[smoke] HTML 渲染完成 ${(html.size / 1024).toFixed(1)}KB，保存到 ${fs_path}`)

    // ============ Step 2: POST 给后端 /api/exam-pdf ============
    const t0 = Date.now()
    const resp = await fetch(`${API_BASE}/api/exam-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: html.html,
        filename: 'wrongbook-server.pdf',
        pdfOptions: {
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
        },
      }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`后端返回 ${resp.status}: ${txt.slice(0, 500)}`)
    }
    const pdfBuf = await resp.arrayBuffer()
    const pdfPath = path.join(OUT_DIR, 'wrongbook-server.pdf')
    fs.writeFileSync(pdfPath, Buffer.from(pdfBuf))
    const dt = Date.now() - t0
    console.log(`[smoke] PDF 接收完成 ${dt}ms, ${(pdfBuf.byteLength / 1024).toFixed(1)}KB，保存到 ${pdfPath}`)
  } finally {
    await page.close()
    await browser.close()
  }
})().catch((err) => {
  console.error('[smoke] 失败:', err.message)
  process.exit(1)
})
