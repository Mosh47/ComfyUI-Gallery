import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { AutoSizer } from 'react-virtualized';
import { FixedSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { MetadataView } from './MetadataView';
import type { FileDetails } from './types';
import { BASE_PATH, BASE_Z_INDEX } from "./ComfyAppApi";
import { useFavorite } from './useFavorite';
import { favoritesStore } from './favoritesStore';

// Icons
const IconImage = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
        <circle cx="9" cy="9" r="2"/>
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
    </svg>
);

const IconX = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
);

const IconChevronLeft = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6"/>
    </svg>
);

const IconChevronRight = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6"/>
    </svg>
);

const IconStarOutline = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);

const IconStarFilled = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);

// Separate component for preview star button - uses useFavorite hook for granular updates
const PreviewFavoriteButton: React.FC<{ url: string }> = ({ url }) => {
    const isFavorite = useFavorite(url);
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                favoritesStore.toggleFavorite(url);
            }}
            style={{
                position: 'absolute',
                top: '20px',
                left: '20px',
                width: '48px',
                height: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isFavorite ? 'rgba(255, 215, 0, 0.9)' : 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '50%',
                color: isFavorite ? '#1a1a1a' : 'white',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                zIndex: 10,
                boxShadow: isFavorite ? '0 4px 20px rgba(255, 215, 0, 0.4)' : 'none',
            }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
            {isFavorite ? <IconStarFilled /> : <IconStarOutline />}
        </button>
    );
};

