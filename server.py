from server import PromptServer
from aiohttp import web
import os
import folder_paths
import time
from datetime import datetime
import json
import math
import pathlib
import threading
import queue
import asyncio
import shutil
from typing import Optional, Tuple
from urllib.parse import unquote

from .folder_monitor import FileSystemMonitor
from .folder_scanner import (
    _scan_for_images,
    DEFAULT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    extract_metadata_for_file,
    invalidate_cached_metadata,
    build_file_entry,
)
from .gallery_config import disable_logs, gallery_log
from .thumbnail_service import THUMBNAIL_DIR, THUMBNAIL_ROUTE, ensure_thumbnail_for

# Add ComfyUI root to sys.path HERE
import sys
comfy_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(comfy_path)

monitor = None
# Placeholder directory.  This *must* exist, even if it's empty.
PLACEHOLDER_DIR = os.path.join(comfy_path, "output")  # os.path.abspath("./placeholder_static")
if not os.path.exists(PLACEHOLDER_DIR):
    os.makedirs(PLACEHOLDER_DIR)

# Add a *placeholder* static route.  This gets modified later.
PromptServer.instance.routes.static('/static_gallery', PLACEHOLDER_DIR, follow_symlinks=True, name='static_gallery_placeholder') #give a name to the route
if not os.path.exists(THUMBNAIL_DIR):
    os.makedirs(THUMBNAIL_DIR, exist_ok=True)
PromptServer.instance.routes.static(THUMBNAIL_ROUTE, THUMBNAIL_DIR, follow_symlinks=True, name='static_gallery_thumbnails')

# Initialize scan_lock here
PromptServer.instance.scan_lock = threading.Lock()

STATIC_ROUTE_NAME = 'static_gallery_placeholder'
THUMBNAIL_ROUTE_NAME = 'static_gallery_thumbnails'


def _get_static_directory() -> str:
    static_route = next(
        (r for r in PromptServer.instance.app.router.routes() if getattr(r, "name", None) == STATIC_ROUTE_NAME),
        None,
    )
    if static_route is not None:
        return str(static_route.resource._directory)
    return folder_paths.get_output_directory()


def _normalize_gallery_relative_path(path: str) -> str:
    if not path:
        return ""
    relative = path.strip().lstrip("/")
    if relative.startswith("static_gallery/"):
        relative = relative[len("static_gallery/"):]
    return relative


def _resolve_static_file(path: str) -> Optional[str]:
    static_dir = _get_static_directory()
    relative = _normalize_gallery_relative_path(path)
    full_path = os.path.normpath(os.path.join(static_dir, relative))
    if not full_path.startswith(os.path.realpath(static_dir)):
        return None
    return full_path


def _normalize_folder_key_value(value: str) -> str:
    if not value:
        return ""
    return value.replace("\\", "/")


def _resolve_gallery_root(raw_relative: Optional[str]) -> Tuple[str, str]:
    if raw_relative is None:
        base = _get_static_directory()
        return base, os.path.basename(os.path.normpath(base))

    relative = str(raw_relative)
    if relative.lower() == "null" or relative.strip() == "":
        base = _get_static_directory()
        return base, os.path.basename(os.path.normpath(base))

    base_output_dir = folder_paths.get_output_directory()
    if os.path.isabs(relative):
        monitor_path = os.path.normpath(relative)
    elif relative in ("./", ".", ""):
        monitor_path = base_output_dir
    else:
        monitor_path = os.path.normpath(os.path.join(base_output_dir, relative))

    if not os.path.isdir(monitor_path):
        fallback = _get_static_directory()
        return fallback, os.path.basename(os.path.normpath(fallback))

    return monitor_path, os.path.basename(monitor_path)


def _folder_key_to_path(root_path: str, root_key_normalized: str, folder_key: str) -> Optional[str]:
    normalized_folder = _normalize_folder_key_value(folder_key) if folder_key else root_key_normalized
    if not normalized_folder:
        normalized_folder = root_key_normalized

    if normalized_folder == root_key_normalized:
        return root_path

    if not normalized_folder.startswith(root_key_normalized):
        normalized_folder = f"{root_key_normalized}/{normalized_folder}"

    suffix = normalized_folder[len(root_key_normalized):].lstrip("/")
    if suffix:
        components = [part for part in suffix.split("/") if part]
        candidate = os.path.normpath(os.path.join(root_path, *components))
    else:
        candidate = root_path

    try:
        root_real = os.path.realpath(root_path)
        candidate_real = os.path.realpath(candidate)
    except FileNotFoundError:
        return None

    if not candidate_real.startswith(root_real):
        return None

    return candidate


