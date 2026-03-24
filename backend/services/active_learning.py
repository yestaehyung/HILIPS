"""
HILIPS Active Learning Service
Iterative Refinement을 위한 Active Learning selection 로직

论文 2.2.3 Iterative Refinement 구현:
- 새로운 이미지에 대해 경량 모델로 객체 탐지
- Confidence score 기반 자동 레이블링 vs 사용자 검토 분류
- Unseen object 발견 시 LLM 파이프라인 호출
- 축적된 데이터를 주기적으로 Knowledge Distillation로 전달
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional
from pathlib import Path
import numpy as np

logger = logging.getLogger(__name__)

# 설정
CONFIDENCE_THRESHOLD = 0.8  # Paper 기본값: confidence 0.8 이상 = 자동 레이블링
REVIEW_THRESHOLD = 0.5  # confidence 0.5 미만 = 반드시 검토 필요
ANNOTATIONS_DIR = os.environ.get('ANNOTATIONS_DIR', 'annotations')


class ActiveLearningService:
    """
    Active Learning 서비스
    
    기능:
    - 미확인 이미지 우선순위화 (low confidence detection 기반)
    - 자동 레이블링 vs 수동 검토 분류
    - 재학습용 데이터셋 큐 관리
    """
    
    def __init__(self, annotations_dir: str = None):
        self.annotations_dir = Path(annotations_dir or ANNOTATIONS_DIR)
        self.annotations_dir.mkdir(parents=True, exist_ok=True)
        self.review_queue_file = self.annotations_dir / 'review_queue.json'
        self.auto_label_queue_file = self.annotations_dir / 'auto_label_queue.json'
        self.load_queues()
    
    def load_queues(self):
        """큐 로드"""
        if self.review_queue_file.exists():
            try:
                with open(self.review_queue_file, 'r') as f:
                    self.review_queue = json.load(f)
            except:
                self.review_queue = {'queue': [], 'statistics': {}}
        else:
            self.review_queue = {'queue': [], 'statistics': {}}
        
        if self.auto_label_queue_file.exists():
            try:
                with open(self.auto_label_queue_file, 'r') as f:
                    self.auto_label_queue = json.load(f)
            except:
                self.auto_label_queue = {'queue': [], 'statistics': {}}
        else:
            self.auto_label_queue = {'queue': [], 'statistics': {}}
    
    def save_queues(self):
        """큐 저장"""
        with open(self.review_queue_file, 'w') as f:
            json.dump(self.review_queue, f, indent=2)
        with open(self.auto_label_queue_file, 'w') as f:
            json.dump(self.auto_label_queue, f, indent=2)
    
    def analyze_detection_confidence(
        self,
        detections: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Detection confidence 분석
        
        Args:
            detections: [{label, confidence, bbox, ...}, ...]
        
        Returns:
            confidence 분석 결과
        """
        if not detections:
            return {
                'total': 0,
                'auto_label_count': 0,
                'review_count': 0,
                'avg_confidence': 0,
                'min_confidence': 0,
                'max_confidence': 0,
                'needs_review': True,
                'reason': 'No detections'
            }
        
        confidences = [d.get('confidence', 0) for d in detections]
        
        auto_count = sum(1 for c in confidences if c >= CONFIDENCE_THRESHOLD)
        review_count = sum(1 for c in confidences if c < CONFIDENCE_THRESHOLD)
        
        needs_review = (
            len(confidences) == 0 or  #_detection 없음
            min(confidences) < REVIEW_THRESHOLD or  # confidence가 너무 낮음
            auto_count == 0  # 자동 레이블링 가능한 detection 없음
        )
        
        return {
            'total': len(detections),
            'auto_label_count': auto_count,
            'review_count': review_count,
            'avg_confidence': sum(confidences) / len(confidences),
            'min_confidence': min(confidences),
            'max_confidence': max(confidences),
            'needs_review': needs_review,
            'auto_ratio': auto_count / len(confidences) if confidences else 0,
            'confidence_distribution': {
                'high': sum(1 for c in confidences if c >= CONFIDENCE_THRESHOLD),
                'medium': sum(1 for c in confidences if REVIEW_THRESHOLD <= c < CONFIDENCE_THRESHOLD),
                'low': sum(1 for c in confidences if c < REVIEW_THRESHOLD)
            }
        }
    
    def classify_for_iterative_refinement(
        self,
        image_path: str,
        detections: List[Dict[str, Any]],
        model_id: str = None
    ) -> Dict[str, Any]:
        """
        Iterative Refinement을 위한 분류
        
        Paper: "confidence score가 임계값(기본값 0.8) 이상인 객체는 자동으로 레이블링,
                임계값 미만인 객체는 사용자 검토 대상으로 분류"
        
        Args:
            image_path: 이미지 경로
            detections: 모델 detection 결과
            model_id: 사용된 모델 ID
        
        Returns:
            분류 결과 + 분류된 detection 리스트
        """
        confidence_analysis = self.analyze_detection_confidence(detections)
        
        auto_detections = []
        review_detections = []
        
        for det in detections:
            conf = det.get('confidence', 0)
            if conf >= CONFIDENCE_THRESHOLD:
                auto_detections.append({
                    **det,
                    'auto_labeled': True,
                    'auto_labeled_by': model_id or 'unknown',
                    'auto_labeled_at': datetime.now().isoformat()
                })
            else:
                review_detections.append({
                    **det,
                    'needs_review': True,
                    'review_reason': 'confidence_below_threshold',
                    'confidence': conf
                })
        
        # 큐 업데이트
        image_info = {
            'image_path': image_path,
            'filename': Path(image_path).name,
            'detected_at': datetime.now().isoformat(),
            'model_id': model_id,
            'confidence_analysis': confidence_analysis
        }
        
        # 검토 큐에 추가 (항상 추가하여 사용자가 확인 가능하게)
        self._add_to_review_queue(image_info, review_detections)
        
        # 자동 레이블링 큐에 추가
        if auto_detections:
            self._add_to_auto_label_queue(image_info, auto_detections)
        
        return {
            'image_path': image_path,
            'auto_labeled': len(auto_detections),
            'needs_review': len(review_detections),
            'auto_detections': auto_detections,
            'review_detections': review_detections,
            'confidence_analysis': confidence_analysis,
            'pipeline_action': 'llm_fallback' if confidence_analysis['needs_review'] else 'auto_proceed'
        }
    
    def _add_to_review_queue(self, image_info: Dict, detections: List[Dict]):
        """검토 큐에 추가"""
        queue_item = {
            **image_info,
            'detections': detections,
            'priority': self._calculate_review_priority(image_info, detections),
            'queued_at': datetime.now().isoformat()
        }
        
        self.review_queue['queue'].append(queue_item)
        self._update_queue_statistics(self.review_queue, 'review')
        self.save_queues()
        
        logger.info(f"Added to review queue: {image_info['filename']} ({len(detections)} detections)")
    
    def _add_to_auto_label_queue(self, image_info: Dict, detections: List[Dict]):
        """자동 레이블링 큐에 추가"""
        queue_item = {
            **image_info,
            'detections': detections,
            'queued_at': datetime.now().isoformat()
        }
        
        self.auto_label_queue['queue'].append(queue_item)
        self._update_queue_statistics(self.auto_label_queue, 'auto')
        self.save_queues()
    
    def _calculate_review_priority(
        self,
        image_info: Dict,
        detections: List[Dict]
    ) -> int:
        """
        검토 우선순위 계산
        
        우선순위 높은 경우:
        - confidence가 매우 낮은 detection 다수
        - detection 수가 이상치 (너무 많거나太少)
        - unseen object 가능성
        """
        priority = 0
        
        confidences = [d.get('confidence', 0) for d in detections]
        if confidences:
            min_conf = min(confidences)
            if min_conf < 0.3:
                priority += 3
            elif min_conf < 0.5:
                priority += 2
            elif min_conf < CONFIDENCE_THRESHOLD:
                priority += 1
        
        # Detection 수 기반 우선순위
        detection_count = len(detections)
        if detection_count == 0:
            priority += 2  # detection 없으면 반드시 확인 필요
        elif detection_count > 20:
            priority += 1  # detection이 너무 많음
        
        return min(priority, 5)  # 최대 5
    
    def _update_queue_statistics(self, queue: Dict, queue_type: str):
        """큐 통계 업데이트"""
        queue['statistics'] = {
            'total_items': len(queue['queue']),
            'last_updated': datetime.now().isoformat(),
            'queue_type': queue_type
        }
    
    def get_review_queue(self, limit: int = None, priority_filter: int = None) -> List[Dict]:
        """
        검토 큐 조회
        
        Args:
            limit: 반환할 최대 개수
            priority_filter: 최소 우선순위 필터
        
        Returns:
            검토 대상 이미지 목록 (우선순위순 정렬)
        """
        queue = self.review_queue.get('queue', [])
        
        # 우선순위 필터
        if priority_filter is not None:
            queue = [item for item in queue if item.get('priority', 0) >= priority_filter]
        
        # 우선순위 내림차순 정렬
        queue_sorted = sorted(queue, key=lambda x: x.get('priority', 0), reverse=True)
        
        if limit:
            queue_sorted = queue_sorted[:limit]
        
        return queue_sorted
    
    def get_auto_label_queue(self, limit: int = None) -> List[Dict]:
        """자동 레이블링 큐 조회"""
        queue = self.auto_label_queue.get('queue', [])
        if limit:
            queue = queue[:limit]
        return queue
    
    def mark_reviewed(
        self,
        image_path: str,
        revised_detections: List[Dict],
        reviewer: str = 'human'
    ) -> Dict[str, Any]:
        """
        검토 완료 표시
        
        Paper: "사용자는 자동 레이블링된 결과를 확인하고, 검토 대상 객체에 대해
                수동으로 레이블을 지정하거나 수정"
        
        Args:
            image_path: 이미지 경로
            revised_detections: 수정된 detection 결과
            reviewer: 검토자 ('human' 또는 'llm')
        
        Returns:
            처리 결과
        """
        # 큐에서 제거
        removed = False
        
        # 검토 큐에서 제거
        queue = self.review_queue.get('queue', [])
        for i, item in enumerate(queue):
            if item.get('image_path') == image_path:
                queue.pop(i)
                removed = True
                break
        
        if not removed:
            logger.warning(f"Image not found in review queue: {image_path}")
        
        # 자동 레이블링 큐에서 제거 (있는 경우)
        auto_queue = self.auto_label_queue.get('queue', [])
        for i, item in enumerate(auto_queue):
            if item.get('image_path') == image_path:
                auto_queue.pop(i)
                break
        
        self.save_queues()
        
        # 검토 완료 데이터 저장
        review_history = {
            'image_path': image_path,
            'reviewed_at': datetime.now().isoformat(),
            'reviewer': reviewer,
            'detection_count': len(revised_detections),
            'revised_detections': revised_detections
        }
        
        history_file = self.annotations_dir / 'review_history.json'
        history = []
        if history_file.exists():
            try:
                with open(history_file, 'r') as f:
                    history = json.load(f)
            except:
                pass
        history.append(review_history)
        with open(history_file, 'w') as f:
            json.dump(history, f, indent=2)
        
        logger.info(f"Marked as reviewed: {image_path} ({len(revised_detections)} detections)")
        
        return {
            'image_path': image_path,
            'reviewed': True,
            'reviewer': reviewer,
            'detection_count': len(revised_detections)
        }
    
    def detect_unseen_objects(
        self,
        detections: List[Dict[str, Any]],
        known_classes: List[str]
    ) -> List[Dict[str, Any]]:
        """
        Unseen object 탐지
        
        Paper: "경량 모델이 처리하지 못하는 객체(unseen object)가 발견되면,
                Cold-start Labeling 단계의 LLM 파이프라인을 선택적으로 호출"
        
        Args:
            detections: 모델 detection 결과
            known_classes: 알려진 클래스 목록
        
        Returns:
            unseen object로 추정되는 detection 목록
        """
        unseen = []
        
        for det in detections:
            label = det.get('label', '').lower()
            confidence = det.get('confidence', 1.0)
            
            # 알려진 클래스가 아니거나 confidence가 낮은 경우
            is_known = any(k.lower() in label or label in k.lower() for k in known_classes)
            
            if not is_known:
                unseen.append({
                    **det,
                    'unseen_type': 'unknown_class',
                    'reason': f'Label "{det.get("label")}" not in known classes'
                })
            elif confidence < 0.3:  # confidence가 매우 낮음
                unseen.append({
                    **det,
                    'unseen_type': 'low_confidence',
                    'reason': f'Confidence {confidence:.2f} below threshold'
                })
        
        return unseen
    
    def prepare_distillation_dataset(
        self,
        include_reviewed: bool = True,
        min_quality_score: float = 0.7
    ) -> Dict[str, Any]:
        """
        재학습용 데이터셋 준비
        
        Paper: "이 과정에서 축적된 데이터는 주기적으로 Knowledge Distillation 단계로
                전달되어 모델을 재학습"
        
        Args:
            include_reviewed: 검토 완료 데이터 포함 여부
            min_quality_score: 포함할 최소 품질 점수
        
        Returns:
            재학습용 데이터셋 정보
        """
        # 검토 완료 데이터 수집
        history_file = self.annotations_dir / 'review_history.json'
        reviewed_data = []
        
        if history_file.exists() and include_reviewed:
            try:
                with open(history_file, 'r') as f:
                    reviewed_data = json.load(f)
            except Exception as e:
                logger.error(f"Failed to read review history: {e}")
        
        # 자동 레이블링 데이터 수집
        auto_queue = self.auto_label_queue.get('queue', [])
        
        # 품질 점수 필터링
        quality_data = []
        
        for item in reviewed_data:
            # 품질 점수 계산 (검토자가 수정한 정도)
            quality_score = self._calculate_quality_score(item)
            if quality_score >= min_quality_score:
                quality_data.append({
                    'source': 'human_review',
                    'quality_score': quality_score,
                    **item
                })
        
        for item in auto_queue:
            conf_analysis = item.get('confidence_analysis', {})
            auto_ratio = conf_analysis.get('auto_ratio', 1.0)
            # 자동 레이블링 비율이 높고 confidence도 높으면 품질 good
            quality_score = (auto_ratio + conf_analysis.get('avg_confidence', 0)) / 2
            if quality_score >= min_quality_score:
                quality_data.append({
                    'source': 'auto_label',
                    'quality_score': quality_score,
                    **item
                })
        
        # 데이터셋 요약
        total_images = len(set(item.get('image_path', '') for item in quality_data))
        total_detections = sum(item.get('detection_count', 0) for item in quality_data)
        
        return {
            'images': total_images,
            'total_detections': total_detections,
            'quality_score_threshold': min_quality_score,
            'ready_for_distillation': total_images > 0,
            'data': quality_data,
            'prepared_at': datetime.now().isoformat()
        }
    
    def _calculate_quality_score(self, review_item: Dict) -> float:
        """품질 점수 계산 (0-1)"""
        # 검토 데이터가 있는 경우
        revised = review_item.get('revised_detections', [])
        original_count = review_item.get('detection_count', 0)
        
        if not revised:
            return 0.5
        
        if original_count == 0:
            return 0.8  #-detection이 없었는데 추가함 = 품질 good
        
        # 수정 정도 (거의 수정 없으면 품질 good)
        edit_ratio = abs(len(revised) - original_count) / max(original_count, 1)
        quality = 1.0 - min(edit_ratio, 0.5)  # 수정율이 높으면 품질稍降
        
        return quality
    
    def get_queue_statistics(self) -> Dict[str, Any]:
        """큐 통계"""
        return {
            'review_queue': {
                'count': len(self.review_queue.get('queue', [])),
                'statistics': self.review_queue.get('statistics', {})
            },
            'auto_label_queue': {
                'count': len(self.auto_label_queue.get('queue', [])),
                'statistics': self.auto_label_queue.get('statistics', {})
            },
            'confidence_threshold': CONFIDENCE_THRESHOLD,
            'review_threshold': REVIEW_THRESHOLD
        }


# 싱글톤 인스턴스
_active_learning_instance = None

def get_active_learning_service(annotations_dir: str = None) -> ActiveLearningService:
    """Active Learning 서비스 싱글톤"""
    global _active_learning_instance
    if _active_learning_instance is None:
        _active_learning_instance = ActiveLearningService(annotations_dir)
    return _active_learning_instance


def reset_active_learning_service():
    """서비스 리셋 (테스트용)"""
    global _active_learning_instance
    _active_learning_instance = None
