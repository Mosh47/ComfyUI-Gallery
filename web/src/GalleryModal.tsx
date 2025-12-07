import { useEffect, useRef } from 'react';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import GalleryImageGrid from './GalleryImageGrid';
import GallerySettingsModal from './GallerySettingsModal';
import { BASE_Z_INDEX } from './ComfyAppApi';
import './styles/theme.css';

const GalleryModal = () => {
    const { open, setOpen, size, showSettings, siderCollapsed } = useGalleryContext();
    const modalRef = useRef<HTMLDivElement>(null);

    // Handle escape key to close modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open && !showSettings) {
                setOpen(false);
            }
        };

        if (open) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [open, showSettings, setOpen]);

    // Handle click outside to close
    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            setOpen(false);
        }
    };

    if (!open) return null;

    return (
        <>
            {/* Modal Overlay */}
            <div
                onClick={handleOverlayClick}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: BASE_Z_INDEX,
                    background: 'rgba(0, 0, 0, 0.85)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                    animation: 'fadeIn 200ms ease-out',
                }}
            >
                {/* Modal Container */}
                <div
                    ref={modalRef}
                    className="gallery-root"
                    style={{
                        width: '100%',
                        maxWidth: size?.width ? Math.min(size.width - 40, 1800) : 1600,
                        height: '90vh',
                        maxHeight: '90vh',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-xl)',
                        border: '1px solid var(--border-subtle)',
                        boxShadow: 'var(--shadow-lg)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        animation: 'scaleIn 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            background: 'var(--glass-bg)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            borderBottom: '1px solid var(--border-subtle)',
                            padding: '12px 20px',
                            flexShrink: 0,
                        }}
                    >
                        <GalleryHeader />
                    </div>

                    {/* Main Content */}
                    <div
                        style={{
                            display: 'flex',
                            flex: 1,
                            overflow: 'hidden',
                        }}
                    >
                        {/* Sidebar */}
                        <div
                            style={{
                                width: siderCollapsed ? 0 : 280,
                                flexShrink: 0,
                                overflow: 'hidden',
                                transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
                                borderRight: siderCollapsed ? 'none' : '1px solid var(--border-subtle)',
                                background: 'var(--glass-bg)',
                                backdropFilter: 'blur(20px)',
                            }}
                        >
                            <div
                                style={{
                                    width: 280,
                                    height: '100%',
                                    overflow: 'hidden',
                                    opacity: siderCollapsed ? 0 : 1,
                                    transition: 'opacity 200ms ease-out',
                                }}
                            >
                                <GallerySidebar />
                            </div>
                        </div>

                        {/* Image Grid */}
                        <div
                            style={{
                                flex: 1,
                                overflow: 'hidden',
                                background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
                            }}
                        >
                            <GalleryImageGrid />
                        </div>
                    </div>

                    {/* Status Bar */}
                    <div
                        style={{
                            background: 'var(--bg-tertiary)',
                            borderTop: '1px solid var(--border-subtle)',
                            padding: '8px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                            flexShrink: 0,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <span>
                                <kbd style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '2px 6px',
                                    background: 'var(--bg-elevated)',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    marginRight: '4px',
                                }}>Ctrl</kbd>
                                + Click to select multiple
                            </span>
                            <span>
                                <kbd style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '2px 6px',
                                    background: 'var(--bg-elevated)',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    marginRight: '4px',
                                }}>Esc</kbd>
                                to close
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: 'var(--accent-success)',
                                animation: 'pulse 2s infinite',
                            }} />
                            <span>Live monitoring active</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Settings Modal */}
            {showSettings && <GallerySettingsModal />}

            {/* Global Keyframes */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleIn {
                    from {
                        opacity: 0;
                        transform: scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </>
    );
};

export default GalleryModal;
