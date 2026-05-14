import { useMemo } from 'react'
import katex from 'katex'

/**
 * MathText — renders text with embedded LaTeX math.
 *
 * Supports two delimiter styles:
 *   $$...$$   display math (block, centered)
 *   \(...\)   inline math
 *
 * Usage:
 *   <MathText content="The area is \(A = \pi r^2\)" />
 *   <MathText content="$$\frac{1}{2}x + 2$$" />
 */
const MathText = ({ content, className = '' }) => {
  const segments = useMemo(() => {
    if (!content) return null
    const text = String(content)
    if (text.length === 0) return null

    // Split into segments: [text, math, text, math, ...]
    const parts = []
    let remaining = text
    let hasMath = false

    while (remaining.length > 0) {
      // Try to find display math $$...$$ first
      const displayMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/)
      if (displayMatch) {
        parts.push({ type: 'display', content: displayMatch[1].trim() })
        remaining = remaining.slice(displayMatch[0].length)
        hasMath = true
        continue
      }

      // Try to find inline math \(...\)
      const inlineMatch = remaining.match(/^\\\(([\s\S]*?)\\\)/)
      if (inlineMatch) {
        parts.push({ type: 'inline', content: inlineMatch[1].trim() })
        remaining = remaining.slice(inlineMatch[0].length)
        hasMath = true
        continue
      }

      // Find the next delimiter boundary
      const nextDisplay = remaining.indexOf('$$')
      const nextInline = remaining.indexOf('\\(')

      let boundary
      if (nextDisplay === -1 && nextInline === -1) {
        // No more math — rest is plain text
        parts.push({ type: 'text', content: remaining })
        remaining = ''
      } else if (nextDisplay === -1) {
        boundary = nextInline
      } else if (nextInline === -1) {
        boundary = nextDisplay
      } else {
        boundary = Math.min(nextDisplay, nextInline)
      }

      if (boundary !== undefined && boundary > 0) {
        parts.push({ type: 'text', content: remaining.slice(0, boundary) })
        remaining = remaining.slice(boundary)
      } else if (boundary === 0) {
        // Should not happen (would have been caught by match), but safety
        parts.push({ type: 'text', content: remaining[0] })
        remaining = remaining.slice(1)
      }
    }

    return hasMath ? parts : null
  }, [content])

  // If no math detected, return plain text
  if (!segments) {
    return <span className={className} style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
  }

  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }

        try {
          const html = katex.renderToString(seg.content, {
            throwOnError: false,
            displayMode: seg.type === 'display',
            maxSize: 10,
            maxExpand: 20,
            strict: false
          })
          if (seg.type === 'display') {
            return <span key={i} dangerouslySetInnerHTML={{ __html: html }} style={{ display: 'block', textAlign: 'center', margin: '4px 0' }} />
          }
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
        } catch (e) {
          // Render raw LaTeX source as code if rendering fails
          return (
            <code key={i} style={{
              background: '#FEE2E2', padding: '1px 4px', borderRadius: '4px',
              fontSize: '0.9em', color: '#DC2626'
            }}>
              {seg.type === 'display' ? `$$${seg.content}$$` : `\\(${seg.content}\\)`}
            </code>
          )
        }
      })}
    </span>
  )
}

export default MathText
