#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_SAMPLES = 15;
const READY_MARK = 'meno-composer-ready';

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const targetUrl = valueAfter('--url');
const sampleCount = Number(valueAfter('--samples') || DEFAULT_SAMPLES);
const chromePath = valueAfter('--chrome') || DEFAULT_CHROME;

if (!targetUrl) {
  console.error('Usage: node scripts/measure-composer-startup.mjs --url <https-url> [--samples 15] [--chrome <path>]');
  process.exit(1);
}

const parsedUrl = new URL(targetUrl);
if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
  console.error('Refusing non-HTTPS remote URL.');
  process.exit(1);
}
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 50) {
  console.error('--samples must be an integer from 1 to 50.');
  process.exit(1);
}

const percentile = (sorted, quantile) => sorted[Math.ceil(sorted.length * quantile) - 1];
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (value) => Math.round(value * 100) / 100;
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    max: round(sorted[sorted.length - 1]),
  };
};

const profileDir = await mkdtemp(join(tmpdir(), 'meno-composer-perf-'));
let chrome;
let socket;

try {
  chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--metrics-recording-only',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const browserWebSocketUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools endpoint.')), 15_000);
    chrome.stderr.setEncoding('utf8');
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools became ready (${code ?? 'unknown'}).`));
    });
  });

  socket = new WebSocket(browserWebSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools.')), { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const eventWaiters = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    for (let index = eventWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = eventWaiters[index];
      if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === message.sessionId)) {
        eventWaiters.splice(index, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message.params);
      }
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const waitForEvent = (method, sessionId, timeoutMs = 15_000) => new Promise((resolve, reject) => {
    const waiter = { method, sessionId, resolve, reject };
    waiter.timeout = setTimeout(() => {
      const index = eventWaiters.indexOf(waiter);
      if (index >= 0) eventWaiters.splice(index, 1);
      reject(new Error(`Timed out waiting for ${method}.`));
    }, timeoutMs);
    eventWaiters.push(waiter);
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);

  const readyInstrumentation = `(() => {
    const markReady = () => {
      if (performance.getEntriesByName('${READY_MARK}').length) return;
      const composer = document.querySelector('textarea[placeholder="现在的想法是..."]');
      if (composer && !composer.disabled) performance.mark('${READY_MARK}');
    };
    new MutationObserver(markReady).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('DOMContentLoaded', markReady, { once: true });
    queueMicrotask(markReady);
  })();`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: readyInstrumentation }, sessionId);

  const readMetrics = async () => {
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => {
        const ready = performance.getEntriesByName('${READY_MARK}').at(-1)?.startTime;
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
        const composer = document.querySelector('textarea[placeholder="现在的想法是..."]');
        return { ready, fcp, domInteractive: nav?.domInteractive, load: nav?.loadEventEnd, composerReady: Boolean(composer && !composer.disabled) };
      })()`,
      returnByValue: true,
    }, sessionId);
    const metrics = result.value;
    if (!metrics?.composerReady || typeof metrics.ready !== 'number') {
      throw new Error('Composer did not become ready during the measured navigation.');
    }
    return metrics;
  };

  const navigate = async (url) => {
    const loaded = waitForEvent('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url }, sessionId);
    await loaded;
    return readMetrics();
  };

  const cold = [];
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
  for (let index = 0; index < sampleCount; index += 1) {
    await send('Network.clearBrowserCache', {}, sessionId);
    cold.push(await navigate(`${targetUrl}${parsedUrl.search ? '&' : '?'}meno_perf=${Date.now()}-${index}`));
  }

  await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
  await send('Network.setBypassServiceWorker', { bypass: false }, sessionId);
  await navigate(targetUrl);
  const warm = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const loaded = waitForEvent('Page.loadEventFired', sessionId);
    await send('Page.reload', { ignoreCache: false }, sessionId);
    await loaded;
    warm.push(await readMetrics());
  }

  const summarizeMetric = (rows, key) => summarize(rows.map((row) => row[key]).filter(Number.isFinite));
  console.log(JSON.stringify({
    url: targetUrl,
    samples: sampleCount,
    measurement: `navigationStart to an enabled Composer textarea, marked in-page by MutationObserver`,
    cold: {
      composerReadyMs: summarizeMetric(cold, 'ready'),
      firstContentfulPaintMs: summarizeMetric(cold, 'fcp'),
      domInteractiveMs: summarizeMetric(cold, 'domInteractive'),
      loadEventEndMs: summarizeMetric(cold, 'load'),
    },
    warm: {
      composerReadyMs: summarizeMetric(warm, 'ready'),
      firstContentfulPaintMs: summarizeMetric(warm, 'fcp'),
      domInteractiveMs: summarizeMetric(warm, 'domInteractive'),
      loadEventEndMs: summarizeMetric(warm, 'load'),
    },
  }, null, 2));
} finally {
  try { socket?.close(); } catch {}
  if (chrome && !chrome.killed) chrome.kill('SIGTERM');
  await rm(profileDir, { recursive: true, force: true });
}
