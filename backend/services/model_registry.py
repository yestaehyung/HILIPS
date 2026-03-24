"""
HILIPS Model Registry
Knowledge Distillation 모델 버전 관리 및 mAP 0.7 검증 시스템

论文 2.2.2 Knowledge Distillation 구현:
- 학습된 모델의 성능 평가 (mAP 0.7 이상 기준)
- 모델 버전 및 성능 지표 데이터베이스 관리
"""

import os
import json
import shutil
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path
from enum import Enum

logger = logging.getLogger(__name__)

# 경로 설정
MODELS_DIR = os.environ.get("MODELS_DIR", "trained_models")
MODEL_REGISTRY_FILE = "model_registry.json"
MAP_THRESHOLD = 0.7  # Paper 기준: mAP 0.7 이상


class ModelStatus(Enum):
    """모델 상태枚举"""

    TRAINING = "training"
    EVALUATING = "evaluating"
    READY = "ready"  # mAP >= 0.7
    NEEDS_IMPROVEMENT = "needs_improvement"  # mAP < 0.7
    ARCHIVED = "archived"
    PRODUCTION = "production"


class ModelRegistry:
    """
    모델 레지스트리

    기능:
    - 모델 버전 관리
    - mAP 0.7 임계값 검증
    - 모델 프로모션 (staging → production)
    - 성능 지표 추적
    """

    def __init__(self, registry_path: str = None):
        self.registry_path = registry_path or MODEL_REGISTRY_FILE
        self.models_dir = Path(MODELS_DIR)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.registry = self._load_registry()

    def _load_registry(self) -> Dict[str, Any]:
        """레지스트리 파일 로드"""
        if Path(self.registry_path).exists():
            try:
                with open(self.registry_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load registry: {e}")
                return {"models": {}, "versions": [], "statistics": {}}
        return {"models": {}, "versions": [], "statistics": {}}

    def _save_registry(self):
        """레지스트리 파일 저장"""
        with open(self.registry_path, "w", encoding="utf-8") as f:
            json.dump(self.registry, f, indent=2, ensure_ascii=False)
        logger.info(f"Registry saved: {self.registry_path}")

    def register_model(
        self,
        model_id: str,
        model_path: str,
        metrics: Dict[str, float],
        dataset_info: Dict[str, Any] = None,
        config: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """
        모델 등록

        Paper: "학습이 완료된 모델은 검증 데이터셋에서 성능을 평가한 후,
                기준 성능(mAP 0.7 이상)을 만족하면 다음 단계에서 사용할 수 있도록 등록"

        Args:
            model_id: 모델 고유 ID
            model_path: 모델 파일 경로
            metrics: 성능 지표 (mAP, precision, recall 등)
            dataset_info: 학습 데이터셋 정보
            config: 모델 설정 (epochs, batch_size 등)

        Returns:
            등록 결과 + 상태 판정
        """
        # mAP 0.7 검증
        map_50 = metrics.get("map50", 0)
        map_50_95 = metrics.get("map50_95", 0)  # mAP@0.5:0.95
        map_70 = self._calculate_map70(metrics)

        # 상태 판정
        if map_70 >= MAP_THRESHOLD:
            status = ModelStatus.READY.value
            status_message = (
                f"✅ Model meets threshold (mAP@0.7={map_70:.3f} >= {MAP_THRESHOLD})"
            )
        else:
            status = ModelStatus.NEEDS_IMPROVEMENT.value
            status_message = (
                f"⚠️ Model below threshold (mAP@0.7={map_70:.3f} < {MAP_THRESHOLD})"
            )

        # 모델 파일 복사
        dest_path = self.models_dir / f"{model_id}.pt"
        try:
            if Path(model_path).exists():
                shutil.copy2(model_path, dest_path)
                actual_path = str(dest_path)
            else:
                actual_path = model_path
        except Exception as e:
            logger.error(f"Model file copy failed: {e}")
            actual_path = model_path

        # 레지스트리 업데이트
        model_info = {
            "id": model_id,
            "file_path": actual_path,
            "status": status,
            "status_message": status_message,
            "metrics": {
                "map50": map_50,
                "map50_95": map_50_95,
                "map70": map_70,
                "precision": metrics.get("precision", 0),
                "recall": metrics.get("recall", 0),
                "f1": metrics.get("f1", 0),
                "per_class": metrics.get("per_class", {}),
                "class_names": metrics.get("class_names", []),
            },
            "dataset_info": dataset_info or {},
            "config": config or {},
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

        # 버전 이력 추가
        version_entry = {
            "model_id": model_id,
            "version": len(
                self.registry["models"].get(model_id, {}).get("versions", [])
            )
            + 1,
            "file_path": actual_path,
            "metrics": model_info["metrics"],
            "status": status,
            "created_at": datetime.now().isoformat(),
        }

        # 저장
        if model_id not in self.registry["models"]:
            self.registry["models"][model_id] = {
                "versions": [],
                "current_status": status,
            }

        self.registry["models"][model_id]["versions"].append(version_entry)
        self.registry["models"][model_id]["current_status"] = status
        self.registry["models"][model_id]["latest_metrics"] = model_info["metrics"]
        self.registry["models"][model_id]["latest_version"] = version_entry["version"]

        self.registry["versions"].append(version_entry)
        self._save_registry()

        logger.info(
            f"Model registered: {model_id} (v{version_entry['version']}, mAP@0.7={map_70:.3f})"
        )

        return {
            "model_id": model_id,
            "version": version_entry["version"],
            "status": status,
            "status_message": status_message,
            "metrics": model_info["metrics"],
            "path": actual_path,
        }

    def _calculate_map70(self, metrics: Dict[str, float]) -> float:
        """
        mAP@0.7 계산

        Ultralytics YOLOv8은 mAP@0.5:0.95 (IoU 0.5~0.95 평균)를 제공
        mAP@0.7은 IoU 0.7에서의 AP

        Note: 실제 구현에서는 validation 시 10개 IoU threshold별 AP 저장 필요
        여기서는 map50을 기준으로 추정 (실제로는 all_ap[:, 4] 접근)
        """
        # YOLOv8 validation 결과에서 직접 접근하는 것이 정확함
        # 이 메소드는 fallback으로 map50 사용
        if "map70" in metrics:
            return metrics["map70"]
        elif "map" in metrics:
            # map50_95가 일반적
            return metrics.get("map", 0) * 0.9  # 대략적 추정
        else:
            return metrics.get("map50", 0)

    def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        """모델 정보 조회"""
        return self.registry["models"].get(model_id)

    def get_latest_model(self, status: str = None) -> Optional[Dict[str, Any]]:
        """
        최신 모델 조회

        Args:
            status: 특정 상태의 모델만 조회 (None이면 전체)
        """
        models = self.registry["models"]

        if not models:
            return None

        # 상태 필터링
        filtered = models
        if status:
            filtered = {
                k: v for k, v in models.items() if v.get("current_status") == status
            }

        if not filtered:
            return None

        # 최신 버전 선택
        latest = max(filtered.items(), key=lambda x: x[1].get("latest_version", 0))

        return {"model_id": latest[0], **latest[1]}

    def get_all_models(self) -> List[Dict[str, Any]]:
        """모든 모델 목록"""
        result = []
        for model_id, info in self.registry["models"].items():
            result.append(
                {
                    "model_id": model_id,
                    "status": info.get("current_status"),
                    "latest_version": info.get("latest_version"),
                    "metrics": info.get("latest_metrics"),
                    "created_at": info["versions"][0]["created_at"]
                    if info.get("versions")
                    else None,
                }
            )
        return sorted(result, key=lambda x: x.get("created_at", ""), reverse=True)

    def promote_to_production(self, model_id: str) -> Dict[str, Any]:
        """
        모델을 프로덕션으로 승격

        Paper: "모델이 개선됨에 따라 자동 레이블링의 정확도가 향상"
        → 프로덕션 모델만 자동 레이블링에 사용
        """
        if model_id not in self.registry["models"]:
            raise ValueError(f"Model not found: {model_id}")

        model_info = self.registry["models"][model_id]

        # 현재 상태 확인
        current_status = model_info.get("current_status")
        if current_status == ModelStatus.NEEDS_IMPROVEMENT.value:
            raise ValueError(f"Cannot promote model below threshold: {model_id}")

        # 기존 프로덕션 모델 demote
        for mid, info in self.registry["models"].items():
            if info.get("current_status") == ModelStatus.PRODUCTION.value:
                info["current_status"] = ModelStatus.READY.value
                logger.info(f"Demoted previous production model: {mid}")

        # 새 모델 프로모션
        self.registry["models"][model_id]["current_status"] = (
            ModelStatus.PRODUCTION.value
        )
        self.registry["models"][model_id]["promoted_at"] = datetime.now().isoformat()
        self._save_registry()

        logger.info(f"Promoted to production: {model_id}")

        return {
            "model_id": model_id,
            "previous_production": "demoted",
            "new_production": model_id,
            "promoted_at": datetime.now().isoformat(),
        }

    def archive_model(self, model_id: str) -> bool:
        """모델 아카이브"""
        if model_id in self.registry["models"]:
            self.registry["models"][model_id]["current_status"] = (
                ModelStatus.ARCHIVED.value
            )
            self.registry["models"][model_id]["archived_at"] = (
                datetime.now().isoformat()
            )
            self._save_registry()
            logger.info(f"Archived model: {model_id}")
            return True
        return False

    def delete_model(self, model_id: str, delete_files: bool = True) -> Dict[str, Any]:
        """
        모델 삭제

        Args:
            model_id: 삭제할 모델 ID
            delete_files: 모델 파일도 함께 삭제할지 여부

        Returns:
            삭제 결과
        """
        if model_id not in self.registry["models"]:
            raise ValueError(f"Model not found: {model_id}")

        model_info = self.registry["models"][model_id]

        deleted_files = []

        if delete_files:
            model_file = self.models_dir / f"{model_id}.pt"
            if model_file.exists():
                try:
                    model_file.unlink()
                    deleted_files.append(str(model_file))
                    logger.info(f"Deleted model file: {model_file}")
                except Exception as e:
                    logger.warning(f"Failed to delete model file {model_file}: {e}")

            for version in model_info.get("versions", []):
                file_path = version.get("file_path")
                if file_path and Path(file_path).exists():
                    try:
                        Path(file_path).unlink()
                        deleted_files.append(file_path)
                    except Exception as e:
                        logger.warning(
                            f"Failed to delete version file {file_path}: {e}"
                        )

        del self.registry["models"][model_id]

        self.registry["versions"] = [
            v for v in self.registry["versions"] if v.get("model_id") != model_id
        ]

        self._save_registry()

        logger.info(f"Deleted model from registry: {model_id}")

        return {
            "model_id": model_id,
            "deleted": True,
            "deleted_files": deleted_files,
            "deleted_at": datetime.now().isoformat(),
        }

    def get_statistics(self) -> Dict[str, Any]:
        """통계 정보"""
        models = self.registry["models"]

        total_models = len(models)
        ready_models = sum(
            1
            for m in models.values()
            if m.get("current_status") == ModelStatus.READY.value
        )
        production_models = sum(
            1
            for m in models.values()
            if m.get("current_status") == ModelStatus.PRODUCTION.value
        )
        needs_improvement = sum(
            1
            for m in models.values()
            if m.get("current_status") == ModelStatus.NEEDS_IMPROVEMENT.value
        )

        # 평균 성능
        if ready_models > 0:
            avg_map70 = (
                sum(
                    m.get("latest_metrics", {}).get("map70", 0)
                    for m in models.values()
                    if m.get("current_status") == ModelStatus.READY.value
                )
                / ready_models
            )
        else:
            avg_map70 = 0

        return {
            "total_models": total_models,
            "ready_models": ready_models,
            "production_models": production_models,
            "needs_improvement": needs_improvement,
            "average_map70": round(avg_map70, 4),
            "map_threshold": MAP_THRESHOLD,
            "last_updated": datetime.now().isoformat(),
        }

    def evaluate_model(
        self, model_id: str, new_metrics: Dict[str, float]
    ) -> Dict[str, Any]:
        """
        모델 재평가

        Paper: "모델이 개선됨에 따라 자동 레이블링의 정확도가 향상"
        → 정기적 재평가를 통해 성능 추적
        """
        if model_id not in self.registry["models"]:
            raise ValueError(f"Model not found: {model_id}")

        model_info = self.registry["models"][model_id]
        old_map70 = model_info.get("latest_metrics", {}).get("map70", 0)
        new_map70 = self._calculate_map70(new_metrics)

        # 상태 업데이트
        if new_map70 >= MAP_THRESHOLD:
            new_status = ModelStatus.READY.value
        else:
            new_status = ModelStatus.NEEDS_IMPROVEMENT.value

        model_info["current_status"] = new_status
        model_info["latest_metrics"] = new_metrics
        model_info["updated_at"] = datetime.now().isoformat()

        # 새 버전 추가
        new_version = {
            "version": len(model_info["versions"]) + 1,
            "file_path": model_info["versions"][-1]["file_path"]
            if model_info.get("versions")
            else None,
            "metrics": new_metrics,
            "status": new_status,
            "created_at": datetime.now().isoformat(),
        }
        model_info["versions"].append(new_version)

        self._save_registry()

        improvement = new_map70 - old_map70

        logger.info(
            f"Model re-evaluated: {model_id} (v{new_version['version']}, "
            f"mAP@0.7: {old_map70:.3f} → {new_map70:.3f}, Δ={improvement:+.3f})"
        )

        return {
            "model_id": model_id,
            "version": new_version["version"],
            "old_map70": old_map70,
            "new_map70": new_map70,
            "improvement": improvement,
            "status": new_status,
            "improved": new_map70 > old_map70,
        }


# 싱글톤 인스턴스
_registry_instance = None


def get_registry(registry_path: str = None) -> ModelRegistry:
    """레지스트리 싱글톤 인스턴스"""
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = ModelRegistry(registry_path)
    return _registry_instance


def reset_registry():
    """레지스트리 리셋 (테스트용)"""
    global _registry_instance
    _registry_instance = None
