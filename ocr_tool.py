import sys
import os
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR()

def recognize_image(img_path):
    if not os.path.exists(img_path):
        return " Error: Image path not found\n