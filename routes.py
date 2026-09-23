"""Custom HTTP routes for comfyui-kwnodes."""

import os
from aiohttp import web
from server import PromptServer

from .prompt_file_picker import PromptFilePicker
from .load_image import LoadImagePath, ROOT, _is_within


@PromptServer.instance.routes.get("/kwnodes/getpath")
async def get_path(request):
    """Return subdirectory names (with trailing '/') directly under a path, for the
    prompt picker's inline directory dropdown. Lists only ONE level, confined to
    the project root (no escaping upward)."""
    query = request.rel_url.query
    if "path" not in query:
        return web.Response(status=204)

    path = os.path.abspath(os.path.expanduser(query["path"]))
    # Clamp to the project root: anything above it resolves to the root itself.
    if not _is_within(path, ROOT):
        path = ROOT
    if not os.path.exists(path) or not os.path.isdir(path):
        return web.json_response([])

    items = []
    try:
        for item in os.scandir(path):
            try:
                if item.is_dir():
                    items.append(item.name + "/")
            except OSError:
                pass
    except OSError:
        return web.json_response([])
    items.sort()
    return web.json_response(items)


@PromptServer.instance.routes.get("/kwnodes/getpath_image")
async def get_path_image(request):
    """Like getpath, but the `path` is ROOT-relative (the Load Image node stores a
    relative directory). Join to ROOT and list one level of subdirectories."""
    from .load_image import _abs

    query = request.rel_url.query
    if "path" not in query:
        return web.Response(status=204)

    path = _abs(query["path"])
    if not os.path.isdir(path):
        return web.json_response([])

    items = []
    try:
        for item in os.scandir(path):
            try:
                if item.is_dir():
                    items.append(item.name + "/")
            except OSError:
                pass
    except OSError:
        return web.json_response([])
    items.sort()
    return web.json_response(items)


@PromptServer.instance.routes.get("/kwnodes/list_prompt_files")
async def list_prompt_files(request):
    """Return the .md/.txt files in a ROOT-relative directory (recursively when sub=1)."""
    directory = request.query.get("directory", "")
    sub = request.query.get("sub", "1") in ("1", "true", "True")
    try:
        files = PromptFilePicker._list_files_abs(directory, sub)
        return web.json_response({"files": files})
    except OSError as e:
        return web.json_response({"files": [], "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/kwnodes/list_image_files")
async def list_image_files(request):
    """Return the image files in an absolute directory (recursively when sub=1)."""
    directory = request.query.get("directory", "")
    directory = os.path.expanduser(directory)
    sub = request.query.get("sub", "1") in ("1", "true", "True")
    try:
        files = LoadImagePath._list_images_abs(directory, sub)
        return web.json_response({"files": files})
    except OSError as e:
        return web.json_response({"files": [], "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/kwnodes/preview_image")
async def preview_image(request):
    """Return the bytes of an image so the frontend <img> can show a thumbnail."""
    directory = os.path.expanduser(request.query.get("directory", ""))
    file = request.query.get("file", "")
    if not file:
        return web.Response(status=400)
    path = os.path.join(directory, file)
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        return web.Response(text=str(e), status=500)
    ext = os.path.splitext(file)[1].lower().lstrip(".")
    ctype = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "tiff": "image/tiff",
        "tif": "image/tiff",
    }.get(ext, "application/octet-stream")
    return web.Response(body=data, content_type=ctype)


@PromptServer.instance.routes.post("/kwnodes/save_prompt_file")
async def save_prompt_file(request):
    """Write the edited prompt text back to its file (mode-aware)."""
    from .load_image import _abs

    post = await request.post()
    directory = _abs(post.get("directory", ""))
    file = post.get("file", "")
    content = post.get("content", "")
    mode = post.get("mode", "fenced")
    if not file:
        return web.json_response({"ok": False, "error": "no file"}, status=400)
    path = os.path.join(directory, file)
    try:
        if mode == "fenced":
            with open(path, "r", encoding="utf-8") as f:
                original = f.read()
            new_text = PromptFilePicker._replace_fenced(original, content)
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        return web.json_response({"ok": True})
    except OSError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/kwnodes/read_prompt_file")
async def read_prompt_file(request):
    """Return the content of a prompt file (mode-aware: raw = full, fenced = body)."""
    from .load_image import _abs

    directory = _abs(request.query.get("directory", ""))
    file = request.query.get("file", "")
    mode = request.query.get("mode", "fenced")
    if not file:
        return web.json_response({"content": ""}, status=400)
    path = os.path.join(directory, file)
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        if mode == "fenced":
            text = PromptFilePicker._extract_fenced(text)
        return web.json_response({"content": text})
    except OSError as e:
        return web.json_response({"content": "", "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/kwnodes/new_prompt_file")
async def new_prompt_file(request):
    """Create a new, empty prompt file named prompt_<n>.md in the directory."""
    from .load_image import _abs

    post = await request.post()
    directory = _abs(post.get("directory", ""))
    try:
        n = 1
        while True:
            name = f"prompt_{n}.md"
            path = os.path.join(directory, name)
            if not os.path.exists(path):
                break
            n += 1
        with open(path, "w", encoding="utf-8") as f:
            f.write("")
        return web.json_response({"ok": True, "file": name})
    except OSError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
