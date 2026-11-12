"""SQLite storage for translation history."""
import sqlite3
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "signbridge.db"


def _connect():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with closing(_connect()) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS history (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   text TEXT NOT NULL,
                   language TEXT NOT NULL,
                   mode TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
               )"""
        )
        conn.commit()


def add_history(text, language, mode):
    with closing(_connect()) as conn:
        cur = conn.execute(
            "INSERT INTO history (text, language, mode) VALUES (?, ?, ?)",
            (text, language, mode),
        )
        conn.commit()
        return cur.lastrowid


def list_history(limit=200):
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT id, text, language, mode, created_at FROM history ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_history(item_id):
    with closing(_connect()) as conn:
        cur = conn.execute("DELETE FROM history WHERE id = ?", (item_id,))
        conn.commit()
        return cur.rowcount > 0


def clear_history():
    with closing(_connect()) as conn:
        conn.execute("DELETE FROM history")
        conn.commit()