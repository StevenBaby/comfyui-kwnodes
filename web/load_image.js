import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Load Image (Path) frontend:
// - directory field uses a VHS-style path search dialog (same widget type as
//   PromptFilePicker's KWNODES_PATH).
// - image dropdown refreshes when the directory changes; a refresh button
//   re-scans the directory and bumps a hidden reload to re-read the image.

const NODE_TYPE = "LoadImagePath";

function pathStem(value) {
  // ROOT-relative path: the whole value is the directory being browsed, with
  // an optional trailing segment being typed. "" = the ROOT itself.
  const v = String(value || "");
  const i = v.lastIndexOf("/");
  if (i < 0) return ["", v];
  return [v.slice(0, i + 1), v.slice(i + 1)];
}

// VHS-style path search dialog bound to a path widget's mouse.
function pathSearchBox(event, pos, node) {
  const pathWidget = this;
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
  name: "kwnodes.LoadImagePath",

  // Register the KWNODES_IMAGE_PATH widget type (VHS-style), a ROOT-relative
  // path picker distinct from PromptFilePicker's KWNODES_PATH.
  async getCustomWidgets() {
    return {
      KWNODES_IMAGE_PATH(node, inputName, inputData) {
        const w = {
          name: inputName,
          type: "KWNODES_IMAGE_PATH",
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

      // Replace the directory STRING widget with a KWNODES_IMAGE_PATH autocomplete.
      const dirWidget = this.widgets?.find((w) => w.name === "directory");
      if (dirWidget) {
        const idx = this.widgets.indexOf(dirWidget);
        const defaultVal = dirWidget.value;
        const placeholder = dirWidget.options?.placeholder;
        this.widgets.splice(idx, 1);
        const custom = app.widgets.KWNODES_IMAGE_PATH(this, "directory", [
          "STRING",
          { default: defaultVal, placeholder },
        ]);
        this.widgets.splice(this.widgets.length - 1, 1);
        this.widgets.splice(idx, 0, custom);
        custom.callback = (value) => this._refreshFiles(value);
      }

      // Refresh button: re-scan the image list and bump reload to re-read.
      const refreshBtn = this.addWidget(
        "button",
        "refresh",
        "↻ Refresh",
        () => {
          const dirW = this.widgets?.find((w) => w.name === "directory");
          if (dirW) this._refreshFiles(dirW.value, true);
          const reloadWidget = this.widgets?.find((w) => w.name === "reload");
          if (reloadWidget) {
            reloadWidget.value = (reloadWidget.value ?? 0) + 1;
            reloadWidget.callback?.(reloadWidget.value);
          }
        },
        { serialize: false },
      );
      refreshBtn.label = "↻ Refresh";

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

      this._setupPreview();

      // Auto-refresh the file list once after the node is created (covers page
      // load, when saved workflows are reconstructed).
      const dirW0 = this.widgets?.find((w) => w.name === "directory");
      if (dirW0) {
        setTimeout(() => this._refreshFiles(dirW0.value), 0);
      }

      // Clean up the preview poll interval when the node is removed.
      const onRemoved = this.onRemoved;
      this.onRemoved = function () {
        onRemoved?.apply(this, arguments);
        this._previewWatchCleanup?.();
        this._previewObjectUrlCleanup?.();
      };

      return r;
    };

    // Image preview below the widgets: an <img> that follows the selected file.
    nodeType.prototype._setupPreview = function () {
      const node = this;

      const imgEl = document.createElement("img");
      imgEl.style.width = "100%";
      imgEl.style.objectFit = "contain";
      imgEl.style.background = "#111";
      imgEl.style.borderRadius = "4px";
      imgEl.style.display = "block";
      imgEl.style.imageRendering = "pixelated";
      imgEl.alt = "";
      node._previewEl = imgEl;

      const previewWidget = this.addDOMWidget("preview", "img", imgEl, {
        serialize: false,
        getMinHeight: () => 120,
        getMaxHeight: () => 600,
      });

      const updatePreview = async () => {
        const dirW = node.widgets?.find((w) => w.name === "directory");
        const fileW = node.widgets?.find((w) => w.name === "image");
        const hide = () => {
          imgEl.src = "";
          imgEl.style.display = "none";
        };
        if (!dirW || !fileW || !fileW.value || fileW.value === "(no images)") {
          hide();
          return;
        }
        const url = api.apiURL(
          "/kwnodes/preview_image?" +
            new URLSearchParams({ directory: dirW.value, file: fileW.value }),
        );
        try {
          const resp = await fetch(url);
          if (!resp.ok) {
            hide();
            return;
          }
          // File exists: show it via an object URL (no second request).
          const blob = await resp.blob();
          if (blob.size === 0) {
            hide();
            return;
          }
          if (imgEl._objectUrl) URL.revokeObjectURL(imgEl._objectUrl);
          imgEl._objectUrl = URL.createObjectURL(blob);
          imgEl.src = imgEl._objectUrl;
          imgEl.style.display = "block";
        } catch (_) {
          hide();
        }
      };
      node._updatePreview = updatePreview;

      // Follow the image dropdown via polling (combo callback is unreliable).
      let lastFile = null;
      node._previewWatch = setInterval(() => {
        const fileW = node.widgets?.find((w) => w.name === "image");
        const cur = fileW?.value ?? null;
        if (cur !== lastFile) {
          lastFile = cur;
          updatePreview();
        }
      }, 300);
      node._previewWatchCleanup = () => clearInterval(node._previewWatch);
      node._previewObjectUrlCleanup = () => {
        if (imgEl._objectUrl) {
          URL.revokeObjectURL(imgEl._objectUrl);
          imgEl._objectUrl = null;
        }
      };

      // Initial preview after layout.
      setTimeout(updatePreview, 0);
    };

    nodeType.prototype._refreshFiles = async function (directory, selectLatest) {
      const fileWidget = this.widgets?.find((w) => w.name === "image");
      if (!fileWidget || !directory) return;
      const subW = this.widgets?.find((w) => w.name === "sub");
      const sub = subW?.value ? 1 : 0;
      try {
        const url = api.apiURL(
          "/kwnodes/list_image_files?" +
            new URLSearchParams({ directory, sub }),
        );
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.files && data.files.length) {
          fileWidget.options.values = data.files;
          // On manual refresh, always jump to the newest file (files are sorted
          // by mtime descending, so [0] is the latest). Otherwise keep the
          // current selection if it still exists.
          if (selectLatest) {
            fileWidget.value = data.files[0];
          } else if (!data.files.includes(fileWidget.value)) {
            fileWidget.value = data.files[0];
          }
          this.setDirtyCanvas?.(true, true);
        }
      } catch (_) {
        /* ignore */
      }
      // Refresh the thumbnail to match the (possibly new) selected file.
      this._updatePreview?.();
    };
  },
});
