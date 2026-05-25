"""
图像自动化裁剪与自适应扫描滤镜增强模块
使用 OpenCV 对裁剪出的配图进行预处理，达到"扫描仪"般的白底黑字效果
"""

import cv2
import numpy as np
from typing import List, Dict, Optional, Tuple
import os
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class ImageEnhancer:
    """图像增强处理器"""
    
    # 默认参数配置
    DEFAULT_PARAMS = {
        # 二值化参数
        "adaptive_block_size": 41,        # 自适应阈值邻域大小 (必须为奇数) — 增大窗口以保留细笔画
        "adaptive_c": 3,                  # 自适应阈值常数 — 降低以保留更多微弱线条和文字细节
        "otsu_threshold": 0,              # Otsu 法会自动计算，此参数保留用于手动调整
        
        # 去噪参数
        "median_blur_kernel": 3,          # 中值滤波核大小 (最小值，仅去除极小噪点，保护文字笔画)
        "gaussian_blur_kernel": (5, 5),   # 高斯模糊核大小 (平滑处理)
        
        # 形态学操作参数
        "morph_kernel_size": 2,           # 形态学核大小
        "morph_iterations": 1,            # 形态学迭代次数
        
        # 对比度增强
        "contrast_alpha": 1.5,            # 对比度增益 (1.0-3.0)
        "contrast_beta": 0,               # 亮度偏移
        
        # 输出图像
        "output_format": ".png",          # 输出格式
        "quality": 95                     # JPEG 质量 (如使用 JPEG)
    }
    
    def __init__(self, custom_params: Dict = None):
        """
        初始化图像增强器
        
        Args:
            custom_params: 自定义参数字典，会覆盖默认参数
        """
        self.params = self.DEFAULT_PARAMS.copy()
        if custom_params:
            self.params.update(custom_params)
    
    def crop_image(self, raw_image: np.ndarray, bbox: list, padding: int = 25) -> np.ndarray:
        """
        物理裁剪: 根据 bounding box 从原始图像中裁剪出配图区域
        
        Args:
            raw_image: 原始图像 (numpy array)
            bbox: 裁剪区域 [x_min, y_min, x_max, y_max]
            padding: 四周外扩像素数 (默认 25，确保外围字母和完整边框都被包含)
            
        Returns:
            裁剪后的图像
        """
        try:
            x_min, y_min, x_max, y_max = bbox
            h, w = raw_image.shape[:2]
            
            # 【边界外扩保护 (Padding)】
            # 向四周各外扩 padding 个像素，确保图形外围的字母标签和完整边框线都被包裹
            x_min = max(0, x_min - padding)
            y_min = max(0, y_min - padding)
            x_max = min(w, x_max + padding)
            y_max = min(h, y_max + padding)
            
            # 执行裁剪
            cropped = raw_image[y_min:y_max, x_min:x_max]
            
            if cropped.size == 0:
                raise ValueError(f"裁剪区域为空: bbox={bbox}, image_size=({w}, {h})")
            
            logger.info(f"图像裁剪成功 (外扩 {padding}px): 原始({w}x{h}) -> 裁剪({cropped.shape[1]}x{cropped.shape[0]})")
            return cropped
            
        except Exception as e:
            logger.error(f"图像裁剪失败: {e}", exc_info=True)
            raise
    
    def grayscale_convert(self, image: np.ndarray) -> np.ndarray:
        """
        将图像转换为灰度图
        
        Args:
            image: 彩色图像 (BGR 格式)
            
        Returns:
            灰度图像
        """
        try:
            if len(image.shape) == 2:
                return image  # 已经是灰度图
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            return gray
        except Exception as e:
            logger.error(f"灰度转换失败: {e}")
            return image
    
    def adaptive_binarization(self, gray_image: np.ndarray) -> np.ndarray:
        """
        自适应高斯阈值二值化
        将发黄、发暗、带有拍照阴影的试卷背景变为纯白色 (255)
        
        Args:
            gray_image: 灰度图像
            
        Returns:
            二值化图像 (白底黑字)
        """
        try:
            block_size = self.params["adaptive_block_size"]
            c = self.params["adaptive_c"]
            
            # 确保 block_size 为奇数
            if block_size % 2 == 0:
                block_size += 1
            
            # 自适应高斯阈值二值化
            # cv2.ADAPTIVE_THRESH_GAUSSIAN_C: 阈值是邻域像素的加权和 (高斯分布)
            # cv2.THRESH_BINARY: 大于阈值的像素设为最大值 (255)，否则为 0
            binary = cv2.adaptiveThreshold(
                gray_image,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                block_size,
                c
            )
            
            logger.info(f"自适应二值化完成: block_size={block_size}, C={c}")
            return binary
            
        except Exception as e:
            logger.error(f"自适应二值化失败: {e}")
            # 降级方案: 使用 Otsu 大津法
            return self._otsu_binarization(gray_image)
    
    def _otsu_binarization(self, gray_image: np.ndarray) -> np.ndarray:
        """
        Otsu 大津法二值化 (降级方案)
        自动寻找最佳全局阈值
        
        Args:
            gray_image: 灰度图像
            
        Returns:
            二值化图像
        """
        try:
            # Otsu 法自动计算阈值
            _, binary = cv2.threshold(
                gray_image,
                0,
                255,
                cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )
            
            logger.info("Otsu 二值化完成 (降级方案)")
            return binary
            
        except Exception as e:
            logger.error(f"Otsu 二值化失败: {e}")
            return gray_image
    
    def denoise(self, image: np.ndarray, method: str = "median") -> np.ndarray:
        """
        图像去噪: 去除手写痕迹等细小噪音
        
        Args:
            image: 输入图像 (二值化后)
            method: 去噪方法 ("median", "gaussian", "bilateral")
            
        Returns:
            去噪后的图像
        """
        try:
            if method == "median":
                # 中值滤波: 有效去除椒盐噪音，同时保留边缘
                kernel = self.params["median_blur_kernel"]
                if kernel % 2 == 0:
                    kernel += 1  # 确保为奇数
                denoised = cv2.medianBlur(image, kernel)
                
            elif method == "gaussian":
                # 高斯模糊: 平滑处理
                kernel = self.params["gaussian_blur_kernel"]
                denoised = cv2.GaussianBlur(image, kernel, 0)
                
            elif method == "bilateral":
                # 双边滤波: 保留边缘的同时平滑
                denoised = cv2.bilateralFilter(image, 9, 75, 75)
                
            else:
                denoised = image
            
            logger.info(f"去噪完成: method={method}")
            return denoised
            
        except Exception as e:
            logger.error(f"去噪失败: {e}")
            return image
    
    def morphological_operation(self, image: np.ndarray, operation: str = "close") -> np.ndarray:
        """
        形态学操作: 加黑加粗印刷体的几何线条
        
        Args:
            image: 输入图像 (二值化后)
            operation: 操作类型 ("close" 闭运算, "open" 开运算, "erode" 腐蚀, "dilate" 膨胀)
            
        Returns:
            形态学处理后的图像
        """
        try:
            kernel_size = self.params["morph_kernel_size"]
            iterations = self.params["morph_iterations"]
            
            kernel = np.ones((kernel_size, kernel_size), np.uint8)
            
            if operation == "close":
                # 闭运算: 先膨胀后腐蚀，填充前景物体内的小洞
                result = cv2.morphologyEx(image, cv2.MORPH_CLOSE, kernel, iterations=iterations)
            elif operation == "open":
                # 开运算: 先腐蚀后膨胀，去除小的噪音点
                result = cv2.morphologyEx(image, cv2.MORPH_OPEN, kernel, iterations=iterations)
            elif operation == "erode":
                # 腐蚀: 使前景物体变细
                result = cv2.erode(image, kernel, iterations=iterations)
            elif operation == "dilate":
                # 膨胀: 使前景物体变粗
                result = cv2.dilate(image, kernel, iterations=iterations)
            else:
                result = image
            
            logger.info(f"形态学操作完成: operation={operation}, kernel={kernel_size}x{kernel_size}")
            return result
            
        except Exception as e:
            logger.error(f"形态学操作失败: {e}")
            return image
    
    def enhance_contrast(self, image: np.ndarray) -> np.ndarray:
        """
        对比度增强 (可选步骤)
        
        Args:
            image: 输入图像
            
        Returns:
            对比度增强后的图像
        """
        try:
            alpha = self.params["contrast_alpha"]
            beta = self.params["contrast_beta"]
            
            enhanced = cv2.convertScaleAbs(image, alpha=alpha, beta=beta)
            logger.info(f"对比度增强完成: alpha={alpha}, beta={beta}")
            return enhanced
            
        except Exception as e:
            logger.error(f"对比度增强失败: {e}")
            return image
    
    def enhance_pipeline(self, cropped_image: np.ndarray) -> np.ndarray:
        """
        完整的图像增强流水线 (自适应扫描滤镜)
        
        处理流程:
        0. 【二值化边界安全区】加 5px 白色保护边框 (防止边缘线条在二值化时丢失)
        1. 灰度转换
        2. 自适应二值化 (核心: 白底黑字)
        3. 中值滤波去噪
        4. 形态学闭运算 (加粗线条)
        5. 裁剪掉白色保护边框
        6. 可选: 对比度增强
        
        Args:
            cropped_image: 裁剪后的图像
            
        Returns:
            增强后的高质量图像
        """
        try:
            # Step 0: 【二值化滤波边界安全区】
            # 在进行自适应二值化之前，给裁剪出来的小图四周强制加上 5 像素宽的纯白色保护边框
            # 这样可以防止图像边缘的线条在二值化计算时因没有邻居像素而丢失
            border_size = 5
            safe_image = cv2.copyMakeBorder(
                cropped_image,
                top=border_size,
                bottom=border_size,
                left=border_size,
                right=border_size,
                borderType=cv2.BORDER_CONSTANT,
                value=255  # 纯白色保护边框
            )
            logger.info(f"边界安全区: 已添加 {border_size}px 白色保护边框")
            
            # Step 1: 灰度转换
            gray = self.grayscale_convert(safe_image)
            
            # Step 2: 自适应二值化 (核心步骤)
            binary = self.adaptive_binarization(gray)
            
            # Step 3: 中值滤波去噪 (去除细小噪音)
            denoised = self.denoise(binary, method="median")
            
            # Step 4: 形态学闭运算 (加黑加粗几何线条)
            morphed = self.morphological_operation(denoised, operation="close")
            
            # Step 5: 裁剪掉白色保护边框，恢复原始尺寸
            h, w = morphed.shape[:2]
            final_image = morphed[border_size:h-border_size, border_size:w-border_size]
            logger.info(f"已移除 {border_size}px 白色保护边框")
            
            logger.info("图像增强流水线完成")
            return final_image
            
        except Exception as e:
            logger.error(f"图像增强流水线失败: {e}", exc_info=True)
            # 降级方案: 返回原始裁剪图像
            return cropped_image


