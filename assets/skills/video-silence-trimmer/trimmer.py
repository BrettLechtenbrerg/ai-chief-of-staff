#!/usr/bin/env python3
"""
Video Silence & Filler Trimmer
==============================

Automatically remove filler words ("um", "uh", "ah", "hmm", ...) and dead air
from any input video or audio file.

Pipeline:
  1. Probe the input (video vs. audio) with ffprobe.
  2. Extract a 16 kHz mono WAV with ffmpeg for transcription.
  3. Transcribe with word-level timestamps (faster-whisper by default; OpenAI
     Whisper or ElevenLabs as optional API fallbacks).
  4. Mark removal intervals: filler words + silences/pauses longer than the
     threshold.
  5. Build the complementary list of "keep" segments (with small padding around
     cuts so the result doesn't feel abrupt).
  6. Slice + concat the keep segments with a single ffmpeg filter_complex pass
     (re-encode) so audio/video stay in sync.
  7. Write the trimmed file. The input is NEVER overwritten unless --output
     resolves to exactly the same path the user explicitly passed.

Exit code is 0 on success, non-zero on failure. The LAST line of stdout is a
single-line JSON object describing the result, so callers (e.g. the AICOS
`trim_video_silence` tool) can parse it.

CLI:
  python3 trimmer.py --input in.mp4 [--output out.mp4]
                     [--silence-threshold 0.8] [--filler-words um,uh,ah,hmm]
                     [--padding 0.05] [--engine faster-whisper|openai|elevenlabs]

Dependencies: Python 3.9+, ffmpeg + ffprobe on PATH, and one transcription
engine (faster-whisper recommended — runs on-device, no API key).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass


# --------------------------------------------------------------------------- #
# Result reporting
# --------------------------------------------------------------------------- #

def _emit(obj: dict) -> None:
    """Print the machine-readable result as the final stdout line."""
    print(json.dumps(obj))


def fail(message: str, code: int = 1, **extra) -> "NoReturn":  # type: ignore[name-defined]
    payload = {"success": False, "error": message}
    payload.update(extra)
    _emit(payload)
    sys.exit(code)


# --------------------------------------------------------------------------- #
# Word model
# --------------------------------------------------------------------------- #

@dataclass
class Word:
    start: float
    end: float
    text: str


def _norm(text: str) -> str:
    """Lowercase + strip punctuation for filler matching."""
    return re.sub(r"[^a-z']", "", text.lower())


# --------------------------------------------------------------------------- #
# ffmpeg helpers
# --------------------------------------------------------------------------- #

def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        fail(
            f"'{name}' was not found on your PATH. Install ffmpeg "
            f"(macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`) "
            f"and try again.",
            code=3,
        )
    return path


def ffprobe_has_video(ffprobe: str, src: str) -> bool:
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0", src],
            capture_output=True, text=True, timeout=60,
        )
        return "video" in (out.stdout or "")
    except Exception:
        return False


def ffprobe_duration(ffprobe: str, src: str) -> float:
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", src],
            capture_output=True, text=True, timeout=60,
        )
        return float((out.stdout or "0").strip() or 0.0)
    except Exception:
        return 0.0


def extract_audio(ffmpeg: str, src: str, dest_wav: str) -> None:
    proc = subprocess.run(
        [ffmpeg, "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000",
         "-f", "wav", dest_wav],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not os.path.exists(dest_wav):
        fail("ffmpeg failed to extract audio from the input file.\n"
             + (proc.stderr or "")[-1500:], code=4)


def wav_duration(path: str) -> float:
    try:
        with wave.open(path, "rb") as w:
            return w.getnframes() / float(w.getframerate() or 16000)
    except Exception:
        return 0.0


# --------------------------------------------------------------------------- #
# Transcription engines — each returns List[Word] with word-level timestamps
# --------------------------------------------------------------------------- #

def transcribe_faster_whisper(wav_path: str) -> list[Word]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        fail(
            "faster-whisper is not installed. Install it with "
            "`pip install faster-whisper` (runs on-device, no API key), or pass "
            "--engine openai / --engine elevenlabs with the matching API key set.",
            code=5,
        )

    model_size = os.environ.get("WHISPER_MODEL", "base")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(wav_path, word_timestamps=True)

    words: list[Word] = []
    for seg in segments:
        for w in (seg.words or []):
            if w.word is None:
                continue
            words.append(Word(start=float(w.start), end=float(w.end), text=w.word))
    return words


def transcribe_openai(wav_path: str) -> list[Word]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        fail("--engine openai requires OPENAI_API_KEY in the environment.", code=6)
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        fail("The `openai` package is not installed. Run `pip install openai`.", code=6)

    client = OpenAI(api_key=api_key)
    with open(wav_path, "rb") as fh:
        resp = client.audio.transcriptions.create(
            model=os.environ.get("OPENAI_WHISPER_MODEL", "whisper-1"),
            file=fh,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
    raw_words = getattr(resp, "words", None) or []
    words: list[Word] = []
    for w in raw_words:
        start = w.get("start") if isinstance(w, dict) else getattr(w, "start", None)
        end = w.get("end") if isinstance(w, dict) else getattr(w, "end", None)
        text = w.get("word") if isinstance(w, dict) else getattr(w, "word", None)
        if start is None or end is None or text is None:
            continue
        words.append(Word(start=float(start), end=float(end), text=str(text)))
    if not words:
        fail("OpenAI returned no word-level timestamps for this file.", code=6)
    return words


def transcribe_elevenlabs(wav_path: str) -> list[Word]:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        fail("--engine elevenlabs requires ELEVENLABS_API_KEY in the environment.", code=7)
    try:
        import requests  # type: ignore
    except ImportError:
        fail("The `requests` package is not installed. Run `pip install requests`.", code=7)

    model_id = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v1")
    with open(wav_path, "rb") as fh:
        resp = requests.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": api_key},
            data={"model_id": model_id, "timestamps_granularity": "word"},
            files={"file": ("audio.wav", fh, "audio/wav")},
            timeout=600,
        )
    if resp.status_code != 200:
        fail(f"ElevenLabs STT failed (HTTP {resp.status_code}): {resp.text[:800]}", code=7)

    data = resp.json()
    words: list[Word] = []
    for w in data.get("words", []):
        # ElevenLabs marks spacing tokens with type == 'spacing'; skip those.
        if w.get("type") == "spacing":
            continue
        start, end, text = w.get("start"), w.get("end"), w.get("text") or w.get("word")
        if start is None or end is None or not text:
            continue
        words.append(Word(start=float(start), end=float(end), text=str(text)))
    if not words:
        fail("ElevenLabs returned no word-level timestamps for this file.", code=7)
    return words


ENGINES = {
    "faster-whisper": transcribe_faster_whisper,
    "openai": transcribe_openai,
    "elevenlabs": transcribe_elevenlabs,
}


# --------------------------------------------------------------------------- #
# Segment math
# --------------------------------------------------------------------------- #

def build_removals(words: list[Word], duration: float,
                   fillers: set[str], silence_threshold: float) -> tuple[list[tuple[float, float]], int, int]:
    """Return (removal_intervals, filler_count, silence_count)."""
    removals: list[tuple[float, float]] = []
    filler_count = 0
    silence_count = 0

    # 1) Filler words → remove the word's own span.
    kept_words: list[Word] = []
    for w in words:
        if _norm(w.text) in fillers:
            removals.append((w.start, w.end))
            filler_count += 1
        else:
            kept_words.append(w)

    # 2) Silence/pauses between consecutive KEPT words longer than threshold.
    prev_end = 0.0
    for w in kept_words:
        gap = w.start - prev_end
        if gap > silence_threshold:
            removals.append((prev_end, w.start))
            silence_count += 1
        prev_end = max(prev_end, w.end)

    # Trailing silence after the last kept word.
    if duration > 0 and (duration - prev_end) > silence_threshold:
        removals.append((prev_end, duration))
        silence_count += 1

    return removals, filler_count, silence_count


def merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cleaned = sorted((max(0.0, s), e) for s, e in intervals if e > s)
    merged: list[tuple[float, float]] = []
    for s, e in cleaned:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def keep_segments(removals: list[tuple[float, float]], duration: float,
                  padding: float) -> list[tuple[float, float]]:
    """Complement of removals over [0, duration], with padding kept around cuts."""
    merged = merge_intervals(removals)
    segments: list[tuple[float, float]] = []
    cursor = 0.0
    for s, e in merged:
        # Keep a little padding before the cut and after it.
        seg_end = min(s + padding, duration)
        if seg_end - cursor > 0.01:
            segments.append((cursor, seg_end))
        cursor = max(cursor, e - padding)
    if duration - cursor > 0.01:
        segments.append((cursor, duration))

    # Clamp + drop degenerate slivers.
    out: list[tuple[float, float]] = []
    for s, e in segments:
        s = max(0.0, min(s, duration))
        e = max(0.0, min(e, duration))
        if e - s >= 0.05:
            out.append((s, e))
    return out


def build_filter_script(segments: list[tuple[float, float]], has_video: bool) -> str:
    """A single-pass filter_complex that trims + concats the keep segments."""
    lines: list[str] = []
    labels: list[str] = []
    for i, (s, e) in enumerate(segments):
        if has_video:
            lines.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{i}];")
        lines.append(f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{i}];")
        if has_video:
            labels.append(f"[v{i}][a{i}]")
        else:
            labels.append(f"[a{i}]")
    n = len(segments)
    if has_video:
        lines.append("".join(labels) + f"concat=n={n}:v=1:a=1[outv][outa]")
    else:
        lines.append("".join(labels) + f"concat=n={n}:v=0:a=1[outa]")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> None:
    parser = argparse.ArgumentParser(description="Trim filler words + dead air from a video/audio file.")
    parser.add_argument("--input", required=True, help="Path to the input video/audio file.")
    parser.add_argument("--output", default=None, help="Path for the trimmed output. Default: <input>.trimmed<ext> next to the input.")
    parser.add_argument("--silence-threshold", type=float, default=0.8, help="Pause length in seconds before silence is removed. Default: 0.8.")
    parser.add_argument("--filler-words", default="um,uh,ah,hmm", help="Comma-separated filler words to remove. Default: um,uh,ah,hmm.")
    parser.add_argument("--padding", type=float, default=0.05, help="Seconds of audio/video kept around each cut so it isn't abrupt. Default: 0.05.")
    parser.add_argument("--engine", choices=list(ENGINES.keys()), default="faster-whisper", help="Transcription engine. Default: faster-whisper (on-device).")
    args = parser.parse_args()

    in_path = os.path.abspath(os.path.expanduser(args.input))
    if not os.path.exists(in_path):
        fail(f"Input file does not exist: {in_path}", code=2)

    stem, ext = os.path.splitext(in_path)
    if args.output:
        out_path = os.path.abspath(os.path.expanduser(args.output))
    else:
        out_path = f"{stem}.trimmed{ext or '.mp4'}"

    overwrites_input = os.path.normcase(out_path) == os.path.normcase(in_path)

    ffmpeg = require_binary("ffmpeg")
    ffprobe = require_binary("ffprobe")

    if args.silence_threshold <= 0:
        fail("--silence-threshold must be greater than 0.", code=2)
    if args.padding < 0:
        fail("--padding cannot be negative.", code=2)

    fillers = {_norm(w) for w in args.filler_words.split(",") if _norm(w)}
    has_video = ffprobe_has_video(ffprobe, in_path)

    tmpdir = tempfile.mkdtemp(prefix="silence-trim-")
    try:
        wav_path = os.path.join(tmpdir, "audio.wav")
        extract_audio(ffmpeg, in_path, wav_path)

        duration = ffprobe_duration(ffprobe, in_path) or wav_duration(wav_path)
        if duration <= 0:
            fail("Could not determine the media duration.", code=4)

        words = ENGINES[args.engine](wav_path)
        if not words:
            fail("Transcription produced no words — nothing to trim. Is there speech in the file?", code=8)

        removals, filler_count, silence_count = build_removals(
            words, duration, fillers, args.silence_threshold)
        segments = keep_segments(removals, duration, args.padding)

        if not segments:
            fail("Everything was marked for removal — refusing to write an empty file. "
                 "Try a larger --silence-threshold.", code=9)

        # Write the filter to a script file to avoid command-length limits.
        filter_path = os.path.join(tmpdir, "filter.txt")
        with open(filter_path, "w") as fh:
            fh.write(build_filter_script(segments, has_video))

        # Render to a temp output first, then move into place. This guarantees we
        # never clobber the input mid-write, even when output == input.
        tmp_out = os.path.join(tmpdir, "out" + (ext or ".mp4"))
        cmd = [ffmpeg, "-y", "-i", in_path, "-filter_complex_script", filter_path]
        if has_video:
            cmd += ["-map", "[outv]", "-map", "[outa]"]
        else:
            cmd += ["-map", "[outa]"]
        cmd += [tmp_out]

        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(tmp_out):
            fail("ffmpeg failed while slicing/concatenating the kept segments.\n"
                 + (proc.stderr or "")[-1800:], code=10)

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        shutil.move(tmp_out, out_path)

        kept_duration = sum(e - s for s, e in segments)
        _emit({
            "success": True,
            "inputPath": in_path,
            "outputPath": out_path,
            "engine": args.engine,
            "hasVideo": has_video,
            "originalDurationSec": round(duration, 2),
            "trimmedDurationSec": round(kept_duration, 2),
            "removedSec": round(max(0.0, duration - kept_duration), 2),
            "fillerWordsRemoved": filler_count,
            "silencesRemoved": silence_count,
            "segmentsKept": len(segments),
            "overwroteInput": overwrites_input,
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
