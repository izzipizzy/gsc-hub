import { it, expect, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { openDb } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async (host: string) => [{ address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }]) }));
import { checkBacklink, BACKLINK_UA } from '../src/lib/server/backlink-fetch';
const source = 'http://donor.example/article/';
const target = 'https://mysite.com/page/';

async function fakeProxy(version: 4 | 5, opts: { fail?: boolean; redirect?: string } = {}) {
  const sockets = new Set<Socket>();
  let auth = '';
  let destination = '';
  let http = '';
  const server = createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let phase = version === 5 ? 'hello' : 'connect';
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
      for (;;) {
        if (phase === 'hello') {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
          buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, 2])); phase = 'auth';
        } else if (phase === 'auth') {
          if (buffer.length < 2) return;
          const endUser = 2+buffer[1];
          if (buffer.length < endUser+1 || buffer.length < endUser+1+buffer[endUser]) return;
          auth = buffer.subarray(2,endUser).toString()+':'+buffer.subarray(endUser+1,endUser+1+buffer[endUser]).toString();
          buffer = buffer.subarray(endUser+1+buffer[endUser]); socket.write(Buffer.from([1,0])); phase = 'connect';
        } else if (phase === 'connect') {
          if (version === 5) {
            if (buffer.length < 10) return;
            destination = [...buffer.subarray(4,8)].join('.'); buffer = buffer.subarray(10);
            socket.write(Buffer.from([5,opts.fail ? 5 : 0,0,1,0,0,0,0,0,0]));
          } else {
            const nul = buffer.indexOf(0,8);
            if (nul < 0) return;
            destination = [...buffer.subarray(4,8)].join('.'); auth = buffer.subarray(8,nul).toString(); buffer = buffer.subarray(nul+1);
            socket.write(Buffer.from([0,opts.fail ? 91 : 90,0,0,0,0,0,0]));
          }
          if (opts.fail) { socket.end(); return; }
          phase = 'http';
        } else {
          if (!buffer.toString().includes('\r\n\r\n')) return;
          http = buffer.toString();
          const body = `<html><a href="${target}" rel="nofollow">Real anchor</a></html>`;
          if (opts.redirect) socket.end(`HTTP/1.1 302 Found\r\nLocation: ${opts.redirect}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
          else socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  const port = (server.address() as any).port;
  return { url: version === 5 ? `socks5://user:password@127.0.0.1:${port}` : `socks4://user@127.0.0.1:${port}`,
    get: () => ({auth,destination,http}), close: async () => { for (const s of sockets) s.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
for (const version of [4,5] as const) it(`fetches through SOCKS${version} with auth, pinned target, original Host and Googlebot`, async () => {
  const proxy = await fakeProxy(version); const db = openDb(':memory:');
  try {
    setConfigValue(db,'BACKLINK_PROXY_URL',proxy.url);
    expect(await checkBacklink(db,source,target)).toMatchObject({status:'found',links:[{anchor:'Real anchor',rel:'nofollow'}]});
    expect(proxy.get()).toMatchObject({auth:version===5?'user:password':'user',destination:'93.184.216.34'});
    expect(proxy.get().http).toContain('Host: donor.example');
    expect(proxy.get().http).toContain('User-Agent: '+BACKLINK_UA);
    expect(proxy.get().http).not.toContain('password');
    expect(proxy.get().http).not.toMatch(/forwarded-for/i);
  } finally { db.close(); await proxy.close(); }
});
it('failed proxy stays an error and never falls back to direct HTTP', async () => {
  const proxy = await fakeProxy(5,{fail:true}); const db = openDb(':memory:');
  try {
    setConfigValue(db,'BACKLINK_PROXY_URL',proxy.url);
    expect((await checkBacklink(db,source,target)).status).toBe('error');
    expect(proxy.get().http).toBe('');
  } finally { db.close(); await proxy.close(); }
});
it('rejects private DNS and redirects to private hosts before opening another connection', async () => {
  const proxy = await fakeProxy(5,{redirect:'http://private.example/'}); const db = openDb(':memory:');
  try {
    setConfigValue(db,'BACKLINK_PROXY_URL',proxy.url);
    expect(await checkBacklink(db,source,target)).toMatchObject({status:'error',error:'Адрес публикации не является публичным'});
    expect(await checkBacklink(db,'http://private.example/',target)).toMatchObject({status:'error'});
  } finally { db.close(); await proxy.close(); }
});
