import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { FileDetails } from './types';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';
import { useFavorite } from './useFavorite';
import { favoritesStore } from './favoritesStore';

export const ImageCardWidth = 280;
export const ImageCardHeight = 320;

// Icons
const IconInfo = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>
);

const IconPlay = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
);

const IconMusic = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
);

const IconCheck = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>
);

const IconStarOutline = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);

const IconStarFilled = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);


const ImageCard = React.memo(function ImageCard({
    image,
    index,
    onImageClick,
    onInfoClick,
}: {
    image: FileDetails & { dragFolder?: string };
    index: number;
    onImageClick: () => void;  // Click on image = full preview
    onInfoClick: () => void;   // Click info = metadata panel
}) {
    const {
        settings,
        selectedImages,
        setSelectedImages,
        imagesDetailsList,
        lastSelectedIndex,
        setLastSelectedIndex,
    } = useGalleryContext();
    // Subscribe to THIS image's favorite status only - won't re-render other cards
    const isFavorite = useFavorite(image.url);
    const onFavoriteToggle = useCallback(() => {
        favoritesStore.toggleFavorite(image.url);
    }, [image.url]);
    const dragRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    const isSelected = selectedImages.includes(image.url);

    // Order of selectable media (no dividers/empty items) for range selection
    const selectableImages = useMemo(
        () => imagesDetailsList.filter(img => img && (img.type === 'image' || img.type === 'media' || img.type === 'audio')),
        [imagesDetailsList]
    );

    // Native HTML5 drag handlers for reliable cross-element drag/drop
    // If multiple images are selected and the dragged image is part of the selection,
    // we send the whole selection as a group so the drop target can move them all.
    const handleDragStart = useCallback((e: React.DragEvent) => {
        setDragging(true);

        let items: Array<{ name: string; folder: string; type: string; url: string }> = [];
        const isPartOfSelection = selectedImages.includes(image.url);

        if (isPartOfSelection && selectedImages.length > 1) {
            const selectedSet = new Set(selectedImages);
            items = imagesDetailsList
                .filter(img => selectedSet.has(img.url))
                .map(img => ({
                    name: img.name,
                    folder: img.folder,
                    type: img.type,
                    url: img.url,
                }));
        } else {
            items = [{
                name: image.name,
                folder: image.dragFolder || image.folder || '',
                type: image.type,
                url: image.url,
            }];
        }

        const dragData = JSON.stringify({ items });
        e.dataTransfer.setData('application/json', dragData);
        e.dataTransfer.setData('text/plain', dragData); // Fallback
        e.dataTransfer.effectAllowed = 'move';
    }, [image.name, image.folder, image.dragFolder, image.type, image.url, selectedImages, imagesDetailsList]);

    const handleDragEnd = useCallback(() => {
        setDragging(false);
    }, []);

    // Intersection Observer for lazy loading
    useEffect(() => {
        const target = dragRef.current;
        if (!target) return;

        if (typeof IntersectionObserver === 'undefined') {
            setIsVisible(true);
            return;
        }

        setIsVisible(false);
        let cancelled = false;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!cancelled && entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '300px' }
        );

        observer.observe(target);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [image.url]);

    const handleCardClick = (event: React.MouseEvent) => {
        if (event.shiftKey) {
            event.stopPropagation();
            event.preventDefault();

            const orderedUrls = selectableImages.map(img => img.url);
            const currentIdx = orderedUrls.indexOf(image.url);
            if (currentIdx === -1) {
                return;
            }

            const anchor = lastSelectedIndex >= 0 ? lastSelectedIndex : currentIdx;
            const [start, end] = anchor <= currentIdx ? [anchor, currentIdx] : [currentIdx, anchor];
            const rangeUrls = orderedUrls.slice(start, end + 1);

            setSelectedImages(prev => Array.from(new Set([...prev, ...rangeUrls])));
            setLastSelectedIndex(currentIdx);
            return;
        }

        if (event.ctrlKey || event.metaKey) {
            // Ctrl+click = select/deselect
            event.stopPropagation();
            event.preventDefault();
            setSelectedImages(prev => {
                if (prev.includes(image.url)) {
                    return prev.filter(url => url !== image.url);
                }
                return [...prev, image.url];
            });
            const currentIdx = selectableImages.findIndex(img => img.url === image.url);
            if (currentIdx !== -1) setLastSelectedIndex(currentIdx);
        } else {
            // Normal click = open full preview
            setSelectedImages([]);
            const currentIdx = selectableImages.findIndex(img => img.url === image.url);
            if (currentIdx !== -1) setLastSelectedIndex(currentIdx);
            onImageClick();
        }
    };

    const thumbnailUrl = useMemo(() => {
        if (image.type === 'image') {
            // Use thumbnail if available, otherwise full image
            return `${BASE_PATH}${image.url}`;
        }
        return null;
    }, [image.url, image.type]);

    return (
        <div
            ref={dragRef}
            className="image-card"
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={handleCardClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                width: ImageCardWidth,
                height: ImageCardHeight,
                borderRadius: '16px',
                overflow: 'hidden',
                position: 'relative',
                cursor: dragging ? 'grabbing' : 'pointer',
                background: isSelected ? 'rgba(0, 212, 255, 0.08)' : 'var(--bg-tertiary)',
                border: isSelected
                    ? '2px solid var(--accent-primary)'
                    : '2px solid rgba(255, 255, 255, 0.06)',
                boxShadow: isSelected
                    ? '0 0 0 2px rgba(0, 212, 255, 0.8), 0 0 30px rgba(0, 212, 255, 0.6)'
                    : isHovered
                        ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.1)'
                        : '0 4px 12px rgba(0, 0, 0, 0.2)',
                transform: dragging
                    ? 'scale(0.95)'
                    : isHovered
                        ? 'translateY(-4px) scale(1.02)'
                        : 'translateY(0) scale(1)',
                transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                opacity: dragging ? 0.7 : 1,
            }}
        >
            {/* Selection Indicator */}
            {isSelected && (
                <div style={{
                    position: 'absolute',
                    top: '12px',
                    left: '12px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'var(--accent-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--bg-primary)',
                    zIndex: 10,
                    animation: 'scaleIn 200ms ease-out',
                }}>
                    <IconCheck />
                </div>
            )}

            {/* Favorite Star Button - each card subscribes to its own status */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onFavoriteToggle();
                }}
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: isFavorite ? 'rgba(255, 215, 0, 0.9)' : 'rgba(0, 0, 0, 0.5)',
                        backdropFilter: 'blur(8px)',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isFavorite ? '#1a1a1a' : 'rgba(255, 255, 255, 0.9)',
                        cursor: 'pointer',
                        zIndex: 10,
                        opacity: isHovered || isFavorite ? 1 : 0,
                        transform: isHovered || isFavorite ? 'scale(1)' : 'scale(0.8)',
                        transition: 'all 200ms ease',
                        boxShadow: isFavorite
                            ? '0 2px 12px rgba(255, 215, 0, 0.4)'
                            : '0 2px 8px rgba(0, 0, 0, 0.3)',
                    }}
                    onMouseEnter={e => {
                        if (!isFavorite) {
                            e.currentTarget.style.background = 'rgba(255, 215, 0, 0.7)';
                            e.currentTarget.style.color = '#1a1a1a';
                        }
                    }}
                    onMouseLeave={e => {
                        if (!isFavorite) {
                            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)';
                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
                        }
                    }}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                    {isFavorite ? <IconStarFilled /> : <IconStarOutline />}
                </button>

            {/* Skeleton Loading State */}
            {!isVisible && (
                <div style={{
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                }} />
            )}

            {/* Image Content */}
            {isVisible && image.type === 'image' && (
                <>
                    {!imageLoaded && !imageError && (
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%)',
                            backgroundSize: '200% 100%',
                            animation: 'shimmer 1.5s infinite',
                        }} />
                    )}
                    <img
                        src={thumbnailUrl!}
                        alt={image.name}
                        draggable={false}
                        onLoad={() => setImageLoaded(true)}
                        onError={() => setImageError(true)}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            opacity: imageLoaded ? 1 : 0,
                            transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                            transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                    />
                </>
            )}

            {/* Video Content */}
            {isVisible && image.type === 'media' && (
                <>
                    <video
                        src={`${BASE_PATH}${image.url}`}
                        autoPlay={settings.autoPlayVideos && isHovered}
                        loop
                        muted
                        playsInline
                        draggable={false}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                            transition: 'transform 400ms ease',
                        }}
                    />
                    {/* Play Icon Overlay */}
                    {!isHovered && (
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            background: 'rgba(0, 0, 0, 0.6)',
                            backdropFilter: 'blur(8px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            pointerEvents: 'none',
                        }}>
                            <IconPlay />
                        </div>
                    )}
                </>
            )}

            {/* Audio Content */}
            {isVisible && image.type === 'audio' && (
                <div style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-elevated) 100%)',
                    padding: '20px',
                }}>
                    <div style={{
                        color: 'var(--accent-primary)',
                        marginBottom: '16px',
                        opacity: 0.8,
                    }}>
                        <IconMusic />
                    </div>
                    <audio
                        controls
                        src={`${BASE_PATH}${image.url}`}
                        style={{
                            width: '90%',
                            height: '36px',
                            borderRadius: '999px',
                        }}
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}

            {/* Hover Overlay - pointerEvents: none so clicks pass through to image */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 250ms ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                padding: '16px',
                pointerEvents: 'none', // Let clicks pass through to image
            }}>
                {/* File Name */}
                <p style={{
                    margin: '0 0 12px 0',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: 'white',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    transform: isHovered ? 'translateY(0)' : 'translateY(10px)',
                    opacity: isHovered ? 1 : 0,
                    transition: 'all 250ms ease 50ms',
                }}>
                    {image.name}
                </p>

                {/* Info Button Only - clicking image itself opens full preview */}
                <div style={{
                    display: 'flex',
                    gap: '8px',
                    transform: isHovered ? 'translateY(0)' : 'translateY(10px)',
                    opacity: isHovered ? 1 : 0,
                    transition: 'all 250ms ease 100ms',
                    pointerEvents: isHovered ? 'auto' : 'none', // Only button captures events
                }}>
                    {/* Info Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onInfoClick();
                        }}
                        style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            padding: '10px',
                            background: 'rgba(255, 255, 255, 0.15)',
                            backdropFilter: 'blur(10px)',
                            border: 'none',
                            borderRadius: '10px',
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--accent-primary)';
                            e.currentTarget.style.transform = 'scale(1.02)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        <IconInfo />
                        Info & Metadata
                    </button>
                </div>
            </div>

            {/* Type Badge - positioned below favorite star */}
            {image.type !== 'image' && (
                <div style={{
                    position: 'absolute',
                    top: '56px',
                    right: '12px',
                    padding: '4px 10px',
                    background: image.type === 'media' ? 'var(--accent-secondary)' : 'var(--accent-tertiary)',
                    borderRadius: '999px',
                    fontSize: '10px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    color: 'white',
                    letterSpacing: '0.5px',
                }}>
                    {image.type === 'media' ? 'Video' : 'Audio'}
                </div>
            )}

            {/* Global Keyframes */}
            <style>{`
                @keyframes fadeInUp {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes scaleIn {
                    from {
                        opacity: 0;
                        transform: scale(0.5);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                @keyframes shimmer {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                }
            `}</style>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison: only re-render if relevant props change
    return (
        prevProps.image.url === nextProps.image.url &&
        prevProps.image.name === nextProps.image.name &&
        prevProps.image.type === nextProps.image.type &&
        prevProps.index === nextProps.index
        // Note: onImageClick and onInfoClick are stable due to useCallback in parent
    );
});

export default ImageCard;
