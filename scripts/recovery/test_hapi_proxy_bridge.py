import asyncio, importlib.util, pathlib, ssl, subprocess, tempfile, time
spec = importlib.util.spec_from_file_location('bridge', str(pathlib.Path(__file__).with_name('hapi_proxy_bridge.py')))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

async def run():
    with tempfile.TemporaryDirectory() as d:
        key, cert = d+'/key.pem', d+'/cert.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server_ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); server_ctx.load_cert_chain(cert,key)
        client_ctx=ssl.create_default_context(cafile=cert)
        seen=[]
        async def hub(r,w):
            try:
                command=await r.readline()
                if command==b'IDLE\n':
                    await asyncio.sleep(35); w.write(b'AFTER_IDLE\n'); await w.drain()
                    assert await r.readline()==b'REVERSE\n'
                    w.write(b'OK\n'); await w.drain()
                elif command==b'PRESSURE\n':
                    w.write(b'READY\n'); await w.drain()
                    await asyncio.sleep(2)  # Deliberately stop reading a large upload.
                    w.write(b'PING\n'); await w.drain()
                    remaining=16*1024*1024
                    while remaining:
                        data=await r.read(min(65536,remaining)); assert data; remaining-=len(data)
                    w.write(b'DONE\n'); await w.drain()
                else:
                    w.write(command); await w.drain()
            finally: w.close()
        hs=await asyncio.start_server(hub,'127.0.0.1',0,ssl=server_ctx)
        hp=hs.sockets[0].getsockname()[1]
        async def proxy(r,w):
            tasks=[]; uw=None
            try:
                first=await r.readexactly(1)
                if first==b'\x05':
                    assert await r.readexactly(2)==b'\x01\x00'
                    for x in b'\x05\x00': w.write(bytes([x])); await w.drain(); await asyncio.sleep(.01)
                    assert await r.readexactly(4)==b'\x05\x01\x00\x03'
                    n=(await r.readexactly(1))[0]; host=(await r.readexactly(n)).decode(); port=int.from_bytes(await r.readexactly(2),'big'); seen.append((host,port))
                    response=b'\x05\x00\x00\x03\x01x'+hp.to_bytes(2,'big')
                else:
                    headers=first+await r.readuntil(b'\r\n\r\n'); assert headers.startswith(b'CONNECT localhost:'); response=b'HTTP/1.1 200 OK\r\n\r\n'
                ur,uw=await asyncio.open_connection('127.0.0.1',hp)
                for x in response: w.write(bytes([x])); await w.drain(); await asyncio.sleep(.001)
                tasks=[asyncio.create_task(b.pump(r,uw)),asyncio.create_task(b.pump(ur,w))]
                await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in tasks: t.cancel()
                if tasks: await asyncio.gather(*tasks,return_exceptions=True)
                if uw: uw.close()
                w.close()
        ps=await asyncio.start_server(proxy,'127.0.0.1',0); pp=ps.sockets[0].getsockname()[1]
        bridges=[]
        for scheme in ('http','socks5h'):
            async def handler(r,w,scheme=scheme): await b.handle_client(r,w,(scheme,'127.0.0.1',pp),('https','localhost',hp),client_ctx)
            bs=await asyncio.start_server(handler,'127.0.0.1',0); bridges.append(bs)
            r,w=await asyncio.open_connection('127.0.0.1',bs.sockets[0].getsockname()[1]); w.write(b'HELLO\n'); await w.drain(); assert await asyncio.wait_for(r.readline(),10)==b'HELLO\n'; w.close()
            print('PASS',scheme,'fragmented handshake and TLS echo',flush=True)
        bp=bridges[-1].sockets[0].getsockname()[1]
        r,w=await asyncio.open_connection('127.0.0.1',bp); w.write(b'PRESSURE\n'); await w.drain(); assert await r.readline()==b'READY\n'
        async def upload():
            for _ in range(256): w.write(b'x'*65536); await w.drain()
        uploading=asyncio.create_task(upload()); assert await asyncio.wait_for(r.readline(),5)==b'PING\n'; await uploading; assert await r.readline()==b'DONE\n'; w.close()
        print('PASS reverse traffic during 16 MiB upload backpressure',flush=True)
        r,w=await asyncio.open_connection('127.0.0.1',bp); w.write(b'IDLE\n'); await w.drain(); assert await asyncio.wait_for(r.readline(),45)==b'AFTER_IDLE\n'; w.write(b'REVERSE\n'); await w.drain(); assert await r.readline()==b'OK\n'; w.close()
        assert all(h=='localhost' and p==hp for h,p in seen)
        print('PASS 35-second idle and bidirectional continuation; SOCKS remote DNS',flush=True)
        # Untrusted upstream certificate must fail, rather than bypass TLS validation.
        async def bad_tls(r,w): await b.handle_client(r,w,('socks5h','127.0.0.1',pp),('https','localhost',hp),ssl.create_default_context())
        bad=await asyncio.start_server(bad_tls,'127.0.0.1',0)
        r,w=await asyncio.open_connection('127.0.0.1',bad.sockets[0].getsockname()[1]); w.write(b'HELLO\n'); await w.drain(); assert (await r.read()).startswith(b'HTTP/1.1 502'); w.close(); print('PASS untrusted TLS rejected',flush=True)
        for s in bridges+[bad,ps,hs]: s.close(); await s.wait_closed()
        await asyncio.sleep(.1)
asyncio.run(run())
