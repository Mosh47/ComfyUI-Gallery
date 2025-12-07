import hashlib
import os
import threading
from typing import Optional, Tuple

from PIL import Image

from .gallery_config import gallery_log


COMFY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THUMBNAIL_DIR = os.path.join(COMFY_ROOT, "gallery_thumbnails")
THUMBNAIL_ROUTE = "/static_gallery_thumbnails"
DEFAULT_SIZE = (350, 350)

_lock = threading.RLock()


def _normalize_relative_path(relative_path: str) -> str:
    normalized = os.path.normpath(relative_path).replace("\\", "/")
    normalized = normalized.lstrip("./")
    while normalized.startswith("../"):
        normalized = normalized[3:]
    return normalized.lstrip("/")


def _thumbnail_identifier(relative_path: str) -> Tuple[str, str, str]:
    normalized = _normalize_relative_path(relative_path)
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
    folder = os.path.dirname(normalized)
    stem, _ = os.path.splitext(os.path.basename(normalized))
    filename = f"{stem}_{digest}.webp" if stem else f"{digest}.webp"
    abs_dir = os.path.join(THUMBNAIL_DIR, folder)
    abs_path = os.path.join(abs_dir, filename)
    url = f"{THUMBNAIL_ROUTE}/{folder}/{filename}" if folder else f"{THUMBNAIL_ROUTE}/{filename}"
    return abs_dir, abs_path, url.replace("//", "/")


def _ensure_directory(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def get_existing_thumbnail(full_path: str, relative_path: str) -> Optional[str]:
    abs_dir, abs_path, url = _thumbnail_identifier(relative_path)

    if not os.path.exists(abs_path):
        return None

    try:
        source_mtime = os.path.getmtime(full_path)
        thumb_mtime = os.path.getmtime(abs_path)
    except OSError:
        return None

    if thumb_mtime < source_mtime:
        return None

    return url


def ensure_thumbnail_for(full_path: str, relative_path: str, size: Tuple[int, int] = DEFAULT_SIZE) -> Optional[str]:
    if not os.path.isfile(full_path):
        return None

    abs_dir, abs_path, url = _thumbnail_identifier(relative_path)
    with _lock:
        existing = get_existing_thumbnail(full_path, relative_path)
        if existing:
            return existing

        try:
            _ensure_directory(abs_dir)
            with Image.open(full_path) as image:
                image.thumbnail(size)
                image.save(abs_path, "WEBP", quality=82, method=6)
        except Exception as exc:
            gallery_log(f"ThumbnailService: Failed to build thumbnail for {full_path}: {exc}")
            if os.path.exists(abs_path):
                try:
                    os.remove(abs_path)
                except OSError:
                    pass
            return None

    return url


def remove_thumbnail_for(full_path: str, relative_path: str) -> None:
    _, abs_path, _ = _thumbnail_identifier(relative_path)
    with _lock:
        if os.path.exists(abs_path):
            try:
                os.remove(abs_path)
            except OSError:
                pass


def hydrate_thumbnail_metadata(entry: dict, full_path: str, relative_path: str) -> dict:
    """Attach thumbnail metadata to a gallery entry."""
    thumbnail_url = get_existing_thumbnail(full_path, relative_path)
    entry["thumbnail_url"] = thumbnail_url
    entry["thumbnail_pending"] = thumbnail_url is None
    return entry