const GalleryImageGrid = () => {
    const {
        gridSize,
        setGridSize,
        autoSizer,
        setAutoSizer,
        imageInfoName,
        setImageInfoName,
        showRawMetadata,
        setShowRawMetadata,
        settings,
        loading,
        imagesDetailsList,
        loadMore,
        hasMore,
        isLoadingMore,
    } = useGalleryContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<FixedSizeGrid>(null);

    // Store just the image names, derive actual objects from imagesDetailsList
    // This ensures metadata updates in context are reflected immediately
    const [previewImageName, setPreviewImageName] = useState<string | null>(null);
    const [infoImageName, setInfoImageName] = useState<string | null>(null);

    // Derive actual image objects from context (so they update when metadata is fetched)
    const previewImage = useMemo(() =>
        previewImageName ? imagesDetailsList.find(img => img.name === previewImageName) ?? null : null,
        [previewImageName, imagesDetailsList]
    );

    const infoImage = useMemo(() =>
        infoImageName ? imagesDetailsList.find(img => img.name === infoImageName) ?? null : null,
        [infoImageName, imagesDetailsList]
    );

    // Previewable images for navigation
    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === "image" || img.type === "media" || img.type === "audio"),
        [imagesDetailsList]
    );

    // If the currently previewed/info image disappears (delete/move), close the modals gracefully
    useEffect(() => {
        if (previewImageName && !previewableImages.some(img => img.name === previewImageName)) {
            setPreviewImageName(null);
        }
        if (infoImageName && !previewableImages.some(img => img.name === infoImageName)) {
            setInfoImageName(null);
            setImageInfoName(undefined);
        }
    }, [previewableImages, previewImageName, infoImageName, setImageInfoName]);

    // Handle clicking on an image - opens simple preview
    const handleImageClick = useCallback((imageName: string) => {
        setPreviewImageName(imageName);
    }, []);

    // Handle clicking Info button - opens metadata panel
    const handleInfoClick = useCallback((imageName: string) => {
        setInfoImageName(imageName);
        setImageInfoName(imageName);
    }, [setImageInfoName]);

    // Navigate preview
    const navigatePreview = useCallback((direction: 'prev' | 'next') => {
        const currentImage = previewImage || infoImage;
        if (!currentImage) return;

        const currentIndex = previewableImages.findIndex(img => img.name === currentImage.name);
        if (currentIndex === -1) return;

        const newIndex = direction === 'prev'
            ? (currentIndex - 1 + previewableImages.length) % previewableImages.length
            : (currentIndex + 1) % previewableImages.length;

        const newImage = previewableImages[newIndex];
        if (previewImageName) {
            setPreviewImageName(newImage.name);
        }
        if (infoImageName) {
            setInfoImageName(newImage.name);
            setImageInfoName(newImage.name);
        }
    }, [previewImage, infoImage, previewableImages, setImageInfoName, previewImageName, infoImageName]);

    // Keyboard navigation - capture and stop propagation to prevent gallery from closing
    useEffect(() => {
        if (!previewImageName && !infoImageName) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                setPreviewImageName(null);
                setInfoImageName(null);
                setImageInfoName(undefined);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigatePreview('prev');
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigatePreview('next');
            }
        };

        // Use capture phase to intercept before gallery modal
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [previewImageName, infoImageName, navigatePreview, setImageInfoName]);

    // Stable cell renderer - uses itemData pattern from react-window best practices
    // Cell function doesn't capture imagesDetailsList in closure - receives data via props
    const Cell = useCallback(
        ({ columnIndex, rowIndex, style, data }: {
            columnIndex: number;
            rowIndex: number;
            style: React.CSSProperties;
            data: {
                items: FileDetails[];
                columnCount: number;
                onImageClick: (name: string) => void;
                onInfoClick: (name: string) => void;
            };
        }) => {
            const { items, columnCount, onImageClick, onInfoClick } = data;
            const index = rowIndex * columnCount + columnIndex;
            const image = items[index];

            if (!image) return null;

            // Date divider
            if (image.type === 'divider') {
                if (columnIndex !== 0) return null;

                return (
                    <div
                        style={{
                            ...style,
                            width: `${columnCount * (ImageCardWidth + 16)}px`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '16px 0',
                            position: 'absolute',
                            zIndex: 2,
                        }}
                    >
                        <div style={{
                            flex: 1,
                            height: '1px',
                            background: 'linear-gradient(to right, transparent, var(--border-strong), transparent)',
                        }} />
                        <span style={{
                            padding: '8px 24px',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '999px',
                            fontSize: '13px',
                            fontWeight: '600',
                            color: 'var(--text-secondary)',
                            whiteSpace: 'nowrap',
                        }}>
                            {image.name}
                        </span>
                        <div style={{
                            flex: 1,
                            height: '1px',
                            background: 'linear-gradient(to right, var(--border-strong), transparent)',
                        }} />
                    </div>
                );
            }

            // Empty space filler
            if (image.type === 'empty-space') {
                return <div style={{ ...style, background: 'transparent' }} />;
            }

            // Regular image card - favorites handled internally via useFavorite hook
            return (
                <div
                    style={{
                        ...style,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '8px',
                    }}
                >
                    <ImageCard
                        image={{ ...image, dragFolder: image.folder }}
                        index={index}
                        onImageClick={() => onImageClick(image.name)}
                        onInfoClick={() => onInfoClick(image.name)}
                    />
                </div>
            );
        },
        [] // No dependencies - receives all data via props
    );

    // Memoize itemData to prevent unnecessary re-renders
    const itemData = useMemo(() => ({
        items: imagesDetailsList,
        columnCount: gridSize.columnCount,
        onImageClick: handleImageClick,
        onInfoClick: handleInfoClick,
    }), [imagesDetailsList, gridSize.columnCount, handleImageClick, handleInfoClick]);

    // Update grid size when container changes
    useEffect(() => {
        const { width, height } = autoSizer;
        const columnCount = Math.max(1, Math.floor(width / (ImageCardWidth + 16)));
        const rowCount = Math.ceil(imagesDetailsList.length / columnCount);
        setGridSize({ width, height, columnCount, rowCount });
    }, [autoSizer.width, autoSizer.height, imagesDetailsList.length, setGridSize]);

    // Scroll handler for infinite loading
    const handleScroll = useCallback(({ scrollTop }: { scrollTop: number }) => {
        const totalHeight = gridSize.rowCount * (ImageCardHeight + 16);
        const viewportHeight = autoSizer.height;
        if (hasMore && !isLoadingMore && totalHeight - scrollTop - viewportHeight < 500) {
            loadMore();
        }
    }, [hasMore, isLoadingMore, loadMore, gridSize.rowCount, autoSizer.height]);

    return (
        <div
            id="imagesBox"
            ref={containerRef}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {/* Loading Overlay */}
            {loading && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(10, 10, 15, 0.8)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 100,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '16px',
                }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        border: '3px solid var(--border-subtle)',
                        borderTopColor: 'var(--accent-primary)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Loading gallery...
                    </span>
                </div>
            )}

            {/* Image Grid */}
            <div style={{ width: '100%', height: '100%' }}>
                {imagesDetailsList.length === 0 ? (
                    // Empty State
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '16px',
                        color: 'var(--text-muted)',
                    }}>
                        <IconImage />
                        <span style={{ fontSize: '16px', fontWeight: '500' }}>
                            No images found
                        </span>
                        <span style={{ fontSize: '13px' }}>
                            Images will appear here when added to the folder
                        </span>
                    </div>
                ) : (
                    // Virtual Grid
                    <AutoSizer>
                        {({ width, height }) => {
                            if (autoSizer.width !== width || autoSizer.height !== height) {
                                setTimeout(() => setAutoSizer({ width, height }), 0);
                            }

                            return (
                                <FixedSizeGrid
                                    ref={gridRef}
                                    columnCount={gridSize.columnCount}
                                    rowCount={gridSize.rowCount}
                                    columnWidth={ImageCardWidth + 16}
                                    rowHeight={ImageCardHeight + 16}
                                    width={width}
                                    height={height}
                                    onScroll={handleScroll}
                                    itemData={itemData}
                                    itemKey={({ columnIndex, rowIndex, data }) => {
                                        const index = rowIndex * data.columnCount + columnIndex;
                                        const item = data.items[index];
                                        // Use URL as stable key, fallback to position for dividers/empty
                                        return item?.url || `${rowIndex}-${columnIndex}`;
                                    }}
                                    style={{
                                        overflowX: 'hidden',
                                    }}
                                    className="gallery-scrollbar"
                                >
                                    {Cell}
                                </FixedSizeGrid>
                            );
                        }}
                    </AutoSizer>
                )}
            </div>

            {/* Load More Indicator */}
            {hasMore && (
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '16px',
                    display: 'flex',
                    justifyContent: 'center',
                    background: 'linear-gradient(to top, var(--bg-primary) 0%, transparent 100%)',
                    pointerEvents: 'none',
                }}>
                    <button
                        onClick={() => loadMore()}
                        disabled={isLoadingMore}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '12px 24px',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '999px',
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: isLoadingMore ? 'wait' : 'pointer',
                            pointerEvents: 'auto',
                            transition: 'all 150ms ease',
                        }}
                    >
                        {isLoadingMore ? (
                            <>
                                <span style={{
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid var(--border-subtle)',
                                    borderTopColor: 'var(--accent-primary)',
                                    borderRadius: '50%',
                                    animation: 'spin 0.8s linear infinite',
                                }} />
                                Loading more...
                            </>
                        ) : (
                            <>Load more images</>
                        )}
                    </button>
                </div>
            )}

            {/* ============================================ */}
            {/* SIMPLE IMAGE PREVIEW MODAL (Click on image) */}
            {/* ============================================ */}
            {previewImage && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: BASE_Z_INDEX + 10,
                        background: 'rgba(0, 0, 0, 0.95)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'fadeIn 200ms ease-out',
                    }}
                    onClick={() => setPreviewImageName(null)}
                >
                    {/* Close Button */}
                    <button
                        onClick={() => setPreviewImageName(null)}
                        style={{
                            position: 'absolute',
                            top: '20px',
                            right: '20px',
                            width: '48px',
                            height: '48px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                            zIndex: 10,
                        }}
                    >
                        <IconX />
                    </button>

                    {/* Favorite Star Button - uses subscription for granular updates */}
                    <PreviewFavoriteButton url={previewImage.url} />

                    {/* Navigation Arrows */}
                    <button
                        onClick={(e) => { e.stopPropagation(); navigatePreview('prev'); }}
                        style={{
                            position: 'absolute',
                            left: '20px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '56px',
                            height: '56px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconChevronLeft />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); navigatePreview('next'); }}
                        style={{
                            position: 'absolute',
                            right: '20px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '56px',
                            height: '56px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconChevronRight />
                    </button>

                    {/* Image Content */}
                    <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
                        {previewImage.type === 'image' && (
                            <img
                                src={`${BASE_PATH}${previewImage.url}`}
                                alt={previewImage.name}
                                style={{
                                    maxWidth: '90vw',
                                    maxHeight: '90vh',
                                    objectFit: 'contain',
                                    borderRadius: '8px',
                                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                                }}
                            />
                        )}
                        {previewImage.type === 'media' && (
                            <video
                                src={`${BASE_PATH}${previewImage.url}`}
                                autoPlay
                                controls
                                loop
                                style={{
                                    maxWidth: '90vw',
                                    maxHeight: '90vh',
                                    borderRadius: '8px',
                                }}
                            />
                        )}
                        {previewImage.type === 'audio' && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '24px',
                                padding: '40px',
                                background: 'var(--bg-secondary)',
                                borderRadius: '16px',
                            }}>
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5">
                                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                                </svg>
                                <audio controls autoPlay src={`${BASE_PATH}${previewImage.url}`} style={{ width: '400px' }} />
                            </div>
                        )}
                    </div>

                    {/* Filename at bottom */}
                    <div style={{
                        position: 'absolute',
                        bottom: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '12px 24px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        backdropFilter: 'blur(8px)',
                        borderRadius: '999px',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: '500',
                    }}>
                        {previewImage.name}
                    </div>
                </div>
            )}

            {/* ============================================ */}
            {/* INFO/METADATA PANEL (Click on Info button) */}
            {/* ============================================ */}
            {infoImage && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: BASE_Z_INDEX + 10,
                        background: 'rgba(0, 0, 0, 0.9)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'fadeIn 200ms ease-out',
                    }}
                    onClick={() => { setInfoImageName(null); setImageInfoName(undefined); }}
                >
                    {/* Close Button */}
                    <button
                        onClick={() => { setInfoImageName(null); setImageInfoName(undefined); }}
                        style={{
                            position: 'absolute',
                            top: '20px',
                            right: '20px',
                            width: '48px',
                            height: '48px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                            zIndex: 10,
                        }}
                    >
                        <IconX />
                    </button>

                    {/* Navigation Arrows */}
                    <button
                        onClick={(e) => { e.stopPropagation(); navigatePreview('prev'); }}
                        style={{
                            position: 'absolute',
                            left: '20px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '56px',
                            height: '56px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconChevronLeft />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); navigatePreview('next'); }}
                        style={{
                            position: 'absolute',
                            right: '20px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '56px',
                            height: '56px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconChevronRight />
                    </button>

                    {/* Metadata View */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '95vw',
                            maxHeight: '90vh',
                            overflow: 'auto',
                        }}
                        className="gallery-scrollbar"
                    >
                        <MetadataView
                            image={infoImage}
                            onShowRaw={() => setShowRawMetadata(true)}
                            showRawMetadata={showRawMetadata}
                            setShowRawMetadata={setShowRawMetadata}
                        />
                    </div>
                </div>
            )}

            {/* Keyframes */}
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default GalleryImageGrid;
