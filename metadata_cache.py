import atexit
import json
import mmap
import multiprocessing as mp
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

from .gallery_config import gallery_log

DB_FILENAME = "gallery_metadata_cache.db"
MMAP_FILENAME = "gallery_metadata_cache.mm"
SQLITE_TIMEOUT = 30.0


def _ensure_directory(path: str) -> None:
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)


class MemoryMappedMetadataStore:
    """Append-only JSONL store backed by a memory map for rapid warm-up."""

    def __init__(self, storage_path: str) -> None:
        self.storage_path = storage_path
        _ensure_directory(storage_path)
        self._lock = threading.RLock()
        self._file = open(storage_path, "a+b")
        self._mm: Optional[mmap.mmap] = None
        self._remap_locked()

    def _remap_locked(self) -> None:
        if self._mm:
            try:
                self._mm.close()
            except Exception:
                pass
            self._mm = None

        self._file.flush()
        size = os.path.getsize(self.storage_path)
        if size == 0:
            return

        self._file.seek(0)
        self._mm = mmap.mmap(self._file.fileno(), 0)

    def append_record(self, record: Dict[str, Any]) -> None:
        payload = json.dumps(record, separators=(",", ":")).encode("utf-8")
        with self._lock:
            self._file.seek(0, os.SEEK_END)
            self._file.write(payload)
            self._file.write(b"\n")
            self._file.flush()
            self._remap_locked()

    def upsert(self, path: str, mtime: float, size: int, metadata_json: str) -> None:
        record = {
            "path": path,
            "mtime": mtime,
            "size": size,
            "metadata_json": metadata_json,
            "ts": time.time(),
        }
        self.append_record(record)

    def mark_removed(self, path: str) -> None:
        record = {"path": path, "remove": True, "ts": time.time()}
        self.append_record(record)

    def iter_recent(self, limit: int) -> List[Tuple[str, float, int, str]]:
        with self._lock:
            if not self._mm:
                return []
            try:
                self._mm.seek(0)
            except (BufferError, ValueError):
                return []

            latest: Dict[str, Tuple[float, float, int, str]] = {}
            while True:
                try:
                    raw_line = self._mm.readline()
                except ValueError:
                    break
                if not raw_line:
                    break
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    record = json.loads(raw_line.decode("utf-8"))
                except json.JSONDecodeError:
                    continue

                path = record.get("path")
                if not path:
                    continue

                if record.get("remove"):
                    latest.pop(path, None)
                    continue

                metadata_json = record.get("metadata_json")
                if metadata_json is None:
                    continue

                ts = float(record.get("ts", 0.0))
                mtime = float(record.get("mtime", 0.0))
                size = int(record.get("size", 0))
                latest[path] = (ts, mtime, size, metadata_json)

            ordered = sorted(latest.items(), key=lambda item: item[1][0], reverse=True)
            results: List[Tuple[str, float, int, str]] = []
            for path, (ts, mtime, size, metadata_json) in ordered[:limit]:
                results.append((path, mtime, size, metadata_json))
            return results

    def close(self) -> None:
        with self._lock:
            if self._mm:
                try:
                    self._mm.close()
                except Exception:
                    pass
                self._mm = None
            if not self._file.closed:
                self._file.close()


