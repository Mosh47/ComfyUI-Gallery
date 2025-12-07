import atexit
import json
import os
import sqlite3
import threading
from typing import Dict, List, Optional, Tuple

from .gallery_config import gallery_log


DB_FILENAME = "gallery_search_index.db"
SQLITE_TIMEOUT = 30.0


def _ensure_directory(path: str) -> None:
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)


def _stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple, set)):
        return "\n".join(_stringify(v) for v in value)
    if isinstance(value, dict):
        return "\n".join(f"{k}: {_stringify(v)}" for k, v in value.items())
    return str(value)


class GallerySearchIndex:
    """SQLite-backed FTS index for gallery metadata."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        _ensure_directory(db_path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            db_path,
            timeout=SQLITE_TIMEOUT,
            check_same_thread=False,
        )
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA temp_store=MEMORY;")
        self._conn.execute("PRAGMA mmap_size=134217728;")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                positive_prompt TEXT,
                negative_prompt TEXT,
                model TEXT
            );
            """
        )
        self._conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS files_fts
            USING fts5(
                path,
                positive_prompt,
                negative_prompt,
                model,
                content='',
                tokenize='porter'
            );
            """
        )
        self._conn.commit()

    # Index maintenance --------------------------------------------------------

    def index_file(self, relative_path: str, metadata: Dict, mtime: float, size: int) -> None:
        positive, negative, model = self._extract_prompts(metadata)

        with self._lock:
            self._conn.execute(
                """
                INSERT INTO files(path, mtime, size, positive_prompt, negative_prompt, model)
                VALUES(?, ?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    mtime=excluded.mtime,
                    size=excluded.size,
                    positive_prompt=excluded.positive_prompt,
                    negative_prompt=excluded.negative_prompt,
                    model=excluded.model;
                """,
                (relative_path, mtime, size, positive, negative, model),
            )
            self._conn.execute("DELETE FROM files_fts WHERE path = ?", (relative_path,))
            self._conn.execute(
                "INSERT INTO files_fts(rowid, path, positive_prompt, negative_prompt, model) VALUES ((SELECT rowid FROM files WHERE path = ?), ?, ?, ?, ?);",
                (relative_path, relative_path, positive, negative, model),
            )
            self._conn.commit()

    def remove(self, relative_path: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM files WHERE path = ?", (relative_path,))
            self._conn.execute("DELETE FROM files_fts WHERE path = ?", (relative_path,))
            self._conn.commit()

    # Queries ------------------------------------------------------------------

    def search(self, query: str, limit: int = 20) -> List[Dict]:
        with self._lock:
            cursor = self._conn.execute(
                """
                SELECT files.path, files.positive_prompt, files.negative_prompt, files.model
                FROM files_fts
                JOIN files ON files_fts.path = files.path
                WHERE files_fts MATCH ?
                LIMIT ?
                """,
                (query, limit),
            )
            rows = cursor.fetchall()
            cursor.close()
        return [
            {
                "path": path,
                "positive_prompt": positive or "",
                "negative_prompt": negative or "",
                "model": model or "",
            }
            for path, positive, negative, model in rows
        ]

    def _extract_prompts(self, metadata: Dict) -> Tuple[str, str, str]:
        prompt_blob = metadata.get("prompt")
        positive = ""
        negative = ""
        model = ""

        if isinstance(prompt_blob, dict):
            positive = _stringify(prompt_blob.get("positive") or prompt_blob.get("Positive") or prompt_blob.get("Prompt"))
            negative = _stringify(prompt_blob.get("negative") or prompt_blob.get("Negative"))
            model = _stringify(prompt_blob.get("model") or prompt_blob.get("Model") or prompt_blob.get("ckpt"))
        elif isinstance(prompt_blob, (list, tuple)):
            combined = _stringify(prompt_blob)
            positive = combined
        elif isinstance(prompt_blob, str):
            positive = prompt_blob

        if not positive:
            positive = _stringify(metadata.get("positive_prompt") or metadata.get("Prompt"))
        if not negative:
            negative = _stringify(metadata.get("negative_prompt") or metadata.get("Negative prompt"))
        if not model:
            model = _stringify(metadata.get("model") or metadata.get("Model"))

        return positive, negative, model

    def close(self) -> None:
        with self._lock:
            if self._conn:
                try:
                    self._conn.commit()
                finally:
                    self._conn.close()
                    self._conn = None


_index_lock = threading.Lock()
_index_instance: Optional[GallerySearchIndex] = None


def get_search_index() -> GallerySearchIndex:
    global _index_instance
    if _index_instance:
        return _index_instance
    with _index_lock:
        if _index_instance is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            db_path = os.path.join(base_dir, DB_FILENAME)
            _index_instance = GallerySearchIndex(db_path)
            atexit.register(_index_instance.close)
    return _index_instance
