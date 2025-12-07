import atexit
import os
import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from .gallery_config import gallery_log
from .metadata_cache import get_metadata_cache
from .metadata_extractor import buildMetadata
from .search_index import get_search_index
from .thumbnail_service import ensure_thumbnail_for, remove_thumbnail_for

# -----------------------------------------------------------------------------
# Task/result payloads
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class MetadataTask:
    action: str  # "index" or "delete"
    full_path: str
    relative_path: str
    folder_key: str
    force: bool = False


@dataclass
class MetadataResult:
    action: str
    full_path: str
    relative_path: str
    folder_key: str
    success: bool
    metadata: Optional[Dict] = None
    thumbnail_url: Optional[str] = None
    error: Optional[str] = None


# -----------------------------------------------------------------------------
# Worker loop (now using threading instead of multiprocessing)
# -----------------------------------------------------------------------------


def _extract_metadata(full_path: str) -> Optional[Dict]:
    """Perform metadata extraction synchronously, closing the PIL handle."""
    if not os.path.isfile(full_path):
        return None

    image = None
    try:
        image, _, metadata = buildMetadata(full_path)
        metadata = metadata or {}
    except Exception as exc:  # pragma: no cover - defensive
        gallery_log(
            f"MetadataWorker: metadata extraction failed for {full_path}: {exc}"
        )
        return {}
    finally:
        try:
            if image is not None:
                image.close()
        except Exception:
            pass

    return metadata


def _worker_loop(task_queue: queue.Queue, result_queue: queue.Queue, stop_event: threading.Event) -> None:
    """Worker thread loop that performs metadata extraction and caching."""
    cache = get_metadata_cache()
    search_index = get_search_index()

    while not stop_event.is_set():
        try:
            task: MetadataTask = task_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        if task is None:
            break

        started = time.time()
        try:
            if task.action == "delete":
                cache.invalidate(task.full_path)
                search_index.remove(task.relative_path)
                remove_thumbnail_for(task.full_path, task.relative_path)
                result_queue.put(
                    MetadataResult(
                        action=task.action,
                        full_path=task.full_path,
                        relative_path=task.relative_path,
                        folder_key=task.folder_key,
                        success=True,
                    )
                )
                continue

            if task.action != "index":
                raise ValueError(f"Unknown task action '{task.action}'")

            if not os.path.isfile(task.full_path):
                cache.invalidate(task.full_path)
                search_index.remove(task.relative_path)
                remove_thumbnail_for(task.full_path, task.relative_path)
                result_queue.put(
                    MetadataResult(
                        action=task.action,
                        full_path=task.full_path,
                        relative_path=task.relative_path,
                        folder_key=task.folder_key,
                        success=False,
                        error="File not found.",
                    )
                )
                continue

            mtime = os.path.getmtime(task.full_path)
            size = os.path.getsize(task.full_path)

            metadata: Optional[Dict] = None
            if not task.force and cache.has_valid(task.full_path, mtime, size):
                metadata = cache.get(task.full_path, mtime, size)
            else:
                metadata = _extract_metadata(task.full_path)
                if metadata is not None:
                    cache.set(task.full_path, mtime, size, metadata)

            thumbnail_url = ensure_thumbnail_for(task.full_path, task.relative_path)

            if metadata:
                search_index.index_file(
                    task.relative_path, metadata, mtime=mtime, size=size
                )
            else:
                search_index.remove(task.relative_path)

            result_queue.put(
                MetadataResult(
                    action=task.action,
                    full_path=task.full_path,
                    relative_path=task.relative_path,
                    folder_key=task.folder_key,
                    success=True,
                    metadata=metadata or {},
                    thumbnail_url=thumbnail_url,
                )
            )
        except Exception as exc:  # pragma: no cover - defensive
            gallery_log(
                f"MetadataWorker: Unexpected error processing {task.full_path}: {exc}"
            )
            result_queue.put(
                MetadataResult(
                    action=task.action,
                    full_path=task.full_path,
                    relative_path=task.relative_path,
                    folder_key=task.folder_key,
                    success=False,
                    error=str(exc),
                )
            )
        finally:
            duration = (time.time() - started) * 1000
            gallery_log(
                f"MetadataWorker: processed {task.action} for {task.full_path} in {duration:.1f}ms"
            )


