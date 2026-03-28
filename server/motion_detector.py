import json
import numpy as np
import os
import subprocess
import sys
import tempfile
import threading
import time


DIFF_THRESHOLD = 10
SAMPLE_INTERVAL = 0.3  # seconds between motion score reports
FRAME_WIDTH = 320
FRAME_HEIGHT = 240
FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT  # grayscale = 1 byte per pixel


def compute_motion_score(prev: np.ndarray, curr: np.ndarray) -> float:
    diff = np.abs(curr.astype(np.int16) - prev.astype(np.int16))
    changed = np.count_nonzero(diff > DIFF_THRESHOLD)
    return round((changed / diff.size) * 100.0, 1)


def emit(msg: dict):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def make_sdp(port: int) -> str:
    return (
        "v=0\r\n"
        "o=- 0 0 IN IP4 127.0.0.1\r\n"
        "s=Motion\r\n"
        "c=IN IP4 127.0.0.1\r\n"
        "t=0 0\r\n"
        f"m=video {port} RTP/AVP 96\r\n"
        "a=rtpmap:96 H264/90000\r\n"
        "a=fmtp:96 packetization-mode=1\r\n"
    )


class StreamAnalyzer(threading.Thread):
    def __init__(self, input_id: str, port: int):
        super().__init__(daemon=True)
        self.input_id = input_id
        self.port = port
        self._stop_event = threading.Event()
        self._ffmpeg: subprocess.Popen | None = None

    def stop(self):
        self._stop_event.set()
        if self._ffmpeg:
            try:
                self._ffmpeg.kill()
            except OSError:
                pass

    def run(self):
        sdp_content = make_sdp(self.port)
        sdp_fd, sdp_path = tempfile.mkstemp(suffix=".sdp")
        try:
            with os.fdopen(sdp_fd, "w") as f:
                f.write(sdp_content)

            print(f"[motion] Starting ffmpeg for {self.input_id} on port {self.port}", file=sys.stderr)

            self._ffmpeg = subprocess.Popen(
                [
                    "ffmpeg",
                    "-protocol_whitelist", "file,rtp,udp",
                    "-fflags", "+discardcorrupt+nobuffer",
                    "-flags", "low_delay",
                    "-reorder_queue_size", "0",
                    "-i", sdp_path,
                    "-f", "rawvideo",
                    "-pix_fmt", "gray",
                    "-s", f"{FRAME_WIDTH}x{FRAME_HEIGHT}",
                    "-an",
                    "-v", "error",
                    "pipe:1",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            # Log ffmpeg stderr in background
            def log_stderr():
                assert self._ffmpeg and self._ffmpeg.stderr
                for line in self._ffmpeg.stderr:
                    if self._stop_event.is_set():
                        break
                    print(f"[motion/ffmpeg/{self.input_id}] {line.decode(errors='replace').rstrip()}", file=sys.stderr)

            stderr_thread = threading.Thread(target=log_stderr, daemon=True)
            stderr_thread.start()

            prev_frame: np.ndarray | None = None
            last_report = 0.0

            assert self._ffmpeg.stdout
            while not self._stop_event.is_set():
                raw = self._ffmpeg.stdout.read(FRAME_BYTES)
                if not raw or len(raw) < FRAME_BYTES:
                    if self._stop_event.is_set():
                        break
                    # ffmpeg ended or error
                    print(f"[motion] ffmpeg stream ended for {self.input_id}", file=sys.stderr)
                    break

                curr_frame = np.frombuffer(raw, dtype=np.uint8)

                now = time.time()
                if prev_frame is not None and (now - last_report) >= SAMPLE_INTERVAL:
                    score = compute_motion_score(prev_frame, curr_frame)
                    emit({"type": "score", "inputId": self.input_id, "score": score})
                    last_report = now

                prev_frame = curr_frame

            if self._ffmpeg:
                self._ffmpeg.kill()
                self._ffmpeg.wait()

        finally:
            try:
                os.unlink(sdp_path)
            except OSError:
                pass

        print(f"[motion] Stopped analyzer for {self.input_id}", file=sys.stderr)


def server_mode():
    """Server mode: read JSON commands from stdin, manage multiple stream analyzers."""
    analyzers: dict[str, StreamAnalyzer] = {}

    print("[motion] Server mode started", file=sys.stderr)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        action = cmd.get("action")

        if action == "add":
            input_id = cmd["inputId"]
            port = cmd["port"]
            if input_id in analyzers:
                analyzers[input_id].stop()
            analyzer = StreamAnalyzer(input_id, port)
            analyzers[input_id] = analyzer
            analyzer.start()
            print(f"[motion] Added analyzer for {input_id} on port {port}", file=sys.stderr)

        elif action == "remove":
            input_id = cmd["inputId"]
            if input_id in analyzers:
                analyzers[input_id].stop()
                del analyzers[input_id]
                print(f"[motion] Removed analyzer for {input_id}", file=sys.stderr)

        elif action == "shutdown":
            break

    for a in analyzers.values():
        a.stop()
    print("[motion] Server mode stopped", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--server":
        server_mode()
    else:
        print(f"Usage: python {sys.argv[0]} --server")
        sys.exit(1)
