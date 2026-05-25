"""
空间与语义双轨对齐算法模块
根据语义线索和空间距离，为文本块匹配最合适的图片块
"""

import math
from typing import List, Dict, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


# 方向权重系数 (距离越小权重越高，排名越靠前)
DIRECTION_WEIGHTS = {
    "below": 1.0,      # 正下方 (最常见排版：题干在上，图片在下)
    "right": 1.2,      # 正右方 (左右并排)
    "above": 2.5,      # 正上方 (较少见)
    "left": 2.0,       # 正左方 (较少见)
    "other": 3.0       # 其他方向 (对角线等，给予惩罚)
}

# 距离阈值 (超过此阈值则触发大模型兜底验证)
DISTANCE_THRESHOLD = 500  # 像素单位，可根据试卷分辨率调整


class MatchResult:
    """匹配结果"""
    
    def __init__(self, text_block: Dict, image_block: Optional[Dict],
                 match_rule: str, confidence: float, 
                 weighted_distance: float = 0.0,
                 direction: str = "none"):
        self.text_block = text_block
        self.image_block = image_block
        self.match_rule = match_rule  # "semantic", "spatial", "multimodal"
        self.confidence = confidence
        self.weighted_distance = weighted_distance
        self.direction = direction
        
    def to_dict(self) -> Dict:
        return {
            "text_block_id": self.text_block.get("block_id"),
            "image_block_id": self.image_block.get("block_id") if self.image_block else None,
            "match_rule": self.match_rule,
            "confidence": self.confidence,
            "weighted_distance": self.weighted_distance,
            "direction": self.direction,
            "image_bbox": self.image_block.get("bbox") if self.image_block else None
        }


def _calculate_euclidean_distance(bbox1: List[int], bbox2: List[int]) -> float:
    """
    计算两个 bounding box 中心点的欧几里得距离
    """
    center1 = ((bbox1[0] + bbox1[2]) / 2, (bbox1[1] + bbox1[3]) / 2)
    center2 = ((bbox2[0] + bbox2[2]) / 2, (bbox2[1] + bbox2[3]) / 2)
    
    distance = math.sqrt((center1[0] - center2[0]) ** 2 + (center1[1] - center2[1]) ** 2)
    return distance


def _calculate_directional_distance(text_bbox: List[int], image_bbox: List[int]) -> Tuple[float, str]:
    """
    计算文本块与图片块的方向加权距离
    
    Args:
        text_bbox: 文本块坐标 [x_min, y_min, x_max, y_max]
        image_bbox: 图片块坐标 [x_min, y_min, x_max, y_max]
        
    Returns:
        (加权距离, 方向类型)
        方向类型: "below" (下方), "right" (右方), "above" (上方), "left" (左方), "other"
    """
    # 获取两个块的中心点
    text_center_x = (text_bbox[0] + text_bbox[2]) / 2
    text_center_y = (text_bbox[1] + text_bbox[3]) / 2
    image_center_x = (image_bbox[0] + image_bbox[2]) / 2
    image_center_y = (image_bbox[1] + image_bbox[3]) / 2
    
    # 计算中心点差值
    dx = image_center_x - text_center_x
    dy = image_center_y - text_center_y
    
    # 计算欧几里得距离
    base_distance = math.sqrt(dx ** 2 + dy ** 2)
    
    if base_distance == 0:
        return 0.0, "below"  # 重合情况视为正下方
    
    # 判断相对方向 (基于角度)
    angle = math.atan2(dy, dx)  # 返回值范围: [-π, π]
    angle_deg = math.degrees(angle)
    
    # 定义方向范围 (以文本块为原点)
    # 下方: 45° ~ 135° (y 增大)
    # 右方: -45° ~ 45° (x 增大)
    # 上方: -135° ~ -45° (y 减小)
    # 左方: 135° ~ 180° 或 -180° ~ -135° (x 减小)
    
    if 45 <= angle_deg <= 135:
        direction = "below"
    elif -45 <= angle_deg < 45:
        direction = "right"
    elif -135 <= angle_deg < -45:
        direction = "above"
    else:
        direction = "left"
    
    # 应用方向权重
    weight = DIRECTION_WEIGHTS.get(direction, DIRECTION_WEIGHTS["other"])
    weighted_distance = base_distance * weight
    
    return weighted_distance, direction


