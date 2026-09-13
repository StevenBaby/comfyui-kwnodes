import { app } from "../../../scripts/app.js";

// Global Fast Bypasser — a global toggle panel. No inputs, no outputs.
//
// Type a node title or group title into the "add name" box; each name gets its own
// toggle row (a native ComfyUI toggle widget). Flipping a switch bypasses every
// node / group whose title matches that name across the current workflow. Remove a
// row via the right-click "Remove row" submenu.
//
// Matches by user-defined title/nickname, case-insensitive substring.

const NODE_TYPE = "Global Fast Bypasser";
const MODE_ALWAYS = 0; // LiteGraph.ALWAYS
const MODE_BYPASS = 4; // LiteGraph.BYPASS

function currentGraph() {
  return app?.canvas?.getCurrentGraph?.() || app?.graph;
}

function nodeTitle(node) {
  return (
    node?.properties?.nickname ||
    node?.title ||
    node?.type ||
    node?.constructor?.type ||
    ""
  ).trim();
}

function groupTitle(group) {
  return (group?.title || group?.name || "").trim();
}

function matchByName(name, graph, includeSubgraphs = false) {
  const q = String(name || "").trim();
  if (!q) return { nodes: [], groups: [] };
  const nodes = [];
  const groups = [];
  const seen = new Set();

  // Walk a node list, matching titles and (optionally) descending into subgraphs.
  const walk = (list, descend) => {
    if (!list) return;
    for (const n of list) {
      if (!n) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      if (nodeTitle(n) === q) nodes.push(n);
      if (
        descend &&
        typeof n.isSubgraphNode === "function" &&
        n.isSubgraphNode() &&
        n.subgraph?.nodes
      ) {
        walk(n.subgraph.nodes, true);
      }
    }
  };
  walk(graph?._nodes, includeSubgraphs);

  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const g of arr) {
      if (g && groupTitle(g) === q) groups.push(g);
    }
  };
  collect(graph?._groups);
  collect(graph?.groups);
  const subgraphs = graph?.subgraphs;
  if (subgraphs && typeof subgraphs.values === "function") {
    for (const sg of subgraphs.values()) {
      collect(sg._groups);
      collect(sg.groups);
      if (includeSubgraphs) walk(sg._nodes, true);
    }
  }
  return { nodes, groups };
}

function groupNodes(group, graph) {
  if (group && typeof group.recomputeInsideNodes === "function") {
    try {
      group.recomputeInsideNodes();
    } catch (_) {
      /* ignore */
    }
  }
  const children = Array.from(group?._children || []).filter(
    (n) => n && typeof n === "object" && typeof n.mode === "number",
  );
  if (children.length) return children;
  const bounds = group?._bounding || group?.bounding;
  if (!Array.isArray(bounds) || bounds.length < 4 || !graph?._nodes) return [];
  const [gx, gy, gw, gh] = bounds;
  return (graph._nodes || []).filter((n) => {
    if (!n || typeof n.mode !== "number") return false;
    const pos = n.pos || [0, 0];
    const size = Array.isArray(n.size) ? n.size : [140, 80];
    const cx = Number(pos[0]) + Number(size[0]) * 0.5;
    const cy = Number(pos[1]) + Number(size[1]) * 0.5;
    return cx >= gx && cx < gx + gw && cy >= gy && cy < gy + gh;
  });
}

function setModeDeep(nodes, mode) {
  const stack = [...nodes];
  const touched = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || touched.has(n)) continue;
    touched.add(n);
    n.mode = mode;
    if (
      typeof n.isSubgraphNode === "function" &&
      n.isSubgraphNode() &&
      n.subgraph?.nodes
    ) {
      stack.push(...n.subgraph.nodes);
    }
  }
}

