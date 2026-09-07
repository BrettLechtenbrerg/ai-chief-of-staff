'use strict';
// Loaded only in an owned external Node process, never in Electron's main thread.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

function report(value) { process.stdout.write(`ACOS_VIDEO ${JSON.stringify(value)}\n`); }
async function digestTree(root, hashContent = true) {
  const hash = createHash('sha256');
  let bytes = 0;
  let files = 0;
  async function visit(dir) {
    for (const name of (await fs.readdir(dir)).sort()) {
      if (++files > 10000) throw new Error('Bundle exceeds entry budget');
      const file = path.join(dir, name);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Bundle symlinks are not allowed');
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile()) {
        if ((bytes += stat.size) > 1024 * 1024 * 1024) throw new Error('Bundle exceeds local job budget');
        hash.update(JSON.stringify([path.relative(root, file), stat.size]));
        // Stream large assets instead of retaining the entire bundle in memory.
        if (hashContent) {
          const stream = require('node:fs').createReadStream(file);
          for await (const chunk of stream) hash.update(chunk);
        }
      } else throw new Error('Unsupported bundle entry');
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function localAssetProxy() {
  const http = require('node:http');
  const sockets = new Set();
  const proxy = http.createServer((request, response) => {
    let url;
    try { url = new URL(request.url); } catch { response.writeHead(400).end(); return; }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403).end(); return; }
    url.hostname = '127.0.0.1';
    const upstream = http.request(url, { method: request.method, headers: request.headers }, (result) => {
      response.writeHead(result.statusCode || 502, result.headers); result.pipe(response);
    });
    upstream.setTimeout(10000, () => upstream.destroy());
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy());
    upstream.end();
  });
  proxy.on('connect', (_request, socket) => socket.destroy());
  proxy.on('connection', (socket) => {
    if (sockets.size >= 128) { socket.destroy(); return; }
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen({ port: 0, host: '127.0.0.1' }, resolve); });
  process.env.ACOS_VIDEO_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  // Browser request restriction, not an OS boundary for arbitrary workspace code.
  return () => { for (const socket of sockets) socket.destroy(); proxy.close(); };
}

function validatePreset(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props) || !props.elements || typeof props.elements !== 'object') throw new Error('Storyboard needs the five selected elements');
  for (const field of ['verbal', 'text', 'visual', 'audio', 'caption']) {
    if (typeof props.elements[field] !== 'string' || !props.elements[field].trim() || props.elements[field].length > 2000) throw new Error('Invalid storyboard element');
  }
  const duration = props.durationSeconds ?? 10;
  if (!Number.isInteger(duration) || duration < 1 || duration > 180) throw new Error('Storyboard duration must be 1–180 seconds');
  if (props.elements.text.length > 160 || (props.elements.verbal.match(/\S+/g) || []).some(word => word.length > 45)) throw new Error('Text exceeds preset safe-area limits; revise or use a custom composition');
  if ((props.elements.verbal.match(/\S+/g) || []).length / duration > 2.5) throw new Error('Spoken text exceeds the editorial 150 WPM guideline; lengthen or review the selection');
  for (const [key, max] of [['brandName', 80], ['cta', 120]]) if (props[key] !== undefined && (typeof props[key] !== 'string' || props[key].length > max)) throw new Error('Invalid storyboard label');
  for (const key of ['background', 'foreground', 'accent']) if (props[key] !== undefined && (typeof props[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(props[key]))) throw new Error('Storyboard colors must use six-digit hex');
  const lightness = (hex) => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const bg = lightness(props.background ?? '#132031');
  for (const color of [props.foreground ?? '#f1f5f9', props.accent ?? '#61dbef']) {
    const fg = lightness(color);
    if ((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) < 4.5) throw new Error('Storyboard text contrast is below 4.5:1; revise the colors');
  }
  return duration;
}

