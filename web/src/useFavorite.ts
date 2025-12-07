// useFavorite.ts
// Hook that subscribes to a single item's favorite status
// Uses useSyncExternalStore so only the component whose status changed re-renders

import { useSyncExternalStore, useCallback } from 'react';
import { favoritesStore } from './favoritesStore';

/**
 * Subscribe to whether a specific URL is favorited.
 * Only re-renders when THIS url's favorite status changes.
 */
export function useFavorite(url: string): boolean {
    // getSnapshot returns the current favorite status for this specific url
    const getSnapshot = useCallback(() => favoritesStore.isFavorite(url), [url]);

    return useSyncExternalStore(
        favoritesStore.subscribe,
        getSnapshot,
        getSnapshot // server snapshot same as client
    );
}

/**
 * Get the toggle function - stable reference, doesn't cause re-renders
 */
export function useToggleFavorite(): (url: string) => Promise<void> {
    return favoritesStore.toggleFavorite;
}
