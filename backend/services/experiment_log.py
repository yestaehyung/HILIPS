"""
HILIPS Experiment Logging Service
File-based experiment logging for research paper metrics

Metrics tracked:
- mAP@0.5: Model quality (Ground Truth vs Prediction)
- Automation Rate: Auto-approved objects / Total objects
- Review per Image: User-reviewed objects per image
- Time per Image: Labeling time per image

Storage: Event-per-file (atomic, concurrency-safe)
"""

import os
import json
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path
from enum import Enum

logger = logging.getLogger(__name__)

# Directory structure: experiments/{experiment_id}/events/{iteration}/{date}/
EXPERIMENTS_DIR = os.environ.get("EXPERIMENTS_DIR", "experiments")


class LabelingMethod(Enum):
    """Labeling method sources"""

    MANUAL = "manual"
    SAM_POINT = "sam_point"
    SAM_LLM = "sam_llm"  # Gemini + SAM
    AUTO_MODEL = "auto_model"  # YOLO inference


class UserAction(Enum):
    """User action on objects"""

    APPROVED = "approved"  # User accepted as-is
    MODIFIED = "modified"  # User edited the annotation
    ADDED = "added"  # User created from scratch
    DELETED = "deleted"  # User removed the annotation


class ExperimentLogService:
    """
    Experiment logging service with event-per-file atomic writes

    File structure:
    experiments/
      {experiment_id}/
        manifest.json           # Experiment metadata
        events/
          {iteration}/
            {date}/
              {timestamp}_{uuid}.json  # Individual events
        summaries/
          iteration_{n}.json    # Computed summaries
    """

    def __init__(self, experiments_dir: Optional[str] = None):
        self.experiments_dir = Path(experiments_dir or EXPERIMENTS_DIR)
        self.experiments_dir.mkdir(parents=True, exist_ok=True)

    def create_experiment(
        self,
        experiment_id: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        test_set_id: Optional[str] = None,
        confidence_threshold: float = 0.8,
    ) -> Dict[str, Any]:
        """
        Create a new experiment

        Args:
            experiment_id: Optional ID (auto-generated if not provided)
            name: Human-readable experiment name
            description: Experiment description
            test_set_id: ID of test set for mAP evaluation
            confidence_threshold: Threshold for auto-approval
        """
        if not experiment_id:
            experiment_id = f"exp_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        exp_dir = self.experiments_dir / experiment_id
        exp_dir.mkdir(parents=True, exist_ok=True)

        manifest = {
            "experiment_id": experiment_id,
            "name": name or experiment_id,
            "description": description or "",
            "test_set_id": test_set_id,
            "confidence_threshold": confidence_threshold,
            "current_iteration": 0,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "status": "active",
        }

        manifest_path = exp_dir / "manifest.json"
        self._atomic_write(manifest_path, manifest)

        # Create events and summaries directories
        (exp_dir / "events").mkdir(exist_ok=True)
        (exp_dir / "summaries").mkdir(exist_ok=True)

        logger.info(f"Created experiment: {experiment_id}")
        return manifest

    def get_experiment(self, experiment_id: str) -> Optional[Dict[str, Any]]:
        """Get experiment manifest"""
        manifest_path = self.experiments_dir / experiment_id / "manifest.json"
        if not manifest_path.exists():
            return None

        try:
            with open(manifest_path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load experiment {experiment_id}: {e}")
            return None

    def list_experiments(self) -> List[Dict[str, Any]]:
        """List all experiments"""
        experiments = []

        if not self.experiments_dir.exists():
            return experiments

        for exp_dir in self.experiments_dir.iterdir():
            if exp_dir.is_dir():
                manifest = self.get_experiment(exp_dir.name)
                if manifest:
                    experiments.append(manifest)

        # Sort by created_at descending
        experiments.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return experiments

    def delete_experiment(self, experiment_id: str) -> bool:
        import shutil

        exp_dir = self.experiments_dir / experiment_id
        if not exp_dir.exists():
            return False

        try:
            shutil.rmtree(exp_dir)
            logger.info(f"Deleted experiment: {experiment_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete experiment {experiment_id}: {e}")
            return False

    def start_iteration(self, experiment_id: str) -> Dict[str, Any]:
        """
        Start a new iteration within an experiment

        Returns iteration info with index
        """
        manifest = self.get_experiment(experiment_id)
        if not manifest:
            raise ValueError(f"Experiment not found: {experiment_id}")

        new_iteration = manifest["current_iteration"] + 1
        manifest["current_iteration"] = new_iteration
        manifest["updated_at"] = datetime.now().isoformat()

        manifest_path = self.experiments_dir / experiment_id / "manifest.json"
        self._atomic_write(manifest_path, manifest)

        # Create iteration events directory
        iteration_dir = (
            self.experiments_dir / experiment_id / "events" / str(new_iteration)
        )
        iteration_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Started iteration {new_iteration} for experiment {experiment_id}")

        return {
            "experiment_id": experiment_id,
            "iteration": new_iteration,
            "started_at": datetime.now().isoformat(),
        }

    def log_labeling_event(
        self,
        experiment_id: str,
        iteration: int,
        image_id: str,
        objects: List[Dict[str, Any]],
        time_seconds: float,
        labeling_method: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Log a labeling event (one image save)

        Args:
            experiment_id: Experiment ID
            iteration: Iteration number
            image_id: Image filename
            objects: List of object annotations with tracking info
                [{
                    "id": "polygon-123",
                    "class": "DOOR",
                    "source": "auto_model",  # manual/sam_point/sam_llm/auto_model
                    "confidence": 0.92,
                    "user_action": "approved",  # approved/modified/added/deleted
                    "bbox": [x, y, w, h],
                    "area": 1234
                }]
            time_seconds: Time spent on this image
            labeling_method: Primary labeling method used
            metadata: Additional metadata

        Returns:
            Event record
        """
        # Validate experiment exists
        manifest = self.get_experiment(experiment_id)
        if not manifest:
            raise ValueError(f"Experiment not found: {experiment_id}")

        # Calculate statistics
        total_objects = len(objects)
        auto_approved = sum(
            1
            for obj in objects
            if obj.get("source") == "auto_model"
            and obj.get("user_action") == "approved"
            and obj.get("confidence", 0) >= manifest.get("confidence_threshold", 0.8)
        )
        user_reviewed = sum(
            1 for obj in objects if obj.get("user_action") in ("modified", "approved")
        )
        user_modified = sum(
            1 for obj in objects if obj.get("user_action") == "modified"
        )
        user_added = sum(1 for obj in objects if obj.get("user_action") == "added")

        # Create event record
        event_id = f"{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{uuid.uuid4().hex[:8]}"
        event = {
            "event_id": event_id,
            "experiment_id": experiment_id,
            "iteration": iteration,
            "image_id": image_id,
            "timestamp": datetime.now().isoformat(),
            "time_seconds": time_seconds,
            "labeling_method": labeling_method,
            "statistics": {
                "total_objects": total_objects,
                "auto_approved": auto_approved,
                "user_reviewed": user_reviewed,
                "user_modified": user_modified,
                "user_added": user_added,
                "automation_rate": auto_approved / total_objects
                if total_objects > 0
                else 0,
            },
            "objects": objects,
            "metadata": metadata or {},
        }

        # Write event file atomically
        date_str = datetime.now().strftime("%Y-%m-%d")
        event_dir = (
            self.experiments_dir / experiment_id / "events" / str(iteration) / date_str
        )
        event_dir.mkdir(parents=True, exist_ok=True)

        event_file = event_dir / f"{event_id}.json"
        self._atomic_write(event_file, event)

        logger.info(
            f"Logged event {event_id} for image {image_id} in iteration {iteration}"
        )

        return event

    def get_iteration_summary(
        self,
        experiment_id: str,
        iteration: int,
        force_recompute: bool = False,
    ) -> Dict[str, Any]:
        """
        Get or compute iteration summary

        Returns:
            {
                "iteration": 1,
                "images": 50,
                "auto_rate": 0.65,
                "review_per_image": 1.05,
                "time_per_image": 18.5,
                "total_objects": 150,
                "auto_approved": 97,
                "user_modified": 30,
                "user_added": 23,
            }
        """
        summary_path = (
            self.experiments_dir
            / experiment_id
            / "summaries"
            / f"iteration_{iteration}.json"
        )

        # Return cached if exists and not forcing recompute
        if summary_path.exists() and not force_recompute:
            try:
                with open(summary_path, "r") as f:
                    return json.load(f)
            except Exception:
                pass

        # Compute summary from events
        events = self._list_iteration_events(experiment_id, iteration)

        if not events:
            return {
                "iteration": iteration,
                "images": 0,
                "auto_rate": 0,
                "review_per_image": 0,
                "time_per_image": 0,
                "total_objects": 0,
                "auto_approved": 0,
                "user_reviewed": 0,
                "user_modified": 0,
                "user_added": 0,
                "computed_at": datetime.now().isoformat(),
            }

        total_images = len(events)
        total_objects = sum(e["statistics"]["total_objects"] for e in events)
        total_auto_approved = sum(e["statistics"]["auto_approved"] for e in events)
        total_user_reviewed = sum(e["statistics"]["user_reviewed"] for e in events)
        total_user_modified = sum(e["statistics"]["user_modified"] for e in events)
        total_user_added = sum(e["statistics"]["user_added"] for e in events)
        total_time = sum(e["time_seconds"] for e in events)

        summary = {
            "iteration": iteration,
            "images": total_images,
            "auto_rate": total_auto_approved / total_objects
            if total_objects > 0
            else 0,
            "review_per_image": total_user_reviewed / total_images
            if total_images > 0
            else 0,
            "time_per_image": total_time / total_images if total_images > 0 else 0,
            "total_time_seconds": total_time,
            "total_objects": total_objects,
            "auto_approved": total_auto_approved,
            "user_reviewed": total_user_reviewed,
            "user_modified": total_user_modified,
            "user_added": total_user_added,
            "computed_at": datetime.now().isoformat(),
        }

        # Cache the summary
        self._atomic_write(summary_path, summary)

        return summary

    def get_all_iteration_summaries(
        self,
        experiment_id: str,
        force_recompute: bool = False,
    ) -> List[Dict[str, Any]]:
        """Get summaries for all iterations"""
        manifest = self.get_experiment(experiment_id)
        if not manifest:
            return []

        summaries = []
        for i in range(manifest["current_iteration"] + 1):
            summary = self.get_iteration_summary(experiment_id, i, force_recompute)
            if summary["images"] > 0:  # Only include iterations with data
                summaries.append(summary)

        return summaries

    def export_experiment_data(
        self,
        experiment_id: str,
        format: str = "json",  # json or csv
    ) -> Dict[str, Any]:
        """
        Export experiment data for analysis

        Returns:
            {
                "experiment": manifest,
                "iterations": [summaries],
                "events": [all events],
            }
        """
        manifest = self.get_experiment(experiment_id)
        if not manifest:
            raise ValueError(f"Experiment not found: {experiment_id}")

        summaries = self.get_all_iteration_summaries(experiment_id)

        # Collect all events
        all_events = []
        for i in range(manifest["current_iteration"] + 1):
            events = self._list_iteration_events(experiment_id, i)
            all_events.extend(events)

        export_data = {
            "experiment": manifest,
            "iterations": summaries,
            "events": all_events,
            "exported_at": datetime.now().isoformat(),
        }

        if format == "csv":
            return self._convert_to_csv_format(export_data)

        return export_data

    def _list_iteration_events(
        self,
        experiment_id: str,
        iteration: int,
    ) -> List[Dict[str, Any]]:
        """List all events for an iteration"""
        events_dir = self.experiments_dir / experiment_id / "events" / str(iteration)

        if not events_dir.exists():
            return []

        events = []
        for date_dir in events_dir.iterdir():
            if date_dir.is_dir():
                for event_file in date_dir.glob("*.json"):
                    try:
                        with open(event_file, "r") as f:
                            events.append(json.load(f))
                    except Exception as e:
                        logger.warning(f"Failed to load event {event_file}: {e}")

        # Sort by timestamp
        events.sort(key=lambda x: x.get("timestamp", ""))
        return events

    def _atomic_write(self, path: Path, data: Dict[str, Any]):
        """Write file atomically using temp file + rename"""
        temp_path = path.with_suffix(".tmp")
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)

    def _convert_to_csv_format(self, export_data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert export data to CSV-friendly format"""
        # Iteration summary CSV
        iteration_rows = []
        for summary in export_data["iterations"]:
            iteration_rows.append(
                {
                    "iteration": summary["iteration"],
                    "images": summary["images"],
                    "auto_rate": round(summary["auto_rate"], 4),
                    "review_per_image": round(summary["review_per_image"], 2),
                    "time_per_image": round(summary["time_per_image"], 2),
                    "total_objects": summary["total_objects"],
                    "auto_approved": summary["auto_approved"],
                    "user_modified": summary["user_modified"],
                    "user_added": summary["user_added"],
                }
            )

        # Event-level CSV
        event_rows = []
        for event in export_data["events"]:
            event_rows.append(
                {
                    "event_id": event["event_id"],
                    "iteration": event["iteration"],
                    "image_id": event["image_id"],
                    "timestamp": event["timestamp"],
                    "time_seconds": event["time_seconds"],
                    "total_objects": event["statistics"]["total_objects"],
                    "auto_approved": event["statistics"]["auto_approved"],
                    "user_reviewed": event["statistics"]["user_reviewed"],
                    "user_modified": event["statistics"]["user_modified"],
                    "user_added": event["statistics"]["user_added"],
                    "automation_rate": round(event["statistics"]["automation_rate"], 4),
                }
            )

        return {
            "experiment": export_data["experiment"],
            "iteration_csv": iteration_rows,
            "event_csv": event_rows,
            "exported_at": export_data["exported_at"],
        }


# Singleton instance
_experiment_log_instance = None


def get_experiment_log_service(
    experiments_dir: Optional[str] = None,
) -> ExperimentLogService:
    """Get experiment log service singleton"""
    global _experiment_log_instance
    if _experiment_log_instance is None:
        _experiment_log_instance = ExperimentLogService(experiments_dir)
    return _experiment_log_instance


def reset_experiment_log_service():
    """Reset service (for testing)"""
    global _experiment_log_instance
    _experiment_log_instance = None
