import { useState, useMemo, useCallback, useEffect } from 'react';
import type { FileDetails } from './types';
import ReactJsonView from '@microlink/react-json-view';
import { ComfyAppApi, BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { saveAs } from 'file-saver';
import { getCachedMetadata } from './MetadataCache';

// Icons
const IconCopy = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
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

const IconCode = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
);

const IconCheck = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>
);

const IconX = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
);

const IconChevronDown = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6"/>
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

export function MetadataView({
    image,
    onShowRaw,
    showRawMetadata,
    setShowRawMetadata
}: {
    image: FileDetails;
    onShowRaw: () => void;
    showRawMetadata: boolean;
    setShowRawMetadata: (show: boolean) => void;
}) {
    const meta = useMemo(() => getCachedMetadata(image), [image.url, image.metadata, image.metadata_pending]);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        'File Info': true,
        'Prompts': true,
        'LoRAs': true,
        'Generation': true,
    });
    const [metadataLoading, setMetadataLoading] = useState(false);
    const [metadataError, setMetadataError] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const { updateFileMetadata, isFavorite, toggleFavorite } = useGalleryContext();

    useEffect(() => {
        setMetadataError(null);
    }, [image.url]);

    // Fetch metadata if not loaded
    useEffect(() => {
        if (image.type !== 'image') {
            setMetadataLoading(false);
            return;
        }
        if (image.metadata && !image.metadata_pending) {
            setMetadataLoading(false);
            return;
        }
        if (metadataError) return;

        let cancelled = false;
        setMetadataLoading(true);

        (async () => {
            try {
                const response = await ComfyAppApi.fetchMetadata(image.url);
                if (!response.ok) throw new Error(await response.text() || 'Failed to load');
                const payload = await response.json();
                if (cancelled) return;
                updateFileMetadata(image.folder, image.name, payload.metadata ?? {}, payload.metadata_pending ?? false);
            } catch (err: any) {
                if (!cancelled) setMetadataError(err?.message ?? 'Failed to load metadata');
            } finally {
                if (!cancelled) setMetadataLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [image.type, image.metadata, image.metadata_pending, image.url, image.name, image.folder, metadataError, updateFileMetadata]);

    const handleCopy = useCallback((text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
    }, []);

    const handleCopyImage = useCallback(async () => {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = `${BASE_PATH}${image.url}`;
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(async (blob) => {
                        if (blob) {
                            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                            setCopiedKey('image');
                            setTimeout(() => setCopiedKey(null), 2000);
                        }
                    }, 'image/png');
                }
            };
        } catch {}
    }, [image.url]);

    const handleDownload = useCallback(async () => {
        try {
            const response = await fetch(`${BASE_PATH}${image.url}`, { mode: 'cors' });
            const blob = await response.blob();
            saveAs(blob, image.name);
        } catch {}
    }, [image.url, image.name]);

    const handleDelete = useCallback(async () => {
        setDeleting(true);
        try {
            await ComfyAppApi.deleteImage(image.url);
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    }, [image.url]);

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    // Parse LoRAs into a nice format
    const lorasFormatted = useMemo(() => {
        const loraStr = meta['LoRAs'] || '';
        if (!loraStr || loraStr === 'N/A') return null;

        // Parse LoRA string like "loraname (Model: 0.8, Clip: 0.8), another (Model: 1.0, Clip: 1.0)"
        const loraRegex = /([^(,]+)\s*\(Model:\s*([^,]*),\s*Clip:\s*([^)]*)\)/g;
        const loras: { name: string; modelStrength: string; clipStrength: string }[] = [];
        let match;
        while ((match = loraRegex.exec(loraStr)) !== null) {
            loras.push({
                name: match[1].trim(),
                modelStrength: match[2].trim() || '1.0',
                clipStrength: match[3].trim() || '1.0',
            });
        }
        return loras.length > 0 ? loras : null;
    }, [meta]);

    // Organize metadata into sections - order: Prompts, LoRAs, Generation, File Info (at bottom)
    const sections = useMemo(() => {
        // Prompts first
        const prompts = {
            'Positive Prompt': meta['Positive Prompt'] || '',
            'Negative Prompt': meta['Negative Prompt'] || '',
        };

        // Generation settings (without LoRAs - we display those separately)
        const generation = {
            Model: meta['Model'] || '',
            Sampler: meta['Sampler'] || '',
            Scheduler: meta['Scheduler'] || '',
            Steps: meta['Steps'] || '',
            'CFG Scale': meta['CFG Scale'] || '',
            Seed: meta['Seed'] || '',
        };

        // File info at bottom
        const fileInfo = {
            Filename: meta['Filename'] || image.name,
            Resolution: meta['Resolution'] || '',
        };

        // Order: Prompts, Generation, File Info (LoRAs handled separately)
        return { 'Prompts': prompts, 'Generation': generation, 'File Info': fileInfo };
    }, [meta, image.name]);

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                gap: '32px',
                padding: '32px',
                overflow: 'auto',
                animation: 'fadeIn 300ms ease-out',
            }}
        >
            {/* Left: Image Preview + Actions */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '20px',
                flexShrink: 0,
            }}>
                {/* Image Container */}
                <div style={{
                    position: 'relative',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    background: 'var(--bg-tertiary)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                }}>
                    {image.type === 'image' && (
                        <img
                            src={`${BASE_PATH}${image.url}`}
                            alt={image.name}
                            style={{
                                maxWidth: '500px',
                                maxHeight: '60vh',
                                objectFit: 'contain',
                                display: 'block',
                            }}
                        />
                    )}
                    {image.type === 'media' && (
                        <video
                            src={`${BASE_PATH}${image.url}`}
                            autoPlay
                            controls
                            loop
                            style={{
                                maxWidth: '500px',
                                maxHeight: '60vh',
                                display: 'block',
                            }}
                        />
                    )}
                    {image.type === 'audio' && (
                        <div style={{
                            padding: '40px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '20px',
                        }}>
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5">
                                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                            </svg>
                            <audio controls src={`${BASE_PATH}${image.url}`} style={{ width: '300px' }} />
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {/* Favorite Button */}
                    <button
                        onClick={() => toggleFavorite(image)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 16px',
                            background: isFavorite(image.url) ? 'rgba(255, 215, 0, 0.9)' : 'var(--bg-tertiary)',
                            border: isFavorite(image.url) ? '1px solid rgba(255, 215, 0, 1)' : '1px solid var(--border-subtle)',
                            borderRadius: '10px',
                            color: isFavorite(image.url) ? '#1a1a1a' : 'var(--text-secondary)',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                            boxShadow: isFavorite(image.url) ? '0 2px 12px rgba(255, 215, 0, 0.3)' : 'none',
                        }}
                    >
                        {isFavorite(image.url) ? <IconStarFilled /> : <IconStarOutline />}
                        {isFavorite(image.url) ? 'Favorited' : 'Favorite'}
                    </button>
                    {image.type === 'image' && (
                        <button
                            onClick={handleCopyImage}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '10px 16px',
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '10px',
                                color: copiedKey === 'image' ? 'var(--accent-success)' : 'var(--text-secondary)',
                                fontSize: '13px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                transition: 'all 150ms ease',
                            }}
                        >
                            {copiedKey === 'image' ? <IconCheck /> : <IconCopy />}
                            {copiedKey === 'image' ? 'Copied!' : 'Copy Image'}
                        </button>
                    )}
                    <button
                        onClick={handleDownload}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 16px',
                            background: 'var(--accent-primary)',
                            border: 'none',
                            borderRadius: '10px',
                            color: 'var(--bg-primary)',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconDownload />
                        Download
                    </button>
                    <button
                        onClick={onShowRaw}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 16px',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconCode />
                        Raw JSON
                    </button>
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 16px',
                            background: 'transparent',
                            border: '1px solid var(--accent-danger)',
                            borderRadius: '10px',
                            color: 'var(--accent-danger)',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconTrash />
                        Delete
                    </button>
                </div>
            </div>

            {/* Right: Metadata Panel */}
            {image.type === 'image' && (
                <div
                    className="gallery-scrollbar"
                    style={{
                        flex: 1,
                        maxWidth: '550px',
                        background: 'var(--glass-bg)',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '16px',
                        border: '1px solid var(--border-subtle)',
                        padding: '16px',
                        overflow: 'auto',
                        maxHeight: '70vh',
                    }}
                >
                    {metadataLoading && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '16px',
                            background: 'var(--bg-tertiary)',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                        }}>
                            <div style={{
                                width: '18px',
                                height: '18px',
                                border: '2px solid var(--border-subtle)',
                                borderTopColor: 'var(--accent-primary)',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                            }} />
                            Loading metadata...
                        </div>
                    )}

                    {metadataError && (
                        <div style={{
                            padding: '16px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid var(--accent-danger)',
                            borderRadius: '10px',
                            color: 'var(--accent-danger)',
                            fontSize: '13px',
                        }}>
                            {metadataError}
                        </div>
                    )}

                    {/* Metadata Sections */}
                    {Object.entries(sections).map(([sectionName, sectionData]) => {
                        const isExpanded = expandedSections[sectionName] !== false;
                        const hasContent = Object.values(sectionData).some(v => v && v !== 'N/A');

                        if (!hasContent && sectionName !== 'File Info') return null;

                        return (
                            <div key={sectionName} style={{ marginBottom: '8px' }}>
                                {/* Section Header */}
                                <button
                                    onClick={() => toggleSection(sectionName)}
                                    style={{
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '8px 0',
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: '1px solid var(--border-subtle)',
                                        cursor: 'pointer',
                                        marginBottom: '6px',
                                    }}
                                >
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                        color: 'var(--accent-primary)',
                                    }}>
                                        {sectionName}
                                    </span>
                                    <span style={{
                                        color: 'var(--text-muted)',
                                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                        transition: 'transform 200ms ease',
                                    }}>
                                        <IconChevronDown />
                                    </span>
                                </button>

                                {/* Section Content */}
                                <div style={{
                                    overflow: 'hidden',
                                    maxHeight: isExpanded ? '1000px' : '0px',
                                    opacity: isExpanded ? 1 : 0,
                                    transition: 'all 200ms ease',
                                }}>
                                    {Object.entries(sectionData).map(([key, value]) => {
                                        if (!value || value === 'N/A') return null;
                                        const isPrompt = key.toLowerCase().includes('prompt');

                                        return (
                                            <div
                                                key={key}
                                                onClick={() => handleCopy(value, key)}
                                                style={{
                                                    padding: '8px 10px',
                                                    marginBottom: '4px',
                                                    background: 'var(--bg-tertiary)',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    transition: 'all 150ms ease',
                                                    border: copiedKey === key ? '1px solid var(--accent-success)' : '1px solid transparent',
                                                }}
                                            >
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    marginBottom: '2px',
                                                }}>
                                                    <span style={{
                                                        fontSize: '10px',
                                                        fontWeight: '600',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.3px',
                                                        color: 'var(--text-muted)',
                                                    }}>
                                                        {key}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px',
                                                        color: copiedKey === key ? 'var(--accent-success)' : 'var(--text-muted)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}>
                                                        {copiedKey === key ? <><IconCheck /> Copied!</> : <><IconCopy /> Click to copy</>}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    fontSize: isPrompt ? '11px' : '13px',
                                                    color: 'var(--text-primary)',
                                                    wordBreak: 'break-word',
                                                    lineHeight: '1.4',
                                                    fontFamily: isPrompt ? 'Monaco, Consolas, monospace' : 'inherit',
                                                    maxHeight: isPrompt ? '120px' : 'auto',
                                                    overflow: isPrompt ? 'auto' : 'visible',
                                                    whiteSpace: isPrompt ? 'pre-wrap' : 'normal',
                                                }}>
                                                    {value}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    {/* LoRAs Section - Special formatting */}
                    {lorasFormatted && lorasFormatted.length > 0 && (
                        <div style={{ marginBottom: '8px' }}>
                            <button
                                onClick={() => toggleSection('LoRAs')}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '8px 0',
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: '1px solid var(--border-subtle)',
                                    cursor: 'pointer',
                                    marginBottom: '6px',
                                }}
                            >
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: '700',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    color: 'var(--accent-primary)',
                                }}>
                                    LoRAs ({lorasFormatted.length})
                                </span>
                                <span style={{
                                    color: 'var(--text-muted)',
                                    transform: expandedSections['LoRAs'] !== false ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 200ms ease',
                                }}>
                                    <IconChevronDown />
                                </span>
                            </button>
                            <div style={{
                                overflow: 'hidden',
                                maxHeight: expandedSections['LoRAs'] !== false ? '500px' : '0px',
                                opacity: expandedSections['LoRAs'] !== false ? 1 : 0,
                                transition: 'all 200ms ease',
                            }}>
                                {lorasFormatted.map((lora, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => handleCopy(lora.name, `lora-${idx}`)}
                                        style={{
                                            padding: '8px 10px',
                                            marginBottom: '4px',
                                            background: 'var(--bg-tertiary)',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            transition: 'all 150ms ease',
                                            border: copiedKey === `lora-${idx}` ? '1px solid var(--accent-success)' : '1px solid transparent',
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            marginBottom: '4px',
                                        }}>
                                            <span style={{
                                                fontSize: '12px',
                                                fontWeight: '600',
                                                color: 'var(--text-primary)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                maxWidth: '70%',
                                            }}>
                                                {lora.name}
                                            </span>
                                            <span style={{
                                                fontSize: '9px',
                                                color: copiedKey === `lora-${idx}` ? 'var(--accent-success)' : 'var(--text-muted)',
                                            }}>
                                                {copiedKey === `lora-${idx}` ? 'Copied!' : 'Click to copy'}
                                            </span>
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            gap: '10px',
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                padding: '2px 8px',
                                                background: 'var(--bg-elevated)',
                                                borderRadius: '4px',
                                            }}>
                                                <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Model</span>
                                                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent-primary)' }}>{lora.modelStrength}</span>
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                padding: '2px 8px',
                                                background: 'var(--bg-elevated)',
                                                borderRadius: '4px',
                                            }}>
                                                <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Clip</span>
                                                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent-secondary)' }}>{lora.clipStrength}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Raw JSON Modal */}
            {showRawMetadata && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: BASE_Z_INDEX + 2,
                        background: 'rgba(0, 0, 0, 0.8)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '40px',
                    }}
                    onClick={() => setShowRawMetadata(false)}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        className="gallery-scrollbar"
                        style={{
                            width: '100%',
                            maxWidth: '900px',
                            maxHeight: '80vh',
                            background: 'var(--bg-secondary)',
                            borderRadius: '16px',
                            border: '1px solid var(--border-subtle)',
                            overflow: 'hidden',
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '16px 24px',
                            borderBottom: '1px solid var(--border-subtle)',
                        }}>
                            <h3 style={{
                                margin: 0,
                                fontSize: '16px',
                                fontWeight: '600',
                                color: 'var(--text-primary)',
                            }}>
                                Raw Metadata: {image.name}
                            </h3>
                            <button
                                onClick={() => setShowRawMetadata(false)}
                                style={{
                                    width: '32px',
                                    height: '32px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'var(--bg-tertiary)',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                }}
                            >
                                <IconX />
                            </button>
                        </div>
                        <div style={{ padding: '24px', overflow: 'auto', maxHeight: 'calc(80vh - 70px)' }}>
                            <ReactJsonView
                                theme="ocean"
                                src={image.metadata || {}}
                                name={false}
                                collapsed={2}
                                enableClipboard
                                displayDataTypes={false}
                                style={{
                                    background: 'transparent',
                                    fontSize: '13px',
                                }}
                            />
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
                        zIndex: BASE_Z_INDEX + 3,
                        background: 'rgba(0, 0, 0, 0.7)',
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
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '400px',
                            border: '1px solid var(--border-subtle)',
                        }}
                    >
                        <h3 style={{ margin: '0 0 12px', color: 'var(--accent-danger)', fontSize: '18px' }}>
                            Delete this image?
                        </h3>
                        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                            This action cannot be undone. "{image.name}" will be permanently deleted.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                style={{
                                    padding: '10px 20px',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: '10px',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                style={{
                                    padding: '10px 20px',
                                    background: 'var(--accent-danger)',
                                    border: 'none',
                                    borderRadius: '10px',
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

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
