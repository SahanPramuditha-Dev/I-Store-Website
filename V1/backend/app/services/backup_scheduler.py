import logging

import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import settings
from app.database import SessionLocal
from app.services.backup_service import create_backup

logger = logging.getLogger("istore.api")

_scheduler = None


def _scheduled_backup_job():
    logger.info("=== SCHEDULED BACKUP JOB STARTED ===")
    try:
        with SessionLocal() as db:
            result = create_backup(db, is_auto=True, trigger="scheduled")
        logger.info(f"=== SCHEDULED BACKUP JOB COMPLETED: {result.get('status')} ===")
    except Exception as exc:
        logger.error(f"=== SCHEDULED BACKUP JOB FAILED: {exc} ===")


def init_backup_scheduler():
    global _scheduler
    if _scheduler is not None:
        logger.warning("Backup scheduler already initialized")
        return
    if not settings.backup_schedule_enabled:
        logger.info("Backup scheduler is disabled (BACKUP_SCHEDULE_ENABLED=false)")
        return

    try:
        _scheduler = BackgroundScheduler()
        try:
            tz = pytz.timezone(settings.backup_schedule_timezone)
        except Exception:
            logger.warning(f"Invalid timezone '{settings.backup_schedule_timezone}', defaulting to UTC")
            tz = pytz.UTC

        _scheduler.add_job(
            _scheduled_backup_job,
            CronTrigger(
                hour=settings.backup_schedule_hour,
                minute=settings.backup_schedule_minute,
                timezone=tz,
            ),
            id="daily_backup",
            name="Daily Backup",
            replace_existing=True,
        )
        _scheduler.start()
        logger.info(
            "Backup scheduler started at "
            f"{settings.backup_schedule_hour:02d}:{settings.backup_schedule_minute:02d} ({settings.backup_schedule_timezone})"
        )
    except Exception as exc:
        logger.error(f"Failed to initialize backup scheduler: {exc}")


def shutdown_backup_scheduler():
    global _scheduler
    if _scheduler is None:
        return
    try:
        _scheduler.shutdown(wait=False)
    finally:
        _scheduler = None
    logger.info("Backup scheduler shut down successfully")


def get_scheduler():
    return _scheduler
