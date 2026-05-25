"""
题干语义解析模块
分析题干文本，判断题目是否提及配图，输出结构化数据
"""

import re
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


# 配图指示关键词正则表达式模式
IMAGE_CLUE_PATTERNS = [
    # 匹配"图1", "图2", "图一", "图12"等
    r'图\s*([0-9一二三四五六七八九十百]+)',
    # 匹配"如图", "附图", "下图", "上图", "左图", "右图"等
    r'(?:如|附|下|上|左|右|该|本)\s*图',
    # 匹配"如图所示", "如下图所示", "见下图"等
    r'(?:如|见|参考)\s*(?:下|上|左|右|该|本)?\s*图\s*(?:所示)?',
    # 匹配"图形", "示意图", "几何图形"等 (需谨慎，避免误判)
    r'(?:几何)?图\s*(?:形|示)',
]


def _normalize_chinese_number(num_str: str) -> str:
    """
    将中文数字转换为阿拉伯数字，便于统一匹配
    例如: "一二三" -> "123", "十一" -> "11"
    """
    chinese_to_arabic = {
        '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
        '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
        '百': '100', '零': '0'
    }
    
    # 如果是阿拉伯数字，直接返回
    if num_str.isdigit():
        return num_str
    
    # 简单替换中文数字 (仅处理简单情况)
    result = ""
    for char in num_str:
        if char in chinese_to_arabic:
            result += chinese_to_arabic[char]
        else:
            result += char
    
    return result


def extract_image_clues(text_content: str) -> Dict:
    """
    题干语义解析
    
    分析题干文本，判断题目是否提及配图。
    支持正则表达式匹配和轻量大模型两种模式。
    
    Args:
        text_content: 题干文本内容
        
    Returns:
        {
            "has_image": bool,           # 是否提及配图
            "image_key": str | None,     # 配图标识 (如 "图1", "如图")
            "clue_type": str,            # 线索类型: "explicit" (明确图号) | "implicit" (泛指如"如图")
            "confidence": float          # 判断置信度 (0.0 - 1.0)
        }
    """
    if not text_content or not text_content.strip():
        return {
            "has_image": False,
            "image_key": None,
            "clue_type": "none",
            "confidence": 1.0
        }
    
    try:
        text = text_content.strip()
        
        # 1. 尝试匹配明确的图号 (如"图1", "图2")
        explicit_pattern = r'图\s*([0-9一二三四五六七八九十百]+)'
        explicit_match = re.search(explicit_pattern, text)
        
        if explicit_match:
            raw_key = explicit_match.group(0)
            number_part = explicit_match.group(1)
            
            # 标准化图号
            normalized_num = _normalize_chinese_number(number_part)
            image_key = f"图{normalized_num}"
            
            return {
                "has_image": True,
                "image_key": image_key,
                "clue_type": "explicit",
                "confidence": 0.95
            }
        
        # 2. 尝试匹配泛指配图词 (如"如图", "下图所示")
        implicit_pattern = r'(?:如|附|下|上|左|右|该|本)\s*图(?:所示)?'
        implicit_match = re.search(implicit_pattern, text)
        
        if implicit_match:
            clue_text = implicit_match.group(0)
            
            # 判断具体类型
            if '下' in clue_text:
                image_key = "下图"
            elif '上' in clue_text:
                image_key = "上图"
            elif '左' in clue_text:
                image_key = "左图"
            elif '右' in clue_text:
                image_key = "右图"
            else:
                image_key = "如图"  # 默认泛指
            
            return {
                "has_image": True,
                "image_key": image_key,
                "clue_type": "implicit",
                "confidence": 0.85
            }
        
        # 3. 未检测到配图线索
        return {
            "has_image": False,
            "image_key": None,
            "clue_type": "none",
            "confidence": 0.90
        }
        
    except Exception as e:
        logger.error(f"题干语义解析失败: {e}", exc_info=True)
        return {
            "has_image": False,
            "image_key": None,
            "clue_type": "error",
            "confidence": 0.0,
            "error": str(e)
        }


def extract_image_clues_batch(text_list: list) -> list:
    """
    批量解析题干语义
    
    Args:
        text_list: 题干文本列表
        
    Returns:
        解析结果列表，与输入列表一一对应
    """
    results = []
    for text in text_list:
        results.append(extract_image_clues(text))
    return results


def is_geometry_related(text_content: str) -> Dict:
    """
    判断题目是否涉及几何内容 (辅助函数)
    
    Args:
        text_content: 题干文本
        
    Returns:
        {
            "is_geometry": bool,
            "geometry_keywords": list,  # 命中的几何关键词
            "confidence": float
        }
    """
    geometry_keywords = [
        '三角形', '△', '四边形', '平行四边形', '矩形', '正方形', '菱形',
        '圆', '⊙', '圆心', '半径', '直径',
        '∠', '角', '垂直', '平行', '相交',
        '线段', '射线', '直线',
        '对称', '旋转', '平移', '翻折',
        '勾股定理', '相似', '全等',
        '坐标', '函数图像', '抛物线'
    ]
    
    if not text_content:
        return {"is_geometry": False, "geometry_keywords": [], "confidence": 1.0}
    
    found_keywords = []
    text_lower = text_content.lower()
    
    for keyword in geometry_keywords:
        if keyword.lower() in text_lower:
            found_keywords.append(keyword)
    
    is_geo = len(found_keywords) > 0
    confidence = min(0.95, 0.5 + len(found_keywords) * 0.15)
    
    return {
        "is_geometry": is_geo,
        "geometry_keywords": found_keywords,
        "confidence": confidence
    }
