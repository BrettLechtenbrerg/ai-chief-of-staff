---
name: video-silence-trimmer
description: Remove filler words ("um", "uh", "ah", "hmm") and dead air from any video or audio file. Use this when the user wants to tighten a recording — clean up a talking-head video, podcast, voiceover, or a clip rendered by Video Studio — without manually cutting. Runs on-device via faster-whisper (no API key), with optional OpenAI/ElevenLabs fallbacks.
---

# Video Silence & Filler Trimmer

Automatically trims **filler words** and **silences/pauses** out of a video or
audio file, then re-exports a clean, in-sync file. Pairs naturally with Video
Studio (tighten a rendered clip) and Content Writer voiceovers.

In AICOS the agent runs this through the **`trim_video_silence`** tool, which
shells out to the bundled `trimmer.py`. You can also run the script directly
from a terminal (see below).

## When to use it

- "Cut the dead air / silences out of this video."
- "Remove the ums and uhs from my recording."
- "Tighten this podcast/voiceover so it's punchier."
- After a Video Studio render, to clean up a talking-head segment.

## What it does (pipeline)

1. Probe the input (video vs. audio) with `ffprobe`.
2. Extract a 16 kHz mono WAV with `ffmpeg` for transcription.
3. Transcribe with **word-level timestamps** (engine below).
4. Mark removals: any filler word, plus any pause longer than the silence
   threshold (default **0.8s**), including trailing silence.
5. Build the complementary **keep** segments, leaving a little **padding**
   around each cut so it doesn't feel abrupt.
6. Slice + concat the keep segments in a single `ffmpeg` `filter_complex` pass
   (re-encode) so audio and video stay in sync.
7. Write the trimmed file. **The input is never overwritten** unless `--output`
   resolves to exactly the same path the user explicitly passed (and even then
   it renders to a temp file first, then moves it into place).

## How to run it manually

```bash
python3 trimmer.py --input /path/to/video.mp4 --output /path/to/video.trimmed.mp4
```

Audio works the same way (`.mp3`, `.wav`, `.m4a`, …) — the output stays
audio-only when the input has no video stream.

### Arguments

| Flag                  | Default          | Meaning |
| --------------------- | ---------------- | ------- |
| `--input`             | (required)       | Path to the input video/audio file. |
| `--output`            | `<input>.trimmed<ext>` next to the input | Path for the trimmed output. |
| `--silence-threshold` | `0.8`            | Pause length in seconds before silence is removed. Raise it to keep more natural pauses; lower it to cut tighter. |
| `--filler-words`      | `um,uh,ah,hmm`   | Comma-separated list of filler words to remove. Override per language/speaker. |
| `--padding`           | `0.05`           | Seconds of audio/video kept around each cut so it isn't abrupt. |
| `--engine`            | `faster-whisper` | Transcription engine: `faster-whisper` (on-device), `openai`, or `elevenlabs`. |

The **last line of stdout is a JSON result** (`success`, `outputPath`,
`originalDurationSec`, `trimmedDurationSec`, `removedSec`, `fillerWordsRemoved`,
`silencesRemoved`, …) so an agent/tool can parse the outcome.

### Tuning silence sensitivity

- Output feels **choppy / clipped**? Increase `--silence-threshold` (e.g. `1.2`)
  and/or `--padding` (e.g. `0.12`).
- Output still feels **slow / baggy**? Decrease `--silence-threshold` (e.g.
  `0.5`).
- Real words getting cut as "fillers"? Trim the `--filler-words` list.

## Installation / dependencies

- **Python 3.9+**
- **ffmpeg + ffprobe** on PATH
  - macOS: `brew install ffmpeg`
  - Windows: `winget install Gyan.FFmpeg` (or `choco install ffmpeg`)
- **A transcription engine:**
  - Default, on-device, no API key: `pip install faster-whisper`
    - Optional env: `WHISPER_MODEL` (default `base`; try `small`/`medium` for
      accuracy), `WHISPER_DEVICE` (`cpu`/`cuda`), `WHISPER_COMPUTE_TYPE`
      (default `int8`).
  - Optional API fallbacks:
    - OpenAI Whisper: `pip install openai`, set `OPENAI_API_KEY`
      (model via `OPENAI_WHISPER_MODEL`, default `whisper-1`).
    - ElevenLabs: `pip install requests`, set `ELEVENLABS_API_KEY`
      (model via `ELEVENLABS_STT_MODEL`, default `scribe_v1`).

## Troubleshooting

- **"`ffmpeg`/`ffprobe` not found"** — install ffmpeg (above) and reopen the
  terminal so PATH refreshes.
- **"faster-whisper is not installed"** — `pip install faster-whisper`, or pass
  `--engine openai` / `--engine elevenlabs` with the matching API key set.
- **"requires OPENAI_API_KEY / ELEVENLABS_API_KEY"** — export the key, or switch
  back to the default `faster-whisper` engine.
- **"Transcription produced no words"** — the file likely has no clear speech;
  silence-only trimming needs speech to anchor timestamps.
- **"Everything was marked for removal"** — the threshold was too aggressive for
  this clip; raise `--silence-threshold`.
- **Inaccurate filler detection** — use a larger `WHISPER_MODEL` (e.g. `small`)
  or a cleaner audio source; customize `--filler-words` for the speaker.
- **Output out of sync** — the script re-encodes in one pass specifically to
  avoid this; if it persists, the source file may have a variable frame rate —
  re-encode it to constant FPS first (`ffmpeg -i in.mp4 -r 30 cfr.mp4`).

## Verification

1. Run on a short test clip with speech + obvious pauses and a few "um"s.
2. Confirm the fillers are gone and pauses longer than the threshold are cut.
3. Confirm the output plays correctly and stays in sync.
4. Confirm the original file is untouched (unless `--output` == input path).
