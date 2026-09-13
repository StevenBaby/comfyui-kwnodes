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
          "/kwnodes/getpath?" + new URLSearchParams({ path }),
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
      return r;
    };

    nodeType.prototype._refreshFiles = async function (directory) {
      const fileWidget = this.widgets?.find((w) => w.name === "file");
      if (!fileWidget || !directory) return;
      try {
        const url = api.apiURL(
          "/kwnodes/list_prompt_files?" + new URLSearchParams({ directory }),
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
    };
  },
});
