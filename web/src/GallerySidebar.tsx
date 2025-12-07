import React, { useMemo, useCallback, memo, useRef, useState } from 'react';
import { useGalleryContext } from './GalleryContext';
import { useDrop } from 'ahooks';
import { ComfyAppApi } from './ComfyAppApi';

// Icons
const IconFolder = ({ open }: { open?: boolean }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={open ? 'var(--accent-primary)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {open ? (
            <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
        ) : (
            <>
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
            </>
        )}
    </svg>
);

const IconChevron = ({ expanded }: { expanded: boolean }) => (
    <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease',
        }}
    >
        <path d="m9 18 6-6-6-6"/>
    </svg>
);

const IconImage = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
    </svg>
);

interface TreeNode {
    key: string;
    title: string;
    children: TreeNode[];
    count: number;
    depth: number;
}

const normalizeFolderKey = (value: string) => (value ? value.replace(/\\/g, "/") : "");

// Build tree data structure from flat folder counts
const buildTreeData = (foldersInput: Record<string, number>): TreeNode[] => {
    const tree: TreeNode[] = [];
    const nodeMap = new Map<string, TreeNode>();
    const paths = Object.keys(foldersInput).sort();

    for (const fullPath of paths) {
        const segments = fullPath.split('/');
        let currentPath = "";

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            currentPath = i > 0 ? `${currentPath}/${segment}` : segment;

            if (!nodeMap.has(currentPath)) {
                const newNode: TreeNode = {
                    key: currentPath,
                    title: segment,
                    children: [],
                    count: foldersInput[currentPath] ?? 0,
                    depth: i,
                };
                nodeMap.set(currentPath, newNode);

                if (i === 0) {
                    tree.push(newNode);
                } else {
                    const parentPath = segments.slice(0, i).join('/');
                    const parentNode = nodeMap.get(parentPath);
                    if (parentNode) {
                        parentNode.children.push(newNode);
                    }
                }
            }
        }
    }

    return tree;
};

