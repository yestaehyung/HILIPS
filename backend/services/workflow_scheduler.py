"""
HILIPS Workflow Scheduler
자동화 워크플로우 스케줄러

论文 2.2.3 Iterative Refinement 자동화:
- 정기적인 auto-annotate 실행
- 모델 재학습 트리거
- 성능 모니터링
"""
import os
import json
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Callable
from pathlib import Path
from enum import Enum

logger = logging.getLogger(__name__)

# 경로 설정
WORKFLOW_CONFIG_FILE = 'workflow_config.json'


class WorkflowStatus(Enum):
    """워크플로우 상태"""
    IDLE = "idle"
    RUNNING = "running"
    SCHEDULED = "scheduled"
    ERROR = "error"


class WorkflowScheduler:
    """
    자동화 워크플로우 스케줄러
    
    기능:
    - 정기적인 auto-annotate 스케줄링
    - 모델 재학습 자동 트리거
    - 성능 모니터링 및 알림
    """
    
    def __init__(self, config_file: str = None):
        self.config_file = config_file or WORKFLOW_CONFIG_FILE
        self.config = self._load_config()
        self.status = WorkflowStatus.IDLE
        self.scheduled_jobs = {}
        self.running_jobs = {}
        self._scheduler_thread = None
        self._stop_event = threading.Event()
        
        # 콜백 함수들
        self.on_auto_annotate: Optional[Callable] = None
        self.on_distillation: Optional[Callable] = None
        self.on_evaluation: Optional[Callable] = None
        self.on_alert: Optional[Callable] = None
    
    def _load_config(self) -> Dict[str, Any]:
        """설정 로드"""
        if Path(self.config_file).exists():
            try:
                with open(self.config_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load config: {e}")
        return self._default_config()
    
    def _default_config(self) -> Dict[str, Any]:
        """기본 설정"""
        return {
            'auto_annotate': {
                'enabled': True,
                'interval_hours': 24,
                'confidence_threshold': 0.8,
                'models': ['latest_production']
            },
            'distillation': {
                'enabled': True,
                'trigger': 'scheduled',  # 'scheduled' or 'data_accumulated'
                'data_threshold': 100,  # 이미지 수 기준 재학습
                'interval_days': 7
            },
            'evaluation': {
                'enabled': True,
                'interval_hours': 6,
                'map_threshold': 0.7
            },
            'notifications': {
                'enabled': True,
                'channels': ['log']  # 'log', 'email', 'webhook'
            }
        }
    
    def save_config(self):
        """설정 저장"""
        with open(self.config_file, 'w') as f:
            json.dump(self.config, f, indent=2)
        logger.info(f"Config saved: {self.config_file}")
    
    def start(self):
        """스케줄러 시작"""
        if self.status == WorkflowStatus.RUNNING:
            logger.warning("Scheduler already running")
            return
        
        self.status = WorkflowStatus.RUNNING
        self._stop_event.clear()
        self._scheduler_thread = threading.Thread(target=self._run_scheduler, daemon=True)
        self._scheduler_thread.start()
        logger.info("Workflow scheduler started")
    
    def stop(self):
        """스케줄러 중지"""
        self.status = WorkflowStatus.IDLE
        self._stop_event.set()
        if self._scheduler_thread:
            self._scheduler_thread.join(timeout=5)
        logger.info("Workflow scheduler stopped")
    
    def _run_scheduler(self):
        """스케줄러 메인 루프"""
        last_runs = {
            'auto_annotate': datetime.now(),
            'distillation': datetime.now(),
            'evaluation': datetime.now()
        }
        
        while not self._stop_event.is_set():
            try:
                now = datetime.now()
                
                # Auto-annotate 체크
                if self.config.get('auto_annotate', {}).get('enabled', False):
                    interval = self.config['auto_annotate'].get('interval_hours', 24)
                    if now - last_runs['auto_annotate'] > timedelta(hours=interval):
                        self._run_auto_annotate()
                        last_runs['auto_annotate'] = now
                
                # Evaluation 체크
                if self.config.get('evaluation', {}).get('enabled', False):
                    interval = self.config['evaluation'].get('interval_hours', 6)
                    if now - last_runs['evaluation'] > timedelta(hours=interval):
                        self._run_evaluation()
                        last_runs['evaluation'] = now
                
                # Distillation 체크
                if self.config.get('distillation', {}).get('enabled', False):
                    trigger = self.config['distillation'].get('trigger', 'scheduled')
                    if trigger == 'scheduled':
                        interval = self.config['distillation'].get('interval_days', 7)
                        if now - last_runs['distillation'] > timedelta(days=interval):
                            self._run_distillation()
                            last_runs['distillation'] = now
                
                # 슬립
                time.sleep(60)  # 1분마다 체크
                
            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                self.status = WorkflowStatus.ERROR
                break
    
    def _run_auto_annotate(self):
        """Auto-annotate 실행"""
        job_id = f"auto_annotate_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            self.running_jobs[job_id] = {
                'type': 'auto_annotate',
                'started_at': datetime.now().isoformat(),
                'status': 'running'
            }
            
            logger.info(f"Starting auto-annotate job: {job_id}")
            
            if self.on_auto_annotate:
                result = self.on_auto_annotate(self.config.get('auto_annotate', {}))
                self.running_jobs[job_id]['result'] = result
            
            self.running_jobs[job_id]['status'] = 'completed'
            self.running_jobs[job_id]['completed_at'] = datetime.now().isoformat()
            
            logger.info(f"Auto-annotate job completed: {job_id}")
            
        except Exception as e:
            logger.error(f"Auto-annotate job failed: {e}")
            self.running_jobs[job_id]['status'] = 'error'
            self.running_jobs[job_id]['error'] = str(e)
            self._send_alert('auto_annotate_failed', str(e))
    
    def _run_evaluation(self):
        """Evaluation 실행"""
        job_id = f"evaluation_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            self.running_jobs[job_id] = {
                'type': 'evaluation',
                'started_at': datetime.now().isoformat(),
                'status': 'running'
            }
            
            logger.info(f"Starting evaluation job: {job_id}")
            
            if self.on_evaluation:
                result = self.on_evaluation(self.config.get('evaluation', {}))
                self.running_jobs[job_id]['result'] = result
                
                # mAP threshold 체크
                map_threshold = self.config.get('evaluation', {}).get('map_threshold', 0.7)
                if result.get('current_map', 0) < map_threshold:
                    self._send_alert('map_below_threshold', 
                                   f"Current mAP {result.get('current_map', 0):.3f} < {map_threshold}")
            
            self.running_jobs[job_id]['status'] = 'completed'
            self.running_jobs[job_id]['completed_at'] = datetime.now().isoformat()
            
            logger.info(f"Evaluation job completed: {job_id}")
            
        except Exception as e:
            logger.error(f"Evaluation job failed: {e}")
            self.running_jobs[job_id]['status'] = 'error'
            self.running_jobs[job_id]['error'] = str(e)
    
    def _run_distillation(self):
        """Knowledge Distillation 실행"""
        job_id = f"distillation_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            self.running_jobs[job_id] = {
                'type': 'distillation',
                'started_at': datetime.now().isoformat(),
                'status': 'running'
            }
            
            logger.info(f"Starting distillation job: {job_id}")
            
            if self.on_distillation:
                result = self.on_distillation(self.config.get('distillation', {}))
                self.running_jobs[job_id]['result'] = result
            
            self.running_jobs[job_id]['status'] = 'completed'
            self.running_jobs[job_id]['completed_at'] = datetime.now().isoformat()
            
            logger.info(f"Distillation job completed: {job_id}")
            
        except Exception as e:
            logger.error(f"Distillation job failed: {e}")
            self.running_jobs[job_id]['status'] = 'error'
            self.running_jobs[job_id]['error'] = str(e)
            self._send_alert('distillation_failed', str(e))
    
    def _send_alert(self, alert_type: str, message: str):
        """알림 전송"""
        alert_data = {
            'type': alert_type,
            'message': message,
            'timestamp': datetime.now().isoformat()
        }
        
        logger.warning(f"ALERT [{alert_type}]: {message}")
        
        if self.on_alert:
            self.on_alert(alert_data)
        
        # 설정된 채널로 알림
        for channel in self.config.get('notifications', {}).get('channels', []):
            if channel == 'log':
                pass  # 이미 로그됨
            # 다른 채널들은 확장 가능
    
    def trigger_auto_annotate(self) -> str:
        """수동 auto-annotate 트리거"""
        job_id = f"manual_annotate_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        threading.Thread(target=self._run_auto_annotate, kwargs={'job_id': job_id}).start()
        return job_id
    
    def trigger_distillation(self) -> str:
        """수동 distillation 트리거"""
        job_id = f"manual_distillation_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        threading.Thread(target=self._run_distillation, kwargs={'job_id': job_id}).start()
        return job_id
    
    def get_status(self) -> Dict[str, Any]:
        """스케줄러 상태"""
        return {
            'status': self.status.value,
            'config': self.config,
            'scheduled_jobs': len(self.scheduled_jobs),
            'running_jobs': len(self.running_jobs),
            'recent_jobs': list(self.running_jobs.items())[-5:]  # 최근 5개
        }
    
    def update_config(self, new_config: Dict[str, Any]):
        """설정 업데이트"""
        self.config.update(new_config)
        self.save_config()
        logger.info("Config updated")


# 싱글톤 인스턴스
_scheduler_instance = None

def get_scheduler(config_file: str = None) -> WorkflowScheduler:
    """스케줄러 싱글톤"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = WorkflowScheduler(config_file)
    return _scheduler_instance


def reset_scheduler():
    """스케줄러 리셋"""
    global _scheduler_instance
    if _scheduler_instance:
        _scheduler_instance.stop()
    _scheduler_instance = None
