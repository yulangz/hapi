#!/usr/bin/env python3
"""Forward loopback HTTP/WebSocket traffic through HTTP or SOCKS5h with verified TLS."""

import argparse
import asyncio
import datetime
import ipaddress
import socket
import ssl
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit


def parse_endpoint(value, schemes):
    endpoint = urlsplit(value)
    if (endpoint.scheme not in schemes or not endpoint.hostname
            or endpoint.username or endpoint.password
            or endpoint.path not in ("", "/") or endpoint.query or endpoint.fragment):
        raise ValueError("Expected %s://host:port without credentials or a path" % "/".join(schemes))
    defaults = {"https": 443, "http": 80, "socks5h": 1080}
    return endpoint.scheme, endpoint.hostname, endpoint.port or defaults[endpoint.scheme]


def recv_exact(connection, size):
    result = bytearray()
    while len(result) < size:
        piece = connection.recv(size - len(result))
        if not piece:
            raise ConnectionError("Proxy closed the handshake")
        result.extend(piece)
    return bytes(result)


def connect_tunnel(proxy, hub):
    scheme, proxy_host, proxy_port = proxy
    _, host, port = hub
    connection = socket.create_connection((proxy_host, proxy_port), timeout=15)
    try:
        if scheme == "http":
            authority = "[%s]:%s" % (host, port) if ":" in host else "%s:%s" % (host, port)
            connection.sendall(("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n" %
                                (authority, authority)).encode("ascii"))
            headers = bytearray()
            while not headers.endswith(b"\r\n\r\n"):
                headers.extend(recv_exact(connection, 1))
                if len(headers) > 65536:
                    raise ConnectionError("Proxy response headers are too large")
            status = bytes(headers).split(b"\r\n", 1)[0].split()
            if len(status) < 2 or status[1] != b"200":
                raise ConnectionError("Proxy CONNECT failed (HTTP %s)" %
                                      (status[1].decode("ascii", "replace") if len(status) > 1 else "unknown"))
        else:
            connection.sendall(b"\x05\x01\x00")
            if recv_exact(connection, 2) != b"\x05\x00":
                raise ConnectionError("SOCKS5 proxy does not accept authentication-free connections")
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                domain = host.encode("idna")
                if not 0 < len(domain) <= 255:
                    raise ValueError("SOCKS5 hostname is too long")
                destination = b"\x03" + bytes([len(domain)]) + domain
            else:
                destination = (b"\x01" if address.version == 4 else b"\x04") + address.packed
            connection.sendall(b"\x05\x01\x00" + destination + port.to_bytes(2, "big"))
            reply = recv_exact(connection, 4)
            if reply[0] != 5 or reply[2] != 0 or reply[1] != 0:
                raise ConnectionError("SOCKS5 CONNECT failed (reply %s)" % reply[1])
            if reply[3] == 1:
                size = 4
            elif reply[3] == 4:
                size = 16
            elif reply[3] == 3:
                size = recv_exact(connection, 1)[0]
            else:
                raise ConnectionError("Invalid SOCKS5 reply address")
            recv_exact(connection, size + 2)
        connection.setblocking(False)
        return connection
    except BaseException:
        connection.close()
        raise


async def pump(reader, writer):
    while True:
        payload = await reader.read(65536)
        if not payload:
            return
        writer.write(payload)
        await writer.drain()


async def handle_client(reader, writer, proxy, hub, context):
    upstream_writer = None
    tunnel = None
    tasks = []
    stage = "proxy connect"
    try:
        loop = asyncio.get_event_loop()
        tunnel = await loop.run_in_executor(None, connect_tunnel, proxy, hub)
        stage = "TLS handshake"
        upstream_reader, upstream_writer = await asyncio.wait_for(
            asyncio.open_connection(sock=tunnel, ssl=context, server_hostname=hub[1]), 20)
        tunnel = None  # The asyncio transport now owns the socket.
        stage = "relay"
        # Separate tasks allow reverse traffic while a destination applies backpressure.
        tasks = [asyncio.ensure_future(pump(reader, upstream_writer)),
                 asyncio.ensure_future(pump(upstream_reader, writer))]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except Exception as error:
        timestamp = datetime.datetime.now().isoformat(timespec="seconds")
        print("[%s] Bridge connection failed (%s): %s" % (timestamp, stage, error),
              file=sys.stderr, flush=True)
        if upstream_writer is None:
            try:
                writer.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                await writer.drain()
            except Exception:
                pass
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if tunnel is not None:
            tunnel.close()
        if upstream_writer is not None:
            upstream_writer.close()
        writer.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ca", help="Optional additional CA certificate; system CAs are always trusted")
    parser.add_argument("--proxy", default="socks5h://127.0.0.1:1082", help="HTTP CONNECT or SOCKS5h proxy URL")
    parser.add_argument("--hub", required=True, help="Public HTTPS Hub origin")
    parser.add_argument("--listen-port", type=int, default=3007)
    args = parser.parse_args()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    executor = ThreadPoolExecutor(max_workers=16)
    loop.set_default_executor(executor)
    server = None
    try:
        proxy = parse_endpoint(args.proxy, ("http", "socks5h"))
        hub = parse_endpoint(args.hub, ("https",))
        context = ssl.create_default_context()
        if args.ca:
            context.load_verify_locations(cafile=str(Path(args.ca).expanduser().resolve()))

        async def connected(reader, writer):
            await handle_client(reader, writer, proxy, hub, context)

        server = loop.run_until_complete(asyncio.start_server(connected, "127.0.0.1", args.listen_port))
        print("HAPI local bridge: http://127.0.0.1:%s -> %s via %s (full duplex)" %
              (server.sockets[0].getsockname()[1], args.hub, args.proxy), flush=True)
        loop.run_forever()
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        print("Cannot start bridge: %s" % error, file=sys.stderr, flush=True)
        return 1
    finally:
        if server is not None:
            server.close()
            loop.run_until_complete(server.wait_closed())
        pending = asyncio.Task.all_tasks(loop) if sys.version_info < (3, 7) else asyncio.all_tasks(loop)
        for task in pending:
            task.cancel()
        if pending:
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        executor.shutdown(wait=True)
        loop.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
