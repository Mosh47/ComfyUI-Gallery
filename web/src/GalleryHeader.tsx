import { useEffect, useRef, useState } from 'react';
import { useGalleryContext } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';

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
        sortMethod, setSortMethod,
        imagesAutoCompleteNames,
        setAutoCompleteOptions,
        setOpen,
        selectedImages, setSelectedImages,
        siderCollapsed, setSiderCollapsed,
        refreshFolder,
        currentFolder,
        folderCounts,
    } = useGalleryContext();

    const [search, setSearch] = useState("");
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [downloading, setDownloading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

    const debouncedSearch = useDebounce(search, { wait: 150 });

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
            setShowDownloadConfirm(false);
        }
    };

    const handleDeleteSelected = async () => {
        setDeleting(true);
        try {
            for (const url of selectedImages) {
                try {
                    await ComfyAppApi.deleteImage(url);
                    await new Promise(res => setTimeout(res, 50));
                } catch (e) {
                    console.error('Failed to delete image:', url, e);
                }
            }
            setSelectedImages([]);
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
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
                        onClick={() => setShowDownloadConfirm(true)}
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
                        onClick={() => setShowDeleteConfirm(true)}
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

            {/* Search */}
            <div style={{ position: 'relative', width: '320px' }}>
                <div style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                }}>
                    <IconSearch />
                </div>
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search images..."
                    style={{
                        width: '100%',
                        padding: '10px 12px 10px 40px',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-full)',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
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
                            right: '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--bg-elevated)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                        }}
                    >
                        <IconX />
                    </button>
                )}
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

            {/* Download Confirmation Modal */}
            {showDownloadConfirm && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 4000,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => setShowDownloadConfirm(false)}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-lg)',
                            padding: '24px',
                            maxWidth: '400px',
                            border: '1px solid var(--border-subtle)',
                            boxShadow: 'var(--shadow-lg)',
                        }}
                    >
                        <h3 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '18px' }}>
                            Download {selectedImages.length} images?
                        </h3>
                        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                            Images will be downloaded as a ZIP file.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowDownloadConfirm(false)}
                                style={{
                                    padding: '10px 20px',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDownloadSelected}
                                disabled={downloading}
                                style={{
                                    padding: '10px 20px',
                                    background: 'var(--accent-primary)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--bg-primary)',
                                    fontWeight: '600',
                                    cursor: downloading ? 'wait' : 'pointer',
                                }}
                            >
                                {downloading ? 'Downloading...' : 'Download'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 4000,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => setShowDeleteConfirm(false)}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-lg)',
                            padding: '24px',
                            maxWidth: '400px',
                            border: '1px solid var(--border-subtle)',
                            boxShadow: 'var(--shadow-lg)',
                        }}
                    >
                        <h3 style={{ margin: '0 0 12px', color: 'var(--accent-danger)', fontSize: '18px' }}>
                            Delete {selectedImages.length} images?
                        </h3>
                        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                            This action cannot be undone. The images will be permanently deleted.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                style={{
                                    padding: '10px 20px',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteSelected}
                                disabled={deleting}
                                style={{
                                    padding: '10px 20px',
                                    background: 'var(--accent-danger)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'white',
                                    fontWeight: '600',
                                    cursor: deleting ? 'wait' : 'pointer',
                                }}
                            >
                                {deleting ? 'Deleting...' : 'Delete Forever'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GalleryHeader;
