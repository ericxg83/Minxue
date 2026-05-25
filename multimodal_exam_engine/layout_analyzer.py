"""
试卷版面分析与特征提取模块
使用 PaddleOCR 的 Layout 组件进行文本块和图片块的分离与识别
"""

import cv2
import numpy as np
from typing import List, Dict, Optional, Tuple
import re
import logging

logger = logging.getLogger(__name__)


class BlockType:
    """版面元素类型常量"""
    TEXT = "text"
    IMAGE = "image"
    TABLE = "table"
    TITLE = "title"


class LayoutBlock:
    """版面分析结果中的单个元素块"""
    
    def __init__(self, block_id: str, block_type: str, bbox: List[int], 
                 text_content: str = "", confidence: float = 0.0):
        """
        初始化版面元素块
        
        Args:
            block_id: 唯一标识符
            block_type: 元素类型 (text/image/table/title)
            bbox: 坐标区域 [x_min, y_min, x_max, y_max] (像素坐标)
            text_content: 文本内容 (OCR提取结果)
            confidence: 识别置信度
        """
        self.block_id = block_id
        self.block_type = block_type
        self.bbox = bbox
        self.text_content = text_content
        self.confidence = confidence
        self.image_key = None  # 图片块可能包含的标签，如"图1"
        
    def to_dict(self) -> Dict:
        """转换为字典格式"""
        return {
            "block_id": self.block_id,
            "block_type": self.block_type,
            "bbox": self.bbox,
            "text_content": self.text_content,
            "confidence": self.confidence,
            "image_key": self.image_key
        }
    
    @property
    def center(self) -> Tuple[int, int]:
        """获取块的中心坐标"""
        x_center = (self.bbox[0] + self.bbox[2]) // 2
        y_center = (self.bbox[1] + self.bbox[3]) // 2
        return (x_center, y_center)
    
    @property
    def width(self) -> int:
        return self.bbox[2] - self.bbox[0]
    
    @property
    def height(self) -> int:
        return self.bbox[3] - self.bbox[1]


def _init_ocr_engine():
    """
    初始化 PaddleOCR 引擎
    使用懒加载避免导入时初始化过慢
    """
    try:
        from paddleocr import PaddleOCR
        # 使用 layout 分析模型
        ocr = PaddleOCR(
            use_angle_cls=True,        # 启用文字方向分类
            lang='ch',                 # 中文识别
            use_gpu=False,             # 是否使用GPU (根据环境配置)
            show_log=False,            # 关闭日志输出
            layout_model_name='PP-Layout'  # 版面分析模型
        )
        return ocr
    except ModuleNotFoundError as e:
        logger.warning(f"PaddleOCR 未安装 ({e})，将使用 Mock 模式返回虚拟版面数据")
        raise  # 上层会捕获此异常并走 Mock 分支
    except ImportError as e:
        logger.error(f"PaddleOCR 未安装，请运行: pip install PaddleOCR. 错误: {e}")
        raise
    except Exception as e:
        logger.error(f"OCR 引擎初始化失败: {e}")
        raise


def _extract_text_from_region(image: np.ndarray, bbox: List[int], ocr_engine) -> str:
    """
    从指定区域提取文本 (OCR)
    
    Args:
        image: 完整图像 (numpy array)
        bbox: 区域坐标 [x_min, y_min, x_max, y_max]
        ocr_engine: PaddleOCR 引擎实例
        
    Returns:
        识别出的文本字符串
    """
    try:
        x_min, y_min, x_max, y_max = bbox
        # 确保坐标不超出图像边界
        h, w = image.shape[:2]
        x_min, x_max = max(0, x_min), min(w, x_max)
        y_min, y_max = max(0, y_min), min(h, y_max)
        
        # 裁剪区域
        region = image[y_min:y_max, x_min:x_max]
        
        if region.size == 0:
            return ""
        
        # 使用 OCR 识别
        result = ocr_engine.ocr(region, cls=True)
        
        texts = []
        if result and result[0]:
            for line in result[0]:
                if line and len(line) >= 2:
                    text = line[1][0]  # 识别文本
                    confidence = line[1][1]  # 置信度
                    if confidence > 0.5:  # 只保留置信度较高的结果
                        texts.append(text)
        
        return " ".join(texts)
    except Exception as e:
        logger.warning(f"区域文本提取失败 (bbox={bbox}): {e}")
        return ""


