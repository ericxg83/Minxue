import fitz

pdf_path = r"C:\Users\Administrator\Downloads\蔡怡希_错题重练-0810-01_20260810_1954.pdf"
doc = fitz.open(pdf_path)

for i, page in enumerate(doc):
    print(f"\n=== Page {i+1} (size pt: {page.rect.width:.1f} x {page.rect.height:.1f}) ===")
    # 列出所有图像
    images = page.get_images(full=True)
    print(f"  images count: {len(images)}")
    for j, img in enumerate(images):
        xref = img[0]
        smask = img[1]
        w_px = img[2]
        h_px = img[3]
        bpc = img[4]
        colorspace = img[5]
        alt_cs = img[6]
        ref_name = img[7]
        filter_name = img[8]
        inv = img[9]
        print(f"    [{j}] xref={xref} smask={smask} size_px={w_px}x{h_px} bpc={bpc} cs={colorspace} ref={ref_name} filter={filter_name}")

        # 获取所有引用此 xref 的位置
        rects = page.get_image_rects(xref)
        for r in rects:
            x0_mm = r.x0 / 2.8346
            y0_mm = r.y0 / 2.8346
            x1_mm = r.x1 / 2.8346
            y1_mm = r.y1 / 2.8346
            w_mm = r.width / 2.8346
            h_mm = r.height / 2.8346
            print(f"        rect_pt=({r.x0:.1f},{r.y0:.1f})-({r.x1:.1f},{r.y1:.1f}) rect_mm=({x0_mm:.1f},{y0_mm:.1f})-({x1_mm:.1f},{y1_mm:.1f}) w_mm={w_mm:.1f} h_mm={h_mm:.1f}")

    # 提取 xref=24 的图像保存看
    for xref_id in [24, 25, 26, 27]:
        try:
            pix = fitz.Pixmap(doc, xref_id)
            out = f"C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\trae\\pdf_pages\\xref_{xref_id}_page{i+1}.png"
            if pix.n - pix.alpha < 4:
                pix.save(out)
            else:
                pix2 = fitz.Pixmap(fitz.csRGB, pix)
                pix2.save(out)
                pix2 = None
            pix = None
            print(f"  saved xref={xref_id} to {out}")
        except Exception as e:
            pass

doc.close()
