import fitz
import os

pdf_path = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810-01_20260810_1954.pdf"
doc = fitz.open(pdf_path)

print(f"PDF pages: {len(doc)}")
print(f"Page rect (pt): {doc[0].rect}")
# 1 pt = 1/72 inch; A4 = 595 x 842 pt

for i, page in enumerate(doc):
    print(f"\n=== Page {i+1} ===")
    print(f"  rect: {page.rect}")
    # 获取所有图像
    images = page.get_images(full=True)
    print(f"  images count: {len(images)}")
    for img in images:
        xref = img[0]
        # 获取图像在页面上的位置
        rects = page.get_image_rects(xref)
        for r in rects:
            print(f"    xref={xref} rect=({r.x0:.1f},{r.y0:.1f})-({r.x1:.1f},{r.y1:.1f}) w={r.width:.1f} h={r.height:.1f}")

    # 获取文本块
    text = page.get_text()
    print(f"  text length: {len(text)}")
    if text:
        print(f"  text (first 200): {text[:200]!r}")

    # 获取所有 drawing (线条等)
    drawings = page.get_drawings()
    print(f"  drawings count: {len(drawings)}")

    # 获取页面所有内容流，看看有没有 Text 操作符
    blocks = page.get_text("dict")["blocks"]
    print(f"  blocks: {len(blocks)}")
    for b in blocks[:5]:
        print(f"    type={b.get('type')} bbox={b.get('bbox')}")
doc.close()
