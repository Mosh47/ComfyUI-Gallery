import { useEffect, useState } from 'react';
import { useGalleryContext, type SettingsState } from './GalleryContext';
import { useSetState } from 'ahooks';
import { BASE_Z_INDEX } from './ComfyAppApi';

// Icons
const IconX = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
);

const IconFolder = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
    </svg>
);

const IconDisplay = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>
    </svg>
);

const IconKeyboard = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="20" height="16" x="2" y="4" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><line x1="6" x2="18" y1="16" y2="16"/>
    </svg>
);

const IconServer = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>
    </svg>
);

// Toggle Switch Component
const Toggle = ({
    checked,
    onChange,
    disabled
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}) => (
    <button
        onClick={() => !disabled && onChange(!checked)}
        style={{
            width: '48px',
            height: '26px',
            borderRadius: '999px',
            border: 'none',
            padding: '3px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: checked ? 'var(--accent-primary)' : 'var(--bg-elevated)',
            transition: 'all 200ms ease',
            opacity: disabled ? 0.5 : 1,
        }}
    >
        <div style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: 'white',
            transform: checked ? 'translateX(22px)' : 'translateX(0)',
            transition: 'transform 200ms ease',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }} />
    </button>
);

const GallerySettingsModal = () => {
    const { showSettings, setShowSettings, settings, setSettings } = useGalleryContext();
    const [staged, setStaged] = useSetState<SettingsState>(settings);
    const [extInput, setExtInput] = useState("");

    // Reset staged settings when modal opens
    useEffect(() => {
        if (showSettings) {
            setStaged(settings);
            setExtInput(settings?.scanExtensions?.join(', ') || '');
        }
    }, [showSettings, settings, setStaged]);

    const handleSave = () => {
        const exts = extInput.split(',').map(s => s.trim().replace(/^\./, '')).filter(s => s);
        const newSettings = { ...staged, scanExtensions: exts } as SettingsState;
        setSettings(newSettings);
        setShowSettings(false);
    };

    const handleCancel = () => {
        setShowSettings(false);
    };

    if (!showSettings) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: BASE_Z_INDEX + 1,
                background: 'rgba(0, 0, 0, 0.8)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                animation: 'fadeIn 200ms ease-out',
            }}
            onClick={handleCancel}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="gallery-scrollbar"
                style={{
                    width: '100%',
                    maxWidth: '600px',
                    maxHeight: '85vh',
                    background: 'var(--bg-secondary)',
                    borderRadius: '20px',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-lg)',
                    overflow: 'hidden',
                    animation: 'scaleIn 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(20px)',
                }}>
                    <h2 style={{
                        margin: 0,
                        fontSize: '18px',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                    }}>
                        Gallery Settings
                    </h2>
                    <button
                        onClick={handleCancel}
                        style={{
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--bg-tertiary)',
                            border: 'none',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        <IconX />
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    padding: '24px',
                    overflow: 'auto',
                    maxHeight: 'calc(85vh - 140px)',
                }}>
                    {/* Path Settings */}
                    <SettingsSection icon={<IconFolder />} title="Path Configuration">
                        <SettingsInput
                            label="Gallery Path"
                            description="Relative path to your output folder"
                            value={staged.relativePath}
                            onChange={value => setStaged({ relativePath: value })}
                            placeholder="./"
                        />
                        <SettingsInput
                            label="File Extensions"
                            description="Comma-separated list of extensions to scan"
                            value={extInput}
                            onChange={setExtInput}
                            placeholder="png, jpg, mp4, wav"
                        />
                    </SettingsSection>

                    {/* Display Settings */}
                    <SettingsSection icon={<IconDisplay />} title="Display">
                        <SettingsToggle
                            label="Show Date Dividers"
                            description="Group images by creation date"
                            checked={staged.showDateDivider}
                            onChange={checked => setStaged({ showDateDivider: checked })}
                        />
                        <SettingsToggle
                            label="Expand All Folders"
                            description="Auto-expand folder tree on load"
                            checked={staged.expandAllFolders}
                            onChange={checked => setStaged({ expandAllFolders: checked })}
                        />
                        <SettingsToggle
                            label="Auto-Play Videos"
                            description="Automatically play video thumbnails on hover"
                            checked={staged.autoPlayVideos}
                            onChange={checked => setStaged({ autoPlayVideos: checked })}
                        />
                    </SettingsSection>

                    {/* Button Settings */}
                    <SettingsSection icon={<IconKeyboard />} title="Open Button">
                        <SettingsToggle
                            label="Floating Button"
                            description="Display a draggable floating button"
                            checked={staged.floatingButton}
                            onChange={checked => setStaged({ floatingButton: checked })}
                        />
                        <SettingsToggle
                            label="Hide Button"
                            description="Hide the open button entirely (use Ctrl+G)"
                            checked={staged.hideOpenButton}
                            onChange={checked => setStaged({ hideOpenButton: checked })}
                        />
                        <SettingsInput
                            label="Button Label"
                            description="Text shown on the open button"
                            value={staged.buttonLabel}
                            onChange={value => setStaged({ buttonLabel: value })}
                            placeholder="Open Gallery"
                        />
                        <SettingsToggle
                            label="Enable Ctrl+G Shortcut"
                            description="Open gallery with keyboard shortcut"
                            checked={staged.galleryShortcut}
                            onChange={checked => setStaged({ galleryShortcut: checked })}
                        />
                    </SettingsSection>

                    {/* Advanced Settings */}
                    <SettingsSection icon={<IconServer />} title="Advanced">
                        <SettingsToggle
                            label="Use Polling Observer"
                            description="Use polling instead of native file watching (slower but more compatible)"
                            checked={staged.usePollingObserver}
                            onChange={checked => setStaged({ usePollingObserver: checked })}
                        />
                        <SettingsToggle
                            label="Disable Console Logs"
                            description="Suppress gallery debug messages"
                            checked={staged.disableLogs}
                            onChange={checked => setStaged({ disableLogs: checked })}
                        />
                        <SettingsInput
                            label="Button Container Query"
                            description="CSS selector for button placement (advanced)"
                            value={staged.buttonBoxQuery}
                            onChange={value => setStaged({ buttonBoxQuery: value })}
                            placeholder="div.flex.gap-2.mx-2"
                        />
                    </SettingsSection>
                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px',
                    padding: '16px 24px',
                    borderTop: '1px solid var(--border-subtle)',
                    background: 'var(--bg-tertiary)',
                }}>
                    <button
                        onClick={handleCancel}
                        style={{
                            padding: '10px 20px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)',
                            fontSize: '14px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        style={{
                            padding: '10px 24px',
                            background: 'var(--accent-primary)',
                            border: 'none',
                            borderRadius: '10px',
                            color: 'var(--bg-primary)',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                        }}
                    >
                        Save Changes
                    </button>
                </div>
            </div>

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
            `}</style>
        </div>
    );
};

// Settings Section Component
const SettingsSection = ({
    icon,
    title,
    children
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}) => (
    <div style={{ marginBottom: '28px' }}>
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
            paddingBottom: '10px',
            borderBottom: '1px solid var(--border-subtle)',
        }}>
            <span style={{ color: 'var(--accent-primary)' }}>{icon}</span>
            <span style={{
                fontSize: '13px',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--accent-primary)',
            }}>
                {title}
            </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {children}
        </div>
    </div>
);

// Settings Toggle Component
const SettingsToggle = ({
    label,
    description,
    checked,
    onChange
}: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'var(--bg-tertiary)',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
    }}>
        <div>
            <div style={{
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '2px',
            }}>
                {label}
            </div>
            <div style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
            }}>
                {description}
            </div>
        </div>
        <Toggle checked={checked} onChange={onChange} />
    </div>
);

// Settings Input Component
const SettingsInput = ({
    label,
    description,
    value,
    onChange,
    placeholder
}: {
    label: string;
    description: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) => (
    <div style={{
        padding: '12px 16px',
        background: 'var(--bg-tertiary)',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
    }}>
        <div style={{
            fontSize: '14px',
            fontWeight: '500',
            color: 'var(--text-primary)',
            marginBottom: '2px',
        }}>
            {label}
        </div>
        <div style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginBottom: '10px',
        }}>
            {description}
        </div>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
                width: '100%',
                padding: '10px 14px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
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
    </div>
);

export default GallerySettingsModal;
