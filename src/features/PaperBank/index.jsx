import { useEffect, useRef, useState } from 'react'
import { ImageIcon, AlertCircle } from 'lucide-react'
import dayjs from 'dayjs'
import { processMultiPagePaperLayout } from '../../services/paperBankAIService'
import { downloadPaperWord } from '../../utils/docxGenerator'
import { useToast } from '../../components/ToastProvider'

// 试卷资源库（Paper Bank）自包含模块。
// 从 App.jsx 拆出：仅含 state + handlers + 渲染辅助函数，无 UI 挂载点（UI 尚未接入）。
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('图片过大（超过 10MB），请选择较小的图片'))
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result
      if (base64String && typeof base64String === 'string') {
        resolve(base64String)
      } else {
        reject(new Error('Failed to convert file to base64'))
      }
    }
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

const escapeHtml = (text) => {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function usePaperBank() {
  const Toast = useToast()

  const [paperBankStep, setPaperBankStep] = useState('list') // list | upload | processing | proofread | export
  const [paperBankPapers, setPaperBankPapers] = useState(() => {
    try {
      const cached = localStorage.getItem('paperbank_papers')
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })

  const [paperBankDraft, setPaperBankDraft] = useState(null)
  const [paperBankUploadedPages, setPaperBankUploadedPages] = useState([])
  const [paperBankReconstructedPages, setPaperBankReconstructedPages] = useState([])
  const [paperBankProcessing, setPaperBankProcessing] = useState(false)
  const [paperBankProgress, setPaperBankProgress] = useState(0)
  const [paperBankProofreadMode, setPaperBankProofreadMode] = useState(false)
  const [paperBankInfo, setPaperBankInfo] = useState(null)
  const [editingBlock, setEditingBlock] = useState(null) // {pageNo, blockIndex}
  const [paperBankCurrentPage, setPaperBankCurrentPage] = useState(0)
  const [paperBankShowOriginal, setPaperBankShowOriginal] = useState(false)
  const paperBankContainerRef = useRef(null)
  const [paperBankNarrow, setPaperBankNarrow] = useState(false)

  useEffect(() => {
    if (!paperBankContainerRef.current) return
    const checkWidth = () => {
      const w = paperBankContainerRef.current?.getBoundingClientRect().width || 0
      setPaperBankNarrow(w < 768)
    }
    checkWidth()
    const observer = new ResizeObserver(checkWidth)
    observer.observe(paperBankContainerRef.current)
    return () => observer.disconnect()
  }, [paperBankStep])

  const [paperBankFilterGrade, setPaperBankFilterGrade] = useState('all')
  const [paperBankFilterSubject, setPaperBankFilterSubject] = useState('all')
  const [paperBankSearchKeyword, setPaperBankSearchKeyword] = useState('')
  const [paperBankShowFilters, setPaperBankShowFilters] = useState(false)
  const [paperBankPreviewPaper, setPaperBankPreviewPaper] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem('paperbank_papers', JSON.stringify(paperBankPapers))
    } catch (e) { /* ignore */ }
  }, [paperBankPapers])

  const handlePaperBankFileSelect = async (e) => {
    const files = Array.from(e.target?.files || [])
    if (files.length === 0) return

    try {
      const pages = await Promise.all(
        files.map(async (file, index) => ({
          id: `page_${Date.now()}_${index}`,
          name: file.name,
          imageUrl: URL.createObjectURL(file),
          imageBase64: await fileToBase64(file),
          file: file
        }))
      )

      setPaperBankUploadedPages(prev => [...prev, ...pages])
      Toast.show({ message: '已添加 ' + files.length + ' 页', type: 'success', duration: 1500 })
    } catch (error) {
      console.error('[PaperBank] 文件选择失败:', error)
      Toast.show({ message: '文件读取失败', type: 'error', duration: 2000 })
    }
  }

  const handlePaperBankRemovePage = (pageId) => {
    setPaperBankUploadedPages(prev => prev.filter(p => p.id !== pageId))
  }

  const handlePaperBankStartProcessing = async () => {
    if (paperBankUploadedPages.length === 0) {
      Toast.show({ message: '请先上传试卷', type: 'error', duration: 2000 })
      return
    }

    const validPages = paperBankUploadedPages.filter(p => p.imageBase64)
    if (validPages.length === 0) {
      Toast.show({ message: '图片数据无效，请重新上传', type: 'error', duration: 2000 })
      return
    }

    setPaperBankProcessing(true)
    setPaperBankProgress(0)
    setPaperBankStep('processing')

    try {
      let currentProgress = 10
      const progressInterval = setInterval(() => {
        currentProgress += Math.random() * 5
        if (currentProgress < 90) {
          setPaperBankProgress(currentProgress)
        }
      }, 1000)

      const result = await processMultiPagePaperLayout(validPages)

      clearInterval(progressInterval)
      setPaperBankProgress(100)

      if (result.success) {
        const info = result.data.paperInfo || {}
        const pageResults = result.data.pageResults || []

        setPaperBankReconstructedPages(pageResults)

        setPaperBankInfo({
          name: info.name || paperBankUploadedPages[0]?.name?.replace(/\.[^.]+$/, '') || '未命名试卷',
          subject: info.subject || '',
          grade: info.grade || '',
          examType: info.examType || '',
          schoolYear: info.schoolYear || '',
          semester: info.semester || ''
        })

        setTimeout(() => {
          setPaperBankStep('proofread')
        }, 500)
      } else {
        Toast.show({ message: result.error || 'AI识别失败', type: 'error', duration: 3000 })
        setPaperBankStep('upload')
      }
    } catch (error) {
      console.error('[PaperBank] AI处理失败:', error)
      Toast.show({ message: '处理失败，请重试', type: 'error', duration: 3000 })
      setPaperBankStep('upload')
    } finally {
      setPaperBankProcessing(false)
    }
  }

  const handlePaperBankDownloadWord = async () => {
    if (!paperBankInfo) return

    const paperData = {
      name: paperBankInfo.name,
      subject: paperBankInfo.subject,
      grade: paperBankInfo.grade,
      examType: paperBankInfo.examType,
      pages: paperBankReconstructedPages
    }

    try {
      const wordToast = Toast.show({ message: '正在生成Word...', type: 'loading', duration: 0 })
      await downloadPaperWord(paperData, paperBankInfo.name)
      wordToast.dismiss()
      Toast.show({ message: 'Word已下载！', type: 'success', duration: 2000 })
    } catch (error) {
      console.error('[PaperBank] Word生成失败:', error)
      Toast.dismiss()
      Toast.show({ message: 'Word 生成失败: ' + error.message, type: 'error', duration: 3000 })
    }
  }

  const handlePaperBankFinalize = () => {
    if (!paperBankInfo) return

    const newPaper = {
      id: `paper_${Date.now()}`,
      name: paperBankInfo.name,
      subject: paperBankInfo.subject,
      grade: paperBankInfo.grade,
      examType: paperBankInfo.examType,
      schoolYear: paperBankInfo.schoolYear,
      semester: paperBankInfo.semester,
      pages: paperBankReconstructedPages.map(p => ({
        pageNo: p.pageNo,
        originalImage: p.originalImage,
        layoutBlocks: p.layoutBlocks
      })),
      totalPages: paperBankReconstructedPages.length,
      thumbnail: paperBankReconstructedPages[0]?.originalImage || '',
      createdAt: new Date().toISOString()
    }

    setPaperBankPapers(prev => [newPaper, ...prev])
    Toast.show({ message: '试卷入库成功', type: 'success', duration: 2000 })

    setPaperBankStep('list')
    setPaperBankUploadedPages([])
    setPaperBankReconstructedPages([])
    setPaperBankDraft(null)
    setPaperBankInfo(null)
    setEditingBlock(null)
  }

  const handlePaperBankReset = () => {
    setPaperBankStep('upload')
    setPaperBankUploadedPages([])
    setPaperBankReconstructedPages([])
    setPaperBankDraft(null)
    setPaperBankInfo(null)
    setEditingBlock(null)
    setPaperBankCurrentPage(0)
    setPaperBankShowOriginal(false)
    setPaperBankProofreadMode(false)
  }

  const handlePaperBankDelete = (paperId) => {
    setPaperBankPapers(prev => prev.filter(p => p.id !== paperId))
    Toast.show({ message: '已删除', type: 'success', duration: 1500 })
  }

  const handleBlockEdit = (pageNo, blockIndex) => {
    setEditingBlock({ pageNo, blockIndex })
  }

  const handleBlockUpdate = (pageNo, blockIndex, newContent) => {
    setPaperBankReconstructedPages(prev =>
      prev.map(page =>
        page.pageNo === pageNo
          ? {
              ...page,
              layoutBlocks: page.layoutBlocks.map((block, idx) =>
                idx === blockIndex ? { ...block, content: newContent } : block
              )
            }
          : page
      )
    )
    setEditingBlock(null)
  }

  const renderBlock = (block, pageNo, blockIndex) => {
    const isEditing = editingBlock?.pageNo === pageNo && editingBlock?.blockIndex === blockIndex
    const isLowConfidence = block.confidence !== undefined && block.confidence < 0.7

    const editableContent = (
      <div
        className={`cursor-pointer rounded transition-colors ${isLowConfidence ? 'bg-[var(--warning-soft)] border border-[var(--warning)] px-1' : 'hover:bg-[var(--primary-mist)]/50'}`}
        onClick={() => !isEditing && handleBlockEdit(pageNo, blockIndex)}
      >
        {isEditing ? (
          <textarea
            value={block.content || ''}
            onChange={(e) => handleBlockUpdate(pageNo, blockIndex, e.target.value)}
            className="w-full p-2 text-sm border-2 border-[var(--primary-light)] rounded focus:outline-none focus:ring-2 focus:ring-[var(--primary)] bg-[var(--primary-mist)]"
            style={{ minHeight: '60px', lineHeight: '1.6' }}
            autoFocus
            onBlur={() => setEditingBlock(null)}
          />
        ) : (
          <div className="flex items-start gap-1">
            <span>{block.content}</span>
            {isLowConfidence && (
              <span className="inline-flex items-center gap-0.5 text-[var(--warning)] text-[10px] ml-1 shrink-0" title={`置信度: ${Math.round(block.confidence * 100)}%`}>
                <AlertCircle size={10} />
              </span>
            )}
          </div>
        )}
      </div>
    )

    switch (block.type) {
      case 'title':
        return (
          <div className="text-center py-3" style={block.style || {}}>
            <div style={{ fontSize: 'var(--fs-20)', fontWeight: 'bold', lineHeight: '1.3', color: 'var(--text)' }}>
              {editableContent}
            </div>
          </div>
        )
      case 'subtitle':
        return (
          <div className="text-center py-1" style={block.style || {}}>
            <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              {editableContent}
            </div>
          </div>
        )
      case 'section':
        return (
          <div className="mt-6 mb-3" style={block.style || {}}>
            <div className="flex items-center gap-2">
              <div style={{ width: '3px', height: '18px', background: 'var(--text)', borderRadius: 'var(--radius-2)' }} />
              <div style={{ fontSize: 'var(--fs-15)', fontWeight: 'bold', color: 'var(--text)', lineHeight: '1.4' }}>
                {editableContent}
              </div>
            </div>
            <div className="mt-2" style={{ borderBottom: '1.5px solid var(--border)' }} />
          </div>
        )
      case 'question':
        return (
          <div className="mb-3" style={block.style || {}}>
            <div style={{ fontSize: 'var(--fs-14)', lineHeight: '1.7', color: 'var(--text)' }}>
              {editableContent}
            </div>
            {block.options && block.options.length > 0 && (
              <div className="mt-2 ml-4">
                {block.options.map((opt, optIdx) => (
                  <div
                    key={optIdx}
                    className="cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--primary-mist)]/50"
                    onClick={() => {
                      const newOptions = [...block.options]
                      const newContent = newOptions[optIdx]
                      setEditingBlock({ pageNo, blockIndex, optionIndex: optIdx })
                    }}
                  >
                    <span style={{ fontSize: 'var(--fs-13)', lineHeight: '1.6', color: 'var(--text)' }}>
                      {opt}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      case 'text':
        return (
          <div className="mb-2" style={block.style || {}}>
            <div style={{ fontSize: 'var(--fs-14)', lineHeight: '1.7', color: 'var(--text)' }}>
              {editableContent}
            </div>
          </div>
        )
      case 'image': {
        return (
          <div className="my-3 text-center">
            {block.src ? (
              <div className="inline-block">
                <img
                  src={block.src}
                  alt={block.caption || '题目配图'}
                  loading="lazy"
                  className="rounded border border-[var(--border-light)] max-w-full"
                  style={{ maxHeight: '220px', objectFit: 'contain' }}
                />
                {block.caption && (
                  <div className="text-xs text-[var(--text-secondary)] mt-1 text-center">{block.caption}</div>
                )}
              </div>
            ) : (
              <div className="inline-flex flex-col items-center gap-1 px-3 py-2 rounded-lg border-2 border-dashed border-[var(--warning)] bg-[var(--warning-soft)]">
                <ImageIcon size={16} style={{ color: 'var(--warning)' }} />
                <span className="text-xs text-[var(--warning)]">
                  {block.caption ? `[图: ${block.caption}]` : '[图片区域]'}
                </span>
                <span className="text-[10px] text-[var(--warning)]">AI未检测到此区域，请手动插入</span>
              </div>
            )}
          </div>
        )
      }
      case 'table':
        if (!block.rows || block.rows.length === 0) return null
        return (
          <div className="my-4 overflow-x-auto">
            <table className="w-full border-collapse border border-gray-400 text-sm">
              <tbody>
                {block.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="border border-gray-400 px-3 py-2"
                        style={{ fontSize: 'var(--fs-13)', lineHeight: '1.5' }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'footer':
        return (
          <div className="text-center py-3 mt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)' }}>
              {editableContent}
            </div>
          </div>
        )
      default:
        return (
          <div className="mb-2" style={block.style || {}}>
            <div style={{ fontSize: 'var(--fs-14)', lineHeight: '1.6', color: 'var(--text)' }}>
              {editableContent}
            </div>
          </div>
        )
    }
  }

  const renderReconstructedPage = (page) => {
    return (
      <div
        className="bg-white rounded-lg shadow-sm overflow-hidden"
        style={{
          border: '1px solid var(--border-light)',
          marginBottom: '16px',
          minHeight: '600px'
        }}
      >
        <div className="p-6">
          {page.layoutBlocks && page.layoutBlocks.length > 0 ? (
            page.layoutBlocks.map((block, idx) => (
              <div key={idx}>
                {renderBlock(block, page.pageNo, idx)}
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-[var(--text-tertiary)] text-sm">
              {page.error ? `识别失败：${page.error}` : '该页未识别到内容'}
            </div>
          )}
        </div>
        <div className="text-center py-2 text-xs text-[var(--text-tertiary)]" style={{ borderTop: '1px solid var(--bg-secondary)' }}>
          — {page.pageNo} —
        </div>
      </div>
    )
  }

  const handlePaperBankPrint = async (paper) => {
    try {
      Toast.show({ message: '正在生成PDF...', type: 'loading', duration: 0 })
      setPaperBankPreviewPaper(paper)

      const html2canvas = (await import('html2canvas')).default
      const jsPDF = (await import('jspdf')).default

      function renderBlockToHTML(block) {
        switch (block.type) {
          case 'title':
            return `<div class="block-title">${escapeHtml(block.content)}</div>`
          case 'subtitle':
            return `<div class="block-subtitle">${escapeHtml(block.content)}</div>`
          case 'section':
            return `<div class="block-section">${escapeHtml(block.content)}</div>`
          case 'question':
            let qHTML = `<div class="block-question">${escapeHtml(block.content)}`
            if (block.options && block.options.length > 0) {
              qHTML += `<div class="block-options">`
              block.options.forEach(opt => {
                qHTML += `<div class="block-option">${escapeHtml(opt)}</div>`
              })
              qHTML += `</div>`
            }
            qHTML += `</div>`
            return qHTML
          case 'text':
            return `<div class="block-text">${escapeHtml(block.content)}</div>`
          case 'image': {
            if (block.src) {
              return `<div class="block-image" style="text-align:center;"><img src="${block.src}" alt="${escapeHtml(block.caption || '')}" loading="lazy" style="max-width:100%;display:block;margin:8px auto;" />${block.caption ? `<div style="font-size:10px;color:#666;">${escapeHtml(block.caption)}</div>` : ''}</div>`
            }
            return `<div class="block-image" style="text-align:center;color:#999;font-style:italic;">[图: ${escapeHtml(block.caption || '待插入')}]</div>`
          }
          case 'table':
            if (!block.rows || block.rows.length === 0) return ''
            let tHTML = `<table class="block-table"><tbody>`
            block.rows.forEach(row => {
              tHTML += `<tr>`
              row.forEach(cell => {
                tHTML += `<td>${escapeHtml(cell)}</td>`
              })
              tHTML += `</tr>`
            })
            tHTML += `</tbody></table>`
            return tHTML
          case 'footer':
            return `<div class="block-footer">${escapeHtml(block.content)}</div>`
          default:
            return `<div class="block-text">${escapeHtml(block.content || '')}</div>`
        }
      }

      let pagesHTML = ''

      if (paper.pages && paper.pages.length > 0) {
        paper.pages.forEach((page, pageIdx) => {
          pagesHTML += `<div class="paper-page">`
          if (pageIdx === 0) {
            pagesHTML += `<div class="paper-title">${escapeHtml(paper.name)}</div>`
            pagesHTML += `<div class="paper-info">${[paper.subject, paper.grade, paper.examType].filter(Boolean).join(' · ') || ''}</div>`
            pagesHTML += `<div class="divider"></div>`
          }
          if (page.layoutBlocks && page.layoutBlocks.length > 0) {
            page.layoutBlocks.forEach(block => {
              pagesHTML += renderBlockToHTML(block)
            })
          }
          pagesHTML += `<div class="footer">- ${page.pageNo} -</div>`
          pagesHTML += `</div>`
        })
      } else if (paper.content) {
        pagesHTML = `<div class="paper-page">
          <div class="paper-title">${escapeHtml(paper.name)}</div>
          <div class="paper-info">${[paper.subject, paper.grade, paper.examType].filter(Boolean).join(' · ') || ''}</div>
          <div class="divider"></div>
          <div class="paper-content">${escapeHtml(paper.content).replace(/\n/g, '<br>')}</div>
          <div class="footer">- 试卷资源库 · ${dayjs(paper.createdAt).format('YYYY/MM/DD')} -</div>
        </div>`
      }

      const paperHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun',sans-serif;color:#1a1a1a}
        .paper-page{width:794px;padding:40px 60px;page-break-after:always}
        .paper-page:last-child{page-break-after:auto}
        .paper-title{text-align:center;font-size:24px;font-weight:bold;margin-bottom:8px}
        .paper-info{text-align:center;font-size:13px;color:#666;margin-bottom:16px}
        .divider{border-top:2px solid #333;margin:12px 0 20px}
        .paper-content{font-size:14px;line-height:2;white-space:pre-wrap;word-break:break-all}
        .block-title{text-align:center;font-size:22px;font-weight:bold;margin-bottom:12px}
        .block-subtitle{text-align:center;font-size:13px;color:#666;margin-bottom:12px}
        .block-section{font-size:16px;font-weight:bold;margin:20px 0 10px;border-left:3px solid #333;padding-left:8px}
        .block-question{font-size:14px;line-height:1.8;margin-bottom:8px}
        .block-options{margin:8px 0 8px 20px}
        .block-option{font-size:14px;line-height:1.6}
        .block-text{font-size:14px;line-height:1.8;margin-bottom:8px}
        .block-image{margin:12px 0;text-align:center}
        .block-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
        .block-table td{border:1px solid #333;padding:6px 8px}
        .block-footer{text-align:center;font-size:11px;color:#999;margin-top:20px;padding-top:8px;border-top:1px solid #ddd}
        .footer{text-align:center;font-size:11px;color:#999;margin-top:30px;padding-top:8px;border-top:1px solid #ddd}
      </style></head><body>
        ${pagesHTML}
      </body></html>`

      const container = document.createElement('div')
      container.innerHTML = paperHTML
      container.style.position = 'absolute'
      container.style.left = '-9999px'
      container.style.top = '0'
      container.style.width = '794px'
      document.body.appendChild(container)

      try {
        const canvas = await html2canvas(container, {
          scale: 2,
          useCORS: true,
          logging: false,
          width: 794,
          height: container.scrollHeight,
        })

        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        const A4_W = 210
        const A4_H = 297
        const pageH = (794 / A4_W) * A4_H
        const totalPages = Math.ceil(canvas.height / pageH)

        const doc = new jsPDF('p', 'mm', 'a4')

        for (let p = 0; p < totalPages; p++) {
          if (p > 0) doc.addPage()
          const srcY = p * pageH
          const sliceH = Math.min(pageH, canvas.height - srcY)

          const pageCanvas = document.createElement('canvas')
          pageCanvas.width = canvas.width
          pageCanvas.height = sliceH
          const ctx = pageCanvas.getContext('2d')
          ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

          const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
          const mmH = (sliceH / canvas.width) * A4_W
          doc.addImage(pageImg, 'JPEG', 0, 0, A4_W, mmH)
        }

        const filename = `${paper.name || '试卷'}_${dayjs().format('YYYYMMDD')}`
        doc.save(`${filename}.pdf`)
        Toast.dismiss()
        Toast.show({ message: 'PDF已生成，请在下载目录查看', type: 'success', duration: 2000 })
      } finally {
        document.body.removeChild(container)
      }
    } catch (error) {
      console.error('[PaperBank] PDF生成失败:', error)
      Toast.dismiss()
      Toast.show({ message: 'PDF生成失败，请重试', type: 'error', duration: 3000 })
    } finally {
      setPaperBankPreviewPaper(null)
    }
  }

  const handlePaperBankClearFilters = () => {
    setPaperBankFilterGrade('all')
    setPaperBankFilterSubject('all')
    setPaperBankSearchKeyword('')
  }

  const paperBankGrades = Array.from(new Set(paperBankPapers.map(p => p.grade).filter(Boolean)))
  const paperBankSubjects = Array.from(new Set(paperBankPapers.map(p => p.subject).filter(Boolean)))

  const filteredPaperBankPapers = paperBankPapers.filter(paper => {
    if (paperBankFilterGrade !== 'all' && paper.grade !== paperBankFilterGrade) return false
    if (paperBankFilterSubject !== 'all' && paper.subject !== paperBankFilterSubject) return false
    if (paperBankSearchKeyword) {
      const keyword = paperBankSearchKeyword.toLowerCase()
      const matchName = paper.name?.toLowerCase().includes(keyword)
      const matchContent = paper.content?.toLowerCase().includes(keyword)
      if (!matchName && !matchContent) return false
    }
    return true
  })

  const hasActiveFilters = paperBankFilterGrade !== 'all' || paperBankFilterSubject !== 'all' || paperBankSearchKeyword

  return {
    paperBankStep,
    paperBankPapers,
    paperBankDraft,
    paperBankUploadedPages,
    paperBankReconstructedPages,
    paperBankProcessing,
    paperBankProgress,
    paperBankProofreadMode,
    paperBankInfo,
    paperBankCurrentPage,
    paperBankShowOriginal,
    paperBankContainerRef,
    paperBankNarrow,
    paperBankFilterGrade,
    paperBankFilterSubject,
    paperBankSearchKeyword,
    paperBankShowFilters,
    paperBankPreviewPaper,
    paperBankGrades,
    paperBankSubjects,
    filteredPaperBankPapers,
    hasActiveFilters,
    handlePaperBankFileSelect,
    handlePaperBankRemovePage,
    handlePaperBankStartProcessing,
    handlePaperBankDownloadWord,
    handlePaperBankFinalize,
    handlePaperBankReset,
    handlePaperBankDelete,
    handleBlockEdit,
    handleBlockUpdate,
    handlePaperBankPrint,
    handlePaperBankClearFilters,
    renderBlock,
    renderReconstructedPage
  }
}
