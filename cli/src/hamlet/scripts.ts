export const doorbellSdk = String.raw`"""Persistent state, authenticated ring, and simple polling for doorbell scripts."""
import atexit
import contextlib
import json
import os
from pathlib import Path
import tempfile
import time
import urllib.request


def ring(*, prompt=None, vars=None, dedup_key=None):
    payload = {k: v for k, v in {"prompt": prompt, "vars": vars, "dedup_key": dedup_key}.items() if v is not None}
    request = urllib.request.Request(os.environ["DOORBELL_URL"],
        json.dumps(payload).encode(), method="POST", headers={
        "Authorization": "Bearer " + os.environ["DOORBELL_TOKEN"],
        "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


class State:
    @contextlib.contextmanager
    def _locked(self):
        root = Path(os.environ["DOORBELL_STATE_DIR"])
        root.mkdir(parents=True, exist_ok=True)
        with (root / "state.lock").open("a+b") as lock:
            if os.name == "nt":
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX)
            path = root / "state.json"
            data = json.loads(path.read_text()) if path.exists() else {}
            yield root, path, data

    def get(self, key, default=None):
        with self._locked() as (_, _, data):
            return data.get(key, default)

    def set(self, key, value):
        with self._locked() as (root, path, data):
            data[key] = value
            fd, temporary = tempfile.mkstemp(dir=root)
            try:
                with os.fdopen(fd, "w") as stream:
                    json.dump(data, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


state = State()
_jobs = []
_registered = False


def _poll():
    try:
        while _jobs:
            now = time.monotonic()
            for job in _jobs:
                if now >= job[2]:
                    job[0]()  # Fail visibly: daemon supervises and backs off on errors.
                    job[2] = time.monotonic() + job[1]
            time.sleep(max(0.01, min(job[2] for job in _jobs) - time.monotonic()))
    except KeyboardInterrupt:
        pass


def every(*, seconds):
    if seconds <= 0:
        raise ValueError("seconds must be positive")
    def decorate(function):
        global _registered
        _jobs.append([function, seconds, 0])
        if not _registered:
            atexit.register(_poll)
            _registered = True
        return function
    return decorate
`

export const supervisor = String.raw`import os, signal, subprocess, sys, threading
with open(sys.argv[2], 'ab', buffering=0) as log:
    command = [sys.argv[1]]
    if os.name == 'nt':
        # On Windows scripts supplied to a doorbell use the Python interpreter.
        command.insert(0, sys.executable)
    proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=os.name != 'nt')
    def stop_on_disconnect():
        sys.stdin.buffer.read()
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], stdout=log, stderr=log)
                return
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    threading.Thread(target=stop_on_disconnect, daemon=True).start()
    sys.exit(proc.wait())
`