def _generate_output_filename(question_id: str, output_dir: str) -> str:
    """
    生成输出文件名
    
    Args:
        question_id: 题目 ID
        output_dir: 输出目录
        
    Returns:
        完整的输出文件路径
    """
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{question_id}_geo_{timestamp}.png"
    return os.path.join(output_dir, filename)


def generate_complete_question(raw_image_path: str, matched_result: Dict,
                                output_dir: str = None,
                                question_id: str = None,
                                enhance_params: Dict = None) -> Dict:
    """
    收尾函数: 图像裁剪与自适应扫描滤镜增强
    
    1. 物理裁剪: 利用 OpenCV 根据匹配成功的图片块坐标裁剪配图区域
    2. 图像去噪与美化: 使用 OpenCV 进行预处理，达到"扫描仪"般的白底黑字效果
    3. 数据组装: 保存处理后的高质量图片，组装成标准 JSON 对象返回
    
    Args:
        raw_image_path: 原始试卷图像路径
        matched_result: 匹配结果 (来自 match_text_and_image)
        output_dir: 输出目录 (默认为 raw_image_path 同级的 enhanced_images 目录)
        question_id: 题目 ID (用于命名)
        enhance_params: 自定义图像增强参数
        
    Returns:
        {
            "question_id": str,
            "raw_text": str,
            "latex_text": str,
            "has_geometry_image": bool,
            "geometry_image_path": str,
            "match_confidence": float,
            "alignment_layout": str
        }
    """
    try:
        # 1. 读取原始图像
        raw_image = cv2.imread(raw_image_path)
        if raw_image is None:
            raise ValueError(f"无法读取原始图像: {raw_image_path}")
        
        # 2. 获取匹配的图片块坐标
        image_bbox = matched_result.get("image_bbox")
        if not image_bbox:
            raise ValueError("匹配结果中未包含 image_bbox")
        
        # 3. 确定输出目录
        if output_dir is None:
            base_dir = os.path.dirname(raw_image_path)
            output_dir = os.path.join(base_dir, "enhanced_images")
        
        # 4. 生成题目 ID
        if question_id is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            question_id = f"q_{timestamp}"
        
        # 5. 初始化图像增强器
        enhancer = ImageEnhancer(custom_params=enhance_params)
        
        # 6. 物理裁剪
        cropped_image = enhancer.crop_image(raw_image, image_bbox)
        
        # 7. 图像增强流水线 (自适应扫描滤镜)
        enhanced_image = enhancer.enhance_pipeline(cropped_image)
        
        # 8. 保存增强后的图像
        output_path = _generate_output_filename(question_id, output_dir)
        save_success = cv2.imwrite(output_path, enhanced_image)
        
        if not save_success:
            raise RuntimeError(f"图像保存失败: {output_path}")
        
        logger.info(f"增强图像已保存: {output_path}")
        
        # 9. 获取文本内容和排版关系
        text_block = matched_result.get("text_block", {})
        image_block = matched_result.get("image_block", {})
        
        raw_text = text_block.get("text_content", "") if isinstance(text_block, dict) else ""
        
        # 获取排版关系
        from .alignment_engine import get_alignment_layout
        alignment_layout = get_alignment_layout(text_block, image_block)
        
        # 10. 组装返回数据
        result = {
            "question_id": question_id,
            "raw_text": raw_text,
            "latex_text": _convert_to_latex(raw_text),  # 简单转换，可替换为专业 LaTeX 转换工具
            "has_geometry_image": True,
            "geometry_image_path": output_path,
            "match_confidence": matched_result.get("confidence", 0.0),
            "alignment_layout": alignment_layout,
            "match_rule": matched_result.get("match_rule", "unknown"),
            "image_bbox": image_bbox
        }
        
        logger.info(f"题目数据组装完成: question_id={question_id}")
        return result
        
    except Exception as e:
        logger.error(f"生成完整题目失败: {e}", exc_info=True)
        return {
            "question_id": question_id or "unknown",
            "raw_text": "",
            "latex_text": "",
            "has_geometry_image": False,
            "geometry_image_path": None,
            "match_confidence": 0.0,
            "alignment_layout": "unknown",
            "error": str(e)
        }


