import { useEffect, useRef, useState } from 'react';
import { useGalleryContext } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi, BASE_Z_INDEX } from './ComfyAppApi';

// Icons as SVG components for better control
const IconSearch = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
);

const IconSettings = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
);

const IconSidebar = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>
    </svg>
);

const IconDownload = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>
    </svg>
);

const IconTrash = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>
);

const IconX = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
);

const IconRefresh = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
    </svg>
);

const GalleryHeader = () => {
    const {
        showSettings, setShowSettings,
        searchFileName, setSearchFileName,
        searchMode, setSearchMode,
        sortMethod, setSortMethod,
        imagesAutoCompleteNames,
        setAutoCompleteOptions,
        setOpen,
        selectedImages, setSelectedImages,
        siderCollapsed, setSiderCollapsed,
        refreshFolder,
        currentFolder,
        folderCounts,
        deleteImages,
    } = useGalleryContext();

    const [search, setSearch] = useState("");
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [downloading, setDownloading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const dragCounter = useRef(0);

    const [countdown] = useCountDown({
        targetDate,
        onEnd: () => {
            setOpen(false);
            setShowClose(false);
            setTargetDate(undefined);
        },
    });

    const currentCount = folderCounts[currentFolder] ?? 0;

    useEffect(() => {
        const onDragStart = () => setShowClose(true);
        const onDragEnd = () => {
            setShowClose(false);
            setTargetDate(undefined);
        };
        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, []);

    // 300ms debounce is the sweet spot: responsive enough for feedback,
    // but prevents excessive filtering on every keystroke
    const debouncedSearch = useDebounce(search, { wait: 300 });

    useEffect(() => {
        setSearchFileName(debouncedSearch);
        if (!debouncedSearch || debouncedSearch.length === 0) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions, setSearchFileName]);

    const handleDownloadSelected = async () => {
        setDownloading(true);
        try {
            const zip = new JSZip();
            await Promise.all(selectedImages.map(async (url) => {
                try {
                    const fetchUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;
                    const response = await fetch(fetchUrl);
                    const blob = await response.blob();
                    const filename = url.split('/').pop() || 'image';
                    zip.file(filename, blob);
                } catch (e) {
                    console.error('Failed to fetch image:', url, e);
                }
            }));
            const content = await zip.generateAsync({ type: 'blob' });
            FileSaver.saveAs(content, 'gallery-images.zip');
        } finally {
            setDownloading(false);
        }
    };

    const handleDeleteSelected = async () => {
        if (!selectedImages.length) return;
        setDeleting(true);
        try {
            await deleteImages(selectedImages);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Left Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Sidebar Toggle */}
                <button
                    onClick={() => setSiderCollapsed(prev => !prev)}
                    style={{
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: siderCollapsed ? 'var(--bg-tertiary)' : 'rgba(0, 212, 255, 0.15)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        color: siderCollapsed ? 'var(--text-secondary)' : 'var(--accent-primary)',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                    }}
                    title={siderCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                >
                    <IconSidebar />
                </button>

                {/* Settings */}
                <button
                    onClick={() => setShowSettings(true)}
                    style={{
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                    }}
                    title="Settings"
                >
                    <IconSettings />
                </button>

                {/* Refresh */}
                <button
                    onClick={() => refreshFolder(currentFolder)}
                    style={{
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                    }}
                    title="Refresh folder"
                >
                    <IconRefresh />
                </button>

                {/* Image Count Badge */}
                <div style={{
                    padding: '6px 12px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                }}>
                    {currentCount} images
                </div>
            </div>

            {/* Selection Actions */}
            {selectedImages.length > 0 && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 12px',
                    background: 'rgba(0, 212, 255, 0.1)',
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 'var(--radius-full)',
                    animation: 'fadeIn 200ms ease-out',
                }}>
                    <span style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        color: 'var(--accent-primary)',
                    }}>
                        {selectedImages.length} selected
                    </span>

                    {/* Download Selected */}
                    <button
                        onClick={async () => {
                            if (downloading || selectedImages.length === 0) return;
                            const confirmed = window.confirm(`Download ${selectedImages.length} images as a ZIP file?`);
                            if (!confirmed) return;
                            await handleDownloadSelected();
                        }}
                        disabled={downloading}
                        className="selectedImagesActionButton"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            background: 'var(--accent-primary)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--bg-primary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: downloading ? 'wait' : 'pointer',
                            opacity: downloading ? 0.7 : 1,
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconDownload />
                        {downloading ? 'Zipping...' : 'Download'}
                    </button>

                    {/* Delete Selected */}
                    <button
                        onClick={async () => {
                            if (deleting || selectedImages.length === 0) return;
                            const confirmed = window.confirm(`Delete ${selectedImages.length} images?\nThis cannot be undone.`);
                            if (!confirmed) return;
                            await handleDeleteSelected();
                        }}
                        disabled={deleting}
                        className="selectedImagesActionButton"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            background: 'var(--accent-danger)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: deleting ? 'wait' : 'pointer',
                            opacity: deleting ? 0.7 : 1,
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconTrash />
                        Delete
                    </button>

                    {/* Clear Selection */}
                    <button
                        onClick={() => setSelectedImages([])}
                        style={{
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                        title="Clear selection"
                    >
                        <IconX />
                    </button>
                </div>
            )}

            {/* Drag to Close Zone */}
            {showClose && (
                <div
                    onDragEnter={e => {
                        e.preventDefault();
                        dragCounter.current++;
                        if (!targetDate) setTargetDate(Date.now() + 3000);
                    }}
                    onDragLeave={e => {
                        e.preventDefault();
                        dragCounter.current--;
                        if (dragCounter.current === 0 && targetDate) setTargetDate(undefined);
                    }}
                    style={{
                        padding: '8px 16px',
                        background: targetDate ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-tertiary)',
                        border: `1px solid ${targetDate ? 'var(--accent-danger)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-md)',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: targetDate ? 'var(--accent-danger)' : 'var(--text-muted)',
                        transition: 'all 200ms ease',
                    }}
                >
                    {targetDate ? `Closing in ${Math.ceil(countdown / 1000)}s...` : 'Drag here to close'}
                </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Search mode toggle + Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                {/* Search Mode Toggle - Segmented Control */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-full) 0 0 var(--radius-full)',
                        border: '1px solid var(--border-subtle)',
                        borderRight: 'none',
                        padding: '2px',
                        height: '42px',
                    }}
                >
                    {([
                        { key: 'prompt' as const, label: 'Prompt', icon: '✨' },
                        { key: 'filename' as const, label: 'Filename', icon: '📄' },
                    ]).map(option => {
                        const isActive = searchMode === option.key;
                        return (
                            <button
                                key={option.key}
                                onClick={() => setSearchMode(option.key)}
                                type="button"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-full)',
                                    border: 'none',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                    background: isActive
                                        ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary, #00a8cc))'
                                        : 'transparent',
                                    boxShadow: isActive ? '0 2px 8px rgba(0, 212, 255, 0.3)' : 'none',
                                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                                    transform: isActive ? 'scale(1)' : 'scale(0.98)',
                                    opacity: isActive ? 1 : 0.7,
                                }}
                                onMouseEnter={e => {
                                    if (!isActive) {
                                        e.currentTarget.style.background = 'rgba(0, 212, 255, 0.15)';
                                        e.currentTarget.style.opacity = '1';
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (!isActive) {
                                        e.currentTarget.style.background = 'transparent';
                                        e.currentTarget.style.opacity = '0.7';
                                        e.currentTarget.style.transform = 'scale(0.98)';
                                    }
                                }}
                                title={option.key === 'prompt' ? 'Search in positive prompts (supports comma-separated terms)' : 'Search by file name'}
                            >
                                <span style={{ fontSize: '11px' }}>{option.icon}</span>
                                {option.label}
                            </button>
                        );
                    })}
                </div>

                {/* Search Input - Connected to toggle */}
                <div style={{ position: 'relative', width: '260px' }}>
                <div style={{
                    position: 'absolute',
                        left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                        color: searchMode === 'prompt' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    pointerEvents: 'none',
                        transition: 'color 200ms ease',
                }}>
                    <IconSearch />
                </div>
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                        placeholder={searchMode === 'prompt' ? 'e.g. car, sunset, beach…' : 'Search file name…'}
                    style={{
                        width: '100%',
                            height: '42px',
                            padding: '10px 36px 10px 42px',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                            borderRadius: '0 var(--radius-full) var(--radius-full) 0',
                        color: 'var(--text-primary)',
                            fontSize: '13px',
                        outline: 'none',
                        transition: 'all 150ms ease',
                    }}
                    onFocus={e => {
                        e.target.style.borderColor = 'var(--accent-primary)';
                        e.target.style.boxShadow = '0 0 0 3px rgba(0, 212, 255, 0.15)';
                    }}
                    onBlur={e => {
                        e.target.style.borderColor = 'var(--border-subtle)';
                        e.target.style.boxShadow = 'none';
                    }}
                />
                {search && (
                    <button
                        onClick={() => setSearch('')}
                        style={{
                            position: 'absolute',
                                right: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                                width: '22px',
                                height: '22px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--bg-elevated)',
                            border: 'none',
                                borderRadius: '50%',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                                transition: 'all 150ms ease',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'var(--accent-danger)';
                                e.currentTarget.style.color = 'white';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'var(--bg-elevated)';
                                e.currentTarget.style.color = 'var(--text-muted)';
                        }}
                    >
                        <IconX />
                    </button>
                )}
                </div>
            </div>

            {/* Sort Controls */}
            <div style={{
                display: 'flex',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                padding: '3px',
                border: '1px solid var(--border-subtle)',
            }}>
                {(['Newest', 'Oldest', 'Name ↑', 'Name ↓'] as const).map((option) => (
                    <button
                        key={option}
                        onClick={() => setSortMethod(option)}
                        style={{
                            padding: '8px 14px',
                            background: sortMethod === option ? 'var(--accent-primary)' : 'transparent',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: sortMethod === option ? 'var(--bg-primary)' : 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        {option}
                    </button>
                ))}
            </div>

            {/* Close Button */}
            <button
                onClick={() => setOpen(false)}
                style={{
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                }}
                title="Close gallery (Esc)"
            >
                <IconX />
            </button>

            {/* (Bulk confirmation now uses native window.confirm dialogs for reliability) */}
        </div>
    );
};

export default GalleryHeader;