function verifyEncodedMetadata(actual, { width, height, fps, durationInFrames }) {
  // Count video samples exactly; AAC container padding is a separate measurement.
  if (actual.dimensions?.width !== width || actual.dimensions?.height !== height || actual.slowNumberOfFrames !== durationInFrames || !Number.isFinite(actual.fps) || Math.abs(actual.fps - fps) > 0.02 || !Number.isFinite(actual.durationInSeconds) || Math.abs(actual.durationInSeconds - durationInFrames / fps) > 0.1) throw new Error('Encoded video metadata does not match the composition');
  return { durationInSeconds: actual.slowNumberOfFrames / actual.fps, containerDurationInSeconds: actual.durationInSeconds, fps: actual.fps };
}

async function run() {
  process.umask(0o077);
  const [workspace, job] = process.argv.slice(2);
  const request = JSON.parse(await fs.readFile(path.join(job, 'request.json'), 'utf8'));
  const external = createRequire(path.join(workspace, 'package.json'));
  // This adapter is verified against these installed APIs, not an unbounded range.
  for (const name of ['@remotion/renderer', '@remotion/bundler', '@remotion/media-parser', 'remotion']) {
    if (external(`${name}/package.json`).version !== '4.0.484') throw new Error('Remotion version needs compatibility review');
  }
  const { bundle } = external('@remotion/bundler');
  const { openBrowser, selectComposition, renderStill, renderMedia, makeCancelSignal } = external('@remotion/renderer');
  const { parseMedia } = external('@remotion/media-parser');
  const { nodeReader } = external('@remotion/media-parser/node');
  const { cancel, cancelSignal } = makeCancelSignal();
  let browser;
  let closeProxy;
  let stopped = false;
  const stop = () => { stopped = true; cancel(); void browser?.close({ silent: true }).catch(() => {}); };
  const deadline = setTimeout(stop, 20 * 60 * 1000);
  const diskMonitor = setInterval(() => {
    void fs.statfs(job).then(disk => { if (disk.bavail * disk.bsize < 5 * 1024 ** 3) stop(); }, stop);
  }, 2000);
  process.once('disconnect', stop);
  process.stdout.on('error', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const check = () => { if (stopped) throw new Error('Video job cancelled'); };
  try {
    let serveUrl;
    if (request.previewJob) {
      serveUrl = path.join(request.previewJob, 'bundle');
      const saved = JSON.parse(await fs.readFile(path.join(request.previewJob, 'preview.json'), 'utf8'));
      if (saved.digest !== await digestTree(serveUrl) || saved.input !== JSON.stringify(request.input)) throw new Error('Preview changed; create and review a new preview');
    } else {
      report({ stage: 'bundling', percent: 0 });
      await digestTree(path.join(workspace, 'public'), false).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      let entryPoint = path.join(workspace, 'src', 'index.ts');
      if (request.input.compositionId === 'ACOS-Storyboard') {
        const props = JSON.parse(request.input.propsJson || '{}');
        const duration = validatePreset(props);
        for (const asset of ['Storyboard.tsx', 'captions.cjs']) await fs.copyFile(path.join(__dirname, asset), path.join(job, asset), require('node:fs').constants.COPYFILE_EXCL);
        entryPoint = path.join(job, 'entry.ts');
        await fs.writeFile(entryPoint, `import React from 'react'; import {registerRoot, Composition} from 'remotion'; import {Storyboard} from './Storyboard'; registerRoot(()=>React.createElement(Composition,{id:'ACOS-Storyboard',component:Storyboard,width:${request.width},height:${request.height},fps:30,durationInFrames:${duration * 30},defaultProps:JSON.parse(${JSON.stringify(JSON.stringify(props))})}));`, { flag: 'wx', mode: 0o600 });
      }
      serveUrl = await bundle({
        entryPoint, rootDir: workspace,
        outDir: path.join(job, 'bundle'), publicDir: path.join(workspace, 'public'),
        symlinkPublicDir: false, enableCaching: false,
        onSymlinkDetected: () => { throw new Error('Public asset symlinks are not allowed'); },
        onProgress: (percent) => report({ stage: 'bundling', percent: Math.round(percent) }),
      });
    }
    check();
    closeProxy = await localAssetProxy();
    browser = await openBrowser('chrome', {
      browserExecutable: path.join(job, 'browser-launcher.sh'), chromeMode: 'chrome-for-testing', logLevel: 'error',
    });
    check();
    const common = { serveUrl, inputProps: request.input.propsJson ? JSON.parse(request.input.propsJson) : {}, puppeteerInstance: browser, logLevel: 'error', timeoutInMilliseconds: 30000 };
    const composition = await selectComposition({ ...common, id: request.input.compositionId });
    const { width, height, fps, durationInFrames } = composition;
    if (width !== request.width || height !== request.height || !Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isSafeInteger(durationInFrames) || durationInFrames < 1 || durationInFrames / fps > 180) throw new Error('Composition dimensions, duration or FPS do not match job limits');
    check();
    const metadata = { width, height, fps, durationInFrames, durationInSeconds: durationInFrames / fps };
    if (!request.previewJob) {
      for (const [index, frame] of [0, Math.floor((durationInFrames - 1) / 2), durationInFrames - 1].entries()) {
        check();
        report({ stage: 'preview', percent: Math.round(index / 3 * 100) });
        await renderStill({ ...common, composition, frame, imageFormat: 'png', output: path.join(job, `preview-${index + 1}.png`), cancelSignal });
      }
      check();
      await fs.writeFile(path.join(job, 'preview.json'), JSON.stringify({ input: JSON.stringify(request.input), digest: await digestTree(serveUrl), metadata }), { flag: 'wx', mode: 0o600 });
      report({ stage: 'preview', percent: 100 });
    } else {
      report({ stage: 'rendering', percent: 0 });
      await renderMedia({ ...common, composition, codec: 'h264', concurrency: 2, overwrite: false, cancelSignal, licenseKey: null,
        outputLocation: path.join(job, 'video.mp4'),
        onProgress: ({ progress }) => report({ stage: 'rendering', percent: Math.floor(progress * 100) }),
      });
      check();
      report({ stage: 'verifying', percent: 0 });
      const encoded = await fs.lstat(path.join(job, 'video.mp4'));
      if (!encoded.isFile() || encoded.size < 32 || encoded.size > 2 * 1024 ** 3) throw new Error('Encoded file exceeds the local job budget');
      const actual = await parseMedia({ src: path.join(job, 'video.mp4'), reader: nodeReader, logLevel: 'error',
        fields: { dimensions: true, fps: true, durationInSeconds: true, slowNumberOfFrames: true },
      });
      Object.assign(metadata, verifyEncodedMetadata(actual, composition));
    }
    check();
    if (request.input.compositionId === 'ACOS-Storyboard') {
      const { makeSrt } = require('./captions.cjs');
      await fs.writeFile(path.join(job, 'captions.srt'), makeSrt(JSON.parse(request.input.propsJson).elements.verbal, durationInFrames, fps), { flag: 'wx', mode: 0o600 });
    }
    await fs.writeFile(path.join(job, 'result.json'), JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
  } finally {
    try { await browser?.close({ silent: true }); } finally {
      closeProxy?.();
      clearTimeout(deadline);
      clearInterval(diskMonitor);
      process.removeListener('disconnect', stop);
      process.stdout.removeListener('error', stop);
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    }
  }
}
module.exports = { validatePreset, digestTree, verifyEncodedMetadata };
if (require.main === module) {
  require('./loopback-listeners.cjs').restrictListenersToLoopback();
  run().catch(async (error) => {
    const job = process.argv[3];
    if (job) await fs.writeFile(path.join(job, 'error.txt'), String(error.message).slice(0, 8192), { flag: 'wx', mode: 0o600 }).catch(() => {});
    report({ stage: 'failed' }); process.exitCode = 1;
  }).finally(() => { if (process.connected) process.disconnect(); });
}