def _parse_pagination(request) -> Tuple[int, int]:
    page_raw = request.rel_url.query.get("page", "0")
    limit_raw = request.rel_url.query.get("limit", "100")

    try:
        page = int(page_raw)
    except (TypeError, ValueError):
        page = 0
    page = max(page, 0)

    try:
        limit = int(limit_raw)
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(limit, 500))

    return page, limit

# Settings file for persistent user settings
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_settings.json")


def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            gallery_log(f"Error loading settings: {e}")
            return {}
    return {}


def save_settings_to_file(settings):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=4)
    except Exception as e:
        gallery_log(f"Error saving settings: {e}")


@PromptServer.instance.routes.get("/Gallery/list")
async def get_gallery_list(request):
    raw_relative = request.rel_url.query.get("relative_path")
    root_path, root_key = _resolve_gallery_root(raw_relative)
    normalized_root = _normalize_folder_key_value(root_key)

    settings = load_settings()
    scan_extensions = settings.get('scanExtensions', DEFAULT_EXTENSIONS)

    result_queue: queue.Queue = queue.Queue()

    def thread_target():
        with PromptServer.instance.scan_lock:
            try:
                folders_with_metadata, _ = _scan_for_images(root_path, root_key, True, scan_extensions)
                summary = {
                    _normalize_folder_key_value(folder): {"count": len(files)}
                    for folder, files in folders_with_metadata.items()
                }
                summary.setdefault(
                    normalized_root,
                    {
                        "count": len(folders_with_metadata.get(root_key, {}))
                        if root_key in folders_with_metadata
                        else 0
                    },
                )
                result_queue.put(
                    {
                        "root": normalized_root,
                        "folders": summary,
                    }
                )
            except Exception as exc:
                result_queue.put(exc)

    threading.Thread(target=thread_target, daemon=True).start()
    result = result_queue.get()

    if isinstance(result, Exception):
        gallery_log(f"Error in /Gallery/list: {result}")
        return web.Response(status=500, text=str(result))

    return web.json_response(sanitize_json_data(result))


