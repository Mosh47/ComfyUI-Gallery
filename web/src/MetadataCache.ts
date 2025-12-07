import { parseComfyMetadata } from './metadata-parser/metadataParser';
import type { FileDetails } from './types';

type ParsedMetadata = Record<string, string>;

type CacheEntry = {
    parsed: ParsedMetadata;
    raw: FileDetails['metadata'] | Record<string, never>;
    pending: boolean;
};

const metadataCache = new Map<string, CacheEntry>();

const resolveCacheKey = (file?: FileDetails): string | undefined => {
    if (!file) return undefined;
    if (file.url) return file.url;
    if (file.folder && file.name) return `${file.folder}/${file.name}`;
    return file.name ?? undefined;
};

export function getCachedMetadata(file?: FileDetails | null): ParsedMetadata {
    if (!file) return {};
    const key = resolveCacheKey(file);
    if (!key) return {};
    const rawMetadata = file.metadata ?? {};
    const pending = !!file.metadata_pending;
    const entry = metadataCache.get(key);
    if (entry && entry.raw === rawMetadata && entry.pending === pending) {
        return entry.parsed;
    }
    const parsed = parseComfyMetadata(rawMetadata);
    metadataCache.set(key, { parsed, raw: rawMetadata, pending });
    return parsed;
}

export function invalidateMetadataCacheByUrl(url?: string) {
    if (!url) return;
    metadataCache.delete(url);
}

export function invalidateMetadataCache(file?: FileDetails | null) {
    const key = resolveCacheKey(file ?? undefined);
    if (!key) return;
    metadataCache.delete(key);
}

export function clearMetadataCache() {
    metadataCache.clear();
}