def _detect_image_label(image: np.ndarray, bbox: List[int], ocr_engine) -> Optional[str]:
    """
    检测图片块内部或周围的微型文本标签 (如"图1", "图2")
    
    Args:
        image: 完整图像
        bbox: 图片块坐标
        ocr_engine: OCR 引擎
        
    Returns:
        识别到的图片标签，如 "图1" 或 None
    """
    try:
        x_min, y_min, x_max, y_max = bbox
        h, w = image.shape[:2]
        
        # 搜索图片块正下方区域 (扩展一定范围)
        label_region_height = 60  # 向下扩展 60 像素
        label_y_min = y_max
        label_y_max = min(h, y_max + label_region_height)
        label_x_min = max(0, x_min - 20)
        label_x_max = min(w, x_max + 20)
        
        if label_y_max > label_y_min:
            label_region = image[label_y_min:label_y_max, label_x_min:label_x_max]
            if label_region.size > 0:
                text = _extract_text_from_region(image, [label_x_min, label_y_min, label_x_max, label_y_max], ocr_engine)
                # 匹配"图X"格式
                match = re.search(r'图\s*[0-9一二三四五六七八九十]+', text)
                if match:
                    return match.group(0).replace(" ", "")
        
        # 也搜索图片块上方区域
        label_y_min = max(0, y_min - label_region_height)
        label_y_max = y_min
        if label_y_max > label_y_min:
            label_region = image[label_y_min:label_y_max, label_x_min:label_x_max]
            if label_region.size > 0:
                text = _extract_text_from_region(image, [label_x_min, label_y_min, label_x_max, label_y_max], ocr_engine)
                match = re.search(r'图\s*[0-9一二三四五六七八九十]+', text)
                if match:
                    return match.group(0).replace(" ", "")
        
        return None
    except Exception as e:
        logger.warning(f"图片标签检测失败 (bbox={bbox}): {e}")
        return None


def _generate_mock_layout(image_size: Tuple[int, int]) -> Dict:
    """
    生成 Mock 版面数据 (当 PaddleOCR 不可用时)
    用于测试后续的 spatial alignment 和 image processor 模块
    
    Args:
        image_size: 图像尺寸 (width, height)
        
    Returns:
        包含虚拟文本块和图片块的字典
    """
    w, h = image_size
    # 坐标按 800x1200 比例设计，会随实际尺寸缩放
    scale_x = w / 800.0 if w else 1.0
    scale_y = h / 1200.0 if h else 1.0
    
    def scale_bbox(bbox):
        """缩放坐标到实际图像尺寸"""
        return [
            int(bbox[0] * scale_x),
            int(bbox[1] * scale_y),
            int(bbox[2] * scale_x),
            int(bbox[3] * scale_y)
        ]
    
    # 三个文本块：第12题、第13题、第14题题干
    text_blocks = [
        LayoutBlock(
            block_id="text_001",
            block_type=BlockType.TEXT,
            bbox=scale_bbox([50, 150, 400, 280]),
            text_content="12．如图，在△ABC中，∠C=90°，AD平分∠BAC交BC于点D。若AB=10，AC=6，求CD的长。",
            confidence=0.95
        ),
        LayoutBlock(
            block_id="text_002",
            block_type=BlockType.TEXT,
            bbox=scale_bbox([50, 620, 400, 720]),
            text_content="13．解方程：2x + 5 = 15",
            confidence=0.95
        ),
        LayoutBlock(
            block_id="text_003",
            block_type=BlockType.TEXT,
            bbox=scale_bbox([50, 820, 400, 980]),
            text_content="14．如图所示，四边形ABCD是平行四边形，E是BC的中点，连接AE交BD于点F。求证：BF=2FD",
            confidence=0.95
        )
    ]
    
    # 两个图片块：几何图A（第12题配图，在题干下方）、几何图B（第14题配图，在题干右方）
    image_blocks = [
        LayoutBlock(
            block_id="img_001",
            block_type=BlockType.IMAGE,
            bbox=scale_bbox([200, 320, 500, 520]),
            confidence=0.90
        ),
        LayoutBlock(
            block_id="img_002",
            block_type=BlockType.IMAGE,
            bbox=scale_bbox([450, 820, 730, 1000]),
            confidence=0.90
        )
    ]
    
    logger.info("[Mock 模式] 已生成虚拟版面数据: 3个文本块, 2个图片块")
    
    return {
        "text_blocks": [b.to_dict() for b in text_blocks],
        "image_blocks": [b.to_dict() for b in image_blocks],
        "image_size": image_size,
        "total_blocks": 5,
        "mock_mode": True
    }


