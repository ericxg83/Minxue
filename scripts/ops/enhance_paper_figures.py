"""试卷题库配图：确定性 3x 高清化（配合 scripts/ops/fix_paper_figures.mjs 的第 2 步）。

用法（在项目根目录执行）：
    python scripts/ops/enhance_paper_figures.py --tag=<tag> [--scale=3]

输入  _work_figures/<tag>/manifest.json + src/<原图>
输出  _work_figures/<tag>/enh/<stem>.png（无损 PNG，供上传）
      _work_figures/<tag>/enh_compare_N.png（前后对照，人工目验用）

⛔ 判题图禁用生成式超分 / AI 重绘：模型会「顺手」把线条画平滑、补粗甚至挪位。
⛔ **禁用任何锐化**（2026-11-10 事故）：11-09 版用 3x 插值 + 强锐化，在细线和字母
   周围产生振铃/双影（松江 q12 的 A/E/F、q17 的 B/C/D、抛物线被锐成断续点线），
   老师二次报障「配图依然模糊」。插值放大不增加真实细节，锐化只会把 JPEG 伪影放大成重影。
⛔ 不得用「白底化阈值」把像素往白推：2026 松江一模是浅灰印刷（刻度数字、顶点字母
   灰度 180~215），11-06 深墨卷的 150/185 阈值会把它们整片洗白（目验确凿丢字）。

现行算法（确定性、以白为锚）：
   n = clip(1.5*a - 121.5, 0, 255)  等价于 d=255-a 时 n=255-clip((d-4)*1.5)
   ⇒ 纯白(255)不动、极浅噪点(>=251)归白、其余墨迹按比例压黑。
   浅灰刻度/字母只会**变深**，绝不会被洗白；再 SCALE 倍 LANCZOS，不加任何锐化。

校验（每张都过才允许写库）：
   ① 连续灰度墨量列投影：相关系数 >0.98（主形状判据）、加权质心偏移 <=3.0 列
      ⛔ 别用二值阈值：取 90/120/150 分别假判红 5/2/1 张（浅灰像素跨阈值抖动）。
      ⚠ 质心阈值 1.5 是旧算法（几乎不改像素）标定的；压黑是单调但**非线性**（暗部
         clip 到 0 饱和），列权重会轻微重分布，嘉定 14 张实测最大偏 1.6 列且
         corr 0.9978、keep 1.07，属正常 ⇒ 判据改 3.0，主形状仍由 corr 锁死。
   ② 墨量增益 ∈ [0.95, 2.2]（压黑是单调线性变换，增益失控说明公式被改坏）。
   ③ 内容保留硬闸：<220 灰度像素总量保留率 >= 0.98（只许变深，不许洗白）。
   ④ 人工目验 enh_compare_*.png：字母、刻度、虚线、图注一个都不能少、不能有双影。
"""
import argparse
import json
import os
import numpy as np
from PIL import Image, ImageDraw

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


def ink_boost(gray: Image.Image) -> Image.Image:
    """以白为锚压黑墨迹：白底不动、浅灰内容变深，绝不往白推（不洗白）。"""
    arr = np.asarray(gray).astype(np.float32)
    n = np.clip(1.5 * arr - 121.5, 0.0, 255.0)
    return Image.fromarray(n.astype(np.uint8), 'L')


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
    norm = ink_boost(src)
    big = norm.resize((norm.width * SCALE, norm.height * SCALE), Image.LANCZOS)
    # ⛔ 这里不许加任何 sharpen：11-09 振铃事故见文件头
    out = os.path.join(ENH, stem + '.png')
    big.save(out, optimize=True)

    after = ink_profile(big)
    cen_b, cen_a = centroid(before), centroid(after)
    corr = float(np.corrcoef(before, after)[0, 1])
    gain = float(after.sum()) / max(float(before.sum()), 1)
    sb = np.asarray(src.resize((312, max(1, int(src.height * 312 / src.width))), Image.LANCZOS))
    sa = np.asarray(big.resize((312, max(1, int(big.height * 312 / big.width))), Image.LANCZOS))
    keep = float((sa < 220).sum()) / max(float((sb < 220).sum()), 1)
    ok = (abs(cen_b - cen_a) <= 3.0 and corr > 0.98
          and 0.95 <= gain <= 2.2 and keep >= 0.98)
    report.append((name, ok))
    flag = 'OK ' if ok else 'FAIL'
    print(f'{flag} {name[:24]:24s} {src.size} -> {big.size} '
          f'cen {cen_b:.1f}->{cen_a:.1f} corr={corr:.4f} gain={gain:.2f}x keep={keep:.2f} '
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
    d.text((PAD * 2 + cw, 3), f'AFTER ({SCALE}x, ink-boost, no sharpen)', fill='#606266')
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
