"""Hyprland IPC, one uinput device, wtype, and best-effort accessibility."""
import fcntl
import json
import math
import os
from pathlib import Path
import socket
import struct
import subprocess
import time


def desktop_environment():
    runtime = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    os.environ.setdefault("XDG_RUNTIME_DIR", str(runtime))
    if not os.environ.get("WAYLAND_DISPLAY"):
        sockets = sorted(p for p in runtime.glob("wayland-*") if p.is_socket())
        if sockets:
            os.environ["WAYLAND_DISPLAY"] = sockets[0].name
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS") and (runtime/"bus").exists():
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = "unix:path="+str(runtime/"bus")
    return runtime


class Hyprland:
    def __init__(self, runtime):
        signature = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
        paths = sorted((runtime/"hypr").glob("*/.socket.sock"), key=lambda p: p.stat().st_mtime, reverse=True)
        if signature:
            preferred = runtime/"hypr"/signature/".socket.sock"
            paths = [preferred]+[path for path in paths if path != preferred]
        for path in paths:
            try:
                self.path = str(path)
                self.request("j/monitors")
                os.environ["HYPRLAND_INSTANCE_SIGNATURE"] = path.parent.name
                return
            except OSError:
                continue
        raise RuntimeError("No active Hyprland IPC socket")

    def request(self, command):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(.25)
            sock.connect(self.path)
            sock.sendall(command.encode())
            chunks = []
            while True:
                part = sock.recv(65536)
                if not part:
                    break
                chunks.append(part)
        result = b"".join(chunks).decode()
        return json.loads(result) if command.startswith("j/") else result

    def monitors(self):
        return self.request("j/monitors")

    def mouse(self):
        p = self.request("j/cursorpos")
        return p["x"], p["y"]

    def warp(self, point):
        # Hyprland 0.56 Lua-config IPC wraps this expression in hl.dispatch().
        # Verified against upstream v0.56.2 LuaBindingsDispatchers.cpp.
        if len(point) != 2 or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in point):
            raise ValueError("Pointer coordinates must be two finite numbers")
        x, y = round(point[0]), round(point[1])
        result = self.request(f"dispatch hl.dsp.cursor.move({{x={x}, y={y}}})")
        if result.strip() != "ok":
            raise RuntimeError("Hyprland pointer warp failed: "+result.strip())


class UInput:
    EV_SYN, EV_KEY, EV_REL = 0, 1, 2
    BTN_LEFT, BTN_RIGHT, BTN_MIDDLE = 272, 273, 274
    REL_X, REL_Y, REL_HWHEEL, REL_WHEEL = 0, 1, 6, 8

    def __init__(self):
        self.fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        self.held = set()
        try:
            for event in (self.EV_SYN, self.EV_KEY, self.EV_REL):
                fcntl.ioctl(self.fd, 0x40045564, event)  # UI_SET_EVBIT
            for key in (self.BTN_LEFT, self.BTN_RIGHT, self.BTN_MIDDLE):
                fcntl.ioctl(self.fd, 0x40045565, key)
            for rel in (self.REL_X, self.REL_Y, self.REL_WHEEL, self.REL_HWHEEL):
                fcntl.ioctl(self.fd, 0x40045566, rel)
            setup = struct.pack("HHHH80sI", 3, 0x1209, 0xB1E0, 1, b"Pip virtual pointer", 0)
            fcntl.ioctl(self.fd, 0x405C5503, setup)  # UI_DEV_SETUP
            fcntl.ioctl(self.fd, 0x5501)  # UI_DEV_CREATE
            time.sleep(.3)  # libinput must discover the device before its first event.
        except Exception:
            os.close(self.fd)
            self.fd = None
            raise

    def event(self, kind, code, value):
        os.write(self.fd, struct.pack("llHHi", 0, 0, kind, code, int(value)))

    def sync(self):
        self.event(self.EV_SYN, 0, 0)

    def button(self, right, down):
        code = self.BTN_RIGHT if right else self.BTN_LEFT
        self.event(self.EV_KEY, code, bool(down))
        self.sync()
        if down:
            self.held.add(code)
        else:
            self.held.discard(code)

    def wheel(self, dx, dy):
        if dx:
            self.event(self.EV_REL, self.REL_HWHEEL, round(dx))
        if dy:
            self.event(self.EV_REL, self.REL_WHEEL, -round(dy))
        self.sync()

    def relative(self, dx, dy):
        if round(dx):
            self.event(self.EV_REL, self.REL_X, round(dx))
        if round(dy):
            self.event(self.EV_REL, self.REL_Y, round(dy))
        self.sync()

    def close(self):
        if self.fd is not None:
            for key in self.held:
                self.event(self.EV_KEY, key, 0)
            self.sync()
            fcntl.ioctl(self.fd, 0x5502)
            os.close(self.fd)
            self.fd = None


