"""试卷题库配图：确定性 3x 高清化（配合 scripts/ops/fix_paper_figures.mjs 的第 2 步）。

用法（在项目根目录执行）：
    python scripts/ops/enhance_paper_figures.py --tag=<tag> [--scale=3]

输入  _work_figures/<tag>/manifest.json + src/<原图>
输出  _work_figures/<tag>/enh/<stem>.png（无损 PNG，供上传）
      _work_figures/<tag>/enh_compare_N.png（前后对照，人工目验用）

⛔ 判题图禁用生成式超分 / AI 重绘：模型会「顺手」把线条画平滑、补粗甚至挪位。
⛔ 白底化阈值必须 >=225：2026 松江一模是**浅灰印刷**（刻度数字、顶点字母灰度 180~215），
   照抄 2026-11-06 深墨卷的 150/185 阈值会把这些内容整片洗白（第一版 5/14 张目验确凿丢字）。
   这里只把 >245 的纸面噪点推到纯白，225~245 软过渡，<225 一律原样保留。

校验（每张都过才允许写库）：
   ① 连续灰度墨量列投影：加权质心偏移 <=1.5 列、相关系数 >0.98、墨量变化 <20%
      ⛔ 别用二值阈值：取 90/120/150 分别假判红 5/2/1 张（浅灰像素跨阈值抖动），
         本工具几何完全不变（同一裁片只做像素变换），连续墨量才是对的量。
   ② 内容保留硬闸：统一宽度后 <220 灰度像素总量保留率 ∈ [0.85, 1.25]。
   ③ 人工目验 enh_compare_*.png：字母、刻度、虚线、图注一个都不能少。
"""
import argparse
import json
import os
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('--tag', required=True)
ap.add_argument('--scale', type=int, default=3)
a = ap.parse_args()

WORK = f'_work_figures/{a.tag}'
SRC = f'{WORK}/src'
ENH = f'{WORK}/enh'
SCALE = a.scale
os.makedirs(ENH, exist_ok=True)
manifest = json.load(open(f'{WORK}/manifest.json', encoding='utf-8'))['manifest']


def whiten(gray: Image.Image) -> Image.Image:
    arr = np.asarray(gray).astype(np.float32)
    w = np.clip((arr - 225.0) / 20.0, 0.0, 1.0)
    n = arr * (1.0 - w) + 255.0 * w
    return Image.fromarray(np.clip(n, 0, 255).astype(np.uint8), 'L')


def ink_profile(gray: Image.Image, width=312):
    """连续墨量列投影（不二值化），见文件头判据说明。"""
    g = gray.resize((width, max(1, int(gray.height * width / gray.width))), Image.LANCZOS)
    return (255.0 - np.asarray(g).astype(np.float32)).sum(axis=0) / 255.0


def centroid(col):
    return float((np.arange(len(col)) * col).sum() / max(col.sum(), 1))


report = []
for item in manifest:
    name = item['base']
    stem = os.path.splitext(name)[0]
    src = Image.open(os.path.join(SRC, name)).convert('L')
    before = ink_profile(src)
    norm = whiten(src)
    big = norm.resize((norm.width * SCALE, norm.height * SCALE), Image.LANCZOS)
    big = big.filter(ImageFilter.UnsharpMask(radius=1.1, percent=70, threshold=2))
    out = os.path.join(ENH, stem + '.png')
    big.save(out, optimize=True)

    after = ink_profile(big)
    cen_b, cen_a = centroid(before), centroid(after)
    corr = float(np.corrcoef(before, after)[0, 1])
    mass = abs(float(after.sum()) - float(before.sum())) / max(float(before.sum()), 1)
    sb = np.asarray(src.resize((312, max(1, int(src.height * 312 / src.width))), Image.LANCZOS))
    sa = np.asarray(big.resize((312, max(1, int(big.height * 312 / big.width))), Image.LANCZOS))
    keep = float((sa < 220).sum()) / max(float((sb < 220).sum()), 1)
    ok = abs(cen_b - cen_a) <= 1.5 and corr > 0.98 and mass < 0.20 and 0.85 <= keep <= 1.25
    report.append((name, ok))
    flag = 'OK ' if ok else 'FAIL'
    print(f'{flag} {name[:24]:24s} {src.size} -> {big.size} '
          f'cen {cen_b:.1f}->{cen_a:.1f} corr={corr:.4f} mass={mass:.1%} keep={keep:.2f} '
          f'{os.path.getsize(out)//1024}KB')

# 前后对照图：左=现网原图 / 右=高清版，每 5 张一张，供人工目验
H, PAD, LABEL = 190, 12, 20
for sheet_i in range(0, len(manifest), 5):
    chunk = manifest[sheet_i:sheet_i + 5]
    pairs = []
    for item in chunk:
        left = Image.open(os.path.join(SRC, item['base'])).convert('RGB')
        right = Image.open(os.path.join(ENH, os.path.splitext(item['base'])[0] + '.png')).convert('RGB')
        left = left.resize((max(1, int(left.width * H / left.height)), H), Image.LANCZOS)
        right = right.resize((max(1, int(right.width * H / right.height)), H), Image.LANCZOS)
        pairs.append((item['base'][:12], left, right))
    cw = max(max(x.width, y.width) for _, x, y in pairs)
    sheet = Image.new('RGB', (PAD * 3 + cw * 2, PAD + (H + LABEL + PAD) * len(pairs)), '#f0f2f5')
    d = ImageDraw.Draw(sheet)
    d.text((PAD, 3), 'BEFORE (OSS now)', fill='#606266')
    d.text((PAD * 2 + cw, 3), f'AFTER ({SCALE}x enhanced)', fill='#606266')
    y = PAD + LABEL
    for label, left, right in pairs:
        d.text((PAD, y - 14), label, fill='#409eff')
        sheet.paste(left, (PAD, y))
        sheet.paste(right, (PAD * 2 + cw, y))
        y += H + PAD + LABEL
    p = f'{WORK}/enh_compare_{sheet_i // 5 + 1}.png'
    sheet.save(p)
    print('compare ->', p, sheet.size)

failed = [n for n, ok in report if not ok]
print(f'\nsummary: {len(report)} images, {len(failed)} failed')
if failed:
    print('FAILED (禁止写库):', failed)
    raise SystemExit(1)