def analyze_paper_layout(image_path: str) -> Dict:
    """
    试卷版面分析与特征提取
    
    对输入的试卷大图进行版面分析，分离出所有的文本块和图片块。
    每个元素包含唯一的 ID、坐标区域和文本内容。
    
    Args:
        image_path: 试卷图像路径
        
    Returns:
        {
            "text_blocks": [LayoutBlock, ...],  # 所有文本块
            "image_blocks": [LayoutBlock, ...],  # 所有图片块
            "image_size": (width, height),       # 原始图像尺寸
            "total_blocks": int                  # 总元素数
        }
    """
    try:
        # 1. 读取图像
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"无法读取图像文件: {image_path}")
        
        img_h, img_w = image.shape[:2]
        logger.info(f"图像加载成功，尺寸: {img_w}x{img_h}")
        
        # 2. 初始化 OCR 引擎
        ocr_engine = _init_ocr_engine()
        
        # 3. 执行版面分析 (PaddleOCR Layout)
        logger.info("开始版面分析...")
        layout_result = ocr_engine.ocr(image_path, cls=True)
        
        text_blocks = []
        image_blocks = []
        block_counter = {"text": 0, "image": 0}
        
        # 4. 解析版面分析结果
        if layout_result and layout_result[0]:
            for line in layout_result[0]:
                if not line or len(line) < 2:
                    continue
                
                # 提取坐标和类型信息
                box_info = line[0]  # 坐标信息
                rec_info = line[1]  # 识别结果
                
                # 获取 bounding box
                if isinstance(box_info, list) and len(box_info) == 4:
                    # box_info 是四个角点坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                    points = np.array(box_info, dtype=np.int32)
                    x_min = int(np.min(points[:, 0]))
                    y_min = int(np.min(points[:, 1]))
                    x_max = int(np.max(points[:, 0]))
                    y_max = int(np.max(points[:, 1]))
                else:
                    continue
                
                # 获取识别类型和文本
                if isinstance(rec_info, dict):
                    block_type_str = rec_info.get('type', 'text')
                    text = rec_info.get('text', '')
                    confidence = rec_info.get('score', 0.0)
                else:
                    # 兼容旧版格式
                    text = rec_info[0] if len(rec_info) > 0 else ''
                    confidence = rec_info[1] if len(rec_info) > 1 else 0.0
                    block_type_str = 'text'
                
                # 映射版面分析类型到我们的分类
                if block_type_str in ['figure', 'image', 'img']:
                    block_type = BlockType.IMAGE
                    block_counter["image"] += 1
                    block_id = f"img_{block_counter['image']:03d}"
                    
                    # 检测图片标签
                    image_key = _detect_image_label(image, [x_min, y_min, x_max, y_max], ocr_engine)
                    
                    block = LayoutBlock(
                        block_id=block_id,
                        block_type=block_type,
                        bbox=[x_min, y_min, x_max, y_max],
                        confidence=confidence
                    )
                    block.image_key = image_key
                    image_blocks.append(block)
                    
                else:
                    block_type = BlockType.TEXT
                    block_counter["text"] += 1
                    block_id = f"text_{block_counter['text']:03d}"
                    
                    # 如果没有识别到文本，尝试单独 OCR
                    if not text or len(text.strip()) < 2:
                        text = _extract_text_from_region(image, [x_min, y_min, x_max, y_max], ocr_engine)
                    
                    block = LayoutBlock(
                        block_id=block_id,
                        block_type=block_type,
                        bbox=[x_min, y_min, x_max, y_max],
                        text_content=text,
                        confidence=confidence
                    )
                    text_blocks.append(block)
        
        logger.info(f"版面分析完成: 文本块 {len(text_blocks)} 个, 图片块 {len(image_blocks)} 个")
        
        return {
            "text_blocks": [b.to_dict() for b in text_blocks],
            "image_blocks": [b.to_dict() for b in image_blocks],
            "image_size": (img_w, img_h),
            "total_blocks": len(text_blocks) + len(image_blocks)
        }
        
    except ModuleNotFoundError as e:
        if "paddleocr" in str(e).lower():
            logger.warning(f"PaddleOCR 未安装，自动切换到 Mock 模式")
            # 读取图像获取尺寸，然后返回 Mock 数据
            try:
                image = cv2.imread(image_path)
                if image is not None:
                    img_h, img_w = image.shape[:2]
                    image_size = (img_w, img_h)
                else:
                    image_size = (800, 1200)  # 默认尺寸
            except Exception:
                image_size = (800, 1200)
            
            return _generate_mock_layout(image_size)
        else:
            logger.error(f"模块导入失败: {e}", exc_info=True)
            return {
                "text_blocks": [],
                "image_blocks": [],
                "image_size": (0, 0),
                "total_blocks": 0,
                "error": str(e)
            }
    except Exception as e:
        logger.error(f"版面分析失败: {e}", exc_info=True)
        return {
            "text_blocks": [],
            "image_blocks": [],
            "image_size": (0, 0),
            "total_blocks": 0,
            "error": str(e)
        }
