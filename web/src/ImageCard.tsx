import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { FileDetails } from './types';
import { useDrag } from 'ahooks';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';

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


function ImageCard({
    image,
    index,
    onImageClick,
    onInfoClick,
    onFavoriteToggle,
    isFavorite,
}: {
    image: FileDetails & { dragFolder?: string };
    index: number;
    onImageClick: () => void;  // Click on image = full preview
    onInfoClick: () => void;   // Click info = metadata panel
    onFavoriteToggle?: () => void;  // Toggle favorite status
    isFavorite?: boolean;  // Whether the image is favorited
}) {
    const { settings, selectedImages, setSelectedImages } = useGalleryContext();
    const dragRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    const isSelected = selectedImages.includes(image.url);

    useDrag(
        {
            name: image.name,
            folder: image.dragFolder || '',
            type: image.type,
            url: image.url,
        },
        dragRef,
        {
            onDragStart: () => setDragging(true),
            onDragEnd: () => setDragging(false),
        }
    );

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
        } else {
            // Normal click = open full preview
            setSelectedImages([]);
            onImageClick();
        }
    };

    const handleNativeDragStart = (event: React.DragEvent) => {
        const ext = (image.name || image.url).split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
            mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
        };
        const mimeType = mimeMap[ext] || 'application/octet-stream';
        event.dataTransfer.setData('text/uri-list', `${BASE_PATH}${image.url}`);
        event.dataTransfer.setData('DownloadURL', `${mimeType}:${image.name}:${window.location.origin + BASE_PATH + image.url}`);
    };

    const thumbnailUrl = useMemo(() => {
        if (image.type === 'image') {
            // Use thumbnail if available, otherwise full image
            return `${BASE_PATH}${image.url}`;
        }
        return null;
    }, [image.url, image.type]);

    // Animation delay based on index for staggered effect
    const animationDelay = Math.min(index * 30, 300);

    return (
        <div
            ref={dragRef}
            className="image-card"
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
                background: 'var(--bg-tertiary)',
                border: `2px solid ${isSelected ? 'var(--accent-primary)' : 'transparent'}`,
                boxShadow: isSelected
                    ? '0 0 0 3px rgba(0, 212, 255, 0.25), 0 8px 32px rgba(0, 0, 0, 0.4)'
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
                animation: `fadeInUp 400ms ease-out ${animationDelay}ms backwards`,
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

            {/* Favorite Star Button */}
            {onFavoriteToggle && (
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
            )}

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
                        draggable
                        onDragStart={handleNativeDragStart}
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
                        onClick={(e) => {
                            e.stopPropagation();
                            onImageClick();
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
                        draggable
                        onDragStart={handleNativeDragStart}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                            transition: 'transform 400ms ease',
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onImageClick();
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

            {/* Type Badge - positioned below favorite star if present */}
            {image.type !== 'image' && (
                <div style={{
                    position: 'absolute',
                    top: onFavoriteToggle ? '56px' : '12px',
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
}

export default ImageCard;
