# -*- coding: utf-8 -*-
"""
Speech server for the Read Aloud plugin, run inside calibre's Python
(calibre-debug -e piper_server.py), which has Piper built in since calibre
8.8, on Windows, macOS and Linux alike.

It keeps the voice loaded, so a paragraph only costs its synthesis time
(about a quarter of its spoken length), not the seconds of loading the model.

Requests arrive on stdin, one JSON object per line:
    {"cmd": "voice", "model": "/path/voice.onnx", "speed": 1.0}
    {"cmd": "speak", "id": 7, "text": "..."}
    {"cmd": "cancel"}                   drop everything queued or being spoken
    {"cmd": "catalog", "dir": "..."}    the voices calibre knows, and which
                                        of them are in `dir` (default: calibre's)
    {"cmd": "download", "key": "hu_HU-anna-medium", "dir": "..."}

Everything goes back on stdout as one JSON header line followed by exactly
"bytes" bytes of payload, which is only ever 16-bit mono PCM of a sentence:
    {"id": 7, "rate": 22050, "bytes": 51200, "last": false}\n<pcm>
The other messages have no payload: {"ready": ...}, {"voice": ...},
{"catalog": [...]}, {"download": key, ...} and {"error": ..., "id"?: ...}.
"""

import json
import os
import queue
import re
import sys
import threading

# About this share of Piper's speech does not follow its length scale, so
# the length scale is stretched to make the whole come out at the asked speed.
FIXED_SHARE = 0.3
SENTENCE_PAUSE = 0.25
QUALITIES = ("x_low", "low", "medium", "high")

out = sys.stdout.buffer
out_lock = threading.Lock()
requests = queue.Queue()
generation = 0          # bumped by every cancel; older speak requests are dropped


def send(header, pcm=b""):
    header["bytes"] = len(pcm)
    with out_lock:
        out.write(json.dumps(header).encode("utf-8") + b"\n")
        out.write(pcm)
        out.flush()


def read_stdin():
    global generation
    for line in sys.stdin.buffer:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        cmd = req.get("cmd")
        if cmd == "cancel":
            generation += 1
        elif cmd == "catalog":
            send_catalog(req.get("dir"))
            continue
        elif cmd == "download":
            threading.Thread(target=download, args=(req["key"], req.get("dir")),
                             daemon=True).start()
            continue
        req["generation"] = generation
        requests.put(req)
    requests.put(None)  # Obsidian went away


def length_multiplier(speed):
    scale = (1 / speed - FIXED_SHARE) / (1 - FIXED_SHARE)
    return max(-1.0, min(0.9, 1 - scale))


# ------------------------------------------------------------------ voices

def default_voices_dir():
    try:
        from calibre.gui2.tts.piper import piper_cache_dir
        return piper_cache_dir()
    except Exception:
        from calibre.constants import cache_dir
        return os.path.join(cache_dir(), "piper-voices")


def known_voices():
    """{key: {lang, name, quality, model_url, config_url}} from calibre's list."""
    from calibre.utils.resources import get_path
    with open(get_path("piper-voices.json"), "rb") as f:
        lang_map = json.load(f)["lang_map"]
    voices = {}
    for lang, names in lang_map.items():
        for name, qualities in names.items():
            for quality, urls in qualities.items():
                key = "%s-%s-%s" % (lang, name, quality)
                voices[key] = {"lang": lang, "name": name, "quality": quality,
                               "model_url": urls["model"],
                               "config_url": urls["config"]}
    return voices


