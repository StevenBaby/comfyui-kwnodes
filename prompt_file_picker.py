"""Prompt picker node — scan a directory for .md/.txt prompt files and output the
selected file's text as a STRING."""

import os
import re

PROMPTS_ROOT = os.path.expanduser("~/source/comfyui/prompts")


class PromptFilePicker:
    """Pick a prompt file from a directory and output its text."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": (
                    "STRING",
                    {
                        "default": PROMPTS_ROOT,
                        "multiline": False,
                    },
                ),
                "file": (cls._list_files_abs(PROMPTS_ROOT),),
                "mode": (["raw", "fenced"], {"default": "fenced"}),
            },
            "hidden": {
                "reload": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "pick"
    CATEGORY = "kwnodes"
    DESCRIPTION = (
        "Pick a prompt directory (absolute path, inline autocomplete from /) and a "
        ".md/.txt file inside it; output the file's text as a STRING. mode 'raw' = "
        "the whole file; mode 'fenced' = only the ``` fenced prompt body."
    )

    @staticmethod
    def _list_files_abs(directory):
        try:
            entries = sorted(
                e
                for e in os.listdir(directory)
                if e.lower().endswith((".md", ".txt"))
                and os.path.isfile(os.path.join(directory, e))
            )
        except OSError:
            entries = []
        return entries if entries else ["(no prompt files)"]

    @staticmethod
    def _extract_fenced(text):
        """Return the content of all ``` fenced blocks, joined by newlines."""
        blocks = re.findall(r"```[^\n]*\n(.*?)```", text, flags=re.DOTALL)
        if not blocks:
            return text
        return "\n".join(b.strip("\n") for b in blocks)

    @staticmethod
    def _replace_fenced(text, new_content):
        """Replace the content of ``` fenced blocks in `text` with `new_content`,
        preserving everything outside the fences. If there is exactly one block,
        swap its body; with multiple blocks, split new_content across them."""
        blocks = re.findall(r"```[^\n]*\n(.*?)```", text, flags=re.DOTALL)
        if not blocks:
            return new_content
        if len(blocks) == 1:
            return re.sub(
                r"```[^\n]*\n(.*?)```",
                "```\n" + new_content.strip("\n") + "\n```",
                text,
                count=1,
                flags=re.DOTALL,
            )
        # Multiple blocks: replace them sequentially with split content.
        parts = new_content.split("\n\n")
        def repl(m):
            nonlocal parts
            return "```\n" + (parts.pop(0) if parts else "") + "\n```"
        return re.sub(r"```[^\n]*\n(.*?)```", repl, text, count=len(blocks), flags=re.DOTALL)

    @classmethod
    def VALIDATE_INPUTS(cls, directory, file, mode):
        files = cls._list_files_abs(os.path.expanduser(directory))
        if file not in files and file != "(no prompt files)":
            return [f"file '{file}' not found in {directory}"]
        return True

    @classmethod
    def IS_CHANGED(cls, directory, file, mode, reload):
        # Bumping `reload` (the refresh button) marks this node as changed, so
        # ComfyUI re-executes just it (and downstream), re-reading the file.
        return reload

    def pick(self, directory, file, mode, reload=0):
        directory = os.path.expanduser(directory)
        path = os.path.join(directory, file)
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as e:
            raise ValueError(f"kwnodes PromptFilePicker: cannot read {path}: {e}")
        if mode == "fenced":
            text = self._extract_fenced(text)
        return (text,)


NODE_CLASS_MAPPINGS = {
    "PromptFilePicker": PromptFilePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptFilePicker": "Prompt File Picker",
}