@PromptServer.instance.routes.get("/Gallery/images/paginated")
async def get_gallery_images_paginated(request):
    raw_relative = request.rel_url.query.get("relative_path")
    root_path, root_key = _resolve_gallery_root(raw_relative)
    normalized_root = _normalize_folder_key_value(root_key)

    folder_query = request.rel_url.query.get("folder")
    target_folder = _normalize_folder_key_value(folder_query) if folder_query else normalized_root

    target_path = _folder_key_to_path(root_path, normalized_root, target_folder)
    if target_path is None:
        return web.Response(status=400, text="Invalid folder path.")
    if not os.path.isdir(target_path):
        return web.Response(status=404, text="Folder not found.")

    sort_field = request.rel_url.query.get("sort", "timestamp").lower()
    if sort_field not in ("timestamp", "name"):
        sort_field = "timestamp"
    descending = request.rel_url.query.get("order", "desc").lower() != "asc"

    # Check if we should scan recursively (for root folder, aggregate all subfolders)
    recursive_param = request.rel_url.query.get("recursive", "auto").lower()
    # Auto mode: recursive for root folder, non-recursive for subfolders
    is_root = target_folder == normalized_root or target_path == root_path
    recursive = recursive_param == "true" or (recursive_param == "auto" and is_root)

    page, limit = _parse_pagination(request)

    settings = load_settings()
    scan_extensions = settings.get('scanExtensions', DEFAULT_EXTENSIONS)

    result_queue: queue.Queue = queue.Queue()

    def thread_target():
        with PromptServer.instance.scan_lock:
            try:
                entries = []

                if recursive:
                    # Recursively scan all subdirectories
                    for dirpath, dirnames, filenames in os.walk(target_path):
                        for filename in filenames:
                            filepath = os.path.join(dirpath, filename)
                            record = build_file_entry(root_path, root_key, filepath, scan_extensions)
                            if not record:
                                continue
                            _, _, details = record
                            details["folder"] = _normalize_folder_key_value(details.get("folder") or target_folder)
                            entries.append(details)
                else:
                    # Non-recursive scan (original behavior)
                    with os.scandir(target_path) as iterator:
                        for entry in iterator:
                            if not entry.is_file():
                                continue
                            record = build_file_entry(root_path, root_key, entry.path, scan_extensions)
                            if not record:
                                continue
                            _, _, details = record
                            details["folder"] = _normalize_folder_key_value(details.get("folder") or target_folder)
                            entries.append(details)

                if sort_field == "name":
                    entries.sort(key=lambda item: str(item.get("name", "")).lower(), reverse=descending)
                else:
                    entries.sort(key=lambda item: item.get("timestamp") or 0, reverse=descending)

                total = len(entries)
                start = page * limit
                end = start + limit
                page_items = entries[start:end] if start < total else []

                result_queue.put(
                    {
                        "folder": target_folder,
                        "page": page,
                        "limit": limit,
                        "total": total,
                        "hasMore": end < total,
                        "items": page_items,
                    }
                )
            except Exception as exc:
                result_queue.put(exc)

    threading.Thread(target=thread_target, daemon=True).start()
    result = result_queue.get()
    if isinstance(result, Exception):
        gallery_log(f"Error in /Gallery/images/paginated: {result}")
        return web.Response(status=500, text=str(result))

    return web.json_response(sanitize_json_data(result))


def sanitize_json_data(data):
    """Recursively sanitizes data to be JSON serializable."""
    if isinstance(data, dict):
        return {k: sanitize_json_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_json_data(item) for item in data]
    elif isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return None
        return data
    elif isinstance(data, (int, str, bool, type(None))):
        return data
    else:
        return str(data)


@PromptServer.instance.routes.get("/Gallery/settings")
async def get_settings(request):
    return web.json_response(load_settings())


@PromptServer.instance.routes.post("/Gallery/settings")
async def save_settings(request):
    try:
        data = await request.json()
        save_settings_to_file(data)
        return web.Response(text="Settings saved")
    except Exception as e:
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.get("/Gallery/images")
async def get_gallery_images(request):
    """Endpoint to get gallery images, accepts relative_path."""
    raw_rel = request.rel_url.query.get("relative_path", "./")
    # Normalize query value: treat null/None/empty as root
    if raw_rel is None or str(raw_rel).lower() == 'null' or str(raw_rel).strip() == "":
        relative_path = "./"
    else:
        relative_path = raw_rel

    # Fix: Only join if relative_path is not absolute or '.'
    base_output_dir = folder_paths.get_output_directory()
    if os.path.isabs(relative_path):
        full_monitor_path = os.path.normpath(relative_path)
    elif relative_path in ("./", ".", ""):  # treat as root
        full_monitor_path = base_output_dir
    else:
        full_monitor_path = os.path.normpath(os.path.join(base_output_dir, relative_path))

    # Use a thread-safe queue to communicate between threads.
    result_queue = queue.Queue()

    def thread_target():
        """Target function for the scanning thread."""
        with PromptServer.instance.scan_lock:
            try:
                # Load saved settings to determine extensions
                saved = load_settings()
                scan_extensions = saved.get('scanExtensions', DEFAULT_EXTENSIONS)
                # Use the actual folder name as the root key
                folder_name = os.path.basename(full_monitor_path)
                folders_with_metadata, _ = _scan_for_images(
                    full_monitor_path, folder_name, True, scan_extensions
                )
                result_queue.put(folders_with_metadata)  # Put the result in the queue
            except Exception as e:
                result_queue.put(e)  # Put the exception in the queue

    def on_scan_complete(folders_with_metadata):
            """Callback executed in the main thread to send the response."""

            try:
                if isinstance(folders_with_metadata, Exception):
                    gallery_log(f"Error in /Gallery/images: {folders_with_metadata}")
                    import traceback
                    traceback.print_exc()
                    return web.Response(status=500, text=str(folders_with_metadata))

                sanitized_folders = sanitize_json_data(folders_with_metadata)
                return web.json_response({"folders": sanitized_folders})
            except Exception as e:
                    gallery_log(f"Error in on_scan_complete: {e}")
                    return web.Response(status=500, text=str(e))


    # Start the scanning in a separate thread.
    scan_thread = threading.Thread(target=thread_target)
    scan_thread.start()
    # Wait result and process it.
    result = result_queue.get() # BLOCKING call
    return on_scan_complete(result)



