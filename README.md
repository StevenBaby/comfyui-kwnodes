# comfyui-kwnodes

Custom nodes for ComfyUI.

- Global Fast Bypasser: A global toggle panel (web/global_fast_bypasser.js). No inputs/outputs.
  Type a node title or group title into the "add name" box; each name gets its own
  native toggle widget. Flipping a switch bypasses every node and group whose title
  matches that name across the current workflow (mode 4) or re-enables them (mode 0).
  Matches by user-defined title/nickname, case-insensitive substring. Remove a row via
  the right-click "Remove row" submenu.

## Global Fast Bypasser usage

1. Add "Global Fast Bypasser" from the `kwnodes` category.
2. In the "add name" box, type a node's title (e.g. "KSampler") or a group's title.
3. A toggle row appears. Flip it to bypass / re-enable all matching nodes and groups.
4. Right-click the node → "Remove row" → pick a name to delete that row.
5. Add more names for independent switches. Right-click for "Bypass all / Enable all".
