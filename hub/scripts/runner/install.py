#!/usr/bin/env python3
"""Install the Hub's matching Hamlet Runner and verify that this machine is online."""
import argparse
import filecmp
import getpass
import gzip
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


http = build_opener(NoRedirect)


def api(url, payload=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = None if payload is None else json.dumps(payload).encode()
    with http.open(Request(url, data, headers), timeout=10) as response:
        return json.load(response)


def tunnel(peer, port):
    if not re.fullmatch(r'[\w.][\w.@-]*', peer) or not 1 <= port <= 65535:
        raise ValueError('Invalid SSH destination or local port')
    sshdir = Path.home() / '.ssh'
    sshdir.mkdir(mode=0o700, exist_ok=True)
    ssh = ['ssh', '-S', str(sshdir / ('hamlet-13007-' + str(port) + '-%C'))]
    if subprocess.run(ssh + ['-O', 'check', peer], stderr=subprocess.DEVNULL).returncode:
        subprocess.run(ssh + ['-fNM', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
                              '-L', f'127.0.0.1:{port}:127.0.0.1:13007', peer], check=True)
    return ssh


def online(url, jwt, settings):
    machine = json.loads(settings.read_text()).get('machineId') if settings.exists() else None
    if machine:
        for entry in api(url + '/api/machines', token=jwt)['machines']:
            if entry['id'] == machine and entry['active'] and 'hamlet' in entry['metadata']['capabilities']:
                return machine
    return None


def link_commands(launcher, names):
    bindir = Path.home() / '.local/bin'
    bindir.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name in names:
        link = bindir / name
        if link.exists() or link.is_symlink():
            continue
        if name == 'hamlet' and shutil.which(name):
            continue
        link.symlink_to(launcher)


def install():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--hub', help='HTTPS Hub URL or local tunnel URL')
    source.add_argument('--ssh', help='SSH login for the Hamlet Hub host')
    parser.add_argument('--allow-http', '--lan-http', dest='allow_http', action='store_true', help='Allow cleartext HTTP for this Hub')
    parser.add_argument('--local-port', type=int, default=13006)
    args = parser.parse_args()
    ssh = tunnel(args.ssh, args.local_port) if args.ssh else None
    url = (args.hub or f'http://127.0.0.1:{args.local_port}').rstrip('/')
    origin = urlsplit(url)
    if not (origin.scheme == 'https' or (origin.scheme == 'http' and (args.allow_http or origin.hostname in ('localhost', '127.0.0.1', '::1')))) or not origin.hostname or origin.username or origin.path or origin.query or origin.fragment:
        raise ValueError('Use an HTTPS Hub origin or a loopback tunnel')
    if args.allow_http:
        global http
        http = build_opener(ProxyHandler({}), NoRedirect)
    system = platform.system().lower()
    arch = {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine().lower())
    if system not in ('darwin', 'linux') or not arch:
        raise ValueError('Supported platforms: macOS and Linux on x64 or arm64')

    home = Path(os.environ.get('HAMLET_RUNNER_HOME', Path.home() / '.local/share/hamlet-runner')).expanduser().resolve()
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    settings = home / 'settings.json'
    config = json.loads(settings.read_text()) if settings.exists() else {}
    changed_url = config.get('apiUrl', url) != url
    token = os.environ.get('CLI_API_TOKEN')
    if not changed_url and not token:
        token = config.get('cliApiToken')
    if not token and ssh:
        command = """python3 -c 'import json,pathlib; print(json.loads((pathlib.Path.home()/".local/share/hamlet-hub/settings.json").read_text())["cliApiToken"])'"""
        token = subprocess.check_output(ssh + [args.ssh, command], text=True).strip()
    if not token:
        token = getpass.getpass('Hub CLI_API_TOKEN: ').strip()
    if changed_url and token != config.get('cliApiToken'):
        raise ValueError('Select a separate HAMLET_RUNNER_HOME for a different Hub.')
    jwt = api(url + '/api/auth', {'accessToken': token})['token']

    def download(path):
        return http.open(Request(path, headers={'Authorization': 'Bearer ' + jwt}), timeout=120)

    asset = f'hamlet-runner-{system}-{arch}.gz'
    base = url + '/runner/' + asset
    binary = home / 'bin/hamlet-runner'
    binary.parent.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=home) as temp:
        stage = Path(temp)
        with download(base + '.sha256') as response:
            expected = response.read(256).decode().split()[0]
        digest = hashlib.sha256()
        with download(base) as response, (stage / asset).open('wb') as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError('Runner checksum mismatch')
        with gzip.open(stage / asset, 'rb') as src, (stage / 'hamlet-runner').open('wb') as out:
            shutil.copyfileobj(src, out)
        (stage / 'hamlet-runner').chmod(0o755)
        env = dict(os.environ, HAMLET_HOME=str(home), HAMLET_API_URL=url, HAMLET_CLI_EXECUTABLE=str(binary))
        env.pop('CLI_API_TOKEN', None)
        if args.allow_http:
            bypass = ','.join(filter(None, (env.get('NO_PROXY') or env.get('no_proxy'), origin.hostname)))
            env.update(NO_PROXY=bypass, no_proxy=bypass)
        subprocess.run([str(stage / 'hamlet-runner'), '--version'], env=env, check=True, stdout=subprocess.DEVNULL)
        launcher = home / 'bin/hamlet'
        with download(url + '/runner/hamlet') as response:
            (stage / 'hamlet').write_bytes(response.read())
        (stage / 'hamlet').chmod(0o755)
        os.replace(stage / 'hamlet', launcher)
        if home == (Path.home() / '.local/share/hamlet-runner').resolve():
            link_commands(launcher, ['hamlet', 'hamlet-runner'])
        config.update(apiUrl=url, cliApiToken=token)
        (stage / 'settings.json').write_text(json.dumps(config) + '\n')
        (stage / 'settings.json').chmod(0o600)
        os.replace(stage / 'settings.json', settings)
        if not changed_url and binary.exists() and filecmp.cmp(binary, stage / 'hamlet-runner', shallow=False):
            machine = online(url, jwt, settings)
            if machine:
                print(f'Runner already online at {url}. Machine ID: {machine}')
                return
        os.replace(stage / 'hamlet-runner', binary)
    state = home / 'runner.state.json'
    if state.exists():
        subprocess.run([str(binary), 'runner', 'stop'], cwd=home, env=env, check=True)
        for _ in range(100):
            if not state.exists():
                break
            time.sleep(0.1)
    logs = home / 'logs'
    logs.mkdir(mode=0o700, exist_ok=True)
    with (logs / 'hamlet-runner.log').open('ab') as log:
        process = subprocess.Popen([str(binary), 'runner', 'start-sync'], cwd=home, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    for _ in range(45):
        if process.poll() is not None:
            raise RuntimeError(f'Runner exited during startup. See {logs / "hamlet-runner.log"}')
        machine = online(url, jwt, settings)
        if machine:
            print(f'Runner online at {url}. Machine ID: {machine}')
            return
        time.sleep(1)
    raise RuntimeError('Runner started but the Hub has not confirmed this machine online')


if __name__ == '__main__':
    try:
        install()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
