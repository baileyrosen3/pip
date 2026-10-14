#!/usr/bin/env python3
"""Pip desktop input helper: newline-delimited protocol A/A1 on stdio.

Run this script with Python 3 (or explicitly add `--no-overlay`). Rendering and
face physics belong to Pip's desktop shell, not this process. Coordinates are
logical pixels relative to the selected monitor. The helper owns one uinput
pointer, uses wtype for keyboard input, and polls Hyprland's local IPC socket.
Drag takeover releases immediately without warping against the user's movement.
"""
import argparse
import concurrent.futures
import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import time

# Exit 78 tells the server that retrying immediately cannot fix missing packages.
MISSING_DEPENDENCY_EXIT = 78


def missing_dependency(package):
    print(f"pip-agent: missing {package} (install: omarchy pkg add python-gobject at-spi2-core)",
          file=sys.stderr, flush=True)
    sys.exit(MISSING_DEPENDENCY_EXIT)


if importlib.util.find_spec("gi") is None:
    missing_dependency("python-gobject")
try:
    import gi
    from gi.repository import GLib
except ImportError:
    missing_dependency("python-gobject")
try:
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except (ImportError, ValueError):
    missing_dependency("at-spi2-core")
from desktop import desktop_environment, Hyprland, UInput, FocusTracker, key_command, run_wtype

TAKEOVER_ERROR = "You moved the mouse, so I stopped dragging."
TAKEOVER_THRESHOLD = 96  # logical pixels beyond predicted relative motion


def log(message):
    print("pip-agent: "+str(message), file=sys.stderr, flush=True)


