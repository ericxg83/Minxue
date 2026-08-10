import fitz
import sys
import os

pdf_path = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810-01_20260810_1954.pdf"
out_dir = r"C:\Users\ADMINI~1\AppData\Local\Temp\trae\pdf_pages"
os.makedirs(out_dir, exist_ok=True)

doc = fitz.open(pdf_path)
print(f"Page count: {len(doc)}")
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=120)
    out = os.path.join(out_dir, f"page_{i+1:02d}.png")
    pix.save(out)
    print(f"Page {i+1}: {pix.width}x{pix.height} -> {out}")

    # 同时提取文本
    text = page.get_text()
    txt_out = os.path.join(out_dir, f"page_{i+1:02d}.txt")
    with open(txt_out, "w", encoding="utf-8") as f:
        f.write(text)
doc.close()
print("Done")
