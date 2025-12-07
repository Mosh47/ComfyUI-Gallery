export interface FileInfo {
    filename: string;
    resolution: string;
    date: string;
    size: string;
}

export interface Metadata {
    fileinfo: FileInfo;
    prompt?: any;
    workflow?: any;
}

export interface FileDetails {
    name: string;
    url: string;
    timestamp: number;
    date: string;
    metadata?: Metadata | null;
    type: "image" | "media" | "audio" | "divider" | "empty-space";
    metadata_pending?: boolean;
    folder: string;
}

export interface PaginatedImagesResponse {
    folder: string;
    items: FileDetails[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

export interface FolderListResponse {
    root: string;
    folders: Record<string, { count: number }>;
}