def send_catalog(folder):
    folder = folder or default_voices_dir()
    try:
        voices = known_voices()
    except Exception as e:
        voices = {}
        send({"error": "Could not read calibre's list of voices: %s" % e})
    try:
        files = set(os.listdir(folder))
    except OSError:
        files = set()
    catalog = []
    for key, v in voices.items():
        catalog.append({"key": key, "lang": v["lang"], "name": v["name"],
                        "quality": v["quality"],
                        "installed": key + ".onnx" in files
                        and key + ".onnx.json" in files})
    # Voices put in the folder by hand, from anywhere.
    for f in sorted(files):
        key = f[:-5]
        if f.endswith(".onnx") and key not in voices and key + ".onnx.json" in files:
            m = re.match(r"^([a-z]{2,3}_[A-Z]{2})-(.+?)(?:-(%s))?$"
                         % "|".join(QUALITIES), key)
            catalog.append({"key": key, "lang": m.group(1) if m else "",
                            "name": m.group(2) if m else key,
                            "quality": (m.group(3) or "") if m else "",
                            "installed": True})
    send({"catalog": catalog, "dir": folder})


def open_url(url):
    try:
        # calibre's browser brings its own certificates on every platform.
        from calibre import browser
        return browser().open(url, timeout=60)
    except ImportError:
        import urllib.request
        return urllib.request.urlopen(url, timeout=60)


def fetch(url, path, report):
    part = path + ".part"
    r = open_url(url)
    try:
        total = int(r.info().get("Content-Length") or 0)
        done = 0
        with open(part, "wb") as f:
            while True:
                data = r.read(256 * 1024)
                if not data:
                    break
                f.write(data)
                done += len(data)
                report(done, total)
    finally:
        r.close()
    os.replace(part, path)


def download(key, folder):
    folder = folder or default_voices_dir()
    try:
        voice = known_voices().get(key)
        if not voice:
            raise ValueError("calibre does not know the voice %s" % key)
        os.makedirs(folder, exist_ok=True)
        model = os.path.join(folder, key + ".onnx")
        fetch(voice["config_url"], model + ".json", lambda d, t: None)
        last = [-1]

        def report(done, total):
            percent = int(100 * done / total) if total else 0
            if percent != last[0]:
                last[0] = percent
                send({"download": key, "done": done, "total": total})
        fetch(voice["model_url"], model, report)
        send({"download": key, "finished": True})
    except Exception as e:
        send({"download": key, "error": str(e)})


# ------------------------------------------------------------------ speech

def main():
    try:
        from calibre.utils.tts import piper
        import calibre_extensions.piper as engine
    except ImportError:
        from calibre.constants import __version__
        send({"error": "calibre %s has no built-in Piper; Read Aloud needs "
                       "calibre 8.8 or newer." % __version__, "fatal": True})
        return
    from calibre.constants import __version__

    engine.initialize(piper.espeak_data_dir())
    threading.Thread(target=read_stdin, daemon=True).start()
    send({"ready": True, "calibre": __version__,
          "voicesDir": default_voices_dir()})

    loaded = None
    while True:
        req = requests.get()
        if req is None:
            return
        cmd = req.get("cmd")
        if cmd == "voice":
            wanted = (req["model"], float(req.get("speed", 1.0)))
            if wanted == loaded:
                continue
            try:
                speed = max(0.5, min(3.0, wanted[1]))
                piper.set_voice(wanted[0] + ".json", wanted[0],
                                length_multiplier(speed),
                                SENTENCE_PAUSE / speed)
                loaded = wanted
                send({"voice": os.path.basename(wanted[0])})
            except Exception as e:
                loaded = None
                send({"error": "Could not load the voice %s: %s"
                      % (wanted[0], e), "voiceFailed": True})
        elif cmd == "speak":
            speak(engine, req, loaded)


def speak(engine, req, loaded):
    rid = req["id"]
    if req["generation"] != generation:
        return
    if loaded is None:
        send({"id": rid, "error": "No voice is loaded."})
        return
    try:
        engine.start(req["text"])
        while True:
            data, _, rate, last = engine.next(True)
            if req["generation"] != generation:
                # Cancelled: finish the utterance quietly so the engine is
                # ready for the next one, but send nothing more.
                while not last:
                    _, _, _, last = engine.next(True)
                return
            send({"id": rid, "rate": rate, "last": bool(last)}, data)
            if last:
                return
    except Exception as e:
        send({"id": rid, "error": str(e)})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
