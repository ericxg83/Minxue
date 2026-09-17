#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
周末班错题课件 → 原生可编辑 PPTX（敏学品牌版）
================================================================
低成本快速出卷：直接消费 server/scripts/weekend-handout.mjs 的 slides.json 产物，
用 python-pptx 程序化生成 PPTX。改数据 → 重跑 mjs → 重跑本脚本 → 新课件，
全程无需手写页面，秒级出卷。产物为原生形状/文本框，可在 PowerPoint/WPS 直接编辑。

视觉规范：敏学 Design System（MINXUE_UI_DESIGN_SYSTEM.md）
- 主色 #6366F1（Indigo-500）；白底 + 1px #E2E8F0 border 分层；无重阴影
- 难度分档 = 状态色语义：基础→绿 #16A34A / 中等→主色蓝 #6366F1 / 较难→橙 #D97706 / 未判定→灰 #64748B
- 答案卡：浅色 mist 底 + 左侧色条 + 「参考答案」小标；整段单击场景（放映者逐题讲）
- 圆角克制（10–12px）；字体微软雅黑（Win 放映最稳）

用法：
  python weekend-handout-pptx.py --slides <slides.json> --out <out.pptx> [--images <dir>] [--no-answer]
"""
import argparse
import json
import os
import sys
import urllib.request

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ── 敏学 Design Tokens ──────────────────────────────────────────────
C_PRIMARY      = RGBColor(0x63, 0x66, 0xF1)   # Indigo-500 主色
C_PRIMARY_SOFT = RGBColor(0xE0, 0xE7, 0xFF)
C_PRIMARY_MIST = RGBColor(0xEE, 0xF2, 0xFF)
C_TEXT         = RGBColor(0x1E, 0x29, 0x3B)   # 一级文字
C_TEXT_2       = RGBColor(0x64, 0x74, 0x8B)   # 二级文字
C_TEXT_3       = RGBColor(0x94, 0xA3, 0xB8)   # 三级文字
C_BORDER       = RGBColor(0xE2, 0xE8, 0xF0)
C_BORDER_LIGHT = RGBColor(0xF1, 0xF5, 0xF9)
C_WHITE        = RGBColor(0xFF, 0xFF, 0xFF)
C_DANGER       = RGBColor(0xDC, 0x26, 0x26)
C_DANGER_SOFT  = RGBColor(0xFE, 0xE2, 0xE2)

# 难度分档 → 状态色（前景 / 浅底）
TIER_COLORS = {
    'basic':   (RGBColor(0x16, 0xA3, 0x4A), RGBColor(0xDC, 0xFC, 0xE7)),
    'medium':  (C_PRIMARY,                   C_PRIMARY_MIST),
    'hard':    (RGBColor(0xD9, 0x77, 0x06), RGBColor(0xFE, 0xF3, 0xC7)),
    'unknown': (RGBColor(0x64, 0x74, 0x8B), RGBColor(0xF1, 0xF5, 0xF9)),
}
TIER_LABEL = {'basic': '基础', 'medium': '中等', 'hard': '较难', 'unknown': '难度未判定'}

FONT = '微软雅黑'
PAGE_W, PAGE_H = 13.333, 7.5          # 16:9 英寸
MARGIN = 0.5                          # 页边距


def esc_markup(s):
    """XML 转义（python-pptx 文本里的 & < >）"""
    if s is None:
        return ''
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def char_w(c):
    """估算字符宽度（相对 1em）：中文/全角≈1，半角≈0.55"""
    o = ord(c)
    if o >= 0x4E00 and o <= 0x9FFF:
        return 1.0
    if c in '，。；：、？！（）《》【】“”’·—…':
        return 1.0
    return 0.55


def estimate_lines(text, size_pt, box_w_in):
    """按字符宽估算文本在指定字号/宽度下的行数"""
    if not text:
        return 1
    em_in = size_pt / 72.0
    max_em = box_w_in / em_in
    lines = 0
    for para in str(text).split('\n'):
        if not para.strip():
            lines += 1
            continue
        w = 0.0
        for ch in para:
            w += char_w(ch)
            if w > max_em:
                lines += 1
                w = char_w(ch)
        lines += 1
    return max(lines, 1)


def set_font(run, size, bold=False, color=C_TEXT, name=FONT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = name
    # 中文字体也要显式设置（东亚文本）
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}ea')
    if ea is None:
        ea = rPr.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}ea', {})
        rPr.append(ea)
    ea.set('typeface', name)


def add_box(slide, x, y, w, h, fill=None, line=None, radius=0.10, shadow=False):
    """圆角矩形（敏学：默认无阴影，border 分层）"""
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius is not None:
        try:
            shape.adjustments[0] = radius
        except Exception:
            pass
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    shape.shadow.inherit = False
    return shape


def add_text(slide, x, y, w, h, text, size=13, bold=False, color=C_TEXT,
             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line_spacing=1.0):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = align
    if line_spacing:
        p.line_spacing = line_spacing
    r = p.add_run()
    r.text = esc_markup(text)
    set_font(r, size, bold, color)
    return tb


def add_para(tf, text, size=13, bold=False, color=C_TEXT, align=PP_ALIGN.LEFT,
             line_spacing=1.0, space_before=0, first=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.line_spacing = line_spacing
    if space_before:
        p.space_before = Pt(space_before)
    r = p.add_run()
    r.text = esc_markup(text)
    set_font(r, size, bold, color)
    return p


def add_pic(slide, path, x, y, w, h):
    """等比嵌入图片（白底卡片内居中）"""
    from PIL import Image as PILImage
    try:
        im = PILImage.open(path)
        iw, ih = im.size
        if iw <= 0 or ih <= 0:
            return False
        ratio = min(w / iw, h / ih)
        nw, nh = iw * ratio, ih * ratio
        px, py = x + (w - nw) / 2, y + (h - nh) / 2
        slide.shapes.add_picture(path, Inches(px), Inches(py),
                                 Inches(nw), Inches(nh))
        return True
    except Exception:
        return False


# ── 页面构建 ──────────────────────────────────────────────────────────

def build_cover(prs, meta, students):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    # 顶部品牌条
    add_box(s, 0, 0, PAGE_W, 0.10, fill=C_PRIMARY)
    # 主标题
    add_text(s, MARGIN, 1.3, PAGE_W - 1, 0.9,
             '周末错题讲评', size=40, bold=True, color=C_TEXT)
    # 副标题
    add_text(s, MARGIN, 2.2, PAGE_W - 1, 0.5,
             f"{meta.get('grade','')} · {meta.get('period',{}).get('start','')} ~ {meta.get('period',{}).get('end','')}",
             size=18, color=C_TEXT_2)
    # 学生名单
    add_text(s, MARGIN, 2.75, PAGE_W - 1, 0.45,
             '、'.join(students), size=14, color=C_TEXT_3)
    # 统计条（白底 + border，KPI 风格）
    stats = meta.get('stats', {})
    kpis = [
        ('错题', stats.get('rawRows', 0)),
        ('去重题', stats.get('topics', 0)),
        ('有课日', stats.get('days', 0)),
        ('学生', stats.get('students', 0)),
    ]
    kw = (PAGE_W - 2 * MARGIN - 3 * 0.2) / 4
    for i, (label, value) in enumerate(kpis):
        x = MARGIN + i * (kw + 0.2)
        add_box(s, x, 3.5, kw, 1.15, fill=C_WHITE, line=C_BORDER, radius=0.08)
        add_box(s, x + 0.16, 3.62, 0.06, 0.9, fill=C_PRIMARY)
        add_text(s, x + 0.35, 3.72, kw - 0.5, 0.55, str(value),
                 size=30, bold=True, color=C_TEXT)
        add_text(s, x + 0.35, 4.28, kw - 0.5, 0.3, label, size=13, color=C_TEXT_2)
    # 底部提示
    add_text(s, MARGIN, 6.7, PAGE_W - 1, 0.4,
             '放映时单击一次浮现参考答案 · 日期倒序 · 每天内部由易到难',
             size=12, color=C_TEXT_3)


def build_toc(prs, slides):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_box(s, 0, 0, PAGE_W, 0.10, fill=C_PRIMARY)
    add_text(s, MARGIN, 0.5, 6, 0.6, '本份课件目录', size=26, bold=True, color=C_TEXT)
    add_text(s, 9.5, 0.6, 3.3, 0.4, '按日期倒序 · 每天内部由易到难',
             size=12, color=C_TEXT_3)
    # 表格：日期 / 题数 / 学生 / 基础 / 中等 / 较难 / 未判定
    secs = [sl for sl in slides if sl['kind'] == 'section']
    rows = len(secs)
    cols = 7
    tw = PAGE_W - 2 * MARGIN
    th = 0.62
    ty = 1.35
    # 表头
    headers = ['日期', '题数', '学生', '基础', '中等', '较难', '未判定']
    widths = [0.30 * tw, 0.10 * tw, 0.12 * tw, 0.12 * tw, 0.12 * tw, 0.12 * tw, 0.12 * tw]
    for j, (hdr, wd) in enumerate(zip(headers, widths)):
        x = MARGIN + sum(widths[:j])
        add_text(s, x, ty + 0.10, wd, 0.3, hdr, size=12, bold=True, color=C_TEXT_3,
                 align=PP_ALIGN.LEFT if j == 0 else PP_ALIGN.RIGHT)
    add_box(s, MARGIN, ty + 0.42, tw, 0.02, fill=C_BORDER)
    for i, sec in enumerate(secs):
        y = ty + 0.62 + i * th
        vals = [sec.get('label', ''), str(sec.get('topicCount', 0)), str(sec.get('studentCount', 0))]
        tiers = sec.get('tiers', {})
        for k in ['basic', 'medium', 'hard', 'unknown']:
            vals.append(str(tiers.get(k, 0)))
        for j, (v, wd) in enumerate(zip(vals, widths)):
            x = MARGIN + sum(widths[:j])
            bold = j == 0
            add_text(s, x, y + 0.12, wd, 0.4, v, size=15, bold=bold, color=C_TEXT,
                     align=PP_ALIGN.LEFT if j == 0 else PP_ALIGN.RIGHT)
        add_box(s, MARGIN, y + th - 0.02, tw, 0.02, fill=C_BORDER_LIGHT)


def build_section(prs, sec, sec_idx, sec_total):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_box(s, 0, 0, PAGE_W, 0.10, fill=C_PRIMARY)
    # 顶部浅色区
    add_box(s, 0, 0.5, PAGE_W, 2.2, fill=C_PRIMARY_MIST)
    add_box(s, MARGIN, 0.72, 0.08, 0.6, fill=C_PRIMARY)
    add_text(s, MARGIN + 0.25, 0.68, 6, 0.4, f'SECTION {sec_idx:02d} / {sec_total:02d}',
             size=13, bold=True, color=C_PRIMARY)
    add_text(s, MARGIN + 0.25, 1.25, 9, 0.9, sec.get('label', ''),
             size=36, bold=True, color=C_TEXT)
    add_text(s, MARGIN + 0.25, 2.15, 11, 0.4,
             f"{sec.get('topicCount',0)} 题 · {sec.get('studentCount',0)} 名学生",
             size=16, color=C_TEXT_2)
    # 学生名单
    stus = '、'.join(sec.get('students') or [])
    if stus:
        add_text(s, MARGIN + 0.25, 3.2, 11, 0.4, f'错的学生：{stus}',
                 size=13, color=C_TEXT_3)
    # 难度分布
    tiers = sec.get('tiers', {})
    parts = [f'{TIER_LABEL[k]} {tiers.get(k,0)}' for k in ['basic','medium','hard','unknown'] if tiers.get(k,0)]
    if parts:
        add_text(s, MARGIN + 0.25, 3.7, 11, 0.4, ' · '.join(parts),
                 size=14, color=C_TEXT_2)


def build_question(prs, q, seq, fig_dir, with_answer):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    tier = q.get('tier') or 'unknown'
    fg, bg = TIER_COLORS.get(tier, TIER_COLORS['unknown'])
    tier_label = TIER_LABEL.get(tier, '难度未判定')
    qn = q.get('questionNumber')
    day = q.get('day', '')
    qtype = q.get('typeLabel') or '未标题型'

    # ── 页眉：题号徽章 + 日期 + 难度 + 人数 ──
    add_box(s, MARGIN, 0.42, 0.62, 0.62, fill=fg, radius=0.25)
    add_text(s, MARGIN, 0.50, 0.62, 0.5, str(seq), size=22, bold=True,
             color=C_WHITE, align=PP_ALIGN.CENTER)
    add_text(s, MARGIN + 0.85, 0.52, 5.5, 0.4, f'{day} · {qtype}',
             size=14, color=C_TEXT_2)
    # 难度 tag（浅底 + 前景色字）
    d = q.get('difficulty')
    dlabel = tier_label if d is None else f'难度 {d} · {tier_label}'
    tag_w = 0.28 + len(dlabel) * 0.13
    add_box(s, MARGIN + 0.85, 0.95, tag_w, 0.34, fill=bg, radius=0.5)
    add_text(s, MARGIN + 0.85, 0.98, tag_w, 0.3, dlabel, size=11.5,
             bold=True, color=fg, align=PP_ALIGN.CENTER)
    # 多小问标识
    sub_parts = q.get('subParts') or []
    if len(sub_parts) > 1:
        add_text(s, 4.2, 0.98, 3, 0.3, f'含 {len(sub_parts)} 小问（完整题）',
                 size=11.5, color=C_TEXT_3)
    # 共错人数
    add_text(s, 10.3, 0.52, 2.5, 0.4,
             f"{q.get('studentCount',0)} 人错", size=14, bold=True,
             color=C_TEXT_2, align=PP_ALIGN.RIGHT)
    add_box(s, MARGIN, 1.42, PAGE_W - 2 * MARGIN, 0.02, fill=C_BORDER)

    # ── 内容区：题干 + 答案 动态分配高度 ──
    has_fig = bool(q.get('figure'))
    stem_w = (PAGE_W - 2 * MARGIN - 3.5) if has_fig else (PAGE_W - 2 * MARGIN)
    stem_x = MARGIN

    parent = q.get('parentStem') or ''
    sub_texts = []
    if len(sub_parts) > 1:
        sub_texts = [f"({sp.get('subNo')}) {sp.get('content','')}".rstrip() for sp in sub_parts]
    else:
        sub_texts = [q.get('stem') or '']
    ans = (q.get('answer') or '') if with_answer else ''
    ans_source = q.get('answerSourceLabel') or ''
    ans_risk = q.get('answerRisk')

    STEM_TOP = 1.62
    FIG_BOTTOM = 6.9
    PAGE_BOTTOM = 7.15

    # 选字号：题干 17→15→13，答案 14→12→10.5→9，直到总高度放得下
    stem_size = 17
    ans_size = 14
    for _ in range(4):
        stem_lines = estimate_lines(parent, stem_size, stem_w)
        for st in sub_texts:
            stem_lines += estimate_lines(st, stem_size, stem_w - 0.3)
        ans_lines = estimate_lines(ans, ans_size, PAGE_W - 2 * MARGIN - 0.6)
        stem_h = stem_lines * stem_size * 1.25 / 72 + 0.15
        ans_h = 0.5 + ans_lines * ans_size * 1.2 / 72
        fig_h = FIG_BOTTOM - STEM_TOP
        # 题干顶 1.62，底部不得超过 5.6；答案从 max(题干底, 4.6) 起，底部 ≤ 7.15
        stem_bottom = min(STEM_TOP + stem_h, 5.6)
        ans_top = max(stem_bottom + 0.18, 4.7)
        total_ok = (ans_top + ans_h <= PAGE_BOTTOM) and (stem_h <= fig_h)
        if total_ok:
            break
        if stem_size > 13:
            stem_size -= 2
        else:
            ans_size -= 1.5
    # 兜底：仍超时再压答案
    for _ in range(3):
        ans_lines = estimate_lines(ans, ans_size, PAGE_W - 2 * MARGIN - 0.6)
        ans_h = 0.5 + ans_lines * ans_size * 1.2 / 72
        stem_lines2 = estimate_lines(parent, stem_size, stem_w)
        for st in sub_texts:
            stem_lines2 += estimate_lines(st, stem_size, stem_w - 0.3)
        stem_h = stem_lines2 * stem_size * 1.25 / 72 + 0.15
        stem_bottom = min(STEM_TOP + stem_h, 5.6)
        ans_top = max(stem_bottom + 0.18, 4.7)
        if ans_top + ans_h <= PAGE_BOTTOM:
            break
        ans_size = max(9, ans_size - 1.5)

    # ── 题干文本框 ──
    tb = s.shapes.add_textbox(Inches(stem_x), Inches(STEM_TOP), Inches(stem_w),
                              Inches(min(STEM_TOP + stem_h, 5.6) - STEM_TOP))
    tf = tb.text_frame
    tf.word_wrap = True
    if parent:
        add_para(tf, parent, size=stem_size, bold=True, color=C_TEXT,
                 line_spacing=1.25, first=True)
        if sub_texts and sub_texts[0]:
            add_para(tf, '', size=4, first=False)
    for i, st in enumerate(sub_texts):
        add_para(tf, st, size=stem_size, bold=False, color=C_TEXT,
                 line_spacing=1.25, space_before=(6 if not parent or i > 0 else 0))

    # 缺小问提示（放在题干下方、答案上方）
    missing = q.get('missingSubs') or []
    if missing:
        add_text(s, stem_x, min(stem_bottom + 0.05, 5.55), 9.5, 0.3,
                 f'⚠ 本题错在第 {"、".join(missing)} 问，但题库缺该小问题干 — 讲前请看原卷图',
                 size=12, bold=True, color=C_DANGER)

    # ── 配图（右置白卡 + border）──
    fig_name = q.get('figure')  # images/figN.png
    if has_fig and fig_name:
        base = os.path.basename(fig_name)
        fig_path = None
        for cand in (os.path.join(fig_dir, base), os.path.join(fig_dir, fig_name)):
            if os.path.exists(cand):
                fig_path = cand
                break
        if fig_path is None and str(fig_name).startswith('http'):
            try:
                os.makedirs(fig_dir, exist_ok=True)
                dst = os.path.join(fig_dir, base)
                urllib.request.urlretrieve(fig_name, dst)
                fig_path = dst
            except Exception:
                fig_path = None
        if fig_path:
            fx = PAGE_W - MARGIN - 3.1
            fh = min(FIG_BOTTOM, stem_bottom + 0.5) - STEM_TOP
            add_box(s, fx, STEM_TOP, 3.1, fh, fill=C_WHITE, line=C_BORDER, radius=0.05)
            add_pic(s, fig_path, fx + 0.2, STEM_TOP + 0.15, 2.7, max(fh - 0.3, 1.0))

    # ── 答案卡（底部，高度自适应）──
    if with_answer:
        ans_lines = estimate_lines(ans, ans_size, PAGE_W - 2 * MARGIN - 0.6)
        ans_h = 0.5 + ans_lines * ans_size * 1.2 / 72
        ans_top = max(stem_bottom + 0.18, 4.7)
        if ans_top + ans_h > PAGE_BOTTOM:
            ans_h = PAGE_BOTTOM - ans_top
        add_box(s, MARGIN, ans_top, PAGE_W - 2 * MARGIN, ans_h, fill=C_PRIMARY_MIST,
                line=None, radius=0.06)
        add_box(s, MARGIN, ans_top, 0.07, ans_h, fill=C_PRIMARY)
        add_text(s, MARGIN + 0.25, ans_top + 0.10, 6, 0.28,
                 f'参考答案{(" · " + ans_source) if ans_source else ""}',
                 size=10.5, bold=True, color=C_PRIMARY)
        if ans:
            add_text(s, MARGIN + 0.25, ans_top + 0.36, PAGE_W - 2 * MARGIN - 0.6,
                     max(ans_h - 0.44, 0.5), ans, size=ans_size, bold=True,
                     color=C_TEXT, line_spacing=1.2)
        else:
            add_text(s, MARGIN + 0.25, ans_top + 0.40, 9, 0.35,
                     '参考答案暂缺 — 讲前请人工补', size=13, color=C_DANGER)
        if ans_risk:
            add_text(s, MARGIN + 0.25, ans_top + max(ans_h - 0.30, 0.1), 11, 0.28,
                     f'⚠ {ans_risk}', size=10, color=C_DANGER)


def main():
    ap = argparse.ArgumentParser(description='周末班错题课件 → 敏学品牌 PPTX')
    ap.add_argument('--slides', required=True, help='slides.json 路径（weekend-handout.mjs 产物）')
    ap.add_argument('--out', required=True, help='输出 PPTX 路径')
    ap.add_argument('--images', default='', help='配图目录（含 fig*.png 或 URL 缓存）')
    ap.add_argument('--no-answer', action='store_true', help='出重练版（不含答案）')
    args = ap.parse_args()

    with open(args.slides, encoding='utf-8') as f:
        data = json.load(f)
    slides = data.get('slides', [])
    meta = data.get('stats', {})
    students = data.get('stats', {}).get('studentNames', [])
    if not students:
        students = [s['name'] for s in slides[0].get('students', [])] if slides else []

    fig_dir = args.images or os.path.join(os.path.dirname(args.out), 'images')

    prs = Presentation()
    prs.slide_width = Inches(PAGE_W)
    prs.slide_height = Inches(PAGE_H)

    build_cover(prs, data, students)
    build_toc(prs, slides)

    secs = [sl for sl in slides if sl['kind'] == 'section']
    sec_total = len(secs)
    seq = 0
    for sec_idx, sec in enumerate(secs, 1):
        build_section(prs, sec, sec_idx, sec_total)
        day = sec.get('label')
        for q in [sl for sl in slides if sl['kind'] == 'question' and sl.get('sectionLabel') == day]:
            seq += 1
            build_question(prs, q, seq, fig_dir, with_answer=not args.no_answer)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    prs.save(args.out)
    print(f'OK 共 {len(prs.slides.__iter__.__self__._sldIdLst)} 页 → {args.out}')


if __name__ == '__main__':
    main()
