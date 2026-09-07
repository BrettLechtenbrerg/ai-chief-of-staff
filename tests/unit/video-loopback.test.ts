import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import net from 'node:net';
const { restrictListenersToLoopback }: { restrictListenersToLoopback(): () => void } = createRequire(import.meta.url)('../../assets/skills/remotion/loopback-listeners.cjs');

describe('Worker-scoped SDK listener guard', () => {
  it('binds a requested wildcard listener to actual IPv4 loopback without mutating its options', async () => {
    const before = net.Server.prototype.listen;
    const restore = restrictListenersToLoopback();
    const server = net.createServer(socket => socket.destroy());
    const options = { port: 0, host: '0.0.0.0' };
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options, resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      expect(address.address).toBe('127.0.0.1');
      expect(options.host).toBe('0.0.0.0');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve())); restore();
    }
    expect(net.Server.prototype.listen).toBe(before);
  });
  it('fails closed on unreviewed file-descriptor or Unix-socket listeners', () => {
    const restore = restrictListenersToLoopback(); const server = net.createServer();
    try {
      expect(() => server.listen({ fd: 1 })).toThrow('Unsupported listener');
      expect(() => server.listen({ path: '/must-not-bind' })).toThrow('Unsupported listener');
    } finally { restore(); }
  });
});
