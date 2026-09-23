"""Load Audio node — load an audio file from disk and output it as a ComfyUI
AUDIO, with a VHS-style path autocomplete on the directory field (confined to
the project root) and a refreshable file dropdown that can optionally recurse
into subdirectories."""

import os

import av
import torch

from .load_image import ROOT, _abs, _is_within

AUDIO_EXTENSIONS = (
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus",
    ".wma", ".aiff", ".aif", ".mp4", ".webm", ".mkv",
)


def _f32_pcm(wav):
    """Convert audio to float32 PCM (mirrors comfy's nodes_audio.f32_pcm)."""
    if wav.dtype.is_floating_point:
        return wav
    elif wav.dtype == torch.int16:
        return wav.float() / (2 ** 15)
    elif wav.dtype == torch.int32:
        return wav.float() / (2 ** 31)
    raise ValueError(f"Unsupported wav dtype: {wav.dtype}")


def _load_audio(path):
    """Decode an audio (or video) file into (waveform, sample_rate), mirroring
    comfy's nodes_audio.load."""
    with av.open(path) as af:
        if not af.streams.audio:
            raise ValueError("No audio stream found in the file.")
        stream = af.streams.audio[0]
        sr = stream.codec_context.sample_rate
        n_channels = stream.channels

        frames = []
        for frame in af.decode(streams=stream.index):
            buf = torch.from_numpy(frame.to_ndarray())
            if buf.shape[0] != n_channels:
                buf = buf.view(-1, n_channels).t()
            frames.append(buf)

        if not frames:
            raise ValueError("No audio frames decoded.")

        wav = torch.cat(frames, dim=1)
        wav = _f32_pcm(wav)
        return wav, sr


class LoadAudioPath:
    """Load an audio file by path (directory autocomplete confined to ROOT) and
    output AUDIO. With `sub` on (default), the file dropdown also lists audio in
    subdirectories, named relative to the chosen directory."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": (
                    "STRING",
                    {"default": "input/audio", "multiline": False},
                ),
                "sub": ("BOOLEAN", {"default": True}),
                "audio": (cls._list_audio_abs("input/audio", True),),
            },
            "hidden": {
                "reload": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1}),
            },
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "load_audio"
    CATEGORY = "kwnodes"
    DESCRIPTION = (
        "Load an audio file from a directory inside the project root and output "
        "it as AUDIO. The directory field has VHS-style autocomplete confined to "
        "the root. With 'sub' on (default), audio in subdirectories are listed "
        "too, named relative to the directory. Newest files first."
    )

    @staticmethod
    def _list_audio_abs(directory, sub=True):
        """Return audio files under `directory` (ROOT-relative), newest first."""
        directory = _abs(directory)

        if not sub:
            try:
                entries = [
                    e
                    for e in os.listdir(directory)
                    if e.lower().endswith(AUDIO_EXTENSIONS)
                    and os.path.isfile(os.path.join(directory, e))
                ]
            except OSError:
                return ["(no audio)"]
            return LoadAudioPath._sort_by_mtime(directory, entries)

        found = []  # (relpath, abspath)
        for root, dirs, files in os.walk(directory):
            dirs.sort()
            for f in files:
                if not f.lower().endswith(AUDIO_EXTENSIONS):
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, directory)
                found.append((rel, full))
        if not found:
            return ["(no audio)"]
        found.sort(key=lambda x: os.path.getmtime(x[1]), reverse=True)
        return [rel for rel, _ in found]

    @staticmethod
    def _sort_by_mtime(directory, entries):
        entries = list(entries)
        entries.sort(
            key=lambda e: os.path.getmtime(os.path.join(directory, e)),
            reverse=True,
        )
        return entries if entries else ["(no audio)"]

    @classmethod
    def VALIDATE_INPUTS(cls, directory, sub, audio):
        files = cls._list_audio_abs(directory, sub)
        if audio not in files and audio != "(no audio)":
            return [f"audio '{audio}' not found in {directory}"]
        return True

    @classmethod
    def IS_CHANGED(cls, directory, sub, audio):
        directory = _abs(directory)
        path = os.path.join(directory, audio)
        try:
            return os.path.getmtime(path)
        except OSError:
            return float("NaN")

    def load_audio(self, directory, sub, audio, reload=0):
        directory = _abs(directory)
        path = os.path.join(directory, audio)

        if not _is_within(path, ROOT):
            raise ValueError(
                f"kwnodes LoadAudioPath: path {path} is outside the project root {ROOT}"
            )

        if audio == "(no audio)":
            raise ValueError("kwnodes LoadAudioPath: no audio file selected")

        try:
            wav, sample_rate = _load_audio(path)
        except (OSError, ValueError) as e:
            raise ValueError(f"kwnodes LoadAudioPath: cannot load {path}: {e}")

        waveform = wav.unsqueeze(0)  # [1, channels, samples]
        return ({"waveform": waveform, "sample_rate": sample_rate},)


NODE_CLASS_MAPPINGS = {
    "LoadAudioPath": LoadAudioPath,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadAudioPath": "Load Audio (Path)",
}
