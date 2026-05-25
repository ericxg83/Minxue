"""
主流程管道模块
整合所有核心功能，提供一键式处理接口
"""

import json
import os
from typing import Dict, List, Optional
import logging

from .layout_analyzer import analyze_paper_layout
from .semantic_parser import extract_image_clues, extract_image_clues_batch
from .alignment_engine import match_text_and_image
from .image_processor import generate_complete_question, batch_enhance_images

logger = logging.getLogger(__name__)


def process_exam_paper(
    image_path: str,
    output_dir: str = None,
    distance_threshold: float = 500,
    enhance_params: dict = None,
    save_json: bool = True,
    json_output_path: str = None
) -> Dict:
    """
    一键处理试卷图像
    
    完整流程:
    1. 试卷版面拆解与特征提取
    2. 题干语义解析
    3. 空间与语义双轨对齐
    4. 图像裁剪与自适应扫描滤镜增强
    5. 数据组装与输出
    
    Args:
        image_path: 试卷图像路径
        output_dir: 增强图像输出目录 (默认为 image_path 同级的 enhanced_images 目录)
        distance_threshold: 距离阈值 (像素)
        enhance_params: 自定义图像增强参数
        save_json: 是否保存 JSON 结果文件
        json_output_path: JSON 输出路径 (默认与 image_path 同名)
        
    Returns:
        {
            "success": bool,
            "questions": [...],  # 所有题目数据列表
            "statistics": {
                "total_text_blocks": int,
                "total_image_blocks": int,
                "matched_questions": int,
                "unmatched_questions": int
            },
            "layout_result": {...},  # 版面分析原始结果
            "match_results": [...]   # 匹配原始结果
        }
    """
    try:
        logger.info(f"开始处理试卷: {image_path}")
        
        # ===== Step 1: 试卷版面拆解与特征提取 =====
        logger.info("Step 1: 版面分析...")
        layout_result = analyze_paper_layout(image_path)
        
        if "error" in layout_result:
            return {
                "success": False,
                "error": f"版面分析失败: {layout_result['error']}",
                "questions": [],
                "statistics": {}
            }
        
        text_blocks = layout_result.get("text_blocks", [])
        image_blocks = layout_result.get("image_blocks", [])
        
        logger.info(f"版面分析完成: {len(text_blocks)} 个文本块, {len(image_blocks)} 个图片块")
        
        # 如果没有文本块或图片块，直接返回
        if not text_blocks:
            logger.warning("未检测到文本块")
            return {
                "success": True,
                "questions": [],
                "statistics": {
                    "total_text_blocks": 0,
                    "total_image_blocks": len(image_blocks),
                    "matched_questions": 0,
                    "unmatched_questions": 0
                },
                "layout_result": layout_result
            }
        
        # ===== Step 2: 题干语义解析 =====
        logger.info("Step 2: 语义解析...")
        image_clues = []
        for text_block in text_blocks:
            text_content = text_block.get("text_content", "")
            clue = extract_image_clues(text_content)
            clue["text_block_id"] = text_block.get("block_id")
            image_clues.append(clue)
        
        needs_image_count = sum(1 for c in image_clues if c.get("has_image"))
        logger.info(f"语义解析完成: {needs_image_count}/{len(text_blocks)} 个题目需要配图")
        
        # ===== Step 3: 空间与语义双轨对齐 =====
        logger.info("Step 3: 图文匹配...")
        match_results = match_text_and_image(
            text_blocks=text_blocks,
            image_blocks=image_blocks,
            image_clues=image_clues,
            raw_image_path=image_path,
            distance_threshold=distance_threshold
        )
        
        # ===== Step 4: 图像裁剪与自适应扫描滤镜增强 =====
        logger.info("Step 4: 图像增强...")
        questions = []
        
        for match_result in match_results:
            # 如果匹配到图片，执行图像增强
            if match_result.get("image_block_id"):
                text_block_id = match_result.get("text_block_id", "unknown")
                
                question_data = generate_complete_question(
                    raw_image_path=image_path,
                    matched_result=match_result,
                    output_dir=output_dir,
                    question_id=text_block_id,
                    enhance_params=enhance_params
                )
                questions.append(question_data)
            else:
                # 未匹配到图片的题目，仅保存文本信息
                text_block = match_result.get("text_block", {})
                questions.append({
                    "question_id": match_result.get("text_block_id", "unknown"),
                    "raw_text": text_block.get("text_content", "") if text_block else "",
                    "latex_text": "",
                    "has_geometry_image": False,
                    "geometry_image_path": None,
                    "match_confidence": 0.0,
                    "alignment_layout": "none",
                    "match_rule": "unmatched"
                })
        
        # ===== Step 5: 数据组装与输出 =====
        logger.info("Step 5: 数据组装...")
        
        # 统计信息
        matched_count = sum(1 for q in questions if q.get("has_geometry_image"))
        unmatched_count = len(questions) - matched_count
        
        statistics = {
            "total_text_blocks": len(text_blocks),
            "total_image_blocks": len(image_blocks),
            "matched_questions": matched_count,
            "unmatched_questions": unmatched_count
        }
        
        result = {
            "success": True,
            "questions": questions,
            "statistics": statistics,
            "layout_result": {
                "text_blocks": text_blocks,
                "image_blocks": image_blocks,
                "image_size": layout_result.get("image_size")
            },
            "match_results": match_results
        }
        
        # 保存 JSON 文件
        if save_json:
            if json_output_path is None:
                base_name = os.path.splitext(os.path.basename(image_path))[0]
                json_output_path = os.path.join(
                    os.path.dirname(image_path) or ".",
                    f"{base_name}_result.json"
                )
            
            # 移除不可序列化的对象，仅保留字典
            serializable_result = {
                "success": result["success"],
                "questions": result["questions"],
                "statistics": result["statistics"]
            }
            
            with open(json_output_path, 'w', encoding='utf-8') as f:
                json.dump(serializable_result, f, ensure_ascii=False, indent=2)
            
            logger.info(f"结果已保存: {json_output_path}")
            result["json_output_path"] = json_output_path
        
        logger.info(f"试卷处理完成: {matched_count}/{len(questions)} 个题目成功匹配配图")
        return result
        
    except Exception as e:
        logger.error(f"试卷处理失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "questions": [],
            "statistics": {}
        }


