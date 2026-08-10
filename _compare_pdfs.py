import fitz
import os

old_pdf = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810-01_20260810_1954.pdf"
new_pdf = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810_20260810_2002.pdf"

def analyze_pdf(pdf_path, label):
    print(f"\n{'='*60}")
    print(f"{label}: {os.path.basename(pdf_path)}")
    print(f"{'='*60}")
    doc = fitz.open(pdf_path)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=80)  # 缩小尺寸加速
        w, h = pix.width, pix.height
        # 直接从 pix.samples 读取像素
        samples = pix.samples
        n = pix.n  # 通道数
        stride = pix.stride

        print(f"\n--- Page {i+1} ({w}x{h}) ---")

        # 列出图像 xref 位置
        for img in page.get_images(full=True):
            xref = img[0]
            for r in page.get_image_rects(xref):
                x0_mm = r.x0 / 2.8346
                y0_mm = r.y0 / 2.8346
                x1_mm = r.x1 / 2.8346
                y1_mm = r.y1 / 2.8346
                w_mm = r.width / 2.8346
                h_mm = r.height / 2.8346
                print(f"  xref={xref} size_px={img[2]}x{img[3]} rect_mm=({x0_mm:.1f},{y0_mm:.1f})-({x1_mm:.1f},{y1_mm:.1f}) w={w_mm:.1f} h={h_mm:.1f}")

        # ASCII 预览：每 30 像素一行，每 15 像素一列
        lines = []
        for y in range(0, h, 30):
            line = ''
            for x in range(0, w, 15):
                non_white = 0
                total = 0
                for dy in range(30):
                    if y + dy >= h: break
                    for dx in range(15):
                        if x + dx >= w: break
                        idx = (y + dy) * stride + (x + dx) * n
                        r_val = samples[idx]
                        g_val = samples[idx + 1] if n > 1 else r_val
                        b_val = samples[idx + 2] if n > 2 else r_val
                        if r_val < 245 or g_val < 245 or b_val < 245:
                            non_white += 1
                        total += 1
                ratio = non_white / total if total > 0 else 0
                if ratio > 0.3:
                    line += '#'
                elif ratio > 0.1:
                    line += '+'
                elif ratio > 0.02:
                    line += '.'
                else:
                    line += ' '
            lines.append(line)
        print('\n'.join(lines))
    doc.close()

analyze_pdf(old_pdf, "OLD PDF (错位)")
analyze_pdf(new_pdf, "NEW PDF (修复后)")