def _match_by_semantic_key(text_image_key: str, image_blocks: List[Dict]) -> Optional[Dict]:
    """
    规则 A: 语义强绑定匹配
    根据题干中的图号 (如"图1") 精确匹配图片块的标签
    """
    if not text_image_key:
        return None
    
    for img_block in image_blocks:
        img_key = img_block.get("image_key")
        if img_key and img_key == text_image_key:
            return img_block
    
    return None


def _match_by_spatial_distance(text_block: Dict, image_blocks: List[Dict]) -> Tuple[Optional[Dict], float, str]:
    """
    规则 B: 空间几何距离优先匹配
    计算文本块与所有图片块的加权距离，返回最近的一个
    """
    if not image_blocks:
        return None, float('inf'), "none"
    
    text_bbox = text_block.get("bbox", [0, 0, 0, 0])
    
    best_match = None
    min_weighted_distance = float('inf')
    best_direction = "none"
    
    for img_block in image_blocks:
        img_bbox = img_block.get("bbox", [0, 0, 0, 0])
        
        weighted_dist, direction = _calculate_directional_distance(text_bbox, img_bbox)
        
        if weighted_dist < min_weighted_distance:
            min_weighted_distance = weighted_dist
            best_match = img_block
            best_direction = direction
    
    return best_match, min_weighted_distance, best_direction


def _match_by_multimodal_llm(text_content: str, image_path: str, candidate_images: List[Dict]) -> Optional[Dict]:
    """
    规则 C: 大模型多模态兜底验证
    调用多模态大模型 API 进行二分类确认
    
    注意: 此为占位函数，需根据实际使用的大模型 API 进行调整
    
    Args:
        text_content: 题干文本
        image_path: 原始试卷图像路径
        candidate_images: 候选图片块列表
        
    Returns:
        匹配的图片块或 None
    """
    try:
        # TODO: 接入实际的多模态大模型 API
        # 示例流程:
        # 1. 裁剪候选图片区域
        # 2. 构建 Prompt: "请判断以下题干文本是否与图片内容相关。题干: {text_content}"
        # 3. 调用 API 获取判断结果
        # 4. 返回置信度最高的图片块
        
        logger.warning("多模态大模型 API 未配置，跳过兜底验证")
        return None
        
    except Exception as e:
        logger.error(f"多模态匹配失败: {e}", exc_info=True)
        return None


