import os
import logging
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler
from linebot.v3.messaging import (
    Configuration,
    ApiClient,
    MessagingApi,
    PushMessageRequest,
    TextMessage,
)

import database as db
import summarizer

logger = logging.getLogger(__name__)


def send_line_message(group_id: str, text: str):
    configuration = Configuration(access_token=os.environ['LINE_CHANNEL_ACCESS_TOKEN'])
    with ApiClient(configuration) as api_client:
        api = MessagingApi(api_client)
        api.push_message(PushMessageRequest(
            to=group_id,
            messages=[TextMessage(type='text', text=text)]
        ))


def run_daily_summary():
    target_date = date.today()
    target_group = os.environ.get('TARGET_GROUP_ID', '').strip()
    retention_days = int(os.environ.get('MESSAGE_RETENTION_DAYS', '7'))

    if target_group:
        group_ids = [target_group]
    else:
        group_ids = db.get_active_groups(target_date)

    if not group_ids:
        logger.info("No active groups today, skipping summary.")
        return

    for group_id in group_ids:
        try:
            existing = db.get_summary(group_id, target_date)
            if existing:
                logger.info("Summary already exists for group %s on %s", group_id, target_date)
                continue

            messages = db.get_today_messages(group_id, target_date)
            logger.info("Summarizing %d messages for group %s", len(messages), group_id)

            summary_text = summarizer.summarize(group_id, messages, target_date)
            db.save_summary(group_id, summary_text, target_date)

            header = f"📊 {target_date.strftime('%Y/%m/%d')} 每日重點摘要\n{'─' * 20}\n"
            send_line_message(group_id, header + summary_text)
            logger.info("Summary sent to group %s", group_id)

        except Exception:
            logger.exception("Failed to process group %s", group_id)

    db.purge_old_messages(retention_days)


def start_scheduler() -> BackgroundScheduler:
    hour = int(os.environ.get('SUMMARY_HOUR', '20'))
    minute = int(os.environ.get('SUMMARY_MINUTE', '0'))

    scheduler = BackgroundScheduler(timezone='Asia/Taipei')
    scheduler.add_job(run_daily_summary, 'cron', hour=hour, minute=minute, id='daily_summary')
    scheduler.start()
    logger.info("Scheduler started — daily summary at %02d:%02d (Asia/Taipei)", hour, minute)
    return scheduler