class Agent:
    def __init__(self):
        self.loop = GLib.MainLoop()
        self.hypr = Hyprland(desktop_environment())
        self.monitor_setting = "auto"
        self.monitor = self.choose_monitor()
        self.mouse_global = self.hypr.mouse()
        self.last_mouse_event = None
        self.last_mouse_emit = 0.
        self.pending = {}
        self.drag = None
        self.last_external_error = None
        self.input_busy = False
        self.capture_busy = False
        self.closing = False
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="pip-input")
        self.uinput = None
        self.input_error = None
        try:
            self.uinput = UInput()
        except Exception as e:
            self.input_error = str(e)
            log("Pointer injection unavailable: "+str(e))
        self.focus = FocusTracker(self.hypr, log)
        self.buffer = bytearray()
        os.set_blocking(sys.stdin.fileno(), False)
        self.stdin_watch = GLib.io_add_watch(sys.stdin.fileno(), GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR, self.read_stdin)
        GLib.timeout_add(17, self.tick)
        GLib.idle_add(self.announce_ready)

    def announce_ready(self):
        self.emit(dict(ev="ready", monitor=self.monitor))
        return False

    def emit(self, data):
        try:
            sys.stdout.write(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)+"\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            self.shutdown()

    @staticmethod
    def request_key(request):
        return json.dumps(request["id"], separators=(",", ":"))

    def reply(self, request, error=None, **data):
        if "id" not in request:
            if error:
                log(error)
            return
        key = self.request_key(request)
        if key not in self.pending:
            return
        del self.pending[key]
        result = dict(id=request["id"], ok=error is None)
        if error is None:
            result.update(data)
        else:
            result["error"] = str(error)
        self.emit(result)

    def choose_monitor(self):
        candidates = [m for m in self.hypr.monitors() if not m.get("disabled")]
        if self.monitor_setting == "auto":
            raw = next((m for m in candidates if m.get("focused")), candidates[0] if candidates else None)
        else:
            raw = next((m for m in candidates if m["name"] == self.monitor_setting), None)
        if raw is None:
            raise ValueError("Monitor is not connected: "+str(self.monitor_setting))
        width, height = raw["width"], raw["height"]
        if raw.get("transform", 0) % 2:
            width, height = height, width
        return dict(name=raw["name"], x=raw["x"], y=raw["y"], width=width/raw["scale"], height=height/raw["scale"], scale=raw["scale"])

    def refresh_monitor(self):
        if self.drag or self.input_busy or self.capture_busy:
            raise RuntimeError("Cannot retarget during input or capture")
        monitor = self.choose_monitor()
        if monitor != self.monitor:
            self.monitor = monitor
            self.last_mouse_event = None
            self.emit(dict(ev="monitor", monitor=monitor))

    def tick(self):
        if self.closing:
            return False
        now = time.monotonic()
        try:
            self.mouse_global = self.hypr.mouse()
        except Exception as e:
            if now-getattr(self, "last_mouse_error", 0) > 5:
                log(e)
                self.last_mouse_error = now
        x, y = self.mouse_global[0]-self.monitor["x"], self.mouse_global[1]-self.monitor["y"]
        state = (x, y, 0 <= x < self.monitor["width"] and 0 <= y < self.monitor["height"])
        if state != self.last_mouse_event and now-self.last_mouse_emit >= 1/60:
            self.last_mouse_event = state
            self.last_mouse_emit = now
            self.emit(dict(ev="mouse", x=x, y=y, onMonitor=state[2]))
        if self.drag:
            self.advance_drag(now)
        return True

    def read_stdin(self, fd, condition):
        try:
            while True:
                data = os.read(fd, 65536)
                if not data:
                    self.shutdown()
                    return False
                self.buffer.extend(data)
                while b"\n" in self.buffer:
                    line, _, rest = self.buffer.partition(b"\n")
                    self.buffer = bytearray(rest)
                    if not line.strip():
                        continue
                    try:
                        request = json.loads(line)
                        if not isinstance(request, dict):
                            raise ValueError("Request must be an object")
                        if "id" in request:
                            self.pending[self.request_key(request)] = request
                        try:
                            self.handle(request)
                        except Exception as e:
                            self.reply(request, error=str(e))
                    except Exception as e:
                        log("Invalid protocol line: "+str(e))
                    if self.closing:
                        return False
        except BlockingIOError:
            return not self.closing
        except OSError as e:
            log(e)
            self.shutdown()
            return False

    @staticmethod
    def finite_point(point):
        if len(point) != 2 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in point):
            raise ValueError("Pointer coordinates must be two finite numbers")
        return tuple(point)

    def global_point(self, point):
        return self.monitor["x"]+point[0], self.monitor["y"]+point[1]

    def input_device(self):
        if self.uinput is None:
            raise RuntimeError("Cannot open /dev/uinput: "+str(self.input_error))
        return self.uinput

    def work(self, request, operation, on_done=None, input_job=False):
        if input_job:
            if self.input_busy:
                raise RuntimeError("Another input operation is in progress")
            self.input_busy = True
        future = self.executor.submit(operation)
        def finished(f):
            def deliver():
                if input_job:
                    self.input_busy = False
                try:
                    result = f.result() or {}
                    if on_done:
                        on_done()
                    self.reply(request, **result)
                except Exception as e:
                    if on_done:
                        on_done()
                    self.reply(request, error=str(e))
                return False
            GLib.idle_add(deliver)
        future.add_done_callback(finished)

    def handle(self, r):
        op = r.get("op")
        if op == "settings":
            if "monitor" in r and r["monitor"] != self.monitor_setting:
                old = self.monitor_setting
                self.monitor_setting = r["monitor"]
                try:
                    self.refresh_monitor()
                except Exception:
                    self.monitor_setting = old
                    raise
        elif op == "mouse":
            x, y = self.hypr.mouse()
            x, y = x-self.monitor["x"], y-self.monitor["y"]
            self.reply(r, x=x, y=y, onMonitor=0 <= x < self.monitor["width"] and 0 <= y < self.monitor["height"])
            return
        elif op == "monitor":
            self.reply(r, **self.monitor)
            return
        elif op == "refreshMonitor":
            if self.monitor_setting == "auto":
                self.refresh_monitor()
        elif op == "capture":
            self.capture(r)
            return
        elif op == "dragBegin":
            self.start_drag(r, external=True)
            return
        elif op == "dragEnd" and "id" not in r and "x" not in r and "y" not in r:
            if self.drag:
                self.finish_drag("Drag stopped")
            self.last_external_error = None
        elif op in ("dragMove", "dragEnd"):
            if not self.drag and self.last_external_error:
                if op == "dragEnd":
                    error, self.last_external_error = self.last_external_error, None
                    self.reply(r, error=error)
                elif "id" in r:
                    self.reply(r, error=self.last_external_error)
                return
            if not self.drag or not self.drag["external"]:
                raise RuntimeError("No external drag is active")
            point = self.finite_point((r["x"], r["y"]))
            if self.drag.get("end_request"):
                if op == "dragEnd":
                    raise RuntimeError("The external drag is already ending")
                return
            self.drag["target"] = point
            if op == "dragEnd":
                self.drag["end_request"] = r
                self.drag["settle_deadline"] = time.monotonic()+1.2
                if self.drag["phase"] != "press_wait":
                    self.drag["phase"] = "ending"
                return
        elif op == "drag":
            self.start_drag(r, external=False)
            return
        elif op == "dragging":
            if not r["on"] and self.drag:
                self.finish_drag("Drag stopped")
        elif op in ("click", "scroll"):
            device = self.input_device()
            point = self.global_point(self.finite_point((r["x"], r["y"])))
            def operate():
                saved = self.hypr.mouse()
                try:
                    self.hypr.warp(point)
                    time.sleep(.04)
                    if op == "click":
                        for _ in range(2 if r.get("count", 1) == 2 else 1):
                            self.hypr.warp(point)
                            device.button(r.get("right", False), True)
                            time.sleep(.045)
                            device.button(r.get("right", False), False)
                            time.sleep(.06)
                    else:
                        self.hypr.warp(point)
                        device.wheel(r.get("dx", 0), r.get("dy", 0))
                        # libinput's wheel plugin defers accumulated wheel frames.
                        time.sleep(.3)
                finally:
                    for key in tuple(device.held):
                        device.button(key == device.BTN_RIGHT, False)
                    self.hypr.warp(saved)
            self.work(r, operate, input_job=True)
            return
        elif op == "type":
            text = r["text"]
            def type_text():
                # Explicit Return events retain leading/trailing newlines.
                lines = text.split("\n")
                for index, line in enumerate(lines):
                    for offset in range(0, len(line), 1024):
                        run_wtype(["wtype", "--", line[offset:offset+1024]])
                    if index < len(lines)-1:
                        run_wtype(["wtype", "-k", "Return"])
                return {}
            self.work(r, type_text, input_job=True)
            return
        elif op == "keys":
            args, label = key_command(r["keys"])
            self.work(r, lambda: (run_wtype(args), {"label": label})[1], input_job=True)
            return
        elif op == "focused":
            monitor = self.monitor.copy()
            def focused():
                try:
                    return self.focus.query(monitor)
                except Exception as e:
                    log("AT-SPI query: "+str(e))
                    return dict(secure=False, rect=None)
            self.work(r, focused)
            return
        elif op == "quit":
            self.reply(r)
            self.shutdown()
            return
        else:
            raise ValueError("Unknown op: "+str(op))
        self.reply(r)

    def start_drag(self, r, external):
        self.input_device()
        if self.input_busy or self.drag:
            raise RuntimeError("Another input operation is in progress")
        origin = self.finite_point((r["x"], r["y"]) if external else r["from"])
        target = origin if external else self.finite_point(r["to"])
        saved = self.hypr.mouse()
        self.input_busy = True
        if external:
            self.last_external_error = None
        self.drag = dict(request=r, external=external, phase="press_wait", saved=saved, origin=origin, target=target, wait=time.monotonic()+.05)
        try:
            self.hypr.warp(self.global_point(origin))
            self.drag["expected_mouse"] = self.global_point(origin)
        except Exception as e:
            self.finish_drag(str(e))

    def relative_toward(self, point):
        desired = self.global_point(point)
        actual = self.hypr.mouse()
        drag = self.drag
        expected = drag.get("expected_mouse")
        if expected is not None and math.dist(actual, expected) > TAKEOVER_THRESHOLD:
            drag["taken_over"] = True
            raise RuntimeError(TAKEOVER_ERROR)
        gain = drag.get("motion_gain", 2.)
        previous, last_step = drag.get("last_actual"), drag.get("last_step")
        if previous is not None and last_step and any(last_step):
            movement = tuple(actual[j]-previous[j] for j in (0, 1))
            squared = sum(value*value for value in last_step)
            measured = sum(movement[j]*last_step[j] for j in (0, 1))/squared
            if .25 <= measured <= 6:
                gain += (measured-gain)*.2
        delta = tuple(desired[j]-actual[j] for j in (0, 1))
        step = tuple(int(math.copysign(min(32, max(1, round(abs(value)*.25))), value)) if abs(value) > 1 else 0 for value in delta)
        if any(step):
            self.uinput.relative(*step)
        drag["motion_gain"] = gain
        drag["last_actual"], drag["last_step"] = actual, step
        drag["expected_mouse"] = tuple(actual[j]+step[j]*gain for j in (0, 1))
        return math.dist(actual, desired)

    def advance_drag(self, now):
        drag = self.drag
        try:
            if drag["phase"] == "press_wait":
                if now < drag["wait"]:
                    return
                if math.dist(self.hypr.mouse(), self.global_point(drag["origin"])) > TAKEOVER_THRESHOLD:
                    drag["taken_over"] = True
                    raise RuntimeError(TAKEOVER_ERROR)
                self.hypr.warp(self.global_point(drag["origin"]))
                drag["expected_mouse"] = self.global_point(drag["origin"])
                self.uinput.button(False, True)
                if drag["external"]:
                    drag["phase"] = "ending" if drag.get("end_request") else "active"
                    self.reply(drag["request"])
                else:
                    distance = math.dist(drag["origin"], drag["target"])
                    drag["start"] = now
                    drag["duration"] = min(1.6, max(.6, (.4+.12*math.log2(1+distance/24))*1.45))
                    drag["phase"] = "moving"
                return
            if drag["external"]:
                point = drag["target"]
                arrived = drag["phase"] == "ending"
            else:
                p = min(1, (now-drag["start"])/drag["duration"])
                ease = p*p*(3-2*p)
                point = tuple(drag["origin"][j]+(drag["target"][j]-drag["origin"][j])*ease for j in (0, 1))
                arrived = p >= 1
            distance = self.relative_toward(point)
            if arrived:
                drag.setdefault("settle_deadline", now+1.2)
                if distance <= 2:
                    if "release_at" not in drag:
                        drag["release_at"] = now+.06
                    elif now >= drag["release_at"]:
                        self.finish_drag()
                elif now > drag["settle_deadline"]:
                    self.finish_drag("The pointer could not reach the drag target")
        except Exception as e:
            self.finish_drag(str(e))

    def finish_drag(self, error=None):
        drag, self.drag = self.drag, None
        try:
            self.uinput.button(False, False)
            if not drag.get("taken_over"):
                self.hypr.warp(drag["saved"])
        except Exception as e:
            error = error or str(e)
        self.input_busy = False
        if drag["external"] and drag.get("taken_over"):
            self.last_external_error = TAKEOVER_ERROR
        self.reply(drag.get("end_request", drag["request"]), error=error)

    def capture(self, r):
        if self.capture_busy:
            raise RuntimeError("Another capture is in progress")
        self.capture_busy = True
        monitor = self.monitor.copy()
        def restore():
            self.capture_busy = False
        def grab():
            path = str(Path(r["path"]).expanduser().resolve())
            result = subprocess.run(["grim", "-o", monitor["name"], path], capture_output=True, text=True, timeout=15)
            if result.returncode:
                raise RuntimeError(result.stderr.strip() or "grim failed")
            with open(path, "rb") as png:
                header = png.read(24)
            if header[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("grim did not produce PNG")
            width, height = struct.unpack(">II", header[16:24])
            return dict(path=path, width=width, height=height, scale=monitor["scale"])
        self.work(r, grab, on_done=restore)

    def shutdown(self):
        if self.closing:
            return
        self.closing = True
        if self.drag:
            self.finish_drag("Agent is shutting down")
        for request in tuple(self.pending.values()):
            self.reply(request, error="Agent is shutting down")
        self.executor.shutdown(wait=True, cancel_futures=True)
        if self.uinput:
            self.uinput.close()
        self.focus.close()
        self.loop.quit()

    def run(self):
        try:
            self.loop.run()
        finally:
            self.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pip's headless Hyprland input/capture helper")
    parser.add_argument("--no-overlay", action="store_true", help="run without rendering (the default)")
    parser.parse_args()
    try:
        Agent().run()
    except Exception as error:
        log(error)
        sys.exit(1)
