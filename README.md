# comfyui-kwnodes

Custom nodes for ComfyUI.

- **Global Fast Bypasser**: A global toggle panel (web/global_fast_bypasser.js). No
  inputs/outputs. Type a node title or group title into the "add name" box; each
  name gets its own native toggle widget. Flipping a switch bypasses every node and
  group whose title matches that name across the current workflow (mode 4) or
  re-enables them (mode 0). Matches by user-defined title/nickname, case-sensitive
  exact match. An "include subgraphs" toggle (default on) controls whether
  subgraph-internal nodes are matched. Remove a row via the right-click "Remove row"
  submenu.
- **Global Set/Get**: a frontend control node (web/global_setget.js) with an "enable
  global lookup" toggle (default on). When on, it monkey-patches KJNodes' GetNode so a
  Get looks up its SetNode across the ENTIRE workflow (root + all nested subgraphs),
  instead of the default ancestor-chain scope; duplicate SetNode names anywhere are
  reported as an error. Turn the toggle off to restore KJNodes' default behavior.
- **Prompt File Picker**: scan a directory for `.md`/`.txt` prompt files and output the
  selected file's text as a STRING. The directory field has a VHS-style path
  autocomplete dialog (confined to the project root); the file list refreshes on
  change. Includes an editable textarea (view/edit the selected file), a 💾 Save button
  (write back to the file), and a ↻ Refresh button (re-scan the directory).
- **Load Image (Path)**: load an image from a directory inside the project root and
  output it as IMAGE + MASK. The directory field has VHS-style path autocomplete
  (ROOT-relative, no escaping upward). An "include sub directory" toggle (default on)
  lists images in subdirectories recursively, named relative to the directory. Newest
  files first; a live thumbnail preview shows the selected image (hidden when the file
  doesn't exist). The ↻ Refresh button re-scans and auto-selects the newest image.
- **Load Audio (Path)**: load an audio file from a directory inside the project root
  and output it as AUDIO (`{"waveform", "sample_rate"}`). Same VHS-style path
  autocomplete and "include sub directory" recursion as Load Image (Path). A native
  `<audio controls>` player below the node previews the selected file. Decodes via
  `av`, so it also extracts the audio track from video files (`.mp4`, `.webm`, etc.).

## Global Fast Bypasser usage

1. Add "Global Fast Bypasser" from the `kwnodes` category.
2. In the "add name" box, type a node's title (e.g. "KSampler") or a group's title.
3. A toggle row appears. Flip it to bypass / re-enable all matching nodes and groups.
4. Right-click the node → "Remove row" → pick a name to delete that row.
5. Add more names for independent switches. Right-click for "Bypass all / Enable all".

## Global Set/Get usage

1. Add "Global Set/Get" from the `kwnodes` category (it has an "enable global lookup"
   toggle, default on).
2. Use KJNodes' normal "Set" and "Get" nodes as usual.
3. While the toggle is on, a GetNode finds its SetNode anywhere in the workflow,
   including inside other subgraphs (previously only its own graph and ancestors).
4. If two SetNodes share a name anywhere, the Get reports a duplicate-name error —
   rename one to resolve.
5. Turn the toggle off to restore KJNodes' default (ancestor-scoped) lookup.

## Prompt File Picker usage

1. Add "Prompt File Picker" from the `kwnodes` category.
2. Click the `directory` field to open a path dialog and pick a directory (VHS-style
   autocomplete, one level at a time, confined to the project root).
3. Pick a `.md`/`.txt` file from the `file` dropdown; its content loads into the
   textarea below (mode `raw` = whole file, `fenced` = only the ```-fenced prompt body).
4. Edit the textarea and click 💾 Save to write back, or leave it and the workflow
   auto-writes on save/queue. The output STRING feeds downstream nodes.
5. Click ↻ Refresh to re-scan the directory (picks up files added since the node loaded).

## Load Image (Path) usage

1. Add "Load Image (Path)" from the `kwnodes` category.
2. Click the `directory` field to pick a directory (ROOT-relative path autocomplete,
   confined to the project root; no escaping upward).
3. Toggle "include sub directory" (default on) to also list images in subdirectories,
   named relative to the directory. The dropdown lists newest files first.
4. Pick an image; its thumbnail shows below the node (hidden when the file is missing).
5. The output IMAGE + MASK feeds downstream nodes (e.g. H3 reference images). Click
   ↻ Refresh to re-scan and auto-select the newest image.

## Load Audio (Path) usage

1. Add "Load Audio (Path)" from the `kwnodes` category.
2. Click the `directory` field to pick a directory (default `input/audio`; ROOT-relative
   path autocomplete, confined to the project root).
3. Toggle "include sub directory" (default on) to also list audio in subdirectories.
4. Pick an audio file; the `<audio controls>` player below previews it. The output AUDIO
   feeds downstream audio nodes (e.g. VAE Encode Audio, or an H3 reference audio).
5. Audio is decoded with `av`, so video files (`.mp4`, `.webm`, `.mkv`) also work —
   their first audio track is extracted.

## Notes

- These nodes are self-contained: the path autocomplete and file listing are
  implemented inside this pack (no VideoHelperSuite or other node dependency). Only
  ComfyUI core + standard Python libs (`PIL`, `aiohttp`, `av`) are used.
