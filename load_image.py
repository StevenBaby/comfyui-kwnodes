"""Load Image node — load an image from disk and output it as a ComfyUI IMAGE
+ MASK, with a VHS-style path autocomplete on the directory field (confined to
the project root) and a refreshable file dropdown that can optionally recurse
into subdirectories."""

import os

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import node_helpers
import comfy.model_management

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif")

# Directory ceiling: ComfyUI's working directory. The directory picker is
# confined to this subtree (no escaping upward via "..").
ROOT = os.path.realpath(os.getcwd())


def _is_within(path, root):
    """True if `path` is `root` or inside it (both realpath'd, no `..` escape)."""
    p = os.path.realpath(path)
    r = os.path.realpath(root)
    return p == r or p.startswith(r + os.sep)


def _abs(directory):
    """Resolve a directory (relative to ROOT) to an absolute path, confined to
    ROOT. A leading '/' input is treated as relative anyway (stripped), so the
    field always shows a ROOT-relative path like 'input' or 'input/sub'."""
    directory = os.path.expanduser(directory or "").strip()
    # Treat the value as ROOT-relative; drop any leading separators so a pasted
    # absolute path still lands inside ROOT rather than escaping it.
    directory = directory.lstrip("/")
    path = os.path.realpath(os.path.join(ROOT, directory))
    if not _is_within(path, ROOT):
        return ROOT
    return path


def _parse_image_value(image):
    """Normalize the `image` widget value. After a save in the mask editor, the
    frontend writes a ComfyUI-style 'filename [type]' value (e.g.
    'clipspace-painted-masked-…png [input]'); return (filename, annotation)
    where annotation is 'input'/'output'/'' (no annotation)."""
    v = (image or "").strip()
    annotation = ""
    if v.endswith("]"):
        i = v.rfind(" [")
        if i > 0:
            annotation = v[i + 2 : -1].strip()
            v = v[:i].strip()
    return v, annotation


def _resolve_image_path(directory, image):
    """Resolve (directory, image) to an absolute path inside ROOT. A mask-editor
    save carries ' [input]' but its file lives in the input ROOT (the
    'clipspace-' prefix is part of the filename), so redirect to the input
    directory in that case."""
    filename, annotation = _parse_image_value(image)
    if annotation == "input":
        directory = os.path.join(ROOT, "input")
    else:
        directory = _abs(directory)
    return os.path.join(directory, filename)


class LoadImagePath:
    """Load an image by path (directory autocomplete confined to ROOT) and output
    IMAGE + MASK. With `sub` on (default), the file dropdown also lists images in
    subdirectories, named relative to the chosen directory."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": (
                    "STRING",
                    {
                        "default": "input",
                        "multiline": False,
                    },
                ),
                "sub": ("BOOLEAN", {"default": True}),
                "image": (cls._list_images_abs("input", True),),
            },
            "hidden": {
                "reload": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"
    CATEGORY = "kwnodes"
    DESCRIPTION = (
        "Load an image from a directory inside the project root and output it "
        "as IMAGE + MASK. The directory field has VHS-style autocomplete "
        "confined to the root. With 'sub' on (default), images in subdirectories "
        "are listed too, named relative to the directory. Newest files first."
    )

    @staticmethod
    def _list_images_abs(directory, sub=True):
        """Return image files under `directory` (ROOT-relative), newest first.
        With `sub`, walk subdirectories and prefix names with the subpath."""
        directory = _abs(directory)

        if not sub:
            try:
                entries = [
                    e
                    for e in os.listdir(directory)
                    if e.lower().endswith(IMAGE_EXTENSIONS)
                    and os.path.isfile(os.path.join(directory, e))
                ]
            except OSError:
                return ["(no images)"]
            return LoadImagePath._sort_by_mtime(directory, entries)

        # Recursive: collect (relative_name, abspath) for every image.
        found = []  # (relpath, abspath)
        for root, dirs, files in os.walk(directory):
            dirs.sort()
            for f in files:
                if not f.lower().endswith(IMAGE_EXTENSIONS):
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, directory)
                found.append((rel, full))
        if not found:
            return ["(no images)"]
        found.sort(key=lambda x: os.path.getmtime(x[1]), reverse=True)
        return [rel for rel, _ in found]

    @staticmethod
    def _sort_by_mtime(directory, entries):
        entries = list(entries)
        entries.sort(
            key=lambda e: os.path.getmtime(os.path.join(directory, e)),
            reverse=True,
        )
        return entries if entries else ["(no images)"]

    @classmethod
    def VALIDATE_INPUTS(cls, directory, sub, image):
        norm, _ = _parse_image_value(image)
        files = cls._list_images_abs(directory, sub)
        if norm not in files and norm != "(no images)":
            # A mask-editor save ('[input]') lives in the input root, which may
            # not be listed under `directory`; allow it through.
            _, annotation = _parse_image_value(image)
            if annotation == "input":
                return True
            return [f"image '{image}' not found in {directory}"]
        return True

    @classmethod
    def IS_CHANGED(cls, directory, sub, image):
        # mtime of the resolved file: re-reads when the file changes on disk.
        path = _resolve_image_path(directory, image)
        try:
            return os.path.getmtime(path)
        except OSError:
            return float("NaN")

    def load_image(self, directory, sub, image, reload=0):
        path = _resolve_image_path(directory, image)

        # Confine reads to the project root; refuse paths that escape upward.
        if not _is_within(path, ROOT):
            raise ValueError(
                f"kwnodes LoadImagePath: path {path} is outside the project root {ROOT}"
            )

        dtype = comfy.model_management.intermediate_dtype()
        device = comfy.model_management.intermediate_device()

        try:
            img = node_helpers.pillow(Image.open, path)
        except OSError as e:
            raise ValueError(f"kwnodes LoadImagePath: cannot open {path}: {e}")

        output_images = []
        output_masks = []
        w, h = None, None

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)
            image_rgb = i.convert("RGB")

            if len(output_images) == 0:
                w, h = image_rgb.size

            if image_rgb.size[0] != w or image_rgb.size[1] != h:
                continue

            arr = np.array(image_rgb).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(arr)[None,]

            if "A" in i.getbands():
                mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")

            output_images.append(image_tensor.to(dtype=dtype))
            output_masks.append(mask.unsqueeze(0).to(dtype=dtype))

        if not output_images:
            raise ValueError(f"kwnodes LoadImagePath: no frames loaded from {path}")

        output_image = torch.cat(output_images, dim=0)
        output_mask = torch.cat(output_masks, dim=0)

        return (
            output_image.to(device=device, dtype=dtype),
            output_mask.to(device=device, dtype=dtype),
        )


NODE_CLASS_MAPPINGS = {
    "LoadImagePath": LoadImagePath,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImagePath": "Load Image (Path)",
}