@PromptServer.instance.routes.get("/Gallery/metadata/{encoded_path:.*}")
async def get_gallery_metadata(request):
    encoded_path = request.match_info.get("encoded_path", "")
    relative_path = unquote(encoded_path)
    if not relative_path:
        return web.Response(status=400, text="File path is required.")

    full_path = _resolve_static_file(relative_path)
    if full_path is None:
        return web.Response(status=403, text="Access denied.")
    if not os.path.exists(full_path):
        return web.Response(status=404, text="File not found.")

    refresh_flag = request.rel_url.query.get("refresh", "0").lower()
    force_refresh = refresh_flag in ("1", "true", "yes")

    metadata = extract_metadata_for_file(full_path, force_refresh=force_refresh)
    normalized_relative = _normalize_gallery_relative_path(relative_path)
    extension = os.path.splitext(full_path)[1].lower()
    thumbnail_url = None
    if extension in IMAGE_EXTENSIONS:
        thumbnail_url = ensure_thumbnail_for(full_path, normalized_relative)

    if metadata is None:
        return web.json_response(
            {
                "path": normalized_relative,
                "metadata": None,
                "metadata_pending": False,
                "thumbnail_url": thumbnail_url,
                "thumbnail_pending": thumbnail_url is None,
            }
        )

    sanitized_metadata = sanitize_json_data(metadata)
    return web.json_response(
        {
            "path": normalized_relative,
            "metadata": sanitized_metadata,
            "metadata_pending": False,
            "thumbnail_url": thumbnail_url,
            "thumbnail_pending": thumbnail_url is None,
        }
    )


