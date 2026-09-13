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
