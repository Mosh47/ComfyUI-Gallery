// favoritesStore.ts
// Subscription-based store for favorites - avoids Context re-render issues
// Each component subscribes to only the piece of state it cares about

import { ComfyAppApi } from './ComfyAppApi';

export type FavoriteListener = () => void;

class FavoritesStore {
    private favorites = new Set<string>();
    private listeners = new Set<FavoriteListener>();
    private initialized = false;

    subscribe = (listener: FavoriteListener): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private emit() {
        for (const listener of Array.from(this.listeners)) {
            listener();
        }
    }

    isFavorite = (url: string): boolean => {
        return this.favorites.has(url);
    };

    toggleFavorite = async (url: string): Promise<void> => {
        // Optimistic update
        const wasFavorite = this.favorites.has(url);
        if (wasFavorite) {
            this.favorites.delete(url);
        } else {
            this.favorites.add(url);
        }
        this.emit();

        // Sync with backend
        try {
            const result = await ComfyAppApi.toggleFavorite(url);
            if (result.success && result.favorites) {
                // Update with server truth
                this.favorites = new Set(result.favorites);
                this.emit();
            } else if (!result.success) {
                // Rollback on failure
                if (wasFavorite) {
                    this.favorites.add(url);
                } else {
                    this.favorites.delete(url);
                }
                this.emit();
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            // Rollback
            if (wasFavorite) {
                this.favorites.add(url);
            } else {
                this.favorites.delete(url);
            }
            this.emit();
        }
    };

    // Initialize from backend
    async initialize(): Promise<void> {
        if (this.initialized) return;
        try {
            const favList = await ComfyAppApi.fetchFavorites();
            this.favorites = new Set(favList);
            this.initialized = true;
            this.emit();
        } catch (error) {
            console.error('Error loading favorites:', error);
        }
    }

    // Get all favorites (for folder counts, etc.)
    getAll(): ReadonlySet<string> {
        return this.favorites;
    }

    getCount(): number {
        return this.favorites.size;
    }

    // Remove URLs from favorites (used when files are deleted)
    removeUrls(urls: string[]): void {
        let changed = false;
        for (const url of urls) {
            if (this.favorites.delete(url)) {
                changed = true;
            }
        }
        if (changed) {
            this.emit();
        }
    }
}

export const favoritesStore = new FavoritesStore();
