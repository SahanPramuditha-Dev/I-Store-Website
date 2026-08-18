import json
import logging
from datetime import datetime, timezone

import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import AppSetting
from app.services.backup_service import (
    LAST_BACKUP_KEY,
    LAST_VERIFIED_BACKUP_KEY,
    create_backup,
    is_backup_in_progress,
)

logger = logging.getLogger("istore.api")

_scheduler = None


def _parse_db_backup_config(db: Session) -> dict:
    """Reads configured backup settings from the database (AppSetting) with fallback to config.py."""
    config = {
        "enabled": bool(settings.backup_schedule_enabled),
        "hour": int(settings.backup_schedule_hour),
        "minute": int(settings.backup_schedule_minute),
        "timezone": str(settings.backup_schedule_timezone or "UTC"),
        "frequency": "Daily",
        "retention_days": 90,
    }
    try:
        row = db.query(AppSetting).filter(AppSetting.key == "backup_data").first()
        if row and row.value:
            data = json.loads(row.value)
            auto = data.get("auto_backup", {}) if isinstance(data, dict) else {}
            if "enable_automatic_backup" in auto:
                config["enabled"] = bool(auto["enable_automatic_backup"])
            if "backup_time" in auto and isinstance(auto["backup_time"], str) and ":" in auto["backup_time"]:
                parts = auto["backup_time"].split(":")
                config["hour"] = int(parts[0])
                config["minute"] = int(parts[1])
            if "backup_frequency" in auto:
                config["frequency"] = str(auto["backup_frequency"])
            if "backup_retention_days" in auto:
                config["retention_days"] = int(auto["backup_retention_days"])
    except Exception as exc:
        logger.warning(f"Error parsing database backup settings: {exc}")
    return config


def _scheduled_backup_job():
    logger.info("=== SCHEDULED BACKUP JOB STARTED ===")
    try:
        with SessionLocal() as db:
            result = create_backup(db, is_auto=True, trigger="scheduled")
        logger.info(f"=== SCHEDULED BACKUP JOB COMPLETED: {result.get('status')}, verified={result.get('verified')} ===")
    except Exception as exc:
        logger.error(f"=== SCHEDULED BACKUP JOB FAILED: {exc} ===")


def _watchdog_backup_job():
    """Watchdog job executed every 30 minutes to detect missed scheduled backups

    (e.g., when the machine was suspended or powered down during the scheduled cron window).
    """
    if is_backup_in_progress():
        logger.debug("Backup watchdog skipped: another backup is currently in progress.")
        return

    try:
        with SessionLocal() as db:
            cfg = _parse_db_backup_config(db)
            if not cfg.get("enabled"):
                return

            row = db.query(AppSetting).filter(AppSetting.key == LAST_VERIFIED_BACKUP_KEY).first()
            if not row or not row.value:
                row = db.query(AppSetting).filter(AppSetting.key == LAST_BACKUP_KEY).first()

            last_dt = None
            if row and row.value:
                try:
                    val = str(row.value).strip().replace("Z", "+00:00")
                    last_dt = datetime.fromisoformat(val)
                    if last_dt.tzinfo is not None:
                        last_dt = last_dt.astimezone(timezone.utc).replace(tzinfo=None)
                except Exception:
                    last_dt = None

            now = datetime.now(timezone.utc).replace(tzinfo=None)
            # Threshold based on frequency
            freq = str(cfg.get("frequency", "Daily")).lower()
            max_age_hours = 168.0 if "week" in freq else 12.0 if "twice" in freq else 6.0 if "6" in freq else 24.0

            if last_dt is None or (now - last_dt).total_seconds() > (max_age_hours * 3600):
                logger.info(f"Watchdog detected overdue backup (last verified: {last_dt}). Triggering recovery backup.")
                create_backup(db, is_auto=True, trigger="watchdog_catchup")
    except Exception as exc:
        logger.error(f"Watchdog backup job error: {exc}")


def _build_cron_trigger(cfg: dict) -> CronTrigger:
    try:
        tz = pytz.timezone(cfg.get("timezone", "UTC"))
    except Exception:
        tz = pytz.UTC

    hour = cfg.get("hour", 23)
    minute = cfg.get("minute", 59)
    freq = str(cfg.get("frequency", "Daily")).lower()

    if "week" in freq:
        return CronTrigger(day_of_week="sun", hour=hour, minute=minute, timezone=tz)
    elif "twice" in freq:
        # e.g., 02:00 and 14:00
        hour2 = (hour + 12) % 24
        return CronTrigger(hour=f"{hour},{hour2}", minute=minute, timezone=tz)
    elif "6" in freq:
        return CronTrigger(hour="0,6,12,18", minute=minute, timezone=tz)
    return CronTrigger(hour=hour, minute=minute, timezone=tz)


def init_backup_scheduler():
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        logger.warning("Backup scheduler already initialized and running")
        return

    try:
        with SessionLocal() as db:
            cfg = _parse_db_backup_config(db)

        _scheduler = BackgroundScheduler()
        if cfg.get("enabled"):
            _scheduler.add_job(
                _scheduled_backup_job,
                _build_cron_trigger(cfg),
                id="daily_backup",
                name="Automated Backup Job",
                replace_existing=True,
            )

        # Register watchdog job every 30 minutes
        _scheduler.add_job(
            _watchdog_backup_job,
            IntervalTrigger(minutes=30),
            id="backup_watchdog",
            name="Backup Health Watchdog",
            replace_existing=True,
        )

        _scheduler.start()
        logger.info(f"Backup scheduler started successfully. Enabled: {cfg.get('enabled')}, Time: {cfg.get('hour'):02d}:{cfg.get('minute'):02d}")
    except Exception as exc:
        logger.error(f"Failed to initialize backup scheduler: {exc}")


def reload_backup_scheduler(db: Session | None = None) -> dict:
    """Dynamically reloads scheduler job triggers based on updated database settings

    without requiring a server restart.
    """
    global _scheduler
    if _scheduler is None or not _scheduler.running:
        init_backup_scheduler()
        return {"status": "initialized"}

    try:
        if db is None:
            with SessionLocal() as local_db:
                cfg = _parse_db_backup_config(local_db)
        else:
            cfg = _parse_db_backup_config(db)

        # Re-add or remove scheduled job
        if cfg.get("enabled"):
            _scheduler.add_job(
                _scheduled_backup_job,
                _build_cron_trigger(cfg),
                id="daily_backup",
                name="Automated Backup Job",
                replace_existing=True,
            )
            job = _scheduler.get_job("daily_backup")
            next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
            logger.info(f"Backup scheduler reloaded. Next run at: {next_run}")
            return {"status": "reloaded", "enabled": True, "next_run": next_run, "config": cfg}
        else:
            if _scheduler.get_job("daily_backup"):
                _scheduler.remove_job("daily_backup")
            logger.info("Automated backup job disabled in scheduler.")
            return {"status": "disabled", "enabled": False}
    except Exception as exc:
        logger.error(f"Error reloading backup scheduler: {exc}")
        return {"status": "error", "error": str(exc)}


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