def match_text_and_image(text_blocks: List[Dict], image_blocks: List[Dict],
                        image_clues: List[Dict] = None,
                        raw_image_path: str = None,
                        distance_threshold: float = DISTANCE_THRESHOLD) -> List[Dict]:
    """
    核心匹配函数: 空间与语义双轨对齐
    
    遍历所有需要配图的文本块，按优先级为它寻找最匹配的图片块:
    - 规则 A: 语义强绑定 (图号精确匹配)
    - 规则 B: 空间几何距离优先 (方向加权)
    - 规则 C: 大模型多模态兜底
    
    Args:
        text_blocks: 文本块列表 (来自 analyze_paper_layout)
        image_blocks: 图片块列表 (来自 analyze_paper_layout)
        image_clues: 语义解析结果列表 (来自 extract_image_clues)，与 text_blocks 一一对应
        raw_image_path: 原始图像路径 (用于大模型兜底)
        distance_threshold: 距离阈值，超过此值触发大模型验证
        
    Returns:
        匹配结果列表，每个元素包含:
        - text_block_id: 文本块 ID
        - image_block_id: 匹配的图片块 ID (可能为 None)
        - match_rule: 使用的匹配规则
        - confidence: 匹配置信度
        - direction: 相对方向
    """
    if not text_blocks or not image_blocks:
        logger.info(f"匹配跳过: text_blocks={len(text_blocks)}, image_blocks={len(image_blocks)}")
        return []
    
    results = []
    matched_image_ids = set()  # 记录已匹配的图片块 (用于一图多题场景)
    
    for idx, text_block in enumerate(text_blocks):
        # 获取语义线索
        if image_clues and idx < len(image_clues):
            clue = image_clues[idx]
        else:
            from .semantic_parser import extract_image_clues
            clue = extract_image_clues(text_block.get("text_content", ""))
        
        # 如果题目不需要配图，跳过
        if not clue.get("has_image", False):
            results.append(MatchResult(
                text_block=text_block,
                image_block=None,
                match_rule="none",
                confidence=1.0
            ).to_dict())
            continue
        
        text_image_key = clue.get("image_key")
        clue_type = clue.get("clue_type", "none")
        
        # ===== 规则 A: 语义强绑定 =====
        if clue_type == "explicit" and text_image_key:
            semantic_match = _match_by_semantic_key(text_image_key, image_blocks)
            if semantic_match:
                results.append(MatchResult(
                    text_block=text_block,
                    image_block=semantic_match,
                    match_rule="semantic",
                    confidence=0.95,
                    direction="semantic_match"
                ).to_dict())
                matched_image_ids.add(semantic_match.get("block_id"))
                logger.info(f"[规则A] 文本块 {text_block['block_id']} 语义匹配图片块 {semantic_match['block_id']} (key={text_image_key})")
                continue
        
        # ===== 规则 B: 空间几何距离优先 =====
        spatial_match, weighted_dist, direction = _match_by_spatial_distance(text_block, image_blocks)
        
        if spatial_match and weighted_dist <= distance_threshold:
            # 计算置信度 (距离越近，置信度越高)
            confidence = max(0.6, 1.0 - (weighted_dist / (distance_threshold * 2)))
            
            results.append(MatchResult(
                text_block=text_block,
                image_block=spatial_match,
                match_rule="spatial",
                confidence=confidence,
                weighted_distance=weighted_dist,
                direction=direction
            ).to_dict())
            matched_image_ids.add(spatial_match.get("block_id"))
            logger.info(f"[规则B] 文本块 {text_block['block_id']} 空间匹配图片块 {spatial_match['block_id']} (距离={weighted_dist:.1f}, 方向={direction})")
            continue
        
        # ===== 规则 C: 大模型多模态兜底 =====
        if spatial_match and weighted_dist > distance_threshold:
            # 距离超过阈值，调用大模型验证
            text_content = text_block.get("text_content", "")
            multimodal_match = _match_by_multimodal_llm(text_content, raw_image_path, [spatial_match])
            
            if multimodal_match:
                results.append(MatchResult(
                    text_block=text_block,
                    image_block=multimodal_match,
                    match_rule="multimodal",
                    confidence=0.75,
                    direction="multimodal_confirm"
                ).to_dict())
                matched_image_ids.add(multimodal_match.get("block_id"))
                logger.info(f"[规则C] 文本块 {text_block['block_id']} 大模型确认匹配图片块 {multimodal_match['block_id']}")
                continue
        
        # 未匹配到任何图片
        results.append(MatchResult(
            text_block=text_block,
            image_block=None,
            match_rule="unmatched",
            confidence=0.0,
            direction="none"
        ).to_dict())
        logger.warning(f"文本块 {text_block['block_id']} 未匹配到图片")
    
    logger.info(f"匹配完成: 共 {len(results)} 个文本块, 成功匹配 {sum(1 for r in results if r['image_block_id'])} 个")
    return results


def get_alignment_layout(text_block: Dict, image_block: Dict) -> str:
    """
    获取文本与图片的相对排版关系描述
    
    Args:
        text_block: 文本块信息
        image_block: 图片块信息
        
    Returns:
        排版关系字符串，如 "text_top_image_bottom"
    """
    if not text_block or not image_block:
        return "unknown"
    
    text_bbox = text_block.get("bbox", [0, 0, 0, 0])
    image_bbox = image_block.get("bbox", [0, 0, 0, 0])
    
    _, direction = _calculate_directional_distance(text_bbox, image_bbox)
    
    direction_to_layout = {
        "below": "text_top_image_bottom",
        "above": "text_bottom_image_top",
        "right": "text_left_image_right",
        "left": "text_right_image_left",
        "other": "text_image_diagonal"
    }
    
    return direction_to_layout.get(direction, "unknown")
