import os
from datetime import datetime
from typing import Dict, Optional, Tuple

from .metadata_cache import get_metadata_cache
from .metadata_extractor import buildMetadata
from .thumbnail_service import hydrate_thumbnail_metadata

# Default extensions include images, media and audio
DEFAULT_EXTENSIONS = [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",  # Images
    ".mp4",
    ".gif",
    ".webm",
    ".mov",  # Media
    ".wav",
    ".mp3",
    ".m4a",
    ".flac",  # Audio
]

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MEDIA_EXTENSIONS = {".mp4", ".gif", ".webm", ".mov"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac"}


def _normalize_extensions(allowed_extensions) -> Tuple[str, ...]:
    if not allowed_extensions:
        allowed_extensions = DEFAULT_EXTENSIONS
    return tuple(
        ext.lower() if ext.startswith(".") else f".{ext.lower()}"
        for ext in allowed_extensions
    )


def _determine_file_type(extension: str) -> str:
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in MEDIA_EXTENSIONS:
        return "media"
    if extension in AUDIO_EXTENSIONS:
        return "audio"
    return "unknown"


def _format_url(subfolder: str, filename: str) -> str:
    if subfolder:
        return f"/static_gallery/{subfolder}/{filename}".replace("\\", "/")
    return f"/static_gallery/{filename}".replace("\\", "/")


def _build_file_entry(
    full_base_path: str,
    root_key: str,
    full_path: str,
    allowed_extensions: Tuple[str, ...],
) -> Optional[Tuple[str, str, Dict[str, object]]]:
    if not os.path.isfile(full_path):
        return None

    extension = os.path.splitext(full_path)[1].lower()
    if allowed_extensions and extension not in allowed_extensions:
        return None

    try:
        timestamp = os.path.getmtime(full_path)
        date_str = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
        rel_dir = os.path.relpath(os.path.dirname(full_path), full_base_path)
        subfolder = "" if rel_dir == "." else rel_dir
        folder_key = os.path.join(root_key, subfolder) if subfolder else root_key
        filename = os.path.basename(full_path)
        url_path = _format_url(subfolder, filename)
        file_type = _determine_file_type(extension)

        entry = {
            "name": filename,
            "url": url_path,
            "timestamp": timestamp,
            "date": date_str,
            "metadata": None,
            "type": file_type,
            "metadata_pending": file_type == "image",
            "folder": folder_key.replace("\\", "/"),
        }
        relative_path = os.path.join(subfolder, filename) if subfolder else filename
        if file_type == "image":
            entry = hydrate_thumbnail_metadata(entry, full_path, relative_path)
        else:
            entry["thumbnail_url"] = None
            entry["thumbnail_pending"] = False
        return folder_key, filename, entry
    except Exception as exc:
        print(f"Gallery Node: Error preparing file entry for {full_path}: {exc}")
        return None


def _scan_for_images(full_base_path, base_path, include_subfolders, allowed_extensions=None):
    """Scans directories for files matching allowed extensions without extracting metadata."""
    allowed_extensions_tuple = _normalize_extensions(allowed_extensions)

    folders_data: Dict[str, Dict[str, Dict[str, object]]] = {}

    def scan_directory(dir_path: str, relative_path: str = "") -> None:
        try:
            entries = os.listdir(dir_path)
        except Exception as exc:
            print(f"Gallery Node: Error reading directory {dir_path}: {exc}")
            return

        folder_content: Dict[str, Dict[str, object]] = {}
        for entry in entries:
            full_path = os.path.join(dir_path, entry)
            if os.path.isdir(full_path):
                if include_subfolders and not entry.startswith("."):
                    next_relative = os.path.join(relative_path, entry)
                    scan_directory(full_path, next_relative)
                continue

            result = _build_file_entry(full_base_path, base_path, full_path, allowed_extensions_tuple)
            if result:
                folder_key, filename, entry_data = result
                if folder_key not in folders_data:
                    folders_data[folder_key] = {}
                folders_data[folder_key][filename] = entry_data
                folder_content[filename] = entry_data

        if folder_content:
            folder_key = os.path.join(base_path, relative_path) if relative_path else base_path
            folders_data.setdefault(folder_key, {}).update(folder_content)

    scan_directory(full_base_path, "")
    return folders_data, False


def extract_metadata_for_file(file_path: str, force_refresh: bool = False) -> Optional[Dict[str, object]]:
    """Extract metadata for a single file, leveraging the shared metadata cache."""
    if not os.path.isfile(file_path):
        return None

    extension = os.path.splitext(file_path)[1].lower()
    if extension not in IMAGE_EXTENSIONS:
        return None

    cache = get_metadata_cache()
    try:
        mtime = os.path.getmtime(file_path)
        size = os.path.getsize(file_path)
    except OSError:
        return None

    if not force_refresh:
        cached = cache.get(file_path, mtime, size)
        if cached is not None:
            return cached

    try:
        image, _, metadata = buildMetadata(file_path)
        try:
            metadata = metadata or {}
        finally:
            try:
                image.close()
            except Exception:
                pass
    except Exception as exc:
        print(f"Gallery Node: Error extracting metadata for {file_path}: {exc}")
        metadata = {}

    cache.set(file_path, mtime, size, metadata)
    return metadata


def invalidate_cached_metadata(file_path: str) -> None:
    cache = get_metadata_cache()
    cache.invalidate(file_path)


def build_file_entry(full_base_path: str, base_path: str, file_path: str, allowed_extensions=None):
    allowed_extensions_tuple = _normalize_extensions(allowed_extensions)
    return _build_file_entry(full_base_path, base_path, file_path, allowed_extensions_tuple)
