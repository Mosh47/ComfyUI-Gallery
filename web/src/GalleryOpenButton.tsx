import { useRef, useEffect, useState } from 'react';
import { useGalleryContext } from './GalleryContext';
import { useLocalStorageState, useDebounceFn } from 'ahooks';
import { OPEN_BUTTON_ID } from './ComfyAppApi';

// Gallery Icon
const IconGallery = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
        <circle cx="9" cy="9" r="2"/>
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
    </svg>
);

const GalleryOpenButton = () => {
    const { open, setOpen, loading, settings } = useGalleryContext();
    const [position, setPosition] = useLocalStorageState<{ x: number; y: number }>('gallery-floating-btn-pos', {
        defaultValue: { x: 24, y: 24 },
    });
    const { run: savePosition } = useDebounceFn((pos) => setPosition(pos), { wait: 400 });
    const btnRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    // Keep button in viewport
    useEffect(() => {
        if (!position) return;

        const handleResize = () => {
            const btnRect = btnRef.current?.getBoundingClientRect();
            const btnWidth = btnRect?.width || 160;
            const btnHeight = btnRect?.height || 56;
            const padding = 16;

            let { x, y } = position;
            let changed = false;

            if (x + btnWidth > window.innerWidth - padding) {
                x = Math.max(padding, window.innerWidth - btnWidth - padding);
                changed = true;
            }
            if (y + btnHeight > window.innerHeight - padding) {
                y = Math.max(padding, window.innerHeight - btnHeight - padding);
                changed = true;
            }
            if (x < padding) { x = padding; changed = true; }
            if (y < padding) { y = padding; changed = true; }

            if (changed && (x !== position.x || y !== position.y)) {
                setPosition({ x, y });
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => window.removeEventListener('resize', handleResize);
    }, [position, setPosition]);

    // Hidden button for keyboard shortcut
    if (settings.hideOpenButton) {
        return (
            <button
                id={OPEN_BUTTON_ID}
                onClick={() => !loading && setOpen(true)}
                style={{ display: 'none' }}
            />
        );
    }

    // Floating button
    if (settings.floatingButton) {
        return (
            <>
                <div
                    ref={btnRef}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    style={{
                        position: 'fixed',
                        left: position?.x ?? 24,
                        top: position?.y ?? 24,
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: isDragging ? 'grabbing' : 'grab',
                        userSelect: 'none',
                        animation: 'floatIn 500ms ease-out',
                    }}
                    onMouseDown={e => {
                        if ((e.target as HTMLElement).tagName === 'BUTTON') return;

                        setIsDragging(true);
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const origX = position?.x ?? 24;
                        const origY = position?.y ?? 24;

                        const onMove = (moveEvent: MouseEvent) => {
                            const dx = moveEvent.clientX - startX;
                            const dy = moveEvent.clientY - startY;

                            const btnRect = btnRef.current?.getBoundingClientRect();
                            const btnWidth = btnRect?.width || 160;
                            const btnHeight = btnRect?.height || 56;
                            const padding = 16;

                            let newX = Math.max(padding, Math.min(origX + dx, window.innerWidth - btnWidth - padding));
                            let newY = Math.max(padding, Math.min(origY + dy, window.innerHeight - btnHeight - padding));

                            const newPos = { x: newX, y: newY };
                            setPosition(newPos);
                            savePosition(newPos);
                        };

                        const onUp = () => {
                            setIsDragging(false);
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                        };

                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    }}
                >
                    {/* Drag Handle */}
                    <div
                        style={{
                            width: '36px',
                            height: '6px',
                            background: isHovered ? 'var(--text-muted)' : 'var(--bg-elevated)',
                            borderRadius: '999px',
                            opacity: isHovered ? 1 : 0.6,
                            transition: 'all 200ms ease',
                            cursor: 'grab',
                        }}
                        title="Drag to move"
                    />

                    {/* Main Button */}
                    <button
                        id={OPEN_BUTTON_ID}
                        onClick={() => !loading && setOpen(true)}
                        disabled={loading}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '12px 20px',
                            background: 'linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%)',
                            border: 'none',
                            borderRadius: '14px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: loading ? 'wait' : 'pointer',
                            boxShadow: isHovered
                                ? '0 0 30px rgba(0, 212, 255, 0.5), 0 8px 32px rgba(0, 0, 0, 0.3)'
                                : '0 0 20px rgba(0, 212, 255, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2)',
                            transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                            opacity: loading ? 0.8 : 1,
                        }}
                    >
                        {loading ? (
                            <>
                                <span style={{
                                    width: '18px',
                                    height: '18px',
                                    border: '2px solid rgba(255,255,255,0.3)',
                                    borderTopColor: 'white',
                                    borderRadius: '50%',
                                    animation: 'spin 0.8s linear infinite',
                                }} />
                                Loading...
                            </>
                        ) : (
                            <>
                                <IconGallery />
                                {settings.buttonLabel || 'Gallery'}
                            </>
                        )}
                    </button>

                    {/* Keyboard Hint */}
                    {isHovered && settings.galleryShortcut && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 10px',
                            background: 'rgba(0, 0, 0, 0.8)',
                            borderRadius: '8px',
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            animation: 'fadeIn 200ms ease-out',
                        }}>
                            <kbd style={{
                                padding: '2px 6px',
                                background: 'var(--bg-elevated)',
                                borderRadius: '4px',
                                fontSize: '10px',
                            }}>Ctrl</kbd>
                            +
                            <kbd style={{
                                padding: '2px 6px',
                                background: 'var(--bg-elevated)',
                                borderRadius: '4px',
                                fontSize: '10px',
                            }}>G</kbd>
                        </div>
                    )}
                </div>

                <style>{`
                    @keyframes floatIn {
                        from {
                            opacity: 0;
                            transform: translateY(-20px);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0);
                        }
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                `}</style>
            </>
        );
    }

    // Standard inline button (non-floating)
    return (
        <>
            <button
                id={OPEN_BUTTON_ID}
                onClick={() => !loading && setOpen(true)}
                disabled={loading}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 18px',
                    background: 'linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%)',
                    border: 'none',
                    borderRadius: '10px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: loading ? 'wait' : 'pointer',
                    boxShadow: isHovered
                        ? '0 0 20px rgba(0, 212, 255, 0.4)'
                        : '0 2px 8px rgba(0, 0, 0, 0.2)',
                    transform: isHovered ? 'scale(1.02)' : 'scale(1)',
                    transition: 'all 200ms ease',
                    opacity: loading ? 0.8 : 1,
                }}
            >
                {loading ? (
                    <>
                        <span style={{
                            width: '16px',
                            height: '16px',
                            border: '2px solid rgba(255,255,255,0.3)',
                            borderTopColor: 'white',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                        }} />
                        Loading...
                    </>
                ) : (
                    <>
                        <IconGallery />
                        {settings.buttonLabel || 'Gallery'}
                    </>
                )}
            </button>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </>
    );
};

export default GalleryOpenButton;
