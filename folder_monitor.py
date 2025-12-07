import os
import time
import threading
from typing import Dict, List, Optional, Tuple

from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver
from watchdog.events import PatternMatchingEventHandler

from server import PromptServer
from .folder_scanner import (
    _scan_for_images,
    IMAGE_EXTENSIONS,
    build_file_entry,
    invalidate_cached_metadata,
)
from .metadata_worker import (
    MetadataResult,
    get_metadata_worker,
    queue_metadata_delete,
    queue_metadata_index,
)
from .gallery_config import gallery_log


def _normalize_folder_key(value: str) -> str:
    return value.replace("\\", "/") if value else ""


def _on_metadata_worker_result(result: MetadataResult) -> None:
    if not result.success or result.action != "index":
        return
    try:
        from .server import sanitize_json_data
    except Exception:
        return
    metadata_payload = {
        "metadata": result.metadata or {},
        "metadata_pending": False,
    }
    metadata_payload["thumbnail_url"] = result.thumbnail_url
    metadata_payload["thumbnail_pending"] = result.thumbnail_url is None

    event = {
        "action": "metadata",
        "folder": _normalize_folder_key(result.folder_key),
        "file": os.path.basename(result.relative_path),
        "data": metadata_payload,
    }
    try:
        PromptServer.instance.send_sync(
            "Gallery.file_change",
            sanitize_json_data({"changes": [event]}),
        )
    except Exception as exc:
        gallery_log(f"FileSystemMonitor: Failed to broadcast metadata update: {exc}")


get_metadata_worker().register_listener(_on_metadata_worker_result)