// Single folder item component
const FolderItem = memo(({
    node,
    currentFolder,
    expandedKeys,
    onToggle,
    onSelect,
}: {
    node: TreeNode;
    currentFolder: string;
    expandedKeys: Set<string>;
    onToggle: (key: string) => void;
    onSelect: (key: string) => void;
}) => {
    const folderRef = useRef<HTMLDivElement>(null);
    const { getLoadedItems, selectedImages, setSelectedImages, folderCounts } = useGalleryContext();
    const [isHovered, setIsHovered] = useState(false);
    const [isDragOver, setDragOver] = useState(false);

    const isActive = currentFolder === node.key;
    const isExpanded = expandedKeys.has(node.key);
    const hasChildren = node.children.length > 0;
    const count = folderCounts[node.key] ?? 0;

    // Get all image URLs in this folder for selection
    const folderImages = useMemo(() => {
        const items = getLoadedItems(node.key);
        return items.filter((img: any) => img?.url).map((img: any) => img.url);
    }, [getLoadedItems, node.key]);

    const allSelected = folderImages.length > 0 && folderImages.every(url => selectedImages.includes(url));

    // Handle folder click with ctrl for selection
    const handleClick = (e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            e.preventDefault();
            setSelectedImages(prev => {
                if (allSelected) {
                    return prev.filter(url => !folderImages.includes(url));
                } else {
                    return Array.from(new Set([...prev, ...folderImages]));
                }
            });
        } else {
            onSelect(node.key);
        }
    };

    // Handle drop for moving images
    useDrop(folderRef, {
        onDom: (content: any) => {
            try {
                const dragData = typeof content === 'string' ? JSON.parse(content) : content;
                if (dragData?.name && dragData?.folder && dragData.folder !== node.key) {
                    const sourcePath = `${dragData.folder}/${dragData.name}`;
                    const targetPath = `${node.key}/${dragData.name}`;
                    ComfyAppApi.moveImage(sourcePath, targetPath);
                }
            } catch (err) {
                console.error('Error parsing drag data:', err);
            }
            setDragOver(false);
        },
        onDragEnter: () => setDragOver(true),
        onDragLeave: () => setDragOver(false),
    });

    return (
        <div style={{ userSelect: 'none' }}>
            <div
                ref={folderRef}
                className="folder"
                onClick={handleClick}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    paddingLeft: `${12 + node.depth * 16}px`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    marginBottom: '2px',
                    transition: 'all 150ms ease',
                    background: isDragOver
                        ? 'rgba(0, 212, 255, 0.2)'
                        : isActive
                            ? 'rgba(0, 212, 255, 0.15)'
                            : isHovered
                                ? 'rgba(255, 255, 255, 0.05)'
                                : 'transparent',
                    borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    boxShadow: allSelected ? '0 0 0 2px var(--accent-primary)' : 'none',
                }}
            >
                {/* Expand/Collapse Toggle */}
                {hasChildren ? (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggle(node.key);
                        }}
                        style={{
                            width: '20px',
                            height: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 0,
                            borderRadius: '4px',
                        }}
                    >
                        <IconChevron expanded={isExpanded} />
                    </button>
                ) : (
                    <span style={{ width: '20px' }} />
                )}

                {/* Folder Icon */}
                <span style={{
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'color 150ms ease',
                }}>
                    <IconFolder open={isActive} />
                </span>

                {/* Folder Name */}
                <span style={{
                    flex: 1,
                    fontSize: '13px',
                    fontWeight: isActive ? '600' : '500',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    transition: 'color 150ms ease',
                }}>
                    {node.title}
                </span>

                {/* Image Count Badge */}
                {count > 0 && (
                    <span style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        background: isActive ? 'rgba(0, 212, 255, 0.2)' : 'var(--bg-elevated)',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: '600',
                        color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                        transition: 'all 150ms ease',
                    }}>
                        <IconImage />
                        {count}
                    </span>
                )}
            </div>

            {/* Children (animated) */}
            {hasChildren && (
                <div style={{
                    overflow: 'hidden',
                    maxHeight: isExpanded ? `${node.children.length * 50}px` : '0px',
                    opacity: isExpanded ? 1 : 0,
                    transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}>
                    {node.children.map(child => (
                        <FolderItem
                            key={child.key}
                            node={child}
                            currentFolder={currentFolder}
                            expandedKeys={expandedKeys}
                            onToggle={onToggle}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});

FolderItem.displayName = 'FolderItem';

const GallerySidebar = () => {
    const { folderCounts, rootFolder, loading, currentFolder, setCurrentFolder, siderCollapsed, settings } = useGalleryContext();

    // Normalize folder counts
    const normalizedCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        Object.entries(folderCounts).forEach(([key, count]) => {
            counts[normalizeFolderKey(key)] = count;
        });
        if (rootFolder) {
            const normalizedRoot = normalizeFolderKey(rootFolder);
            if (!(normalizedRoot in counts)) {
                counts[normalizedRoot] = 0;
            }
        }
        return counts;
    }, [folderCounts, rootFolder]);

    // Build tree structure
    const treeData = useMemo(() => {
        if (!Object.keys(normalizedCounts).length) return [];
        return buildTreeData(normalizedCounts);
    }, [normalizedCounts]);

    // Track expanded folders
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
        if (settings.expandAllFolders) {
            return new Set(Object.keys(normalizedCounts));
        }
        return new Set([rootFolder].filter(Boolean));
    });

    const handleToggle = useCallback((key: string) => {
        setExpandedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const handleSelect = useCallback((key: string) => {
        setCurrentFolder(normalizeFolderKey(key));
    }, [setCurrentFolder]);

    if (siderCollapsed) return null;

    return (
        <div
            className="gallery-scrollbar"
            style={{
                height: '100%',
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '12px 8px',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '8px 12px 16px',
                borderBottom: '1px solid var(--border-subtle)',
                marginBottom: '12px',
            }}>
                <h3 style={{
                    margin: 0,
                    fontSize: '11px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--text-muted)',
                }}>
                    Folders
                </h3>
            </div>

            {/* Loading State */}
            {loading && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '32px',
                }}>
                    <div style={{
                        width: '24px',
                        height: '24px',
                        border: '2px solid var(--border-subtle)',
                        borderTopColor: 'var(--accent-primary)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                </div>
            )}

            {/* Empty State */}
            {!loading && treeData.length === 0 && (
                <div style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                }}>
                    No folders found
                </div>
            )}

            {/* Folder Tree */}
            {!loading && treeData.map(node => (
                <FolderItem
                    key={node.key}
                    node={node}
                    currentFolder={currentFolder}
                    expandedKeys={expandedKeys}
                    onToggle={handleToggle}
                    onSelect={handleSelect}
                />
            ))}

            {/* Keyboard hint */}
            <div style={{
                marginTop: '24px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '11px',
                color: 'var(--text-muted)',
            }}>
                <div style={{ marginBottom: '4px' }}>
                    <kbd style={{
                        display: 'inline-flex',
                        padding: '2px 5px',
                        background: 'var(--bg-elevated)',
                        borderRadius: '4px',
                        fontSize: '10px',
                        marginRight: '4px',
                    }}>Ctrl</kbd>
                    + Click folder to select all
                </div>
                <div>
                    Drag images to folders to move
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default GallerySidebar;
