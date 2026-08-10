import fitz
import os

pdf_path = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810_20260810_2002.pdf"
doc = fitz.open(pdf_path)

out_dir = r"C:\Users\ADMINI~1\AppData\Local\Temp\trae\pdf_pages_new"
os.makedirs(out_dir, exist_ok=True)

# 提取 xref=24 的图像
for xref_id in [23, 24, 25, 26, 27]:
    try:
        pix = fitz.Pixmap(doc, xref_id)
        out = os.path.join(out_dir, f"xref_{xref_id}.png")
        if pix.n - pix.alpha < 4:
            pix.save(out)
        else:
            pix2 = fitz.Pixmap(fitz.csRGB, pix)
            pix2.save(out)
            pix2 = None
        pix = None
        print(f"saved xref={xref_id} size={pix.width if pix else '?'} to {out}")
    except Exception as e:
        print(f"xref={xref_id} error: {e}")

# 也提取每页的渲染图（包括所有叠加）
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=120)
    out = os.path.join(out_dir, f"page_{i+1:02d}.png")
    pix.save(out)
    print(f"page {i+1}: {pix.width}x{pix.height} -> {out}")

doc.close()
print("Done")