@PromptServer.instance.routes.post("/Gallery/monitor/start")
async def start_gallery_monitor(request):
    """Endpoint to start gallery monitoring, accepts relative_path."""
    global monitor
    from . import gallery_config
    try:
        data = await request.json()
        # Normalize relative_path: if missing, null, or literal 'null', treat as root
        relative_path = data.get("relative_path", "./")
        if relative_path is None or str(relative_path).lower() == 'null' or str(relative_path).strip() == "":
            relative_path = "./"
        gallery_config.disable_logs = data.get("disable_logs", False)
        gallery_config.use_polling_observer = data.get("use_polling_observer", False)
        scan_extensions = data.get("scan_extensions", DEFAULT_EXTENSIONS)
        disable_logs = gallery_config.disable_logs
        use_polling_observer = gallery_config.use_polling_observer
        full_monitor_path = os.path.normpath(os.path.join(folder_paths.get_output_directory(), "..", "output", relative_path))
        gallery_log("disable_logs", disable_logs)
        gallery_log("use_polling_observer", use_polling_observer)
        if monitor and monitor.thread and monitor.thread.is_alive():
            gallery_log("FileSystemMonitor: Monitor already running, stopping previous monitor.")
            monitor.stop_monitoring()
        if not os.path.isdir(full_monitor_path):
            return web.Response(status=400, text=f"Invalid relative_path: {relative_path}, path not found")
        for route in PromptServer.instance.app.router.routes():
            if route.name == 'static_gallery_placeholder':
                route.resource._directory = pathlib.Path(full_monitor_path)
                gallery_log(f"Serving static files from {full_monitor_path} at /static_gallery")
                break
        else:
            gallery_log("Error: Placeholder static route not found!")
            return web.Response(status=500, text="Placeholder route not found.")
        monitor = FileSystemMonitor(full_monitor_path, interval=1.0, use_polling_observer=use_polling_observer, extensions=scan_extensions)
        monitor.start_monitoring()
        return web.Response(text="Gallery monitor started", content_type="text/plain")
    except Exception as e:
        gallery_log(f"Error starting gallery monitor: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.post("/Gallery/monitor/stop")
async def stop_gallery_monitor(request):
    """Endpoint to stop gallery monitoring."""
    global monitor
    from .gallery_config import gallery_log
    if monitor and monitor.thread and monitor.thread.is_alive():
        monitor.stop_monitoring()
        monitor = None
    for route in PromptServer.instance.app.router.routes():
        if route.name == 'static_gallery_placeholder':
            route.resource._directory = pathlib.Path(PLACEHOLDER_DIR)
            gallery_log(f"Serving static files from {PLACEHOLDER_DIR} at /static_gallery")
            break
    return web.Response(text="Gallery monitor stopped", content_type="text/plain")

@PromptServer.instance.routes.patch("/Gallery/updateImages")
async def newSettings(request):
    # This route is no longer used
    return web.Response(status=200)

@PromptServer.instance.routes.post("/Gallery/delete")
async def delete_image(request):
    """Endpoint to delete an image."""
    from .gallery_config import gallery_log
    try:
        data = await request.json()
        image_url = data.get("image_path")
        if not image_url:
            return web.Response(status=400, text="image_path is required")
        if not image_url.startswith("/static_gallery/"):
            return web.Response(status=400, text="Invalid image_path format")

        full_image_path = _resolve_static_file(image_url)
        if full_image_path is None:
            return web.Response(status=403, text="Access denied: File outside of static directory")
        if not os.path.exists(full_image_path):
            return web.Response(status=404, text=f"File not found: {full_image_path}")
        os.remove(full_image_path)
        invalidate_cached_metadata(full_image_path)
        return web.Response(text=f"Image deleted: {image_url}")
    except Exception as e:
        gallery_log(f"Error deleting image: {e}")
        return web.Response(status=500, text=str(e))

@PromptServer.instance.routes.post("/Gallery/move")
async def move_image(request):
    """Endpoint to move an image to a new location, relative to the current gallery root (current_path)."""
    from .gallery_config import disable_logs, gallery_log
    try:
        data = await request.json()
        source_path = data.get("source_path")
        target_path = data.get("target_path")
        current_path = data.get("current_path") or data.get("relative_path") or "./"
        gallery_log(f"source_path: {source_path}")
        gallery_log(f"target_path: {target_path}")
        gallery_log(f"current_path: {current_path}")
        if not source_path or not target_path:
            return web.Response(status=400, text="source_path and target_path are required")
        static_dir = _get_static_directory()
        static_dir_basename = os.path.basename(os.path.normpath(static_dir))
        def make_path(p):
            if os.path.isabs(p):
                return os.path.normpath(p)
            if p.startswith(static_dir_basename + os.sep):
                p = p[len(static_dir_basename + os.sep):]
            elif p.startswith(static_dir_basename + "/"):
                p = p[len(static_dir_basename + "/") :]
            normalized = _normalize_gallery_relative_path(p)
            return os.path.normpath(os.path.join(static_dir, normalized))
        full_source_path = make_path(source_path)
        full_target_path = make_path(target_path)
        gallery_log(f"static_dir: {static_dir}")
        gallery_log(f"full_source_path: {full_source_path}")
        gallery_log(f"full_target_path: {full_target_path}")
        if not os.path.exists(full_source_path):
            return web.Response(status=404, text=f"Source file not found: {full_source_path}")
        if not os.path.realpath(full_source_path).startswith(os.path.realpath(static_dir)) or \
            not os.path.realpath(full_target_path).startswith(os.path.realpath(static_dir)) or \
            not os.path.realpath(full_source_path).startswith(os.path.realpath(comfy_path)) or \
            not os.path.realpath(full_target_path).startswith(os.path.realpath(comfy_path)):
            return web.Response(status=403, text="Access denied: File outside of allowed directory")
        if os.path.isdir(full_target_path):
            full_target_path = os.path.join(full_target_path, os.path.basename(full_source_path))
        target_dir = os.path.dirname(full_target_path)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)
        shutil.move(full_source_path, full_target_path)
        invalidate_cached_metadata(full_source_path)
        invalidate_cached_metadata(full_target_path)
        return web.Response(text=f"Image moved from {source_path} to {target_path}")
    except Exception as e:
        gallery_log(f"Error moving image: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))


# Favorites functionality
FAVORITES_FOLDER_NAME = "_favorites"

def _get_favorites_folder():
    """Get the favorites folder path, creating it if it doesn't exist."""
    static_dir = _get_static_directory()
    favorites_path = os.path.join(static_dir, FAVORITES_FOLDER_NAME)
    if not os.path.exists(favorites_path):
        os.makedirs(favorites_path, exist_ok=True)
    return favorites_path

def _is_in_favorites(file_path: str) -> bool:
    """Check if a file is in the favorites folder."""
    favorites_folder = _get_favorites_folder()
    real_file = os.path.realpath(file_path)
    real_favorites = os.path.realpath(favorites_folder)
    return real_file.startswith(real_favorites + os.sep)

@PromptServer.instance.routes.post("/Gallery/favorite/toggle")
async def toggle_favorite(request):
    """Toggle favorite status of an image by moving it to/from the favorites folder."""
    from .gallery_config import gallery_log
    try:
        data = await request.json()
        image_url = data.get("image_path")
        if not image_url:
            return web.Response(status=400, text="image_path is required")

        # Resolve the file path
        full_path = _resolve_static_file(image_url)
        if full_path is None:
            return web.Response(status=403, text="Access denied")
        if not os.path.exists(full_path):
            return web.Response(status=404, text="File not found")

        static_dir = _get_static_directory()
        favorites_folder = _get_favorites_folder()
        filename = os.path.basename(full_path)

        is_favorite = _is_in_favorites(full_path)

        if is_favorite:
            # Move OUT of favorites - back to root
            new_path = os.path.join(static_dir, filename)
            # Handle filename conflicts
            counter = 1
            base_name, ext = os.path.splitext(filename)
            while os.path.exists(new_path):
                new_path = os.path.join(static_dir, f"{base_name}_{counter}{ext}")
                counter += 1
            shutil.move(full_path, new_path)
            invalidate_cached_metadata(full_path)
            invalidate_cached_metadata(new_path)
            # Calculate new URL
            new_relative = os.path.relpath(new_path, static_dir).replace("\\", "/")
            new_url = f"/static_gallery/{new_relative}"
            gallery_log(f"Removed from favorites: {filename}")
            return web.json_response({
                "is_favorite": False,
                "new_path": new_url,
                "message": f"Removed from favorites: {filename}"
            })
        else:
            # Move INTO favorites
            new_path = os.path.join(favorites_folder, filename)
            # Handle filename conflicts
            counter = 1
            base_name, ext = os.path.splitext(filename)
            while os.path.exists(new_path):
                new_path = os.path.join(favorites_folder, f"{base_name}_{counter}{ext}")
                counter += 1
            shutil.move(full_path, new_path)
            invalidate_cached_metadata(full_path)
            invalidate_cached_metadata(new_path)
            # Calculate new URL
            new_relative = os.path.relpath(new_path, static_dir).replace("\\", "/")
            new_url = f"/static_gallery/{new_relative}"
            gallery_log(f"Added to favorites: {filename}")
            return web.json_response({
                "is_favorite": True,
                "new_path": new_url,
                "message": f"Added to favorites: {filename}"
            })
    except Exception as e:
        gallery_log(f"Error toggling favorite: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.get("/Gallery/favorites")
async def get_favorites(request):
    """Get list of all favorited images."""
    try:
        favorites_folder = _get_favorites_folder()
        static_dir = _get_static_directory()
        favorites = []

        if os.path.exists(favorites_folder):
            for filename in os.listdir(favorites_folder):
                file_path = os.path.join(favorites_folder, filename)
                if os.path.isfile(file_path):
                    relative = os.path.relpath(file_path, static_dir).replace("\\", "/")
                    favorites.append(f"/static_gallery/{relative}")

        return web.json_response({"favorites": favorites})
    except Exception as e:
        from .gallery_config import gallery_log
        gallery_log(f"Error getting favorites: {e}")
        return web.json_response({"favorites": []})
