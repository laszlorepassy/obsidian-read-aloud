# -*- coding: utf-8 -*-
"""
Speech server for the Read Aloud plugin, run inside calibre's Python
(calibre-debug -e piper_server.py), which has Piper built in.

It keeps the voice loaded, so a paragraph only costs its synthesis time
(about a quarter of its spoken length), not the ~5 s of loading the model.

Requests arrive on stdin, one JSON object per line:
    {"cmd": "voice", "model": "/path/voice.onnx", "speed": 1.0}
    {"cmd": "speak", "id": 7, "text": "..."}
    {"cmd": "cancel"}          drop everything queued or being spoken

Audio goes to stdout, sentence by sentence, each chunk as one JSON header
line followed by exactly "bytes" bytes of 16-bit mono PCM:
    {"id": 7, "rate": 22050, "bytes": 51200, "last": false}\n<pcm>
Errors are reported the same way, with "error" and no PCM.
"""

import json
import os
import queue
import sys
import threading

# About this share of Piper's speech does not follow its length scale, so
# the length scale is stretched to make the whole come out at the asked speed.
FIXED_SHARE = 0.3
SENTENCE_PAUSE = 0.25

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
        if req.get("cmd") == "cancel":
            generation += 1
        req["generation"] = generation
        requests.put(req)
    requests.put(None)  # Obsidian went away


def length_multiplier(speed):
    scale = (1 / speed - FIXED_SHARE) / (1 - FIXED_SHARE)
    return max(-1.0, min(0.9, 1 - scale))


def main():
    from calibre.utils.tts import piper
    import calibre_extensions.piper as engine

    engine.initialize(piper.espeak_data_dir())
    threading.Thread(target=read_stdin, daemon=True).start()
    send({"ready": True})

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
                      % (wanted[0], e)})
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
