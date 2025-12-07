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

type FolderState = {
    items: FileDetails[];
    total: number;
    pageSize: number;
    loadedPages: number[];
    hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 120;

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
    // Favorites
    favorites: Set<string>;
    isFavorite: (url: string) => boolean;
    toggleFavorite: (image: FileDetails) => Promise<void>;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

export function GalleryProvider({ children }: { children: React.ReactNode }) {
    const [currentFolderInternal, setCurrentFolderInternal] = useState("");
    const [rootFolder, setRootFolder] = useState("");
    const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
    const [folderData, setFolderData] = useState<Record<string, FolderState>>({});
    const [searchFileName, setSearchFileName] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [showRawMetadata, setShowRawMetadata] = useState(false);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    // Track when we're actively favoriting to suppress file watcher events
    const suppressFileWatcherRef = useRef(false);
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
                    const numericValue = typeof value?.count === 'number' ? value.count : Number(value?.count ?? 0);
                    normalizedFolders[normalizedKey] = Number.isFinite(numericValue) ? numericValue : 0;
                });
            }
            const normalizedRoot = normalizeFolderKey(payload?.root || Object.keys(normalizedFolders)[0] || rootFolder);
            if (normalizedRoot && !(normalizedRoot in normalizedFolders)) {
                normalizedFolders[normalizedRoot] = normalizedFolders[normalizedRoot] ?? 0;
            }
            setRootFolder(normalizedRoot);
            setFolderCounts(normalizedFolders);
            setFolderData(prev => {
                const next: Record<string, FolderState> = {};
                Object.entries(normalizedFolders).forEach(([folderKey, count]) => {
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
    }, [settingsState?.relativePath, rootFolder]);

    const loadFolderPage = useCallback(async (folder: string, page = 0, replace = false) => {
        const normalizedFolder = normalizeFolderKey(folder || currentFolderRef.current || rootFolder);
        if (!normalizedFolder) {
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
    }, [settingsState?.relativePath, rootFolder]);

    const handleRealtimeChanges = useCallback((payload: any) => {
        if (!payload) return;
        // Skip processing if we're actively favoriting (to prevent UI flicker)
        if (suppressFileWatcherRef.current) return;
        const totalsRaw = payload.totals ?? {};
        const normalizedTotals: Record<string, number> = {};
        Object.entries(totalsRaw).forEach(([key, value]) => {
            const normalizedKey = normalizeFolderKey(key);
            if (!normalizedKey) return;
            const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
            normalizedTotals[normalizedKey] = Number.isFinite(numericValue) ? numericValue : 0;
        });
        if (Object.keys(normalizedTotals).length > 0) {
            setFolderCounts(prev => {
                const next = { ...prev };
                Object.entries(normalizedTotals).forEach(([key, count]) => {
                    next[key] = count;
                });
                return next;
            });
            setFolderData(prev => {
                const next: Record<string, FolderState> = { ...prev };
                Object.entries(normalizedTotals).forEach(([key, count]) => {
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
        }
    }, [setFolderCounts, setFolderData, setSelectedImages, rootFolder]);

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

    // Favorites functions
    const isFavorite = useCallback((url: string) => {
        return favorites.has(url) || url.includes('/_favorites/');
    }, [favorites]);

    const toggleFavorite = useCallback(async (image: FileDetails) => {
        try {
            // Suppress file watcher events to prevent UI flicker during favorite operation
            suppressFileWatcherRef.current = true;

            const result = await ComfyAppApi.toggleFavorite(image.url);
            if (result.success) {
                // Just update the favorites set - no UI refresh
                setFavorites(prev => {
                    const next = new Set(prev);
                    if (result.isFavorite && result.newPath) {
                        next.add(result.newPath);
                        next.delete(image.url);
                    } else {
                        next.delete(image.url);
                        if (result.newPath) {
                            next.delete(result.newPath);
                        }
                    }
                    return next;
                });
            }

            // Re-enable file watcher after a delay to let any pending events pass
            setTimeout(() => {
                suppressFileWatcherRef.current = false;
            }, 2000);
        } catch (error) {
            console.error('Error toggling favorite:', error);
            suppressFileWatcherRef.current = false;
        }
    }, []);

    // Load favorites on mount
    useEffect(() => {
        (async () => {
            const favList = await ComfyAppApi.fetchFavorites();
            setFavorites(new Set(favList));
        })();
    }, []);

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
        const state = folderData[target];
        const isLoaded = state && state.loadedPages.length > 0;
        const isLoading = !!loadingFolders[target];
        if (!isLoaded && !isLoading) {
            loadFolderPage(target, 0, true).catch(() => {});
        }
    }, [currentFolder, folderData, loadingFolders, loadFolderPage]);

    useEffect(() => {
        if (!currentFolder && rootFolder) {
            setCurrentFolder(rootFolder);
        }
    }, [currentFolder, rootFolder, setCurrentFolder]);

    const normalizedCurrentFolder = normalizeFolderKey(currentFolder);
    const currentFolderState = folderData[normalizedCurrentFolder] ?? createEmptyFolderState(folderCounts[normalizedCurrentFolder] ?? 0);

    // Derive showDateDivider from settings
    const showDateDivider = settingsState?.showDateDivider ?? DEFAULT_SETTINGS.showDateDivider;

    const imagesDetailsList = useMemo(() => {
        let list: FileDetails[] = [...(currentFolderState.items ?? [])];
        if (searchFileName && searchFileName.trim() !== "") {
            const searchTerm = searchFileName.toLowerCase();
            list = list.filter(imageInfo => imageInfo.name.toLowerCase().includes(searchTerm));
        }
        if (sortMethod !== 'Name ↑' && sortMethod !== 'Name ↓') {
            list = list.sort((a, b) => (sortMethod === 'Newest' ? (b.timestamp || 0) - (a.timestamp || 0) : (a.timestamp || 0) - (b.timestamp || 0)));
            if (!showDateDivider) return list;
            const grouped: { [date: string]: FileDetails[] } = {};
            list.forEach(item => {
                const date = item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(item);
            });
            const result: FileDetails[] = [];
            Object.entries(grouped).forEach(([date, items]) => {
                const colCount = Math.max(1, gridSize.columnCount || 1);
                for (let i = 0; i < colCount; i++) {
                    result.push({ name: date, type: 'divider', url: '', timestamp: 0, date, metadata: null, folder: normalizedCurrentFolder, metadata_pending: false });
                }
                result.push(...items);
                const remainder = items.length % colCount;
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
    }, [currentFolderState.items, searchFileName, sortMethod, settingsState?.showDateDivider, gridSize.columnCount, normalizedCurrentFolder]);

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
        favorites,
        isFavorite,
        toggleFavorite,
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
        favorites,
        isFavorite,
        toggleFavorite,
    ]);

    return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}

export function useGalleryContext() {
    const ctx = useContext(GalleryContext);
    if (!ctx) throw new Error('useGalleryContext must be used within a GalleryProvider');
    return ctx;
}