def _convert_to_latex(text: str) -> str:
    """
    简单文本到 LaTeX 的转换 (占位函数)
    实际项目中建议使用专业的 LaTeX 转换工具或 API
    
    Args:
        text: 原始文本
        
    Returns:
        LaTeX 格式文本
    """
    if not text:
        return ""
    
    # 简单替换规则 (示例)
    latex = text
    
    # 替换常见数学符号
    replacements = {
        '△': r'$\triangle$',
        '∠': r'$\angle$',
        '⊙': r'$\odot$',
        '°': r'^\circ',
        '²': r'^2',
        '³': r'^3',
        '√': r'$\sqrt{}$',
        '≈': r'$\approx$',
        '≠': r'$\neq$',
        '≤': r'$\leq$',
        '≥': r'$\geq$',
        '∥': r'$\parallel$',
        '⊥': r'$\perp$',
    }
    
    for original, latex_symbol in replacements.items():
        latex = latex.replace(original, latex_symbol)
    
    return latex


def batch_enhance_images(raw_image_path: str, matched_results: List[Dict],
                         output_dir: str = None) -> List[Dict]:
    """
    批量处理多个匹配结果
    
    Args:
        raw_image_path: 原始图像路径
        matched_results: 匹配结果列表
        output_dir: 输出目录
        
    Returns:
        处理结果列表
    """
    results = []
    for idx, match_result in enumerate(matched_results):
        question_id = match_result.get("text_block_id", f"q_{idx:03d}")
        
        # 跳过未匹配到图片的结果
        if not match_result.get("image_block_id"):
            continue
        
        result = generate_complete_question(
            raw_image_path=raw_image_path,
            matched_result=match_result,
            output_dir=output_dir,
            question_id=question_id
        )
        results.append(result)
    
    return results