app.registerExtension({
  name: "kwnodes.GlobalFastBypasser",

  registerCustomNodes() {
    class FastBypasser extends LGraphNode {
      static title = NODE_TYPE;
      static category = "kwnodes";
      static _category = "kwnodes";
      static comfyClass = "kwnodes";
      isVirtualNode = true;
      serialize_widgets = true;

      constructor() {
        super(NODE_TYPE);
        this._rows = []; // [{ name, widget }]
        this._nameWidget = this.addWidget("text", "add name", "", (value) =>
          this._addName(value),
        );
        this._subgraphWidget = this.addWidget(
          "toggle",
          "include subgraphs",
          true,
          () => this.setDirtyCanvas(true, true),
          { on: "on", off: "off" },
        );
      }

      onConfigure() {
        this._restoreRows();
      }

      onAdded() {
        this._restoreRows();
      }

      _restoreRows() {
        for (const w of this.widgets || []) {
          if (
            w.type === "toggle" &&
            w !== this._nameWidget &&
            w !== this._subgraphWidget
          ) {
            if (!this._rows.some((r) => r.name === w.name)) {
              this._rows.push({ name: w.name, widget: w });
            }
          }
        }
      }

      _addName(rawValue) {
        const name = String(rawValue || "").trim();
        if (!name) return;
        if (this._rows.some((r) => r.name === name)) {
          this._nameWidget.value = "";
          return;
        }
        const widget = this.addWidget(
          "toggle",
          name,
          false,
          (value) => this._apply(name, value),
          { on: "bypass", off: "active" },
        );
        this._rows.push({ name, widget });
        this._nameWidget.value = "";
        this.setDirtyCanvas(true, true);
      }

      _removeRow(name) {
        const idx = this._rows.findIndex((r) => r.name === name);
        if (idx < 0) return;
        const widget = this._rows[idx].widget;
        const wi = this.widgets.indexOf(widget);
        if (wi > -1) this.widgets.splice(wi, 1);
        this._rows.splice(idx, 1);
        this.setDirtyCanvas(true, true);
      }

      _apply(name, bypass) {
        const graph = currentGraph();
        if (!graph) return;
        const includeSubgraphs = !!this._subgraphWidget?.value;
        const { nodes, groups } = matchByName(name, graph, includeSubgraphs);
        const allNodes = [...nodes];
        for (const g of groups) allNodes.push(...groupNodes(g, graph));
        setModeDeep(allNodes, bypass ? MODE_BYPASS : MODE_ALWAYS);
        graph.setDirtyCanvas?.(true, false);
      }

      _all(bypass) {
        const graph = currentGraph();
        if (!graph) return;
        const includeSubgraphs = !!this._subgraphWidget?.value;
        const allNodes = [];
        for (const row of this._rows) {
          const { nodes, groups } = matchByName(
            row.name,
            graph,
            includeSubgraphs,
          );
          allNodes.push(...nodes);
          for (const g of groups) allNodes.push(...groupNodes(g, graph));
          row.widget.value = bypass;
        }
        setModeDeep(allNodes, bypass ? MODE_BYPASS : MODE_ALWAYS);
        graph.setDirtyCanvas?.(true, false);
      }

      getExtraMenuOptions(_, options) {
        const removeSubmenu = this._rows.map((row) => ({
          content: row.name,
          callback: () => this._removeRow(row.name),
        }));
        options.unshift(
          {
            content: "Remove row",
            has_submenu: true,
            submenu: { title: "Remove row", options: removeSubmenu },
            disabled: this._rows.length === 0,
          },
          { content: "Bypass all rows", callback: () => this._all(true) },
          { content: "Enable all rows", callback: () => this._all(false) },
          null,
        );
      }
    }

    LiteGraph.registerNodeType(NODE_TYPE, FastBypasser);
    // The new frontend clears `category` during registerNodeType; restore it so the
    // node shows under the "kwnodes" group in the menu (mirrors rgthree's setUp).
    if (FastBypasser._category) {
      FastBypasser.category = FastBypasser._category;
    }
  },
});
