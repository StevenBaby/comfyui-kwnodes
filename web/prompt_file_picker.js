import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Prompt File Picker frontend:
// - directory field uses a VHS Load Image (Path)-style search dialog: click it,
//   a dialog opens listing subdirectories of the typed path (one level, prefix
//   filtered). Click a dir to descend, Enter/OK to commit.
// - file dropdown refreshes when the directory changes.

const NODE_TYPE = "PromptFilePicker";

function pathStem(value) {
  const v = String(value || "");
  const i = v.lastIndexOf("/");
  if (i < 0) return ["", v];
  return [v.slice(0, i + 1), v.slice(i + 1)];
}

// VHS-style path search dialog bound to a path widget's mouse.
function pathSearchBox(event, pos, node) {
  const pathWidget = this;
  // Prevent a second dialog from opening on the click that closes the first.
  if (pathWidget.prompt) return;
  pathWidget.prompt = true;

  let dialog = document.createElement("div");
  dialog.className = "litegraph litesearchbox graphdialog rounded";
  dialog.innerHTML =
    '<span class="name">Directory</span> <input autofocus type="text" class="value">' +
    '<button class="rounded">OK</button><div class="helper"></div>';
  dialog.close = () => {
    dialog.remove();
    pathWidget.prompt = false;
  };
  document.body.append(dialog);

  const input = dialog.querySelector(".value");
  const optionsEl = dialog.querySelector(".helper");
  input.value = pathWidget.value;

  let timeout = null;
  let lastPath = null;
  let options = [];

  const commit = () => {
    pathWidget.value = input.value;
    pathWidget.callback?.(pathWidget.value);
    dialog.close();
    node.graph?.setDirtyCanvas?.(true);
  };

  const updateOptions = async () => {
    timeout = null;
    const [path, remainder] = pathStem(input.value);
    if (lastPath !== path) {
      try {
        const url = api.apiURL(
          "/kwnodes/getpath_image?" + new URLSearchParams({ path }),
        );
        const resp = await fetch(url);
        options = (await resp.json()) || [];
        options.sort();
      } catch (_) {
        options = [];
      }
      lastPath = path;
    }
    optionsEl.innerHTML = "";
    for (const option of options) {
      const name = option.endsWith("/") ? option.slice(0, -1) : option;
      if (!name.startsWith(remainder)) continue;
      const el = document.createElement("div");
      el.innerText = option;
      el.className = "litegraph lite-search-item is-dir";
      el.addEventListener("click", () => {
        input.value = path + option;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(updateOptions, 10);
      });
      optionsEl.appendChild(el);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.keyCode === 27) {
      dialog.close();
    } else if (e.keyCode === 13 && e.target.localName !== "textarea") {
      commit();
    } else if (e.keyCode === 9) {
      const first = optionsEl.firstChild;
      if (first) {
        const [path] = pathStem(input.value);
        input.value = path + first.innerText;
        e.preventDefault();
        e.stopPropagation();
      }
    } else {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(updateOptions, 10);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  dialog.querySelector("button").addEventListener("click", commit);

  const rect = app.canvas?.canvas?.getBoundingClientRect?.();
  if (rect) {
    dialog.style.left = (event?.clientX || 0) - rect.left - 20 + "px";
    dialog.style.top = (event?.clientY || 0) - rect.top - 20 + "px";
  }
  setTimeout(() => {
    input.focus();
    updateOptions();
  }, 10);
}

app.registerExtension({
  name: "kwnodes.PromptFilePicker",

  // Hook graph serialization so edited prompt text is written back to its file
  // when the workflow is saved or queued.
  setup() {
    const originalGraphToPrompt = app.graphToPrompt?.bind(app);
    if (originalGraphToPrompt) {
      app.graphToPrompt = async function (...args) {
        const result = await originalGraphToPrompt(...args);
        // Write back any dirty editors.
        const nodes = app.graph?._nodes || [];
        for (const n of nodes) {
          if (n.type === NODE_TYPE && n._writeBackBound) {
            try {
              await n._writeBackBound();
            } catch (_) {
              /* ignore */
            }
          }
        }
        return result;
      };
    }
  },

  // Register the KWNODES_PATH widget type via getCustomWidgets (VHS-style).
  async getCustomWidgets() {
    return {
      KWNODES_PATH(node, inputName, inputData) {
        const w = {
          name: inputName,
          type: "KWNODES_PATH",
          value: "",
          options: inputData?.[1] || {},
          draw(ctx, node, widgetWidth, y, H) {
            const scale = app.canvas.ds.scale;
            const showText =
              scale >= (app.canvas.low_quality_zoom_threshold ?? 0.5);
            const margin = 15;
            ctx.textAlign = "left";
            ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
            ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
            ctx.beginPath();
            if (showText)
              ctx.roundRect(margin, y, widgetWidth - margin * 2, H, [H * 0.5]);
            else ctx.rect(margin, y, widgetWidth - margin * 2, H);
            ctx.fill();
            if (showText) {
              if (!this.disabled) ctx.stroke();
              ctx.save();
              ctx.beginPath();
              ctx.rect(margin, y, widgetWidth - margin * 2, H);
              ctx.clip();
              const label = this.label || this.name;
              if (label != null) {
                ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR;
                ctx.fillText(label, margin * 2, y + H * 0.7);
              }
              ctx.fillStyle = this.value ? LiteGraph.WIDGET_TEXT_COLOR : "#777";
              ctx.textAlign = "right";
              ctx.fillText(
                String(this.value || this.options.placeholder || ""),
                widgetWidth - margin * 2,
                y + H * 0.7,
              );
              ctx.restore();
            }
          },
          mouse: pathSearchBox,
        };
        if (w.options.default != null) w.value = w.options.default;
        node.widgets = node.widgets || [];
        node.widgets.push(w);
        return w;
      },
    };
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeType.comfyClass !== NODE_TYPE) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);

      const dirWidget = this.widgets?.find((w) => w.name === "directory");
      if (dirWidget) {
        const idx = this.widgets.indexOf(dirWidget);
        const defaultVal = dirWidget.value;
        const placeholder = dirWidget.options?.placeholder;
        this.widgets.splice(idx, 1);
        const custom = app.widgets.KWNODES_PATH(this, "directory", [
          "STRING",
          { default: defaultVal, placeholder },
        ]);
        this.widgets.splice(this.widgets.length - 1, 1);
        this.widgets.splice(idx, 0, custom);
        custom.callback = (value) => this._refreshFiles(value);
      }

      // Editable text area showing the current file content, plus Save + Refresh
      // buttons. Also hook the file dropdown so selecting a file loads its
      // content immediately. The `editor` multiline widget auto-sizes the node.
      this._setupEditor();

      const fileW = this.widgets?.find((w) => w.name === "file");
      if (fileW) {
        const node = this;
        const origCb = fileW.callback;
        fileW.callback = function (value) {
          origCb?.call(this, value);
          node._loadContent();
        };
      }

      // Toggling `sub` re-scans the file list (recursive vs flat).
      const subW = this.widgets?.find((w) => w.name === "sub");
      if (subW) {
        subW.label = "include sub directory";
        const origSubCb = subW.callback;
        subW.callback = function (value) {
          origSubCb?.call(this, value);
          const dirW = this.widgets?.find((w) => w.name === "directory");
          if (dirW) this._refreshFiles(dirW.value);
        };
      }

      // Clean up the file-watch interval when the node is removed.
      const onRemoved = this.onRemoved;
      this.onRemoved = function () {
        onRemoved?.apply(this, arguments);
        this._fileWatchCleanup?.();
      };

      // Auto-refresh the file list once after the node is created (covers page
      // load, when saved workflows are reconstructed).
      const dirW0 = this.widgets?.find((w) => w.name === "directory");
      if (dirW0) {
        setTimeout(() => this._refreshFiles(dirW0.value), 0);
      }

      return r;
    };

    nodeType.prototype._setupEditor = function () {
      const node = this;

      // The `editor` input is a native multiline STRING widget (declared in
      // INPUT_TYPES with {"multiline": True}), so ComfyUI renders it as a proper
      // textarea with correct styling — no hand-rolled DOM widget.
      const editorWidget = this.widgets?.find((w) => w.name === "editor");
      if (!editorWidget) return;

      // Ctrl+/ toggles a '#' comment on the current line. Find the textarea DOM
      // the multiline widget rendered (element / legacy inputEl / node query).
      const ta =
        editorWidget.element ||
        editorWidget.inputEl ||
        editorWidget.element?.querySelector?.("textarea") ||
        (editorWidget.element && editorWidget.element.tagName === "TEXTAREA"
          ? editorWidget.element
          : null);
      if (ta && ta.tagName === "TEXTAREA") {
        // Add a bit of space between the editor and the buttons above it.
        ta.addEventListener("keydown", (e) => {
          if (!(e.ctrlKey || e.metaKey) || e.key !== "/") return;
          e.preventDefault();
          const val = ta.value;
          const start = ta.selectionStart;
          const lineStart = val.lastIndexOf("\n", start - 1) + 1;
          let lineEnd = val.indexOf("\n", start);
          if (lineEnd === -1) lineEnd = val.length;
          const line = val.slice(lineStart, lineEnd);
          const leading = line.match(/^\s*/)[0];
          const body = line.slice(leading.length);
          let newLine;
          if (body.startsWith("#")) {
            newLine = leading + body.replace(/^#\s?/, "");
          } else {
            newLine = leading + "# " + body;
          }
          const newVal = val.slice(0, lineStart) + newLine + val.slice(lineEnd);
          ta.value = newVal;
          editorWidget.value = newVal;
          const delta = newLine.length - line.length;
          ta.selectionStart = ta.selectionEnd = start + delta;
        });
      }

      // Fill the editor with the node's output after execution.
      const onExecuted = this.onExecuted;
      this.onExecuted = function (msg) {
        onExecuted?.apply(this, arguments);
        const text = msg?.text?.[0];
        if (text != null) {
          editorWidget.value = text;
        }
      };

      // Refresh button (re-scan file list + bump reload to mark node changed).
      const refreshBtn = this.addWidget(
        "button",
        "refresh",
        "↻ Refresh",
        () => {
          const dirW = node.widgets?.find((w) => w.name === "directory");
          if (dirW) node._refreshFiles(dirW.value);
          const reloadWidget = node.widgets?.find((w) => w.name === "reload");
          if (reloadWidget) {
            reloadWidget.value = (reloadWidget.value ?? 0) + 1;
            reloadWidget.callback?.(reloadWidget.value);
          }
        },
        { serialize: false },
      );
      refreshBtn.label = "↻ Refresh";

      // Save button (write editor content back to the file).
      const saveBtn = this.addWidget(
        "button",
        "save",
        "💾 Save",
        async () => {
          const dirW = node.widgets?.find((w) => w.name === "directory");
          const fileW = node.widgets?.find((w) => w.name === "file");
          const modeW = node.widgets?.find((w) => w.name === "mode");
          if (!dirW || !fileW || fileW.value === "(no prompt files)") return;
          const body = new URLSearchParams({
            directory: dirW.value,
            file: fileW.value,
            mode: modeW?.value ?? "fenced",
            content: editorWidget.value,
          });
          try {
            await api.fetchApi("/kwnodes/save_prompt_file", {
              method: "POST",
              body,
            });
          } catch (_) {
            /* ignore */
          }
        },
        { serialize: false },
      );
      saveBtn.label = "💾 Save";

      // New button: create a new prompt_<n>.md file and select it.
      const newBtn = this.addWidget(
        "button",
        "new",
        "➕ New",
        async () => {
          const dirW = node.widgets?.find((w) => w.name === "directory");
          if (!dirW) return;
          try {
            const resp = await api.fetchApi("/kwnodes/new_prompt_file", {
              method: "POST",
              body: new URLSearchParams({ directory: dirW.value }),
            });
            const data = await resp.json();
            if (data && data.ok && data.file) {
              const fileW = node.widgets?.find((w) => w.name === "file");
              if (fileW) fileW.value = data.file;
              await node._refreshFiles(dirW.value);
              const fw = node.widgets?.find((w) => w.name === "file");
              if (fw) fw.value = data.file;
              if (editorWidget) editorWidget.value = "";
              node._loadContent?.();
            }
          } catch (_) {
            /* ignore */
          }
        },
        { serialize: false },
      );
      newBtn.label = "➕ New";

      // Move the refresh/new/save buttons above the editor textarea.
      const btns = [refreshBtn, newBtn, saveBtn];
      node.widgets = node.widgets.filter((w) => !btns.includes(w));
      const insertAt = node.widgets.indexOf(editorWidget);
      if (insertAt >= 0) {
        node.widgets.splice(insertAt, 0, ...btns);
      } else {
        node.widgets.push(...btns);
      }

      // Auto-write back when the workflow is saved / queued (graphToPrompt).
      node._writeBack = async () => {
        const dirW = node.widgets?.find((w) => w.name === "directory");
        const fileW = node.widgets?.find((w) => w.name === "file");
        const modeW = node.widgets?.find((w) => w.name === "mode");
        if (!dirW || !fileW || fileW.value === "(no prompt files)") return;
        if (!editorWidget.value) return;
        try {
          await api.fetchApi("/kwnodes/save_prompt_file", {
            method: "POST",
            body: new URLSearchParams({
              directory: dirW.value,
              file: fileW.value,
              mode: modeW?.value ?? "fenced",
              content: editorWidget.value,
            }),
          });
        } catch (_) {
          /* ignore */
        }
      };
      node._writeBackBound = node._writeBack.bind(node);

      // Load the selected file's content into the editor immediately.
      node._loadContent = async function () {
        const dirW = this.widgets?.find((w) => w.name === "directory");
        const fileW = this.widgets?.find((w) => w.name === "file");
        const modeW = this.widgets?.find((w) => w.name === "mode");
        const editorW = this.widgets?.find((w) => w.name === "editor");
        if (!dirW || !fileW || !fileW.value || fileW.value === "(no prompt files)") {
          return;
        }
        const mode = modeW?.value ?? "fenced";
        try {
          const url = api.apiURL(
            "/kwnodes/read_prompt_file?" +
            new URLSearchParams({
              directory: dirW.value,
              file: fileW.value,
              mode,
            }),
          );
          const resp = await fetch(url);
          const data = await resp.json();
          if (data && data.content != null && editorW) {
            editorW.value = data.content;
          }
        } catch (_) {
          /* ignore */
        }
      };

      // Fallback: poll the file widget's value; if it changes, reload content.
      // ComfyUI's combo callback is unreliable across frontend versions, so this
      // guarantees the editor follows the selected file.
      let lastFile = null;
      node._fileWatch = setInterval(() => {
        const fileW = node.widgets?.find((w) => w.name === "file");
        const cur = fileW?.value ?? null;
        if (cur !== lastFile) {
          lastFile = cur;
          node._loadContent();
        }
      }, 300);
      node._fileWatchCleanup = () => clearInterval(node._fileWatch);
    };

    nodeType.prototype._refreshFiles = async function (directory) {
      const fileWidget = this.widgets?.find((w) => w.name === "file");
      if (!fileWidget || !directory) return;
      const subW = this.widgets?.find((w) => w.name === "sub");
      const sub = subW?.value ? 1 : 0;
      try {
        const url = api.apiURL(
          "/kwnodes/list_prompt_files?" +
            new URLSearchParams({ directory, sub }),
        );
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.files && data.files.length) {
          fileWidget.options.values = data.files;
          if (!data.files.includes(fileWidget.value)) {
            fileWidget.value = data.files[0];
          }
          this.setDirtyCanvas?.(true, true);
        }
      } catch (_) {
        /* ignore */
      }
      // Load the (possibly new) selected file's content into the editor.
      this._loadContent?.();
    };
  },
});