# -----------------------------------------------------------------------------
# Parent side manager (now using threading)
# -----------------------------------------------------------------------------


class MetadataWorkerManager:
    """Coordinates background metadata extraction using worker threads."""

    def __init__(self, num_workers: int = 2) -> None:
        self._num_workers = max(1, num_workers)
        self._task_queue: queue.Queue = queue.Queue(maxsize=1024)
        self._result_queue: queue.Queue = queue.Queue()
        self._threads: List[threading.Thread] = []
        self._listeners: List[Callable[[MetadataResult], None]] = []
        self._pending: Dict[str, float] = {}
        self._pending_lock = threading.Lock()
        self._result_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._started = False

    # Lifecycle ----------------------------------------------------------------

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        self._stop_event.clear()

        for i in range(self._num_workers):
            thread = threading.Thread(
                target=_worker_loop,
                args=(self._task_queue, self._result_queue, self._stop_event),
                name=f"GalleryMetadataWorker-{i}",
                daemon=True,
            )
            thread.start()
            self._threads.append(thread)

        self._result_thread = threading.Thread(
            target=self._consume_results,
            name="GalleryMetadataWorkerResults",
            daemon=True,
        )
        self._result_thread.start()
        atexit.register(self.shutdown)
        gallery_log(f"MetadataWorker: started with {len(self._threads)} worker threads.")

    def shutdown(self) -> None:
        if not self._started:
            return
        self._started = False
        self._stop_event.set()

        # Send None to wake up any waiting workers
        try:
            for _ in self._threads:
                self._task_queue.put(None)
        except Exception:
            pass

        for thread in self._threads:
            thread.join(timeout=1.0)

        self._threads.clear()

        if self._result_thread and self._result_thread.is_alive():
            self._result_thread.join(timeout=0.5)
        self._result_thread = None

    # Listener management ------------------------------------------------------

    def register_listener(self, callback: Callable[[MetadataResult], None]) -> None:
        self._listeners.append(callback)

    # Queueing -----------------------------------------------------------------

    def queue_index(
        self, full_path: str, relative_path: str, folder_key: str, force: bool = False
    ) -> None:
        self._queue_task(
            MetadataTask(
                action="index",
                full_path=full_path,
                relative_path=relative_path,
                folder_key=folder_key,
                force=force,
            )
        )

    def queue_delete(self, full_path: str, relative_path: str, folder_key: str) -> None:
        self._queue_task(
            MetadataTask(
                action="delete",
                full_path=full_path,
                relative_path=relative_path,
                folder_key=folder_key,
                force=False,
            )
        )

    def _queue_task(self, task: MetadataTask) -> None:
        key = f"{task.action}:{task.full_path}"
        with self._pending_lock:
            if key in self._pending and not task.force:
                return
            self._pending[key] = time.time()

        if not self._started:
            self.start()

        try:
            self._task_queue.put_nowait(task)
        except queue.Full:
            gallery_log("MetadataWorker: task queue full, dropping task.")
            with self._pending_lock:
                self._pending.pop(key, None)

    # Result processing --------------------------------------------------------

    def _consume_results(self) -> None:
        while self._started:
            try:
                result: MetadataResult = self._result_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            key = f"{result.action}:{result.full_path}"
            with self._pending_lock:
                self._pending.pop(key, None)

            for listener in self._listeners:
                try:
                    listener(result)
                except Exception as exc:  # pragma: no cover - defensive
                    gallery_log(f"MetadataWorker: listener raised error {exc}")


_manager_lock = threading.Lock()
_manager: Optional[MetadataWorkerManager] = None


def get_metadata_worker() -> MetadataWorkerManager:
    global _manager
    if _manager:
        return _manager
    with _manager_lock:
        if _manager is None:
            _manager = MetadataWorkerManager()
    return _manager


def queue_metadata_index(
    full_path: str, relative_path: str, folder_key: str, force: bool = False
) -> None:
    worker = get_metadata_worker()
    worker.queue_index(full_path, relative_path, folder_key=folder_key, force=force)


def queue_metadata_delete(full_path: str, relative_path: str, folder_key: str) -> None:
    worker = get_metadata_worker()
    worker.queue_delete(full_path, relative_path, folder_key=folder_key)