class GalleryEventHandler(PatternMatchingEventHandler):
    """Processes filesystem events and emits incremental gallery updates."""

    def __init__(
        self,
        base_path,
        patterns=None,
        ignore_patterns=None,
        ignore_directories=False,
        case_sensitive=True,
        debounce_interval: float = 2.0,
        extensions=None,
    ):
        super().__init__(
            patterns=patterns,
            ignore_patterns=ignore_patterns,
            ignore_directories=ignore_directories,
            case_sensitive=case_sensitive,
        )
        self.base_path = os.path.realpath(base_path)
        self.root_folder = os.path.basename(os.path.normpath(self.base_path)) or os.path.basename(self.base_path)
        self.base_debounce_interval = max(0.5, debounce_interval)
        self.current_debounce_interval = self.base_debounce_interval
        self.max_debounce_interval = 8.0
        self.backoff_multiplier = 2.0
        self.max_batch_size = 50
        self.debounce_timer: Optional[threading.Timer] = None
        self.pending_events: List[Dict[str, Optional[str]]] = []
        self.pending_lock = threading.Lock()
        self.processed_events: Dict[Tuple[str, str], float] = {}
        self.running_scan = False
        self.extensions = extensions
        self.allowed_extensions = (
            tuple(
                ext.lower() if ext.startswith(".") else f".{ext.lower()}"
                for ext in extensions
            )
            if extensions
            else tuple()
        )
        self.last_known_folders: Dict[str, Dict[str, dict]] = {}

    # Event ingestion -----------------------------------------------------------------

    def on_any_event(self, event):
        if event.is_directory:
            return

        real_path = os.path.realpath(event.src_path)
        if not self._is_within_base(real_path):
            return
        if self._is_temp_file(real_path):
            return

        event_type = event.event_type
        if event_type not in ("created", "deleted", "modified", "moved"):
            return

        current_time = time.time()
        event_key = (event_type, real_path)
        last_time = self.processed_events.get(event_key)
        if last_time and (current_time - last_time) < self.base_debounce_interval:
            return
        self.processed_events[event_key] = current_time
        if len(self.processed_events) > 1024:
            self._prune_processed_events(current_time)

        dest_path = getattr(event, "dest_path", None)
        if dest_path:
            dest_path = os.path.realpath(dest_path)

        gallery_log(f"Watchdog detected {event_type}: {real_path}")
        self._queue_event(
            {
                "type": event_type,
                "path": real_path,
                "dest_path": dest_path,
            }
        )

    def _queue_event(self, event_data: Dict[str, Optional[str]]) -> None:
        with self.pending_lock:
            self.pending_events.append(event_data)
            queue_size = len(self.pending_events)
        if queue_size >= self.max_batch_size:
            gallery_log("FileSystemMonitor: Max batch size reached, flushing immediately.")
            self._schedule_flush(immediate=True)
        else:
            self._schedule_flush()

    # Debounce & scheduling -----------------------------------------------------------

    def _schedule_flush(self, immediate: bool = False) -> None:
        if immediate:
            if self.debounce_timer and self.debounce_timer.is_alive():
                self.debounce_timer.cancel()
            self.debounce_timer = None
            self._start_event_processing()
            return

        if self.running_scan:
            return

        if self.debounce_timer and self.debounce_timer.is_alive():
            self.debounce_timer.cancel()

        self.debounce_timer = threading.Timer(self.current_debounce_interval, self._on_debounce_timer)
        self.debounce_timer.daemon = True
        self.debounce_timer.start()

    def _on_debounce_timer(self) -> None:
        self.debounce_timer = None
        self._start_event_processing()

    def _start_event_processing(self) -> None:
        with self.pending_lock:
            if self.running_scan:
                return
            self.running_scan = True

        worker = threading.Thread(target=self._process_pending_events, name="GalleryEventBatch", daemon=True)
        worker.start()

    def _process_pending_events(self) -> None:
        events = self._drain_events()
        if not events:
            with self.pending_lock:
                self.running_scan = False
            return

        try:
            self._handle_event_batch(events)
        finally:
            with self.pending_lock:
                self.running_scan = False
                has_more = bool(self.pending_events)
            if has_more:
                self._schedule_flush(immediate=True)

    def _drain_events(self) -> List[Dict[str, Optional[str]]]:
        with self.pending_lock:
            events = list(self.pending_events)
            self.pending_events.clear()
        return events

    # Batch processing ----------------------------------------------------------------

    def _handle_event_batch(self, events: List[Dict[str, Optional[str]]]) -> None:
        gallery_log(f"FileSystemMonitor: Processing {len(events)} filesystem events.")
        aggregated = self._coalesce_events(events)
        if not aggregated:
            gallery_log("FileSystemMonitor: No actionable changes after coalescing.")
            self._adjust_backoff(len(events))
            return

        change_events: List[Dict[str, object]] = []
        total_updates: Dict[str, int] = {}
        for path, action_info in aggregated.items():
            action = action_info["action"]
            if action != "remove" and not self._should_handle_path(path):
                continue
            if not self._is_within_base(path):
                continue

            if action == "remove":
                change_payload = self._apply_remove(path)
            else:
                change_payload = self._apply_upsert(path, action)

            if change_payload is None:
                continue

            folder_key, filename, payload = change_payload
            normalized_folder = _normalize_folder_key(folder_key)
            action_type = payload.get("action")
            data_payload = {k: v for k, v in payload.items() if k != "action"}

            event: Dict[str, object] = {
                "action": action_type,
                "folder": normalized_folder,
                "file": filename,
            }
            if action_type != "remove":
                event["data"] = data_payload
            change_events.append(event)

            snapshot = self.last_known_folders.get(folder_key, {})
            total_updates[normalized_folder] = len(snapshot)

        if change_events:
            gallery_log(f"FileSystemMonitor: Sending {len(change_events)} incremental change events to clients.")
            from .server import sanitize_json_data

            payload = {"changes": change_events}
            if total_updates:
                payload["totals"] = total_updates

            PromptServer.instance.send_sync(
                "Gallery.file_change",
                sanitize_json_data(payload),
            )
        else:
            gallery_log("FileSystemMonitor: No changes to broadcast after filtering.")

        self._adjust_backoff(len(events))

    def _coalesce_events(self, events: List[Dict[str, Optional[str]]]) -> Dict[str, Dict[str, str]]:
        aggregated: Dict[str, Dict[str, str]] = {}
        for event in events:
            event_type = event.get("type")
            path = event.get("path")
            dest_path = event.get("dest_path")
            if not path:
                continue

            if event_type == "moved" and dest_path:
                aggregated[path] = {"action": "remove"}
                if self._should_handle_path(dest_path):
                    aggregated[dest_path] = {"action": "create"}
                continue

            if event_type == "deleted":
                aggregated[path] = {"action": "remove"}
                continue

            if event_type == "created":
                previous = aggregated.get(path)
                if previous and previous["action"] == "remove":
                    aggregated[path] = {"action": "update"}
                else:
                    aggregated[path] = {"action": "create"}
                continue

            if event_type == "modified":
                previous = aggregated.get(path)
                if previous and previous["action"] == "create":
                    continue
                aggregated[path] = {"action": "update"}

        return aggregated

    def _apply_upsert(self, path: str, action: str) -> Optional[Tuple[str, str, dict]]:
        record = build_file_entry(self.base_path, self.root_folder, path, self.extensions)
        if not record:
            return None

        folder_key, filename, entry = record
        if action == "update":
            invalidate_cached_metadata(path)

        if entry.get("type") == "image":
            relative_path = os.path.relpath(path, self.base_path).replace("\\", "/")
            normalized_folder = _normalize_folder_key(folder_key)
            queue_metadata_index(path, relative_path, normalized_folder, force=(action == "update"))

        self.last_known_folders.setdefault(folder_key, {})[filename] = entry
        payload = {"action": action}
        payload.update(entry)
        return folder_key, filename, payload

    def _apply_remove(self, path: str) -> Optional[Tuple[str, str, dict]]:
        if not self._should_handle_path(path):
            invalidate_cached_metadata(path)
            return None

        folder_key, filename = self._resolve_folder_and_name(path)
        folder_content = self.last_known_folders.get(folder_key)
        if folder_content and filename in folder_content:
            del folder_content[filename]
            if not folder_content:
                del self.last_known_folders[folder_key]

        invalidate_cached_metadata(path)
        extension = os.path.splitext(path)[1].lower()
        if extension in IMAGE_EXTENSIONS:
            relative_path = os.path.relpath(path, self.base_path).replace("\\", "/")
            normalized_folder = _normalize_folder_key(folder_key)
            queue_metadata_delete(path, relative_path, normalized_folder)
        return folder_key, filename, {"action": "remove"}

    # Utility helpers -----------------------------------------------------------------

    def _should_handle_path(self, path: str) -> bool:
        if not self.allowed_extensions:
            return True
        extension = os.path.splitext(path)[1].lower()
        return extension in self.allowed_extensions

    def _resolve_folder_and_name(self, path: str) -> Tuple[str, str]:
        rel_dir = os.path.relpath(os.path.dirname(path), self.base_path)
        subfolder = "" if rel_dir in (".", "") else rel_dir
        folder_key = os.path.join(self.root_folder, subfolder) if subfolder else self.root_folder
        filename = os.path.basename(path)
        return folder_key, filename

    def _is_within_base(self, path: str) -> bool:
        try:
            common = os.path.commonpath([self.base_path, os.path.realpath(path)])
        except ValueError:
            return False
        return common == self.base_path

    @staticmethod
    def _is_temp_file(path: str) -> bool:
        lower = path.lower()
        return lower.endswith((".swp", ".tmp", "~"))

    def _adjust_backoff(self, event_count: int) -> None:
        if event_count >= self.max_batch_size:
            self.current_debounce_interval = min(
                self.max_debounce_interval,
                self.current_debounce_interval * self.backoff_multiplier,
            )
        elif event_count <= max(5, self.max_batch_size // 4):
            self.current_debounce_interval = max(
                self.base_debounce_interval,
                self.current_debounce_interval / self.backoff_multiplier,
            )

    def _prune_processed_events(self, now: float) -> None:
        threshold = self.current_debounce_interval * 4
        stale = [key for key, ts in self.processed_events.items() if (now - ts) > threshold]
        for key in stale:
            self.processed_events.pop(key, None)


class FileSystemMonitor:
    """Monitors gallery directories and streams incremental updates."""

    def __init__(self, base_path, interval=1.0, use_polling_observer=False, extensions=None):
        self.base_path = base_path
        self.interval = interval
        self.use_polling_observer = use_polling_observer
        self.extensions = extensions
        self.observer = PollingObserver() if not use_polling_observer else Observer()

        if self.extensions:
            patterns = [f"*{ext}" if ext.startswith(".") else f"*.{ext}" for ext in self.extensions]
        else:
            patterns = ["*"]

        self.event_handler = GalleryEventHandler(
            base_path=base_path,
            patterns=patterns,
            debounce_interval=2.0,
            extensions=self.extensions,
        )

        self.thread: Optional[threading.Thread] = None

    def start_monitoring(self):
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self._start_observer_thread, daemon=True)
            self.thread.start()
            gallery_log("FileSystemMonitor: Watchdog monitoring thread started.")
        else:
            gallery_log("FileSystemMonitor: Watchdog monitoring thread already running.")

    def _start_observer_thread(self):
        try:
            folder_name = os.path.basename(self.base_path)
            gallery_log("FileSystemMonitor: Starting initial background scan...")
            initial_data, _ = _scan_for_images(self.base_path, folder_name, True, self.extensions)
            self.event_handler.last_known_folders = initial_data
            gallery_log("FileSystemMonitor: Initial background scan complete.")
        except Exception as e:
            gallery_log(f"FileSystemMonitor: Error during initial scan: {e}")

        self.observer.schedule(self.event_handler, self.base_path, recursive=True)
        self.observer.follow_directory_symlinks = True
        self.observer.start()

        try:
            while True:
                time.sleep(self.interval)
        except KeyboardInterrupt:
            self.stop_monitoring()

    def stop_monitoring(self):
        if self.thread and self.thread.is_alive():
            self.observer.stop()
            if self.observer.is_alive():
                self.observer.join()
            self.thread = None
            gallery_log("FileSystemMonitor: Watchdog monitoring thread stopped.")
        else:
            gallery_log("FileSystemMonitor: Watchdog monitoring thread was not running.")
