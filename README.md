# ComfyUI-Gallery (Performance Fork)

> **Finally, a gallery that doesn't murder your PC.**

A fork of [ComfyUI-Gallery](https://github.com/PanicTitan/ComfyUI-Gallery) that actually works with large image collections.

![ComfyUI Gallery](showcase.gif)

---

## The Problem

The original gallery has a fatal flaw: **every time you save an image, it rescans your ENTIRE output folder and re-extracts metadata from EVERY file.**

Got 500 images? That's 500 file reads. Got 5,000? Good luck.

Your GPU sits idle while ComfyUI chokes on disk I/O.

## The Solution

This fork fixes it. Properly.

| Before | After |
|--------|-------|
| Full rescan on every file change | Only processes the changed file |
| Extracts metadata from ALL files every time | SQLite cache—extracts once, reads forever |
| Sends entire folder over WebSocket | Sends only what changed |
| Loads all images at once | Virtualized grid with lazy loading |
| 0.5s debounce (useless) | Smart batching with proper debouncing |
| Broken prompt extraction | Full node graph tracing for complete prompts |

**Result:** Gallery stays snappy even with thousands of images.

---

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Mosh47/ComfyUI-Gallery.git
cd ComfyUI-Gallery
pip install -r requirements.txt
```

Restart ComfyUI. Done.

---

## Features

### 🔍 Smart Search
- **Prompt Search**: Search by positive prompt content with comma-separated terms (e.g., `cat, sunset, beach`)
- **Filename Search**: Traditional filename search
- **Toggle Switch**: Easily switch between search modes with a beautiful segmented control
- **Debounced Input**: 300ms debounce prevents UI lag while typing
- **Background Indexing**: Prompts are indexed in the background for instant search results

### 📁 Folder Management
- **Folder Tree**: Navigate your output folders with an expandable sidebar
- **Create Folders**: Right-click to create new folders
- **Delete Folders**: Remove folders with confirmation dialog
- **Drag & Drop**: Move images between folders by dragging onto the sidebar
- **Real-time Updates**: File changes detected instantly via filesystem monitoring

### ⭐ Favorites System
- **Star Images**: Click the star button on any image to favorite it
- **Favorites Folder**: All favorites are accessible in a dedicated virtual folder
- **Persistent**: Favorites survive restarts

### 🖼️ Image Preview
- **Full Preview**: Click any image for a large, centered preview
- **Keyboard Navigation**: Use arrow keys to navigate between images
- **Video Support**: Full playback controls for video files
- **Audio Support**: Play audio files directly in the gallery

### 📋 Metadata View
- **Full Prompt Extraction**: Traces the complete node graph to capture your full prompt
- **Supports Complex Workflows**: Works with KSampler, SamplerCustomAdvanced, CFGGuider, ConditioningConcat, ImpactWildcardProcessor, CR Text Concatenate, and more
- **Copy to Clipboard**: One-click copy for any metadata field
- **Raw JSON View**: Toggle to see the complete raw metadata

### ✅ Multi-Select & Batch Operations
- **Ctrl+Click**: Select/deselect individual images
- **Shift+Click**: Range selection for multiple images
- **Batch Download**: Download selected images as a ZIP file
- **Batch Delete**: Delete multiple images at once with confirmation

### 🎨 User Interface
- **Virtualized Grid**: Only renders visible images for buttery smooth scrolling
- **Date Dividers**: Images grouped by date (optional, can be toggled off)
- **Sort Options**: Sort by Newest, Oldest, Name ↑, or Name ↓
- **Dark Mode**: Beautiful dark theme by default
- **Responsive**: Adapts to window size automatically

### ⌨️ Keyboard Shortcuts
- **Ctrl+G**: Open/close the gallery
- **Escape**: Close preview or info panel
- **Arrow Keys**: Navigate between images in preview mode

### ⚙️ Settings
- **Relative Path**: Configure the root folder for the gallery
- **Auto-play Videos**: Toggle automatic video playback on hover
- **Date Dividers**: Show or hide date groupings
- **Floating Button**: Toggle the gallery open button
- **Scan Extensions**: Configure which file types to include

---

## Fixed: Prompt Extraction

The original only grabbed part of your prompt. If you use `ConditioningConcat`, wildcards, or `CFGGuider`—it missed half your text.

This fork traces the full node graph:

```
[Main Prompt] ──→ CLIPTextEncode ──┐
                                   ├──→ ConditioningConcat ──→ Sampler
[Quality Tags] ─→ CLIPTextEncode ──┘

Original: "a photo of a cat"
This fork: "a photo of a cat, masterpiece, best quality, 8k uhd"
```

---

## Performance Optimizations

This fork includes extensive performance work:

- **Virtualized Grid**: Using react-window for efficient rendering of large lists
- **Memoized Components**: React.memo with custom comparison functions
- **Debounced Search**: 300ms debounce on search input
- **Background Prompt Indexing**: Indexes prompts without blocking the UI
- **Stable References**: Prevents unnecessary re-renders with proper useMemo/useCallback usage
- **itemData Pattern**: Efficient data passing to virtualized cells
- **Grace Period for Deletions**: Prevents flickering when folders are deleted

---

## Credits

- Original: [PanicTitan](https://github.com/PanicTitan/ComfyUI-Gallery)
- This fork: [Mosh47](https://github.com/Mosh47/ComfyUI-Gallery)

MIT License
