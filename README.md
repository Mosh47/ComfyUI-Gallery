# ComfyUI-Gallery (Performance Fork)

> **Doesn't make your PC want to die.**

This is a performance-optimized fork of [PanicTitan/ComfyUI-Gallery](https://github.com/PanicTitan/ComfyUI-Gallery) that fixes critical issues causing ComfyUI to slow to a crawl, especially with large image collections.

![ComfyUI Gallery Node in Action](showcase.gif)

## 🚨 Why This Fork Exists

The original ComfyUI-Gallery had **catastrophic performance issues**:
- Full directory rescans on EVERY file change
- Metadata extraction for EVERY file on EVERY scan
- Broken prompt extraction that only grabbed partial prompts
- No support for complex workflows with ConditioningConcat, CFGGuider, etc.

**If you have hundreds or thousands of images, the original would bring ComfyUI to its knees.**

---

## ✨ What's Fixed in This Fork

### 🔧 **Complete Metadata Parser Rewrite**

The prompt extraction was fundamentally broken. It only grabbed ONE text from the prompt chain, missing:
- Text from `ConditioningConcat` nodes (quality tags, style prompts)
- Resolved wildcards from `ImpactWildcardProcessor`
- Multiple text sources combined via `CR Text Concatenate`
- Prompts from workflows using `SamplerCustomAdvanced` + `CFGGuider`

**Now it properly extracts the FULL prompt by:**

1. **Dynamic Graph Traversal** - Follows the actual node connections, not hardcoded IDs
2. **ConditioningConcat Support** - Traces BOTH `conditioning_to` AND `conditioning_from` branches
3. **ImpactWildcardProcessor Support** - Uses `populated_text` (the resolved wildcard result)
4. **CR Text Concatenate Support** - Properly joins `text1` + `separator` + `text2`
5. **CFGGuider Support** - Handles `SamplerCustomAdvanced` workflows that use guiders
6. **Extensible Design** - Easy to add new node types without rewriting logic

### 📋 Supported Node Types

**Samplers:**
- KSampler, KSamplerAdvanced, SamplerCustom, SamplerCustomAdvanced
- FaceDetailerPipe, DetailerForEach, UltimateSDUpscale
- Tiled KSampler variants

**Text/Prompt Nodes:**
- CLIPTextEncode, CR Text, CR Prompt Text
- ImpactWildcardProcessor (uses `populated_text`!)
- CR Text Concatenate, Text Concatenate, StringConcat
- ShowText|pysssss, and more

**Conditioning Nodes:**
- ConditioningConcat, ConditioningCombine
- CFGGuider, BasicGuider, DualCFGGuider

### 🔄 How It Works

```
Your Workflow:
[Main Prompt] → CLIPTextEncode ─────────────────────┐
                                                    ├→ ConditioningConcat → CFGGuider → Sampler
[Quality Tags] → CLIPTextEncode ────────────────────┘

Old Parser: Only grabbed [Main Prompt] ❌
New Parser: Grabs [Main Prompt] + [Quality Tags] ✅
```

The parser dynamically traces the graph from the sampler backwards, following ALL branches through concat nodes to collect every piece of text that contributes to your final image.

---

## 🛠️ Performance Improvements (Roadmap)

These optimizations are planned/in-progress:

| Issue | Status | Impact |
|-------|--------|--------|
| Full rescan on every file change | 🔄 Planned | Critical |
| Metadata extraction on every scan | 🔄 Planned | Critical |
| SQLite metadata cache | 🔄 Planned | High |
| Incremental file updates | 🔄 Planned | High |
| Increased debounce (0.5s → 3s) | 🔄 Planned | Medium |
| Lazy metadata extraction | 🔄 Planned | Medium |
| API pagination | 🔄 Planned | Medium |

---

## 📦 Installation

### Via Git (Recommended for this fork)

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Mosh47/ComfyUI-Gallery.git
```

Restart ComfyUI.

### Dependencies

```bash
cd ComfyUI/custom_nodes/ComfyUI-Gallery
pip install -r requirements.txt
```

---

## 🎮 Usage

1. **Open Gallery:** Click "Open Gallery" button in ComfyUI
2. **Browse:** Navigate folders, search, sort by date/name
3. **View Metadata:** Click "Info" on any image to see full extracted metadata
4. **Batch Operations:** Ctrl+Click to select multiple images for download/delete

---

## ⚙️ Adding Support for Custom Nodes

If you use custom nodes that aren't recognized, you can add them to the arrays in `web/src/metadata-parser/promptMetadataParser.ts`:

```typescript
// Add new sampler types
const SAMPLER_NODE_TYPES = [
    'KSampler', 'YourCustomSampler', ...
];

// Add new text concatenation nodes
const TEXT_CONCAT_TYPES = [
    'CR Text Concatenate', 'YourCustomConcat', ...
];

// Add new text source nodes
const TEXT_NODE_TYPES = [
    'CLIPTextEncode', 'YourCustomTextNode', ...
];
```

Then rebuild:
```bash
cd web && npm run build
```

---

## 📝 Original Features (Inherited)

- Real-time gallery updates via Watchdog
- Video, GIF, and Audio support
- Image metadata inspection with JSON viewer
- Search and sort functionality
- Drag-and-drop file moving
- Batch download as ZIP
- Dark/Light mode
- Configurable file extensions
- Ctrl+G keyboard shortcut

See the [original repo](https://github.com/PanicTitan/ComfyUI-Gallery) for full feature documentation.

---

## 🙏 Credits

- **Original Author:** [PanicTitan](https://github.com/PanicTitan/ComfyUI-Gallery)
- **Performance Fork:** [Mosh47](https://github.com/Mosh47/ComfyUI-Gallery)
- **ComfyUI:** [comfyanonymous](https://github.com/comfyanonymous/ComfyUI)

---

## 📄 License

MIT License - See [LICENSE](LICENSE)

---

**If the original gallery was making your ComfyUI unusable, give this fork a try!**
