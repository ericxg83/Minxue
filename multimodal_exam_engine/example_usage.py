"""
多模态智能切题引擎 - 真实图片图像增强测试
直接对真实几何题图片应用 OpenCV 自适应二值化去噪滤镜
（跳过版面分析和空间对齐，专注测试图像增强效果）
"""

import os
import sys
import json
import logging
import cv2
import numpy as np
from datetime import datetime

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def enhance_single_image(image_path: str, output_path: str = None) -> dict:
    """
    对单张几何题图片应用增强滤镜
    
    Args:
        image_path: 原始图片路径
        output_path: 输出路径 (默认自动生成)
        
    Returns:
        处理结果信息
    """
    # 1. 读取图片
    raw_image = cv2.imread(image_path)
    if raw_image is None:
        raise ValueError(f"无法读取图片: {image_path}")
    
    h, w = raw_image.shape[:2]
    logger.info(f"图片加载成功: {w}x{h}")
    
    # 2. 整张图作为 bbox (跳过裁剪)
    image_bbox = [0, 0, w, h]
    logger.info(f"使用整张图范围: bbox={image_bbox}")
    
    # 3. 导入图像增强器
    from multimodal_exam_engine.image_processor import ImageEnhancer
    
    enhancer = ImageEnhancer()
    
    # 4. 直接对原图应用增强流水线 (无需裁剪)
    enhanced_image = enhancer.enhance_pipeline(raw_image)
    
    # 5. 保存结果
    if output_path is None:
        base_name = os.path.splitext(os.path.basename(image_path))[0]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = f"{base_name}_enhanced_{timestamp}.png"
    
    save_success = cv2.imwrite(output_path, enhanced_image)
    if not save_success:
        raise RuntimeError(f"图片保存失败: {output_path}")
    
    logger.info(f"增强图片已保存: {output_path}")
    
    return {
        "original_path": image_path,
        "original_size": (w, h),
        "enhanced_path": output_path,
        "enhanced_size": (enhanced_image.shape[1], enhanced_image.shape[0]),
        "original_file_size_kb": os.path.getsize(image_path) / 1024,
        "enhanced_file_size_kb": os.path.getsize(output_path) / 1024
    }


def run_test():
    """运行真实图片增强测试"""
    print("=" * 70)
    print("真实几何题图片 - OpenCV 增强滤镜测试")
    print("=" * 70)
    
    # 查找真实图片
    project_root = os.path.dirname(os.path.abspath(__file__))
    image_path = os.path.join(project_root, "real_geometry.png")
    
    if not os.path.exists(image_path):
        print(f"\n[ERROR] 未找到真实图片: {image_path}")
        print("请将您的真实几何题图片放置为 real_geometry.png 后重新运行")
        return
    
    print(f"\n[OK] 找到真实图片: {image_path}")
    print(f"     文件大小: {os.path.getsize(image_path) / 1024:.1f} KB")
    
    # 运行增强
    print("\n" + "-" * 70)
    print("正在应用增强滤镜...")
    print("-" * 70)
    
    try:
        result = enhance_single_image(image_path)
    except Exception as e:
        print(f"\n[ERROR] 处理失败: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # 打印结果
    print("\n" + "=" * 70)
    print("处理结果")
    print("=" * 70)
    print(f"\n[原始图片]")
    print(f"  路径: {result['original_path']}")
    print(f"  尺寸: {result['original_size'][0]}x{result['original_size'][1]}")
    print(f"  大小: {result['original_file_size_kb']:.1f} KB")
    
    print(f"\n[增强图片]")
    print(f"  路径: {result['enhanced_path']}")
    print(f"  尺寸: {result['enhanced_size'][0]}x{result['enhanced_size'][1]}")
    print(f"  大小: {result['enhanced_file_size_kb']:.1f} KB")
    
    print("\n" + "=" * 70)
    print("测试完成! 请查看增强后的图片效果")
    print("=" * 70)


if __name__ == "__main__":
    run_test()