class MetadataCache:
    """SQLite-backed metadata cache with an in-memory LRU for hot entries."""

    def __init__(self, db_path: str, max_in_memory: int = 1024) -> None:
        self.db_path = db_path
        self.max_in_memory = max(16, max_in_memory)
        _ensure_directory(self.db_path)

        self._lock = threading.RLock()
        self._memory_cache: "OrderedDict[str, Tuple[float, int, Dict[str, Any]]]" = OrderedDict()
        self._use_mmap_store = mp.current_process().name == "MainProcess"
        mmap_path = os.path.join(os.path.dirname(self.db_path), MMAP_FILENAME)
        self._mmap_store = MemoryMappedMetadataStore(mmap_path) if self._use_mmap_store else None

        self._conn = sqlite3.connect(
            self.db_path,
            timeout=SQLITE_TIMEOUT,
            check_same_thread=False,
        )
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA mmap_size = 134217728;")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS metadata (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                metadata_json TEXT NOT NULL,
                last_access REAL NOT NULL
            )
            """
        )
        self._conn.commit()

        self._stop_event = threading.Event()
        self._warm_thread = threading.Thread(target=self._warm_cache, name="GalleryMetadataWarmCache", daemon=True)
        self._warm_thread.start()

    def close(self) -> None:
        with self._lock:
            if self._stop_event.is_set():
                return
            self._stop_event.set()
            if self._conn is not None:
                try:
                    self._conn.commit()
                finally:
                    self._conn.close()
                    self._conn = None
            self._memory_cache.clear()
            if self._mmap_store:
                self._mmap_store.close()
        if self._warm_thread.is_alive():
            self._warm_thread.join(timeout=0.2)

    # Cache operations -----------------------------------------------------------------

    def get(self, path: str, mtime: float, size: int) -> Optional[Dict[str, Any]]:
        """Return cached metadata when the stored signature matches."""
        signature = (mtime, size)

        with self._lock:
            cached = self._memory_cache.get(path)
            if cached and self._signature_matches(cached, signature):
                self._memory_cache.move_to_end(path)
                self._update_last_access_locked(path)
                return cached[2]

        row = self._execute_fetchone(
            "SELECT metadata_json, mtime, size FROM metadata WHERE path = ?",
            (path,),
        )
        if not row:
            return None

        metadata_json, cached_mtime, cached_size = row
        if not self._signature_matches((cached_mtime, cached_size, None), signature):
            return None

        try:
            metadata = json.loads(metadata_json)
        except json.JSONDecodeError:
            gallery_log(f"MetadataCache: Failed to decode metadata JSON for {path}, purging entry.")
            self.invalidate(path)
            return None

        with self._lock:
            self._memory_cache[path] = (cached_mtime, cached_size, metadata)
            self._memory_cache.move_to_end(path)
            self._trim_memory_cache_locked()
            self._update_last_access_locked(path)

        return metadata

    def has_valid(self, path: str, mtime: float, size: int) -> bool:
        """Return True if a valid, up-to-date cache entry exists."""
        cached = self.get(path, mtime, size)
        return cached is not None

    def set(self, path: str, mtime: float, size: int, metadata: Dict[str, Any]) -> None:
        """Insert or replace metadata for the given file."""
        metadata_json = json.dumps(metadata)
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO metadata(path, mtime, size, metadata_json, last_access)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    mtime=excluded.mtime,
                    size=excluded.size,
                    metadata_json=excluded.metadata_json,
                    last_access=excluded.last_access
                """,
                (path, mtime, size, metadata_json, now),
            )
            self._conn.commit()
            self._memory_cache[path] = (mtime, size, metadata)
            self._memory_cache.move_to_end(path)
            self._trim_memory_cache_locked()
        if self._mmap_store:
            self._mmap_store.upsert(path, mtime, size, metadata_json)

    def invalidate(self, path: str) -> None:
        """Remove metadata for a deleted or modified file."""
        with self._lock:
            self._conn.execute("DELETE FROM metadata WHERE path = ?", (path,))
            self._conn.commit()
            if path in self._memory_cache:
                del self._memory_cache[path]
        if self._mmap_store:
            self._mmap_store.mark_removed(path)

    def purge_prefix(self, prefix: str) -> None:
        """Remove all cache entries whose path starts with the provided prefix."""
        like_pattern = f"{prefix}%"
        with self._lock:
            self._conn.execute("DELETE FROM metadata WHERE path LIKE ?", (like_pattern,))
            self._conn.commit()
            keys_to_remove = [key for key in self._memory_cache if key.startswith(prefix)]
            for key in keys_to_remove:
                del self._memory_cache[key]

    # Internal helpers -----------------------------------------------------------------

    def _warm_cache(self) -> None:
        recent_entries = self._mmap_store.iter_recent(self.max_in_memory) if self._mmap_store else []
        if recent_entries:
            with self._lock:
                for path, mtime, size, metadata_json in recent_entries:
                    if self._stop_event.is_set():
                        break
                    try:
                        metadata = json.loads(metadata_json)
                    except json.JSONDecodeError:
                        continue
                    self._memory_cache[path] = (mtime, size, metadata)
                self._trim_memory_cache_locked()
            return

        try:
            rows = self._execute_fetchall(
                """
                SELECT path, metadata_json, mtime, size
                FROM metadata
                ORDER BY last_access DESC
                LIMIT ?
                """,
                (self.max_in_memory,),
            )
        except Exception as exc:
            gallery_log(f"MetadataCache: warm cache failed - {exc}")
            return

        with self._lock:
            for path, metadata_json, mtime, size in rows:
                if self._stop_event.is_set():
                    break
                try:
                    metadata = json.loads(metadata_json)
                except json.JSONDecodeError:
                    gallery_log(f"MetadataCache: invalid JSON during warm cache for {path}, purging.")
                    self._conn.execute("DELETE FROM metadata WHERE path = ?", (path,))
                    continue
                self._memory_cache[path] = (mtime, size, metadata)
            self._trim_memory_cache_locked()

    def _trim_memory_cache_locked(self) -> None:
        while len(self._memory_cache) > self.max_in_memory:
            self._memory_cache.popitem(last=False)

    def _signature_matches(
        self,
        cached: Tuple[float, int, Optional[Dict[str, Any]]],
        signature: Tuple[float, int],
    ) -> bool:
        cached_mtime, cached_size = cached[0], cached[1]
        mtime, size = signature
        return abs(cached_mtime - mtime) < 1e-6 and cached_size == size

    def _update_last_access_locked(self, path: str) -> None:
        now = time.time()
        self._conn.execute("UPDATE metadata SET last_access = ? WHERE path = ?", (now, path))
        self._conn.commit()

    def _execute_fetchone(self, query: str, params: Tuple[Any, ...]) -> Optional[Tuple[Any, ...]]:
        with self._lock:
            cursor = self._conn.execute(query, params)
            row = cursor.fetchone()
            cursor.close()
            return row

    def _execute_fetchall(self, query: str, params: Tuple[Any, ...]) -> Tuple[Tuple[Any, ...], ...]:
        with self._lock:
            cursor = self._conn.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()
            return tuple(rows)


_instance_lock = threading.Lock()
_instance: Optional[MetadataCache] = None


def get_metadata_cache(max_in_memory: int = 1024) -> MetadataCache:
    global _instance
    if _instance:
        return _instance
    with _instance_lock:
        if _instance is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            db_path = os.path.join(base_dir, DB_FILENAME)
            _instance = MetadataCache(db_path=db_path, max_in_memory=max_in_memory)
            atexit.register(_instance.close)
    return _instance