def process_exam_papers_batch(
    image_paths: List[str],
    output_base_dir: str = None,
    **kwargs
) -> List[Dict]:
    """
    批量处理多张试卷图像
    
    Args:
        image_paths: 试卷图像路径列表
        output_base_dir: 输出根目录 (每个试卷会创建子目录)
        **kwargs: 传递给 process_exam_paper 的其他参数
        
    Returns:
        处理结果列表
    """
    results = []
    
    for idx, image_path in enumerate(image_paths):
        logger.info(f"[{idx+1}/{len(image_paths)}] 处理: {image_path}")
        
        # 为每张试卷创建独立的输出目录
        if output_base_dir:
            base_name = os.path.splitext(os.path.basename(image_path))[0]
            output_dir = os.path.join(output_base_dir, base_name)
            kwargs["output_dir"] = output_dir
        
        result = process_exam_paper(image_path, **kwargs)
        results.append(result)
    
    return results


def get_enhancement_params_preset(preset: str = "default") -> Dict:
    """
    获取预设的图像增强参数
    
    Args:
        preset: 预设名称 ("default", "aggressive", "gentle")
        
    Returns:
        参数字典
    """
    presets = {
        "default": {
            # 默认参数: 适用于大多数试卷图像
            # 精细化调参：增大二值化窗口、降低减法常数，保护细笔画文字
            "adaptive_block_size": 41,
            "adaptive_c": 3,
            "median_blur_kernel": 3,
            "morph_kernel_size": 2,
            "morph_iterations": 1
        },
        "aggressive": {
            # 激进参数: 适用于质量较差的图像 (模糊、阴影严重)
            # 即使是激进模式，也避免过度侵蚀文字
            "adaptive_block_size": 35,
            "adaptive_c": 5,
            "median_blur_kernel": 3,
            "morph_kernel_size": 2,
            "morph_iterations": 1
        },
        "gentle": {
            # 温和参数: 适用于质量较好的图像 (清晰扫描件)
            # 最大化保留文字和线条细节
            "adaptive_block_size": 51,
            "adaptive_c": 2,
            "median_blur_kernel": 3,
            "morph_kernel_size": 1,
            "morph_iterations": 1
        }
    }
    
    return presets.get(preset, presets["default"])