KEYS = {"return": "Return", "enter": "Return", "escape": "Escape", "esc": "Escape", "tab": "Tab", "space": "space", "backspace": "BackSpace", "delete": "Delete", "up": "Up", "down": "Down", "left": "Left", "right": "Right", "home": "Home", "end": "End", "pageup": "Prior", "pagedown": "Next"}
KEYS.update({f"f{i}": f"F{i}" for i in range(1, 13)})
MODIFIERS = {"ctrl": "ctrl", "control": "ctrl", "alt": "alt", "option": "alt", "shift": "shift", "super": "super", "meta": "super", "cmd": "super", "command": "super"}


def key_command(combo):
    parts = [p.strip().lower() for p in combo.split("+")]
    if not parts or any(not p for p in parts):
        raise ValueError("Empty key combination")
    mods = []
    for part in parts[:-1]:
        if part not in MODIFIERS:
            raise ValueError("Unknown modifier: "+part)
        mod = MODIFIERS[part]
        if mod not in mods:
            mods.append(mod)
    key = parts[-1]
    if key in MODIFIERS:
        mod = MODIFIERS[key]
        args = ["wtype", "-M", mod, "-m", mod]
        return args, mod.title()
    mapped = KEYS.get(key)
    if mapped is None:
        if len(key) == 1 and key.isprintable():
            mapped = key
        else:
            raise ValueError("Unknown key: "+key)
    args = ["wtype"]
    for mod in mods:
        args += ["-M", mod]
    args += ["-P", mapped, "-p", mapped]
    for mod in reversed(mods):
        args += ["-m", mod]
    names = dict(ctrl="Ctrl", alt="Alt", shift="Shift", super="Super")
    label = "+".join([names[m] for m in mods]+["Enter" if mapped == "Return" else key.upper() if len(key) == 1 or key.startswith("f") and key[1:].isdigit() else key.title()])
    return args, label


def run_wtype(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "wtype failed")


class FocusTracker:
    def __init__(self, hyprland, log):
        self.hyprland = hyprland
        self.atspi = None
        self.focus = None
        self.listener = None
        try:
            import gi
            gi.require_version("Atspi", "2.0")
            from gi.repository import Atspi
            self.atspi = Atspi
            Atspi.init()
            self.listener = Atspi.EventListener.new(self.changed, None)
            self.listener.register("object:state-changed:focused")
        except Exception as e:
            log("AT-SPI focus tracking unavailable: "+str(e))

    def changed(self, event, *args):
        if event.detail1:
            self.focus = event.source
        elif self.focus == event.source:
            self.focus = None

    def query(self, monitor):
        result = dict(secure=False, rect=None)
        if self.atspi is None:
            return result
        accessible = self.focus
        if accessible is None:
            # Existing focus may precede the listener; scan a bounded accessibility tree.
            pending = [self.atspi.get_desktop(0)]
            visited = 0
            while pending and visited < 500:
                node = pending.pop()
                visited += 1
                if node.get_state_set().contains(self.atspi.StateType.FOCUSED):
                    accessible = node
                    break
                count = min(node.get_child_count(), 80)
                for index in range(count):
                    child = node.get_child_at_index(index)
                    if child is not None:
                        pending.append(child)
        if accessible is None:
            return result
        result["secure"] = accessible.get_role() == self.atspi.Role.PASSWORD_TEXT
        component = accessible.get_component_iface()
        if component:
            # Wayland applications commonly report SCREEN extents as (0, 0).
            # Translate WINDOW coordinates only when this accessible really
            # belongs to Hyprland's active toplevel; layer-shells have no such
            # toplevel and correctly return a null rectangle.
            window = self.hyprland.request("j/activewindow")
            position = window.get("at")
            if position and window.get("pid") == accessible.get_process_id():
                rect = component.get_extents(self.atspi.CoordType.WINDOW)
                if rect.width > 0 and rect.height > 0 and abs(rect.x) < 100000 and abs(rect.y) < 100000:
                    result["rect"] = [rect.x+position[0]-monitor["x"], rect.y+position[1]-monitor["y"], rect.width, rect.height]
        return result

    def close(self):
        if self.listener:
            self.listener.deregister("object:state-changed:focused")
