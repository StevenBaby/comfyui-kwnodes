import { app } from "../../../scripts/app.js";

// Global Set/Get — a node with an on/off switch that patches KJNodes' GetNode to
// look up its SetNode across the ENTIRE workflow (root + all nested subgraphs),
// instead of the default ancestor-chain scope. Duplicate names anywhere in the
// workflow are reported as an error (forced uniqueness).
//
// The node is a pure frontend control: a toggle "enable global lookup" (default on).
// ON  → apply the global patch to KJNodes GetNode.
// OFF → restore KJNodes' original ancestor-chain behavior.
//
// This monkey-patches GetNode.prototype (findSetter / resolveVirtualOutput) from
// outside KJNodes, so the third-party source stays untouched.

const NODE_TYPE = "Global Set/Get";
const GLOBAL_KEY = "__kwnodes_global_setget__";

const SET_TYPE = "SetNode";
const GET_TYPE = "GetNode";

// ---- global lookup helpers (self-contained, no KJNodes internals) ----

function findRootGraph(graph) {
  if (!graph) return null;
  return graph.rootGraph || graph;
}

function collectAllGraphs(root) {
  const out = [];
  const seen = new Set();
  const visit = (g) => {
    if (!g || seen.has(g)) return;
    seen.add(g);
    out.push(g);
    const subgraphs = g._subgraphs || g.subgraphs;
    if (subgraphs) {
      if (typeof subgraphs.values === "function") {
        for (const sg of subgraphs.values()) visit(sg);
      } else if (Array.isArray(subgraphs)) {
        for (const sg of subgraphs) visit(sg);
      }
    }
    if (g._nodes) {
      for (const n of g._nodes) {
        if (n?.subgraph) visit(n.subgraph);
      }
    }
  };
  visit(root);
  return out;
}

function getLink(graph, linkId) {
  if (linkId == null) return null;
  if (graph.getLink) return graph.getLink(linkId);
  return graph._links instanceof Map
    ? graph._links.get(linkId)
    : (graph._links?.[linkId] ?? null);
}

function globalFindSetters(graph, name) {
  if (!name) return [];
  const root = findRootGraph(graph);
  if (!root) return [];
  const results = [];
  for (const g of collectAllGraphs(root)) {
    if (!g?._nodes) continue;
    for (const node of g._nodes) {
      if (node.type === SET_TYPE && node.widgets?.[0]?.value === name) {
        results.push({ node, graph: g });
      }
    }
  }
  return results;
}

// ---- patch functions ----

function patchedFindSetter(graph) {
  const name = this.widgets?.[0]?.value;
  const setters = globalFindSetters(graph, name);
  return setters.length ? setters[0].node : undefined;
}

function patchedResolveVirtualOutput(slot) {
  const name = this.widgets?.[0]?.value;
  const setters = globalFindSetters(this.graph, name);
  if (setters.length === 0) return undefined;

  if (setters.length > 1) {
    console.warn(
      `[kwnodes] Multiple SetNodes named "${name}" found across the workflow. Rename duplicates.`,
      setters.map((s) => s.node),
    );
    return undefined;
  }

  const { node: setter, graph: setterGraph } = setters[0];
  if (setterGraph === this.graph) return undefined;

  const slotInfo = setter.inputs?.[slot];
  if (!slotInfo || slotInfo.link == null) return undefined;

  const link = getLink(setterGraph, slotInfo.link);
  if (!link) return undefined;

  const sourceNode = setterGraph.getNodeById(link.origin_id);
  if (!sourceNode) return undefined;

  return { node: sourceNode, slot: link.origin_slot };
}

// ---- apply / restore (toggleable) ----

const saved = {
  findSetter: null,
  resolveVirtualOutput: null,
  applied: false,
};

function applyPatch() {
  const GetCls = LiteGraph.registered_node_types?.[GET_TYPE];
  if (!GetCls) return false;
  if (saved.applied) return true; // already applied

  // Save originals once so we can restore them when the switch is turned off.
  if (saved.findSetter == null) saved.findSetter = GetCls.prototype.findSetter;
  if (saved.resolveVirtualOutput == null)
    saved.resolveVirtualOutput = GetCls.prototype.resolveVirtualOutput;

  GetCls.prototype.findSetter = patchedFindSetter;
  GetCls.prototype.resolveVirtualOutput = patchedResolveVirtualOutput;
  saved.applied = true;
  console.log("[kwnodes] Global Set/Get patch applied.");
  return true;
}

function restorePatch() {
  const GetCls = LiteGraph.registered_node_types?.[GET_TYPE];
  if (!GetCls) return;
  if (!saved.applied) return; // nothing to restore

  if (saved.findSetter) GetCls.prototype.findSetter = saved.findSetter;
  if (saved.resolveVirtualOutput)
    GetCls.prototype.resolveVirtualOutput = saved.resolveVirtualOutput;
  saved.applied = false;
  console.log("[kwnodes] Global Set/Get patch restored to KJNodes default.");
}

app.registerExtension({
  name: "kwnodes.GlobalSetGet",

  async setup() {
    // Defer: KJNodes registers GetNode during its own registerCustomNodes pass.
    setTimeout(() => {
      const GetCls = LiteGraph.registered_node_types?.[GET_TYPE];
      if (GetCls) {
        // Save originals eagerly, but only apply if the toggle (default on) says so.
        if (saved.findSetter == null) saved.findSetter = GetCls.prototype.findSetter;
        if (saved.resolveVirtualOutput == null)
          saved.resolveVirtualOutput = GetCls.prototype.resolveVirtualOutput;
      }
    }, 1000);
  },

  registerCustomNodes() {
    class GlobalSetGet extends LGraphNode {
      static title = NODE_TYPE;
      static category = "kwnodes";
      static _category = "kwnodes";
      static comfyClass = "kwnodes";
      isVirtualNode = true;
      serialize_widgets = true;

      constructor() {
        super(NODE_TYPE);
        this._toggle = this.addWidget(
          "toggle",
          "enable global lookup",
          true,
          (value) => this._setEnabled(!!value),
          { on: "on", off: "off" },
        );
      }

      onConfigure() {
        // Apply the patch on load if the toggle was left on.
        if (this._toggle?.value) applyPatch();
      }

      onAdded() {
        if (this._toggle?.value) applyPatch();
      }

      _setEnabled(enabled) {
        if (enabled) applyPatch();
        else restorePatch();
      }

      onRemoved() {
        // If this was the node holding the patch on, restore KJNodes default.
        restorePatch();
      }
    }

    LiteGraph.registerNodeType(NODE_TYPE, GlobalSetGet);
    if (GlobalSetGet._category) GlobalSetGet.category = GlobalSetGet._category;
  },
});
