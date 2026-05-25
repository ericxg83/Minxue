"""
多模态智能切题引擎 - 测试用例
"""

import unittest
import os
import json
import sys

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from multimodal_exam_engine.semantic_parser import extract_image_clues, is_geometry_related
from multimodal_exam_engine.alignment_engine import (
    _calculate_directional_distance,
    _match_by_semantic_key,
    _match_by_spatial_distance,
    get_alignment_layout
)


class TestSemanticParser(unittest.TestCase):
    """语义解析模块测试"""
    
    def test_explicit_image_key(self):
        """测试明确图号匹配"""
        text = "12．如图1所示，在△ABC中，∠C=90°..."
        result = extract_image_clues(text)
        
        self.assertTrue(result["has_image"])
        self.assertEqual(result["image_key"], "图1")
        self.assertEqual(result["clue_type"], "explicit")
        self.assertGreater(result["confidence"], 0.9)
    
    def test_chinese_number(self):
        """测试中文数字图号"""
        text = "如图所示，三角形ABC..."
        result = extract_image_clues(text)
        
        self.assertTrue(result["has_image"])
        self.assertEqual(result["image_key"], "如图")
        self.assertEqual(result["clue_type"], "implicit")
    
    def test_implicit_reference(self):
        """测试泛指配图词"""
        text = "如下图所示，四边形ABCD是平行四边形..."
        result = extract_image_clues(text)
        
        self.assertTrue(result["has_image"])
        self.assertEqual(result["image_key"], "下图")
    
    def test_no_image_reference(self):
        """测试无配图引用"""
        text = "计算下列各式的值：(1) 2+3 (2) 5×6"
        result = extract_image_clues(text)
        
        self.assertFalse(result["has_image"])
        self.assertIsNone(result["image_key"])
    
    def test_empty_text(self):
        """测试空文本"""
        result = extract_image_clues("")
        
        self.assertFalse(result["has_image"])
    
    def test_geometry_detection(self):
        """测试几何内容检测"""
        text = "在△ABC中，∠C=90°，AD平分∠BAC"
        result = is_geometry_related(text)
        
        self.assertTrue(result["is_geometry"])
        self.assertIn("△", result["geometry_keywords"])
        self.assertIn("∠", result["geometry_keywords"])


class TestAlignmentEngine(unittest.TestCase):
    """对齐算法模块测试"""
    
    def test_directional_distance_below(self):
        """测试正下方距离计算"""
        text_bbox = [100, 100, 300, 150]  # 文本块
        image_bbox = [120, 200, 280, 350]  # 图片块 (在文本下方)
        
        weighted_dist, direction = _calculate_directional_distance(text_bbox, image_bbox)
        
        self.assertEqual(direction, "below")
        self.assertGreater(weighted_dist, 0)
    
    def test_directional_distance_right(self):
        """测试正右方距离计算"""
        text_bbox = [100, 100, 250, 150]
        image_bbox = [300, 110, 450, 160]  # 图片块 (在文本右方)
        
        weighted_dist, direction = _calculate_directional_distance(text_bbox, image_bbox)
        
        self.assertEqual(direction, "right")
    
    def test_semantic_matching(self):
        """测试语义强绑定匹配"""
        image_blocks = [
            {"block_id": "img_001", "image_key": "图1"},
            {"block_id": "img_002", "image_key": "图2"}
        ]
        
        result = _match_by_semantic_key("图2", image_blocks)
        
        self.assertIsNotNone(result)
        self.assertEqual(result["block_id"], "img_002")
    
    def test_semantic_no_match(self):
        """测试语义匹配失败"""
        image_blocks = [
            {"block_id": "img_001", "image_key": "图1"}
        ]
        
        result = _match_by_semantic_key("图5", image_blocks)
        
        self.assertIsNone(result)
    
    def test_spatial_matching(self):
        """测试空间距离匹配"""
        text_block = {
            "block_id": "text_001",
            "bbox": [100, 100, 300, 150],
            "text_content": "如图，三角形ABC..."
        }
        
        image_blocks = [
            {"block_id": "img_001", "bbox": [120, 200, 280, 350]},  # 下方
            {"block_id": "img_002", "bbox": [500, 100, 650, 250]}   # 右方 (更远)
        ]
        
        match, dist, direction = _match_by_spatial_distance(text_block, image_blocks)
        
        self.assertIsNotNone(match)
        self.assertEqual(match["block_id"], "img_001")  # 应匹配下方的图片
    
    def test_alignment_layout(self):
        """测试排版关系获取"""
        text_block = {"bbox": [100, 100, 300, 150]}
        image_block = {"bbox": [120, 200, 280, 350]}
        
        layout = get_alignment_layout(text_block, image_block)
        
        self.assertEqual(layout, "text_top_image_bottom")


class TestIntegration(unittest.TestCase):
    """集成测试 (模拟完整流程)"""
    
    def test_full_pipeline_mock(self):
        """测试完整流程 (使用模拟数据)"""
        # 模拟版面分析结果
        text_blocks = [
            {
                "block_id": "text_001",
                "bbox": [100, 100, 400, 180],
                "text_content": "12．如图，在△ABC中，∠C=90°，AD平分∠BAC"
            },
            {
                "block_id": "text_002",
                "bbox": [100, 500, 400, 580],
                "text_content": "13．解方程: 2x + 5 = 15"  # 无配图
            }
        ]
        
        image_blocks = [
            {
                "block_id": "img_001",
                "bbox": [120, 220, 380, 420],
                "image_key": None
            }
        ]
        
        # 语义解析
        from multimodal_exam_engine.semantic_parser import extract_image_clues
        clues = [extract_image_clues(tb["text_content"]) for tb in text_blocks]
        
        # 图文匹配
        from multimodal_exam_engine.alignment_engine import match_text_and_image
        matches = match_text_and_image(text_blocks, image_blocks, clues)
        
        # 验证结果
        self.assertEqual(len(matches), 2)
        self.assertIsNotNone(matches[0]["image_block_id"])  # 第一题有配图
        self.assertIsNone(matches[1]["image_block_id"])     # 第二题无配图
        self.assertEqual(matches[0]["match_rule"], "spatial")


def run_tests():
    """运行所有测试"""
    unittest.main(verbosity=2)


if __name__ == '__main__':
    run_tests()
