"""Prompt picker node — scan a directory for .md/.txt prompt files and output the
selected file's text as a STRING. The directory is ROOT-relative (confined to the
project root); an optional `sub` toggle lists files in subdirectories."""

import os
import re

from .load_image import ROOT, _abs


class PromptFilePicker:
    """Pick a prompt file from a directory and output its text."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": (
                    "STRING",
                    {
                        "default": "prompts",
                        "multiline": False,
                    },
                ),
                "sub": ("BOOLEAN", {"default": True}),
                "file": (cls._list_files_abs("prompts", True),),
                "mode": (["raw", "fenced"], {"default": "fenced"}),
                "editor": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "dynamicPrompts": False,
                    },
                ),
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
        "Pick a prompt directory (ROOT-relative, inline autocomplete) and a "
        ".md/.txt file inside it; output the file's text as a STRING. mode "
        "'raw' = the whole file; mode 'fenced' = only the ``` fenced prompt "
        "body. With 'sub' on (default), files in subdirectories are listed too, "
        "named relative to the directory. Newest files first."
    )

    @staticmethod
    def _list_files_abs(directory, sub=True):
        """Return .md/.txt files under `directory` (ROOT-relative), newest first.
        With `sub`, walk subdirectories and prefix names with the subpath."""
        directory = _abs(directory)

        if not sub:
            try:
                entries = [
                    e
                    for e in os.listdir(directory)
                    if e.lower().endswith((".md", ".txt"))
                    and os.path.isfile(os.path.join(directory, e))
                ]
            except OSError:
                return ["(no prompt files)"]
            return PromptFilePicker._sort_by_mtime(directory, entries)

        found = []  # (relpath, abspath)
        for root, dirs, files in os.walk(directory):
            dirs.sort()
            for f in files:
                if not f.lower().endswith((".md", ".txt")):
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, directory)
                found.append((rel, full))
        if not found:
            return ["(no prompt files)"]
        found.sort(key=lambda x: os.path.getmtime(x[1]), reverse=True)
        return [rel for rel, _ in found]

    @staticmethod
    def _sort_by_mtime(directory, entries):
        entries = list(entries)
        entries.sort(
            key=lambda e: os.path.getmtime(os.path.join(directory, e)),
            reverse=True,
        )
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
        swap its body; with multiple blocks, split new_content across them. If
        there are no fences at all, wrap new_content in a fresh ``` block."""
        blocks = re.findall(r"```[^\n]*\n(.*?)```", text, flags=re.DOTALL)
        if not blocks:
            return "```\n" + new_content.strip("\n") + "\n```\n"
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
    def VALIDATE_INPUTS(cls, directory, sub, file, mode, editor=""):
        files = cls._list_files_abs(directory, sub)
        if file not in files and file != "(no prompt files)":
            return [f"file '{file}' not found in {directory}"]
        return True

    @classmethod
    def IS_CHANGED(cls, directory, sub, file, mode, editor=""):
        # mtime of the resolved file: re-reads when the file changes on disk.
        directory = _abs(directory)
        path = os.path.join(directory, file)
        try:
            return os.path.getmtime(path)
        except OSError:
            return float("NaN")

    def pick(self, directory, sub, file, mode, editor="", reload=0):
        directory = _abs(directory)
        path = os.path.join(directory, file)
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as e:
            raise ValueError(f"kwnodes PromptFilePicker: cannot read {path}: {e}")
        if mode == "fenced":
            text = self._extract_fenced(text)
        # Strip comment lines (those starting with '#', ignoring leading space).
        lines = [ln for ln in text.split("\n") if not ln.lstrip().startswith("#")]
        return ("\n".join(lines),)


NODE_CLASS_MAPPINGS = {
    "PromptFilePicker": PromptFilePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptFilePicker": "Prompt File Picker",
}
