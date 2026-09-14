"""Custom HTTP routes for comfyui-kwnodes."""

import os
from aiohttp import web
from server import PromptServer

from .prompt_file_picker import PromptFilePicker


@PromptServer.instance.routes.get("/kwnodes/getpath")
async def get_path(request):
    """Return subdirectory names (with trailing '/') directly under a path, for the
    prompt picker's inline directory dropdown. Lists only ONE level."""
    query = request.rel_url.query
    if "path" not in query:
        return web.Response(status=204)

    path = os.path.abspath(os.path.expanduser(query["path"]))
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


@PromptServer.instance.routes.get("/kwnodes/list_prompt_files")
async def list_prompt_files(request):
    """Return the .md/.txt files in an absolute directory."""
    directory = request.query.get("directory", "")
    directory = os.path.expanduser(directory)
    try:
        files = PromptFilePicker._list_files_abs(directory)
        return web.json_response({"files": files})
    except OSError as e:
        return web.json_response({"files": [], "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/kwnodes/save_prompt_file")
async def save_prompt_file(request):
    """Write the edited prompt text back to its file (mode-aware)."""
    post = await request.post()
    directory = os.path.expanduser(post.get("directory", ""))
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
    directory = os.path.expanduser(request.query.get("directory", ""))
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
