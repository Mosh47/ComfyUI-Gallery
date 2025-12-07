import React, {
    createContext,
    useContext,
    useState,
    useMemo,
    useEffect,
    useCallback,
    useRef,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useSize from 'ahooks/lib/useSize';
import useAsyncEffect from 'ahooks/lib/useAsyncEffect';
import { useEventListener, useLocalStorageState, useClickAway } from 'ahooks';
import type { FileDetails, FolderListResponse, PaginatedImagesResponse } from './types';
import type { AutoCompleteProps } from 'antd/es/auto-complete';
import { ComfyAppApi, BASE_PATH, OPEN_BUTTON_ID } from './ComfyAppApi';
import { clearMetadataCache, invalidateMetadataCacheByUrl } from './MetadataCache';
import { parseComfyMetadata } from './metadata-parser/metadataParser';
import { favoritesStore } from './favoritesStore';

type FolderState = {
    items: FileDetails[];
    total: number;
    pageSize: number;
    loadedPages: number[];
    hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 120;
const FAVORITES_FOLDER = '_favorites';

const normalizeFolderKey = (value: string) => (value ? value.replace(/\\/g, "/") : "");

const createEmptyFolderState = (total = 0, pageSize = DEFAULT_PAGE_SIZE): FolderState => ({
    items: [],
    total,
    pageSize,
    loadedPages: [],
    hasMore: total > 0,
});

export interface SettingsState {
    relativePath: string;
    buttonBoxQuery: string;
    buttonLabel: string;
    showDateDivider: boolean;
    floatingButton: boolean;
    autoPlayVideos: boolean;
    hideOpenButton: boolean;
    darkMode: boolean;
    galleryShortcut: boolean;
    expandAllFolders: boolean;
    disableLogs: boolean;
    usePollingObserver: boolean;
    scanExtensions: string[];
}

export const DEFAULT_SETTINGS: SettingsState = {
    relativePath: './',
    buttonBoxQuery: 'div.flex.gap-2.mx-2',
    buttonLabel: 'Gallery',
    showDateDivider: true,
    floatingButton: true,
    autoPlayVideos: true,
    hideOpenButton: false,
    darkMode: true, // Default to dark mode
    galleryShortcut: true,
    expandAllFolders: true,
    disableLogs: true, // Less noise by default
    usePollingObserver: false,
    scanExtensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'gif', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'flac'],
};
export const STORAGE_KEY = 'comfy-ui-gallery-settings';

export interface GalleryContextType {
    currentFolder: string;
    setCurrentFolder: Dispatch<SetStateAction<string>>;
    rootFolder: string;
    folderCounts: Record<string, number>;
    loadMore: (folder?: string) => Promise<void>;
    refreshFolder: (folder?: string) => Promise<void>;
    getLoadedItems: (folder: string) => FileDetails[];
    hasMore: boolean;
    isLoadingMore: boolean;
    loading: boolean;
    error: any;
    searchFileName: string;
    setSearchFileName: Dispatch<SetStateAction<string>>;
    searchMode: 'prompt' | 'filename';
    setSearchMode: Dispatch<SetStateAction<'prompt' | 'filename'>>;
    showDateDivider: boolean;
    showSettings: boolean;
    setShowSettings: Dispatch<SetStateAction<boolean>>;
    showRawMetadata: boolean;
    setShowRawMetadata: Dispatch<SetStateAction<boolean>>;
    sortMethod: 'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓';
    setSortMethod: Dispatch<SetStateAction<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>>;
    imageInfoName: string | undefined;
    setImageInfoName: Dispatch<SetStateAction<string | undefined>>;
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    previewingVideo: string | undefined;
    setPreviewingVideo: Dispatch<SetStateAction<string | undefined>>;
    size: ReturnType<typeof useSize>;
    imagesBoxSize: ReturnType<typeof useSize>;
    gridSize: { width: number; height: number; columnCount: number; rowCount: number };
    setGridSize: Dispatch<SetStateAction<{ width: number; height: number; columnCount: number; rowCount: number }>>;
    autoSizer: { width: number; height: number };
    setAutoSizer: Dispatch<SetStateAction<{ width: number; height: number }>>;
    imagesDetailsList: FileDetails[];
    imagesUrlsLists: string[];
    imagesAutoCompleteNames: NonNullable<AutoCompleteProps['options']>;
    autoCompleteOptions: NonNullable<AutoCompleteProps['options']>;
    setAutoCompleteOptions: React.Dispatch<React.SetStateAction<NonNullable<AutoCompleteProps['options']>>>;
    settings: SettingsState;
    setSettings: (v: SettingsState) => void;
    selectedImages: string[];
    setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
    siderCollapsed: boolean;
    setSiderCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    updateFileMetadata: (folder: string, filename: string, metadata: any, metadataPending: boolean) => void;
    lastSelectedIndex: number;
    setLastSelectedIndex: Dispatch<SetStateAction<number>>;
    deleteImages: (urls: string[]) => Promise<void>;
    deleteFolder: (folderKey: string) => Promise<void>;
    // Favorites are now handled by favoritesStore + useFavorite hook for granular updates
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

export function GalleryProvider({ children }: { children: React.ReactNode }) {
    const [currentFolderInternal, setCurrentFolderInternal] = useState("");
    const [rootFolder, setRootFolder] = useState("");
    const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
    const [folderData, setFolderData] = useState<Record<string, FolderState>>({});
    const folderDataRef = useRef<Record<string, FolderState>>({});
    // Keep ref in sync with state for use in callbacks without re-triggering effects
    useEffect(() => {
        folderDataRef.current = folderData;
    }, [folderData]);
    const [searchFileName, setSearchFileName] = useState("");
    const [searchMode, setSearchMode] = useState<'prompt' | 'filename'>('prompt');
    const [showSettings, setShowSettings] = useState(false);
    const [showRawMetadata, setShowRawMetadata] = useState(false);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
    // Favorites are now in favoritesStore (subscription-based for granular updates)
    const size = useSize(document.querySelector('body'));
    const imagesBoxSize = useSize(document.querySelector('#imagesBox'));
    const [gridSize, setGridSize] = useState({ width: 1000, height: 600, columnCount: 1, rowCount: 1 });
    const [autoSizer, setAutoSizer] = useState({ width: 1000, height: 600 });
    const [autoCompleteOptions, setAutoCompleteOptions] = useState<NonNullable<AutoCompleteProps['options']>>([]);
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });
    const [loading, setLoading] = useState(false);
    const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<any>(null);

    // Prompt search index (url -> positive prompt lowercased)
    // Stored in ref to avoid re-renders when index updates
    const promptIndexRef = useRef<Map<string, string>>(new Map());

    // ========================================================================
    // DELETED FOLDERS GRACE PERIOD TRACKING
    // When a folder is deleted, we track it here to ignore real-time events
    // that might try to re-add it before the backend fully processes the deletion.
    // Map<normalizedFolderKey, deletionTimestamp>
    // ========================================================================
    const deletedFoldersRef = useRef<Map<string, number>>(new Map());
    const DELETED_FOLDER_GRACE_PERIOD_MS = 10000; // 10 seconds grace period

    // Check if a folder (or any of its parents) is in the deleted grace period
    const isFolderDeletePending = useCallback((folderKey: string): boolean => {
        const normalized = normalizeFolderKey(folderKey);
        if (!normalized) return false;

        const now = Date.now();
        // Check this exact folder
        const deletedAt = deletedFoldersRef.current.get(normalized);
        if (deletedAt && now - deletedAt < DELETED_FOLDER_GRACE_PERIOD_MS) {
            return true;
        }

        // Check if any parent folder is deleted (subfolder of a deleted folder)
        for (const [deletedFolder, timestamp] of deletedFoldersRef.current.entries()) {
            if (now - timestamp < DELETED_FOLDER_GRACE_PERIOD_MS) {
                if (normalized.startsWith(deletedFolder + '/')) {
                    return true;
                }
            }
        }

        return false;
    }, []);

    // Cleanup stale entries from deletedFoldersRef periodically
    const cleanupDeletedFoldersTracking = useCallback(() => {
        const now = Date.now();
        for (const [folder, timestamp] of deletedFoldersRef.current.entries()) {
            if (now - timestamp > DELETED_FOLDER_GRACE_PERIOD_MS * 2) {
                deletedFoldersRef.current.delete(folder);
            }
        }
    }, []);

    const currentFolder = normalizeFolderKey(currentFolderInternal);
    const currentFolderRef = useRef<string>(currentFolder);

    const setCurrentFolder = useCallback((value: SetStateAction<string>) => {
        if (typeof value === "function") {
            setCurrentFolderInternal(prev => normalizeFolderKey((value as (prevState: string) => string)(prev)));
        } else {
            setCurrentFolderInternal(normalizeFolderKey(value));
        }
    }, []);

    useEffect(() => {
        currentFolderRef.current = currentFolder;
    }, [currentFolder]);

    const saveSettings = useCallback((newSettings: SettingsState) => {
        setSettings(newSettings);
        ComfyAppApi.saveSettings(newSettings);
    }, [setSettings]);

    const loadFolderList = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await ComfyAppApi.fetchFolderList(settingsState?.relativePath);
            if (!response?.ok) {
                const text = response ? await response.text() : '';
                throw new Error(text || 'Failed to load folder list');
            }
            const payload: FolderListResponse = await response.json();
            const normalizedFolders: Record<string, number> = {};
            if (payload?.folders) {
                Object.entries(payload.folders).forEach(([key, value]) => {
                    const normalizedKey = normalizeFolderKey(key);
                    // Skip folders that are pending deletion
                    if (isFolderDeletePending(normalizedKey)) return;
                    const numericValue = typeof value?.count === 'number' ? value.count : Number(value?.count ?? 0);
                    normalizedFolders[normalizedKey] = Number.isFinite(numericValue) ? numericValue : 0;
                });
            }
            const normalizedRoot = normalizeFolderKey(payload?.root || Object.keys(normalizedFolders)[0] || rootFolder);
            if (normalizedRoot && !(normalizedRoot in normalizedFolders) && !isFolderDeletePending(normalizedRoot)) {
                normalizedFolders[normalizedRoot] = normalizedFolders[normalizedRoot] ?? 0;
            }
            setRootFolder(normalizedRoot);
            setFolderCounts(normalizedFolders);
            setFolderData(prev => {
                const next: Record<string, FolderState> = {};
                Object.entries(normalizedFolders).forEach(([folderKey, count]) => {
                    // Double-check deletion status
                    if (isFolderDeletePending(folderKey)) return;
                    const existing = prev[folderKey];
                    next[folderKey] = existing
                        ? { ...existing, total: count, hasMore: count > existing.items.length }
                        : createEmptyFolderState(count);
                });
                return next;
            });
            return normalizedRoot;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [settingsState?.relativePath, rootFolder, isFolderDeletePending]);

    const loadFolderPage = useCallback(async (folder: string, page = 0, replace = false) => {
        const normalizedFolder = normalizeFolderKey(folder || currentFolderRef.current || rootFolder);
        if (!normalizedFolder) {
            return;
        }
        // Skip loading if this folder is pending deletion - prevents flicker from
        // attempting to load data for a folder that's being removed
        if (isFolderDeletePending(normalizedFolder)) {
            return;
        }
        let resolvedFolder = normalizedFolder;
        setLoadingFolders(prev => ({ ...prev, [normalizedFolder]: true }));
        setError(null);
        try {
            const response = await ComfyAppApi.fetchImagesPage({
                folder: normalizedFolder,
                page,
                limit: DEFAULT_PAGE_SIZE,
                relativePath: settingsState?.relativePath,
            });
            if (!response?.ok) {
                const text = response ? await response.text() : '';
                throw new Error(text || 'Failed to load images');
            }
            const payload: PaginatedImagesResponse = await response.json();
            resolvedFolder = normalizeFolderKey(payload.folder || normalizedFolder);
            const normalizedItems = (payload.items ?? []).map(item => ({
                ...item,
                folder: normalizeFolderKey(item.folder || resolvedFolder),
            }));
            setFolderCounts(prev => ({
                ...prev,
                [resolvedFolder]: payload.total,
            }));
            setFolderData(prev => {
                const previousState = replace ? undefined : prev[resolvedFolder];
                const baseItems = replace ? [] : previousState?.items ?? [];
                const itemsMap = new Map(baseItems.map(item => [item.url, item]));
                normalizedItems.forEach(item => {
                    itemsMap.set(item.url, item);
                });
                let mergedItems = Array.from(itemsMap.values());
                mergedItems.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
                const pageSize = payload.limit || previousState?.pageSize || DEFAULT_PAGE_SIZE;
                const loadedPages = replace ? [page] : [...(previousState?.loadedPages ?? [])];
                if (!loadedPages.includes(page)) {
                    loadedPages.push(page);
                    loadedPages.sort((a, b) => a - b);
                }
                if (loadedPages.length > 0) {
                    const maxItems = loadedPages.length * pageSize;
                    if (mergedItems.length > maxItems) {
                        mergedItems = mergedItems.slice(0, maxItems);
                    }
                }
                return {
                    ...prev,
                    [resolvedFolder]: {
                        items: mergedItems,
                        total: payload.total,
                        pageSize,
                        loadedPages,
                        hasMore: payload.hasMore,
                    },
                };
            });
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoadingFolders(prev => {
                const next = { ...prev };
                delete next[normalizedFolder];
                if (resolvedFolder !== normalizedFolder) {
                    delete next[resolvedFolder];
                }
                return next;
            });
        }
    }, [settingsState?.relativePath, rootFolder, isFolderDeletePending]);

    const handleRealtimeChanges = useCallback((payload: any) => {
        if (!payload) return;

        // Cleanup stale deleted folder entries on each real-time event
        cleanupDeletedFoldersTracking();

        const totalsRaw = payload.totals ?? {};
        const normalizedTotals: Record<string, number> = {};
        Object.entries(totalsRaw).forEach(([key, value]) => {
            const normalizedKey = normalizeFolderKey(key);
            if (!normalizedKey) return;
            // IMPORTANT: Skip folders that are in the deletion grace period
            // This prevents deleted folders from being re-added by stale events
            if (isFolderDeletePending(normalizedKey)) {
                return;
            }
            const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
            normalizedTotals[normalizedKey] = Number.isFinite(numericValue) ? numericValue : 0;
        });
        if (Object.keys(normalizedTotals).length > 0) {
            setFolderCounts(prev => {
                const next = { ...prev };
                Object.entries(normalizedTotals).forEach(([key, count]) => {
                    // Double-check in case deletion happened between filtering and state update
                    if (isFolderDeletePending(key)) return;
                    next[key] = count;
                });
                return next;
            });
            setFolderData(prev => {
                const next: Record<string, FolderState> = { ...prev };
                Object.entries(normalizedTotals).forEach(([key, count]) => {
                    // Skip deleted folders
                    if (isFolderDeletePending(key)) return;
                    const existing = next[key];
                    if (existing) {
                        next[key] = {
                            ...existing,
                            total: count,
                            hasMore: count > existing.items.length,
                        };
                    } else {
                        next[key] = createEmptyFolderState(count);
                    }
                });
                return next;
            });
        }
        const changes = Array.isArray(payload.changes) ? payload.changes : [];
        if (!changes.length) {
            return;
        }
        const removedUrls: string[] = [];
        setFolderData(prev => {
            const next: Record<string, FolderState> = { ...prev };
            const normalizedRoot = normalizeFolderKey(rootFolder);

            // Helper function to apply a change to a specific folder state
            const applyChangeToFolder = (targetFolderKey: string, change: any, incoming?: FileDetails) => {
                // Skip if this folder is pending deletion
                if (isFolderDeletePending(targetFolderKey)) return;

                const existing = next[targetFolderKey] ?? createEmptyFolderState();
                const pageSize = existing.pageSize || DEFAULT_PAGE_SIZE;
                const loadedPages = existing.loadedPages ? [...existing.loadedPages] : [];
                let items = existing.items ? [...existing.items] : [];
                const action = change?.action;

                if (action === "remove") {
                    const index = items.findIndex(item => item.name === change?.file);
                    if (index >= 0) {
                        if (!removedUrls.includes(items[index].url)) {
                            removedUrls.push(items[index].url);
                        }
                        items.splice(index, 1);
                    }
                } else if (incoming) {
                    const index = items.findIndex(item => item.url === incoming.url || item.name === incoming.name);
                    if (index >= 0) {
                        items[index] = { ...items[index], ...incoming };
                    } else {
                        items.unshift(incoming);
                    }
                }

                items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
                if (loadedPages.length > 0) {
                    const maxItems = loadedPages.length * pageSize;
                    if (items.length > maxItems) {
                        items = items.slice(0, maxItems);
                    }
                }
                const totalCount = normalizedTotals[targetFolderKey] ?? existing.total;
                next[targetFolderKey] = {
                    ...existing,
                    items,
                    total: totalCount,
                    loadedPages,
                    hasMore: totalCount > items.length,
                    pageSize,
                };
            };

            changes.forEach((change: any) => {
                const folderKey = normalizeFolderKey(change?.folder);
                if (!folderKey) return;

                // Skip changes for folders pending deletion
                if (isFolderDeletePending(folderKey)) return;

                let incoming: FileDetails | undefined;
                if (change?.data) {
                    incoming = {
                        ...(change.data as FileDetails),
                        folder: normalizeFolderKey((change.data as FileDetails).folder || folderKey),
                    };
                }

                // Apply change to the specific folder
                applyChangeToFolder(folderKey, change, incoming);

                // Also apply to root folder if this is a subfolder change and root folder data exists
                if (normalizedRoot && folderKey !== normalizedRoot && folderKey.startsWith(normalizedRoot + "/")) {
                    if (next[normalizedRoot] && next[normalizedRoot].loadedPages.length > 0) {
                        applyChangeToFolder(normalizedRoot, change, incoming);
                    }
                }
            });
            return next;
        });
        if (removedUrls.length) {
            removedUrls.forEach(invalidateMetadataCacheByUrl);
            setSelectedImages(prev => prev.filter(url => !removedUrls.includes(url)));
            favoritesStore.removeUrls(removedUrls);
        }
    }, [setFolderCounts, setFolderData, setSelectedImages, rootFolder, isFolderDeletePending, cleanupDeletedFoldersTracking]);

    const loadMore = useCallback(async (folder?: string) => {
        const target = normalizeFolderKey(folder || currentFolderRef.current || rootFolder);
        if (!target) return;
        const state = folderData[target];
        const nextPage = state && state.loadedPages.length > 0 ? Math.max(...state.loadedPages) + 1 : 0;
        if (state && !state.hasMore && state.loadedPages.length > 0) {
            return;
        }
        await loadFolderPage(target, nextPage, false);
    }, [folderData, loadFolderPage, rootFolder]);

    const refreshFolder = useCallback(async (folder?: string) => {
        const target = normalizeFolderKey(folder || currentFolderRef.current || rootFolder);
        if (!target) return;
        await loadFolderList();
        await loadFolderPage(target, 0, true);
    }, [loadFolderList, loadFolderPage, rootFolder]);

    const getLoadedItems = useCallback((folder: string) => {
        const normalized = normalizeFolderKey(folder);
        return folderData[normalized]?.items ?? [];
    }, [folderData]);

    const updateFileMetadata = useCallback((folder: string, filename: string, metadata: any, metadataPending: boolean) => {
        const normalized = normalizeFolderKey(folder);
        setFolderData(prev => {
            const next = { ...prev };
            let updatedUrl: string | undefined;

            // Helper to update items in a folder state
            const updateItemsInFolder = (folderKey: string) => {
                const existing = next[folderKey];
                if (!existing) return;

                const items = existing.items.map(item => {
                    // Match by name AND folder (to handle items in root folder from subfolders)
                    if (item.name === filename && normalizeFolderKey(item.folder) === normalized) {
                        if (!updatedUrl) updatedUrl = item.url;
                        return { ...item, metadata, metadata_pending: metadataPending };
                    }
                    return item;
                });

                next[folderKey] = { ...existing, items };
            };

            // Update the specific folder
            updateItemsInFolder(normalized);

            // Also update root folder if this is a subfolder item
            const normalizedRoot = normalizeFolderKey(rootFolder);
            if (normalizedRoot && normalized !== normalizedRoot && normalized.startsWith(normalizedRoot + "/")) {
                updateItemsInFolder(normalizedRoot);
            }

            // Also check current folder in case it's different
            const normalizedCurrent = normalizeFolderKey(currentFolderRef.current);
            if (normalizedCurrent && normalizedCurrent !== normalized && normalizedCurrent !== normalizedRoot) {
                updateItemsInFolder(normalizedCurrent);
            }

            if (updatedUrl) {
                invalidateMetadataCacheByUrl(updatedUrl);
            }

            return next;
        });
    }, [rootFolder]);

    // ========================================================================
    // PROMPT INDEX BACKGROUND BUILDER
    // Builds a lightweight index (url -> positive prompt) for fast prompt search
    // without mutating folderData, to avoid flicker and heavy re-renders.
    // ========================================================================
    const prefetchAbortRef = useRef<AbortController | null>(null);
    const prefetchedUrlsRef = useRef<Set<string>>(new Set());

    const buildPromptIndexBatch = useCallback(
        async (getItems: () => FileDetails[], signal: AbortSignal) => {
            const BATCH_SIZE = 6;
            const BATCH_DELAY = 150;
            const MAX_PREFETCH = 200;

            const items = getItems();
            const needsFetch = items
                .filter(item => {
                    if (item.type !== 'image') return false;
                    if (prefetchedUrlsRef.current.has(item.url)) return false;

                    // If we already have an indexed prompt, no need to fetch
                    if (promptIndexRef.current.has(item.url)) return false;

                    // If we already have full metadata attached (e.g. from info panel),
                    // we can index from it locally without a network call.
                    if (item.metadata && !item.metadata_pending) return false;

                    return true;
                })
                .slice(0, MAX_PREFETCH);

            if (!needsFetch.length) return;

            let anyIndexed = false;

            for (let i = 0; i < needsFetch.length; i += BATCH_SIZE) {
                if (signal.aborted) break;

                const batch = needsFetch.slice(i, i + BATCH_SIZE);

                await Promise.allSettled(
                    batch.map(async (item) => {
                        if (signal.aborted) return;
                        if (prefetchedUrlsRef.current.has(item.url)) return;

                        try {
                            prefetchedUrlsRef.current.add(item.url);
                            const response = await ComfyAppApi.fetchMetadata(item.url);
                            if (!response.ok || signal.aborted) return;

                            const payload = await response.json();
                            if (signal.aborted) return;

                            const parsed = parseComfyMetadata(payload.metadata ?? null);
                            const positive = (parsed['Positive Prompt'] || '').toLowerCase();
                            if (positive) {
                                promptIndexRef.current.set(item.url, positive);
                            }
                        } catch {
                            // Silently ignore; we'll keep existing index entries
                        }
                    })
                );

                if (signal.aborted) break;
                if (i + BATCH_SIZE < needsFetch.length) {
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                }
            }
            // Note: No state update here - index lives in ref
            // Results will appear on next user keystroke/filter change
        },
        []
    );

    // Kick off prompt indexing when user starts searching by prompt
    useEffect(() => {
        const normalized = normalizeFolderKey(currentFolder);
        const query = searchFileName.trim();
        if (!normalized || !query || searchMode !== 'prompt') return;

        // Cancel any existing background work
        if (prefetchAbortRef.current) {
            prefetchAbortRef.current.abort();
        }

        const controller = new AbortController();
        prefetchAbortRef.current = controller;

        const getItems = () => folderDataRef.current[normalized]?.items ?? [];
        buildPromptIndexBatch(getItems, controller.signal).catch(() => {});

        return () => {
            controller.abort();
        };
    }, [currentFolder, searchFileName, searchMode, buildPromptIndexBatch]);

    // Clear prompt index when root changes (essentially a new gallery session)
    useEffect(() => {
        promptIndexRef.current.clear();
        prefetchedUrlsRef.current.clear();
    }, [rootFolder]);
    // ========================================================================

    // Optimistically remove a set of image URLs from all folders to keep the UI snappy.
    // The filesystem monitor will later reconcile any discrepancies from the backend.
    const optimisticRemoveByUrls = useCallback((urls: string[]) => {
        if (!urls.length) return;
        const urlSet = new Set(urls);
        const removedPerFolder: Record<string, number> = {};
        const removedUrls: string[] = [];

        setFolderData(prev => {
            const next: Record<string, FolderState> = {};

            Object.entries(prev).forEach(([folderKey, state]) => {
                const originalItems = state.items ?? [];
                let removedCountForFolder = 0;

                const items = originalItems.filter(item => {
                    if (urlSet.has(item.url)) {
                        removedCountForFolder += 1;
                        if (!removedUrls.includes(item.url)) {
                            removedUrls.push(item.url);
                        }
                        return false;
                    }
                    return true;
                });

                if (removedCountForFolder > 0) {
                    removedPerFolder[folderKey] = (removedPerFolder[folderKey] ?? 0) + removedCountForFolder;
                    const previousTotal = Number.isFinite(state.total) ? state.total : originalItems.length;
                    const total = Math.max(0, previousTotal - removedCountForFolder);
                    next[folderKey] = {
                        ...state,
                        items,
                        total,
                        hasMore: total > items.length,
                    };
                } else {
                    next[folderKey] = state;
                }
            });

            return next;
        });

        setFolderCounts(prev => {
            if (!Object.keys(removedPerFolder).length) return prev;
            const next = { ...prev };
            Object.entries(removedPerFolder).forEach(([folderKey, removed]) => {
                const before = typeof next[folderKey] === 'number' ? next[folderKey] : 0;
                next[folderKey] = Math.max(0, before - removed);
            });
            return next;
        });

        if (removedUrls.length) {
            setSelectedImages(prev => prev.filter(url => !urlSet.has(url)));
            removedUrls.forEach(invalidateMetadataCacheByUrl);
            favoritesStore.removeUrls(removedUrls);
        }
    }, [setFolderData, setFolderCounts, setSelectedImages]);

    // High-level delete API used by the UI: perform an optimistic removal and then
    // dispatch delete requests to the backend. Any mismatches will be corrected
    // by the realtime file-change events feeding back into the context.
    const deleteImages = useCallback(async (urls: string[]) => {
        if (!urls || !urls.length) return;

        // Optimistic update for instant UX
        optimisticRemoveByUrls(urls);

        // Fire-and-forget deletes; we don't block the UI on these.
        await Promise.allSettled(
            urls.map(async (url) => {
                try {
                    await ComfyAppApi.deleteImage(url);
                } catch (err) {
                    console.error('Failed to delete image:', url, err);
                }
            })
        );
    }, [optimisticRemoveByUrls]);

    // High-level folder delete: call backend, then prune the folder subtree from
    // local state (folderCounts + folderData) and redirect currentFolder if needed.
    const deleteFolder = useCallback(async (folderKey: string) => {
        const normalizedKey = normalizeFolderKey(folderKey);
        if (!normalizedKey) return;

        // IMPORTANT: Mark folder as deleted IMMEDIATELY, before any async operations.
        // This prevents real-time events from re-adding the folder while deletion is in progress.
        const deletionTimestamp = Date.now();
        deletedFoldersRef.current.set(normalizedKey, deletionTimestamp);

        // Also mark all subfolders as deleted (they'll be removed with parent)
        Object.keys(folderData).forEach(key => {
            const normKey = normalizeFolderKey(key);
            if (normKey.startsWith(normalizedKey + '/')) {
                deletedFoldersRef.current.set(normKey, deletionTimestamp);
        }
        });

        // Optimistically prune from UI immediately (before backend responds)
        // This gives instant feedback and prevents flicker
        setFolderData(prev => {
            const next: Record<string, FolderState> = {};
            Object.entries(prev).forEach(([key, state]) => {
                const normKey = normalizeFolderKey(key);
                if (normKey === normalizedKey || normKey.startsWith(normalizedKey + "/")) {
                    return; // Drop this folder subtree
                }
                next[key] = state;
            });
            return next;
        });

        setFolderCounts(prev => {
            const next: Record<string, number> = {};
            Object.entries(prev).forEach(([key, count]) => {
                const normKey = normalizeFolderKey(key);
                if (normKey === normalizedKey || normKey.startsWith(normalizedKey + "/")) {
                    return;
                }
                next[key] = count;
            });
            return next;
        });

        // If the current folder is inside the deleted subtree, bounce back to root
        setCurrentFolder(prev => {
            const currentNorm = normalizeFolderKey(prev || currentFolderRef.current || "");
            if (!currentNorm) return prev;
            if (currentNorm === normalizedKey || currentNorm.startsWith(normalizedKey + "/")) {
                const fallback = rootFolder ? normalizeFolderKey(rootFolder) : "";
                return fallback || "";
            }
            return prev;
        });

        // Now call backend (UI is already updated)
        try {
            const ok = await ComfyAppApi.deleteFolder(normalizedKey);
            if (!ok) {
                console.error('Failed to delete folder:', normalizedKey);
                // Note: We don't restore the folder on failure - the grace period will expire
                // and a refresh will restore it if it still exists on disk
            }
        } catch (err) {
            console.error('Error deleting folder:', normalizedKey, err);
        }

        // Refresh folder list to ensure counts are accurate
        // The grace period protects against race conditions during this refresh
        try {
            await loadFolderList();
        } catch (err) {
            console.error('Error refreshing folder list after delete:', err);
        }
    }, [rootFolder, setCurrentFolder, setFolderCounts, setFolderData, loadFolderList, folderData]);


    useAsyncEffect(async () => {
        try {
            const serverSettings = await ComfyAppApi.fetchSettings();
            if (serverSettings && Object.keys(serverSettings).length > 0) {
                const merged: any = { ...DEFAULT_SETTINGS };
                Object.keys(serverSettings).forEach((key) => {
                    const value = (serverSettings as any)[key];
                    if (value !== null && value !== undefined) {
                        merged[key] = value;
                    }
                });
                setSettings(merged as SettingsState);
            }
        } catch (e) {
            // ignore
        }

        const fileChangeHandler = (event: any) => {
            if (event?.detail) {
                handleRealtimeChanges(event.detail);
            }
        };

        ComfyAppApi.onFileChange(fileChangeHandler);
        ComfyAppApi.onUpdate(fileChangeHandler);
        ComfyAppApi.onClear(() => {
            setFolderCounts({});
            setFolderData({});
            clearMetadataCache();
        });
    }, [handleRealtimeChanges, setSettings]);

    useEffect(() => {
        let cancelled = false;
        const effectiveSettings = settingsState || DEFAULT_SETTINGS;
        if (!effectiveSettings?.relativePath) {
            return;
        }
        (async () => {
            try {
                await ComfyAppApi.startMonitoring(
                    effectiveSettings.relativePath,
                    effectiveSettings.disableLogs,
                    effectiveSettings.usePollingObserver,
                    effectiveSettings.scanExtensions
                );
                const root = await loadFolderList();
                if (cancelled) return;
                const target = normalizeFolderKey(currentFolderRef.current || root);
                setCurrentFolder(prev => prev || target);
                await loadFolderPage(target || root || effectiveSettings.relativePath, 0, true);
                await favoritesStore.initialize();
                // Compute favorites folder key using fresh root value to avoid stale closure
                const freshFavoritesKey = root ? `${root}/${FAVORITES_FOLDER}` : FAVORITES_FOLDER;
                setFolderCounts(prev => ({ ...prev, [freshFavoritesKey]: favoritesStore.getCount() }));
            } catch (err) {
                if (!cancelled) {
                    setError(err);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        settingsState?.relativePath,
        settingsState?.disableLogs,
        settingsState?.usePollingObserver,
        JSON.stringify(settingsState?.scanExtensions),
        loadFolderList,
        loadFolderPage,
        setCurrentFolder,
    ]);

    useEffect(() => {
        const target = normalizeFolderKey(currentFolder);
        if (!target) return;
        // Don't try to load a folder that's pending deletion
        if (isFolderDeletePending(target)) return;
        const state = folderData[target];
        const isLoaded = state && state.loadedPages.length > 0;
        const isLoading = !!loadingFolders[target];
        if (!isLoaded && !isLoading) {
            loadFolderPage(target, 0, true).catch(() => {});
        }
    }, [currentFolder, folderData, loadingFolders, loadFolderPage, isFolderDeletePending]);

    useEffect(() => {
        if (!currentFolder && rootFolder) {
            setCurrentFolder(rootFolder);
        }
    }, [currentFolder, rootFolder, setCurrentFolder]);

    const normalizedCurrentFolder = normalizeFolderKey(currentFolder);
    const currentFolderState = folderData[normalizedCurrentFolder] ?? createEmptyFolderState(folderCounts[normalizedCurrentFolder] ?? 0);

    // Derive showDateDivider from settings
    const showDateDivider = settingsState?.showDateDivider ?? DEFAULT_SETTINGS.showDateDivider;

    // Memoize filtered URLs separately - this is the expensive filtering operation
    const filteredUrls = useMemo(() => {
        const items = currentFolderState.items ?? [];
        const searchTrimmed = searchFileName.trim().toLowerCase();

        if (!searchTrimmed) {
            // No search - return all media item URLs in order
            return items
                .filter(item => item.type === 'image' || item.type === 'media' || item.type === 'audio')
                .map(item => item.url);
        }

        if (searchMode === 'filename') {
            // Simple filename search
            return items
                .filter(item => {
                    if (item.type !== 'image' && item.type !== 'media' && item.type !== 'audio') return false;
                    return (item.name || '').toLowerCase().includes(searchTrimmed);
                })
                .map(item => item.url);
        }

        // Prompt search with comma-separated term support
        const terms = searchTrimmed.split(',').map(t => t.trim()).filter(Boolean);

        return items
            .filter(item => {
                if (item.type !== 'image' && item.type !== 'media' && item.type !== 'audio') return false;

                // 1. Look up from prompt index (fast path - reads from ref)
                let positivePrompt = promptIndexRef.current.get(item.url) || '';

                // 2. If not indexed but we already have metadata, derive once locally
                if (!positivePrompt && item.metadata && !item.metadata_pending) {
                    const parsed = parseComfyMetadata(item.metadata as any);
                    positivePrompt = (parsed['Positive Prompt'] || '').toLowerCase();
                    if (positivePrompt) {
                        promptIndexRef.current.set(item.url, positivePrompt);
                    }
                }

                const fallbackName = (item.name || '').toLowerCase();
                const haystack = positivePrompt || fallbackName;
                if (!haystack) return false;

                if (terms.length === 0) {
                    return haystack.includes(searchTrimmed);
                }
                return terms.every(term => haystack.includes(term));
            })
            .map(item => item.url);
    }, [currentFolderState.items, searchFileName, searchMode]);

    // Build the display list only when filtered URLs actually change
    // This prevents re-renders when typing produces the same results
    const imagesDetailsList = useMemo(() => {
        const items = currentFolderState.items ?? [];
        const searchTrimmed = searchFileName.trim();

        // Build URL set for O(1) lookup
        const filteredUrlSet = new Set(filteredUrls);

        // Get filtered items maintaining original order
        let list: FileDetails[];
        if (!searchTrimmed) {
            // No search - use all items
            list = [...items];
        } else {
            // Filter to only items matching search
            list = items.filter(item => filteredUrlSet.has(item.url));
        }

        // Apply sorting
        if (sortMethod !== 'Name ↑' && sortMethod !== 'Name ↓') {
            list = list.sort((a, b) => (sortMethod === 'Newest' ? (b.timestamp || 0) - (a.timestamp || 0) : (a.timestamp || 0) - (b.timestamp || 0)));

            if (!showDateDivider) return list;

            // Group by date with dividers
            const grouped: { [date: string]: FileDetails[] } = {};
            list.forEach(item => {
                const date = item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(item);
            });

            const result: FileDetails[] = [];
            Object.entries(grouped).forEach(([date, dateItems]) => {
                const colCount = Math.max(1, gridSize.columnCount || 1);
                for (let i = 0; i < colCount; i++) {
                    result.push({ name: date, type: 'divider', url: '', timestamp: 0, date, metadata: null, folder: normalizedCurrentFolder, metadata_pending: false });
                }
                result.push(...dateItems);
                const remainder = dateItems.length % colCount;
                if (remainder !== 0 && colCount > 1) {
                    for (let i = 0; i < colCount - remainder; i++) {
                        result.push({ name: `empty-${date}-${i}`, type: 'empty-space', url: '', timestamp: 0, date, metadata: null, folder: normalizedCurrentFolder, metadata_pending: false });
                    }
                }
            });
            return result;
        }

        switch (sortMethod) {
            case 'Name ↑':
                return list.sort((a, b) => a.name.localeCompare(b.name));
            case 'Name ↓':
                return list.sort((a, b) => b.name.localeCompare(a.name));
            default:
                return list;
        }
    }, [filteredUrls, currentFolderState.items, sortMethod, showDateDivider, gridSize.columnCount, normalizedCurrentFolder, searchFileName]);

    const imagesUrlsLists = useMemo(() =>
        imagesDetailsList
            .filter(image => image.type === "image" || image.type === "media" || image.type === "audio")
            .map(image => `${BASE_PATH}${image.url}`),
    [imagesDetailsList]);

    const imagesAutoCompleteNames = useMemo<NonNullable<AutoCompleteProps['options']>>(() => {
        let filtered = imagesDetailsList.filter(image => (image.type === "image" || image.type === "media" || image.type === "audio") && typeof image.name === 'string');
        if (sortMethod === 'Name ↑') {
            filtered = filtered.sort((a, b) => (a.name as string).localeCompare(b.name as string));
        } else if (sortMethod === 'Name ↓') {
            filtered = filtered.sort((a, b) => (b.name as string).localeCompare(a.name as string));
        } else if (sortMethod === 'Newest') {
            filtered = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } else if (sortMethod === 'Oldest') {
            filtered = filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        return filtered.map(image => ({ value: image.name as string, label: image.name as string }));
    }, [imagesDetailsList, sortMethod]);

    const isFolderLoading = !!loadingFolders[normalizedCurrentFolder] && (currentFolderState.loadedPages?.length ?? 0) === 0;
    const isLoadingMore = !!loadingFolders[normalizedCurrentFolder] && (currentFolderState.loadedPages?.length ?? 0) > 0;
    const combinedLoading = loading || isFolderLoading;
    const hasMore = currentFolderState.hasMore;

    const [imageCards, setImageCards] = useState<NodeListOf<Element>>(document.querySelectorAll(".image-card"));
    const [folders, setFolders] = useState<NodeListOf<Element>>(document.querySelectorAll('[role="treeitem"], .folder'));
    const [selectedImagesActionButtons, setSelectedImagesActionButtons] = useState<NodeListOf<Element>>(document.querySelectorAll(".selectedImagesActionButton"));

    useEffect(() => {
        setImageCards(document.querySelectorAll(".image-card"));
    }, [imagesDetailsList]);
    useEffect(() => {
        setFolders(document.querySelectorAll('[role="treeitem"], .folder'));
    }, [imagesDetailsList, currentFolder]);
    useEffect(() => {
        setSelectedImagesActionButtons(document.querySelectorAll(".selectedImagesActionButton"));
    }, [selectedImages]);

    useClickAway((event) => {
        setSelectedImages([]);
    }, [...Array.from(imageCards), ...Array.from(folders), ...Array.from(selectedImagesActionButtons)]);

    useEventListener('keydown', (event) => {
        const effectiveSettings = settingsState || DEFAULT_SETTINGS;
        if (effectiveSettings?.galleryShortcut && event.code == "KeyG" && event.ctrlKey) {
            try {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                document.getElementById(OPEN_BUTTON_ID)?.click();
            } catch {}
        }
    });

    const value = useMemo(() => ({
        currentFolder,
        setCurrentFolder,
        rootFolder,
        folderCounts,
        loadMore,
        refreshFolder,
        getLoadedItems,
        hasMore,
        isLoadingMore,
        loading: combinedLoading,
        error,
        searchFileName,
        setSearchFileName,
        searchMode,
        setSearchMode,
        showDateDivider,
        showSettings,
        setShowSettings,
        showRawMetadata,
        setShowRawMetadata,
        sortMethod,
        setSortMethod,
        imageInfoName,
        setImageInfoName,
        open,
        setOpen,
        previewingVideo,
        setPreviewingVideo,
        size,
        imagesBoxSize,
        gridSize,
        setGridSize,
        autoSizer,
        setAutoSizer,
        imagesDetailsList,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        setAutoCompleteOptions,
        settings: settingsState || DEFAULT_SETTINGS,
        setSettings: saveSettings,
        selectedImages,
        setSelectedImages,
        siderCollapsed,
        setSiderCollapsed,
        updateFileMetadata,
        lastSelectedIndex,
        setLastSelectedIndex,
        deleteImages,
        deleteFolder,
    }), [
        currentFolder,
        setCurrentFolder,
        rootFolder,
        folderCounts,
        loadMore,
        refreshFolder,
        getLoadedItems,
        hasMore,
        isLoadingMore,
        combinedLoading,
        error,
        searchFileName,
        searchMode,
        showDateDivider,
        showSettings,
        showRawMetadata,
        sortMethod,
        imageInfoName,
        open,
        previewingVideo,
        size,
        imagesBoxSize,
        gridSize,
        autoSizer,
        imagesDetailsList,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        settingsState,
        saveSettings,
        selectedImages,
        siderCollapsed,
        updateFileMetadata,
        lastSelectedIndex,
        setLastSelectedIndex,
        deleteImages,
        deleteFolder,
    ]);

    return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}

export function useGalleryContext() {
    const ctx = useContext(GalleryContext);
    if (!ctx) throw new Error('useGalleryContext must be used within a GalleryProvider');
    return ctx;
}
