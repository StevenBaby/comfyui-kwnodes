"""
comfyui-kwnodes

Custom nodes for ComfyUI. Currently provides:
- "Global Fast Bypasser" utility node (web/global_fast_bypasser.js) — a global
  toggle panel that bypasses/enables nodes and groups by matching their title.
- "Prompt File Picker" (prompt_file_picker.py) — scan a directory for .md/.txt
  prompt files and output the selected file's text as a STRING. The directory
  field has VHS-style path autocomplete; the file list refreshes on change.
"""

import importlib

from .prompt_file_picker import NODE_CLASS_MAPPINGS as _PICKER_NODES
from .prompt_file_picker import NODE_DISPLAY_NAME_MAPPINGS as _PICKER_NAMES

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = dict(_PICKER_NODES)

NODE_DISPLAY_NAME_MAPPINGS = dict(_PICKER_NAMES)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# Register the custom HTTP routes (directory autocomplete + file list refresh).
importlib.import_module(".routes", __name__)
