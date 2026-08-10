import fitz

pdf_path = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810_20260810_2002.pdf"
doc = fitz.open(pdf_path)

print(f"PDF pages: {len(doc)}")
for i, page in enumerate(doc):
    print(f"\n=== Page {i+1} (size pt: {page.rect.width:.1f} x {page.rect.height:.1f}) ===")
    images = page.get_images(full=True)
    print(f"  images count: {len(images)}")
    for j, img in enumerate(images):
        xref = img[0]
        w_px = img[2]
        h_px = img[3]
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        for r in rects:
            x0_mm = r.x0 / 2.8346
            y0_mm = r.y0 / 2.8346
            x1_mm = r.x1 / 2.8346
            y1_mm = r.y1 / 2.8346
            w_mm = r.width / 2.8346
            h_mm = r.height / 2.8346
            print(f"    [{j}] xref={xref} size_px={w_px}x{h_px} rect_mm=({x0_mm:.1f},{y0_mm:.1f})-({x1_mm:.1f},{y1_mm:.1f}) w_mm={w_mm:.1f} h_mm={h_mm:.1f}")

doc.close()
