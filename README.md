# comfyui-kwnodes

Custom nodes for ComfyUI.

- Global Fast Bypasser: A global toggle panel (web/global_fast_bypasser.js). No inputs/outputs.
  Type a node title or group title into the "add name" box; each name gets its own
  native toggle widget. Flipping a switch bypasses every node and group whose title
  matches that name across the current workflow (mode 4) or re-enables them (mode 0).
  Matches by user-defined title/nickname, case-sensitive exact match. An "include
  subgraphs" toggle (default on) controls whether subgraph-internal nodes are matched.
  Remove a row via the right-click "Remove row" submenu.
- Global Set/Get: a frontend control node (web/global_setget.js) with an "enable
  global lookup" toggle (default on). When on, it monkey-patches KJNodes' GetNode so a
  Get looks up its SetNode across the ENTIRE workflow (root + all nested subgraphs),
  instead of the default ancestor-chain scope; duplicate SetNode names anywhere are
  reported as an error. Turn the toggle off to restore KJNodes' default behavior.

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
