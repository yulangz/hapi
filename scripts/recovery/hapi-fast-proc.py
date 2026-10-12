#!/usr/bin/python3
"""Fast, narrow Linux process queries for HAPI; delegate other forms to procps."""
import os
import pathlib
import sys
import time

name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]

def fallback():
    os.execv('/usr/bin/' + name, [name] + args)

if name == 'pgrep' and len(args) == 2 and args[0] == '-P' and args[1].isdigit():
    proc = pathlib.Path('/proc') / args[1]
    if not proc.exists():
        sys.exit(1)
    children = set()
    try:
        for task in (proc / 'task').iterdir():
            try:
                children.update(int(pid) for pid in (task / 'children').read_text().split())
            except FileNotFoundError:
                continue
    except FileNotFoundError:
        sys.exit(1)
    except PermissionError:
        fallback()
    for pid in sorted(children):
        print(pid)
    sys.exit(0 if children else 1)

if (name == 'ps' and len(args) == 4 and args[0] == '-p' and args[1].isdigit()
        and args[2] == '-o' and args[3] in ('lstart=', 'command=')):
    proc = pathlib.Path('/proc') / args[1]
    try:
        stat = (proc / 'stat').read_text()
        fields = stat.rsplit(')', 1)[1].split()
        if args[3] == 'lstart=':
            # HAPI compares English UTC strings as process generation markers.
            if os.environ.get('LC_ALL') != 'C' or os.environ.get('TZ') != 'UTC':
                fallback()
            with open('/proc/stat') as f:
                for line in f:
                    if line.startswith('btime '):
                        boot = int(line.split()[1])
                        break
                else:
                    fallback()
            start = boot + int(fields[19]) / os.sysconf('SC_CLK_TCK')
            time.tzset()
            print(time.strftime('%a %b %e %H:%M:%S %Y', time.localtime(start)))
        else:
            cmdline = (proc / 'cmdline').read_bytes().rstrip(b'\0')
            if cmdline:
                print(os.fsdecode(cmdline.replace(b'\0', b' ')))
            else:
                comm = stat.split('(', 1)[1].rsplit(')', 1)[0]
                print('[%s]%s' % (comm, ' <defunct>' if fields[0] == 'Z' else ''))
        sys.exit(0)
    except FileNotFoundError:
        sys.exit(1)
    except (PermissionError, OSError, ValueError, IndexError):
        fallback()

fallback()
