"""
HILIPS Workflow State Service
프로젝트 워크플로우 상태 및 Iteration 추적

논문 순환 구조 구현:
Phase 1 (Cold-start) → Phase 2 (Distillation) → Phase 3 (Refinement) → Phase 2 (재학습) → ...
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path
from enum import Enum

logger = logging.getLogger(__name__)

WORKFLOW_STATE_FILE = "workflow_state.json"
ANNOTATIONS_DIR = os.environ.get("ANNOTATIONS_DIR", "annotations")


class WorkflowPhase(Enum):
    """워크플로우 단계"""

    COLD_START = 1  # Phase 1: LLM + SAM2 초기 레이블링
    DISTILLATION = 2  # Phase 2: YOLO 학습
    REFINEMENT = 3  # Phase 3: 자동 레이블링 + 검토


class WorkflowStateService:
    """
    워크플로우 상태 관리 서비스

    기능:
    - Iteration 카운트 추적
    - 현재 Phase 관리
    - 각 Iteration의 통계 저장
    - Phase 전환 로직
    """

    def __init__(self, state_file: str = None, annotations_dir: str = None):
        self.state_file = Path(state_file or WORKFLOW_STATE_FILE)
        self.annotations_dir = Path(annotations_dir or ANNOTATIONS_DIR)
        self.annotations_dir.mkdir(parents=True, exist_ok=True)
        self.state = self._load_state()

    def _load_state(self) -> Dict[str, Any]:
        """상태 로드"""
        if self.state_file.exists():
            try:
                with open(self.state_file, "r") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load workflow state: {e}")
        return self._default_state()

    def _default_state(self) -> Dict[str, Any]:
        """기본 상태"""
        return {
            "project_id": "default",
            "current_iteration": 0,
            "current_phase": WorkflowPhase.COLD_START.value,
            "phase_state": {
                "phase": WorkflowPhase.COLD_START.value,
                "started_at": datetime.now().isoformat(),
                "gate": {
                    "distillation_map_threshold": 0.7,
                    "refinement_confidence_threshold": 0.8,
                },
            },
            "iterations": [],
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

    def save_state(self):
        """상태 저장"""
        self.state["updated_at"] = datetime.now().isoformat()
        with open(self.state_file, "w") as f:
            json.dump(self.state, f, indent=2)
        logger.info(
            f"Workflow state saved: iteration {self.state['current_iteration']}, phase {self.state['current_phase']}"
        )

    def get_current_state(self) -> Dict[str, Any]:
        """현재 상태 조회"""
        # 동적으로 큐 상태 계산
        review_queue_size = self._get_review_queue_size()
        auto_label_queue_size = self._get_auto_label_queue_size()
        reviewed_since_last_train = self._get_reviewed_since_last_train()

        return {
            "project_id": self.state.get("project_id", "default"),
            "current_iteration": self.state.get("current_iteration", 0),
            "current_phase": self.state.get("current_phase", 1),
            "phase_state": self.state.get("phase_state", {}),
            "queues": {
                "review_queue_size": review_queue_size,
                "auto_label_queue_size": auto_label_queue_size,
                "reviewed_since_last_train": reviewed_since_last_train,
            },
            "training": self._get_training_state(),
            "iterations": self.state.get("iterations", [])[-5:],  # 최근 5개만
            "created_at": self.state.get("created_at"),
            "updated_at": self.state.get("updated_at"),
        }

    def _get_review_queue_size(self) -> int:
        count = 0
        if self.annotations_dir.exists():
            for f in self.annotations_dir.glob("*_coco.json"):
                try:
                    with open(f, "r", encoding="utf-8") as af:
                        data = json.load(af)
                        if data.get("metadata", {}).get("needs_review", False):
                            count += 1
                except Exception:
                    pass
        return count

    def _get_auto_label_queue_size(self) -> int:
        """자동 레이블 큐 크기"""
        queue_file = self.annotations_dir / "auto_label_queue.json"
        if queue_file.exists():
            try:
                with open(queue_file, "r") as f:
                    data = json.load(f)
                    return len(data.get("queue", []))
            except:
                pass
        return 0

    def _get_reviewed_since_last_train(self) -> int:
        """마지막 학습 이후 검토된 이미지 수"""
        history_file = self.annotations_dir / "review_history.json"
        if not history_file.exists():
            return 0

        try:
            with open(history_file, "r") as f:
                history = json.load(f)

            # 마지막 iteration의 학습 시간 이후의 검토 수
            last_train_time = None
            iterations = self.state.get("iterations", [])
            for it in reversed(iterations):
                if it.get("training", {}).get("completed_at"):
                    last_train_time = it["training"]["completed_at"]
                    break

            if not last_train_time:
                return len(history)

            count = 0
            for item in history:
                reviewed_at = item.get("reviewed_at", "")
                if reviewed_at > last_train_time:
                    count += 1

            return count
        except:
            return 0

    def _get_training_state(self) -> Dict[str, Any]:
        """학습 상태"""
        iterations = self.state.get("iterations", [])
        if not iterations:
            return {
                "active_job_id": None,
                "last_completed_job_id": None,
                "last_map70": None,
            }

        last_it = iterations[-1]
        training = last_it.get("training") or {}

        return {
            "active_job_id": training.get("job_id")
            if training.get("status") == "training"
            else None,
            "last_completed_job_id": training.get("job_id")
            if training.get("status") == "completed"
            else None,
            "last_map70": training.get("map70"),
        }

    def start_new_iteration(self, phase: int = None) -> Dict[str, Any]:
        """
        새 Iteration 시작

        논문: 순환 구조의 시작점
        """
        new_iteration = self.state["current_iteration"] + 1

        iteration_data = {
            "iteration_index": new_iteration,
            "started_at": datetime.now().isoformat(),
            "phase": phase or WorkflowPhase.DISTILLATION.value,
            "status": "active",
            "dataset": {
                "coco_filenames": [],
                "new_reviewed_count": self._get_reviewed_since_last_train(),
            },
            "training": None,
            "refinement": None,
        }

        self.state["iterations"].append(iteration_data)
        self.state["current_iteration"] = new_iteration
        self.state["current_phase"] = iteration_data["phase"]
        self.save_state()

        logger.info(f"Started new iteration: {new_iteration}")

        return iteration_data

    def update_iteration_training(
        self,
        job_id: str,
        model_name: str = None,
        status: str = "preparing",
        map70: float = None,
        coco_filenames: List[str] = None,
    ):
        """Iteration 학습 정보 업데이트"""
        iterations = self.state.get("iterations", [])
        if not iterations:
            logger.warning("No active iteration to update")
            return

        current = iterations[-1]

        if current["training"] is None:
            current["training"] = {}

        current["training"]["job_id"] = job_id
        current["training"]["status"] = status

        if model_name:
            current["training"]["model_name"] = model_name
        if map70 is not None:
            current["training"]["map70"] = map70
        if coco_filenames:
            current["dataset"]["coco_filenames"] = coco_filenames

        if status == "completed":
            current["training"]["completed_at"] = datetime.now().isoformat()
            # Phase 3으로 전환
            self.state["current_phase"] = WorkflowPhase.REFINEMENT.value

        self.save_state()

    def update_iteration_refinement(
        self, auto_labeled: int, needs_review: int, confidence_threshold: float = 0.8
    ):
        """Iteration Refinement 정보 업데이트"""
        iterations = self.state.get("iterations", [])
        if not iterations:
            return

        current = iterations[-1]
        total = auto_labeled + needs_review

        current["refinement"] = {
            "confidence_threshold": confidence_threshold,
            "auto_labeled": auto_labeled,
            "needs_review": needs_review,
            "auto_ratio": auto_labeled / total if total > 0 else 0,
            "updated_at": datetime.now().isoformat(),
        }

        self.save_state()

    def complete_iteration(self):
        """현재 Iteration 완료"""
        iterations = self.state.get("iterations", [])
        if iterations:
            iterations[-1]["status"] = "completed"
            iterations[-1]["completed_at"] = datetime.now().isoformat()
            self.save_state()

    def get_iteration_history(self, limit: int = None) -> List[Dict[str, Any]]:
        """Iteration 히스토리 조회"""
        iterations = self.state.get("iterations", [])
        if limit:
            return iterations[-limit:]
        return iterations

    def get_automation_trend(self) -> Dict[str, Any]:
        """
        자동화 비율 추이

        논문: "모델이 개선됨에 따라 자동 레이블링의 정확도가 향상되고,
              사용자가 직접 개입해야 하는 객체의 수가 감소"
        """
        iterations = self.state.get("iterations", [])

        trend = []
        for it in iterations:
            refinement = it.get("refinement") or {}
            training = it.get("training") or {}

            trend.append(
                {
                    "iteration": it.get("iteration_index"),
                    "auto_ratio": refinement.get("auto_ratio", 0),
                    "map70": training.get("map70"),
                    "started_at": it.get("started_at"),
                }
            )

        # 개선율 계산
        improvement = None
        if len(trend) >= 2:
            first_ratio = trend[0].get("auto_ratio", 0)
            last_ratio = trend[-1].get("auto_ratio", 0)
            if first_ratio > 0:
                improvement = (last_ratio - first_ratio) / first_ratio * 100

        return {
            "trend": trend,
            "total_iterations": len(iterations),
            "improvement_percent": improvement,
            "message": self._get_trend_message(trend),
        }

    def _get_trend_message(self, trend: List[Dict]) -> str:
        """추이 메시지 생성"""
        if not trend:
            return "No iterations completed yet."

        if len(trend) == 1:
            ratio = trend[0].get("auto_ratio", 0) * 100
            return f"First iteration completed with {ratio:.1f}% automation."

        first_ratio = trend[0].get("auto_ratio", 0) * 100
        last_ratio = trend[-1].get("auto_ratio", 0) * 100

        if last_ratio > first_ratio:
            return f"Automation improved from {first_ratio:.1f}% to {last_ratio:.1f}% over {len(trend)} iterations."
        elif last_ratio < first_ratio:
            return f"Automation decreased from {first_ratio:.1f}% to {last_ratio:.1f}%. Consider reviewing data quality."
        else:
            return (
                f"Automation stable at {last_ratio:.1f}% over {len(trend)} iterations."
            )

    def get_next_action(self) -> Dict[str, Any]:
        """
        다음 권장 액션 반환

        현재 상태를 기반으로 사용자가 취해야 할 다음 액션 제안
        """
        current_phase = self.state.get("current_phase", 1)
        iterations = self.state.get("iterations", [])

        review_queue_size = self._get_review_queue_size()
        reviewed_count = self._get_reviewed_since_last_train()

        # Phase 1: Cold-start
        if current_phase == 1:
            return {
                "phase": 1,
                "action": "label_initial_data",
                "title": "Label Initial Data",
                "description": "Use SAM/Gemini to create initial labels for training data.",
                "cta": "Go to Labeling",
                "route": "/gallery",
            }

        # Phase 2: Distillation
        if current_phase == 2:
            if (
                iterations
                and (iterations[-1].get("training") or {}).get("status") == "training"
            ):
                return {
                    "phase": 2,
                    "action": "wait_training",
                    "title": "Training in Progress",
                    "description": "YOLO model is being trained. Please wait.",
                    "cta": "View Progress",
                    "route": "/training/monitor",
                }

            return {
                "phase": 2,
                "action": "start_training",
                "title": "Start Training",
                "description": f"Ready to train with {reviewed_count} reviewed images.",
                "cta": "Start Training",
                "route": "/training",
            }

        # Phase 3: Refinement
        if current_phase == 3:
            if review_queue_size > 0:
                return {
                    "phase": 3,
                    "action": "review_images",
                    "title": f"Review {review_queue_size} Images",
                    "description": "Images with low confidence need human review.",
                    "cta": "Start Review",
                    "route": "/gallery?filter=needs-review",
                }

            # 검토 완료 데이터가 충분하면 재학습 제안
            threshold = (
                self.state.get("phase_state", {})
                .get("gate", {})
                .get("distillation_data_threshold", 50)
            )
            if reviewed_count >= threshold:
                return {
                    "phase": 3,
                    "action": "retrain",
                    "title": "Ready for Re-training",
                    "description": f"{reviewed_count} reviewed images available. Start new training iteration?",
                    "cta": "Start Re-training",
                    "route": "/training",
                }

            return {
                "phase": 3,
                "action": "auto_label_more",
                "title": "Run Auto-Labeling",
                "description": "Use trained model to auto-label more images.",
                "cta": "Auto-Label",
                "route": "/gallery",
            }

        return {
            "phase": current_phase,
            "action": "unknown",
            "title": "Continue Working",
            "description": "Continue with the labeling workflow.",
            "cta": "Go to Dashboard",
            "route": "/",
        }

    def set_phase(self, phase: int):
        """Phase 수동 설정"""
        if phase not in [1, 2, 3]:
            raise ValueError(f"Invalid phase: {phase}")

        self.state["current_phase"] = phase
        self.state["phase_state"]["phase"] = phase
        self.state["phase_state"]["started_at"] = datetime.now().isoformat()
        self.save_state()

        logger.info(f"Phase manually set to: {phase}")


# 싱글톤 인스턴스
_workflow_state_instance = None


def get_workflow_state_service(
    state_file: str = None, annotations_dir: str = None
) -> WorkflowStateService:
    """워크플로우 상태 서비스 싱글톤"""
    global _workflow_state_instance
    if _workflow_state_instance is None:
        _workflow_state_instance = WorkflowStateService(state_file, annotations_dir)
    return _workflow_state_instance


def reset_workflow_state_service():
    """서비스 리셋"""
    global _workflow_state_instance
    _workflow_state_instance = None
