import sqlite3
import os
from datetime import datetime, date, timedelta
from contextlib import contextmanager


DB_PATH = os.environ.get('DB_PATH', 'messages.db')


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                user_id TEXT,
                display_name TEXT,
                message TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_messages_group_time
                ON messages (group_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_summaries_group_date
                ON summaries (group_id, date);
        """)


def save_message(group_id: str, user_id: str, message: str, display_name: str = None):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (group_id, user_id, display_name, message) VALUES (?, ?, ?, ?)",
            (group_id, user_id, display_name, message)
        )


def get_today_messages(group_id: str, target_date: date = None) -> list[dict]:
    if target_date is None:
        target_date = date.today()
    start = datetime.combine(target_date, datetime.min.time())
    end = datetime.combine(target_date, datetime.max.time())
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT user_id, display_name, message, timestamp
               FROM messages
               WHERE group_id = ? AND timestamp BETWEEN ? AND ?
               ORDER BY timestamp ASC""",
            (group_id, start.isoformat(), end.isoformat())
        ).fetchall()
    return [dict(r) for r in rows]


def get_active_groups(target_date: date = None) -> list[str]:
    if target_date is None:
        target_date = date.today()
    start = datetime.combine(target_date, datetime.min.time())
    end = datetime.combine(target_date, datetime.max.time())
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT group_id FROM messages
               WHERE timestamp BETWEEN ? AND ?""",
            (start.isoformat(), end.isoformat())
        ).fetchall()
    return [r['group_id'] for r in rows]


def save_summary(group_id: str, summary: str, target_date: date = None):
    if target_date is None:
        target_date = date.today()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO summaries (group_id, summary, date) VALUES (?, ?, ?)",
            (group_id, summary, target_date.isoformat())
        )


def get_summary(group_id: str, target_date: date = None) -> str | None:
    if target_date is None:
        target_date = date.today()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT summary FROM summaries WHERE group_id = ? AND date = ? ORDER BY created_at DESC LIMIT 1",
            (group_id, target_date.isoformat())
        ).fetchone()
    return row['summary'] if row else None


def purge_old_messages(retention_days: int = 7):
    cutoff = datetime.now() - timedelta(days=retention_days)
    with get_conn() as conn:
        conn.execute("DELETE FROM messages WHERE timestamp < ?", (cutoff.isoformat(),))
