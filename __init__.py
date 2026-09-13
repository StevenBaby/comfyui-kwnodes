"""
comfyui-kwnodes

Custom nodes for ComfyUI. Currently provides the frontend-only
"Global Fast Bypasser" utility node (web/fast_bypasser.js) — a global toggle
panel that bypasses/enables nodes and groups by matching their title.
"""

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}

NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
