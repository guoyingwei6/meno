import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, it } from 'node:test';

import {
  formatReport,
  main,
  measureSamples,
  parseArgs,
  summarize,
} from './measure-public-feed.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

const startServer = async (handler) => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}/api/public/memos?limit=20`;
};

describe('measure-public-feed CLI', () => {
  it('requires an explicit URL and rejects credential-bearing URLs', () => {
    assert.throws(() => parseArgs([]), /显式提供 --url/);
    assert.throws(
      () => parseArgs(['--url', 'http://127.0.0.1:8787/api/public/memos?access_token=not-used']),
      /不得包含 token、cookie/,
    );
    assert.throws(
      () => parseArgs(['--url', 'http://127.0.0.1:8787/api/public/memos?key=not-used']),
      /不得包含 token、cookie/,
    );
    assert.throws(() => parseArgs(['--url', 'file:///tmp/feed']), /只允许使用 http/);

    const options = parseArgs([
      '--url=http://127.0.0.1:8787/api/public/memos?limit=20',
      '--samples=3',
      '--timeout-ms=250',
      '--delay-ms=2',
      '--max-body-bytes=1024',
      '--json',
    ]);
    assert.equal(options.samples, 3);
    assert.equal(options.timeoutMs, 250);
    assert.equal(options.delayMs, 2);
    assert.equal(options.maxBodyBytes, 1024);
    assert.equal(options.json, true);
  });

  it('takes sequential read-only samples and measures wire gzip and transfer bytes', async () => {
    const requestLog = [];
    const payload = Buffer.from(JSON.stringify({
      memos: [{ id: 1, content: 'local fixture token=must-not-print' }],
    }));
    const compressedPayload = gzipSync(payload);
    const url = await startServer((request, response) => {
      requestLog.push({ method: request.method, headers: request.headers });
      const attempt = requestLog.length;
      if (attempt === 3) {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('failure token=must-not-print; cookie=must-not-print');
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      });
      response.end(compressedPayload);
    });

    const options = parseArgs(['--url', url, '--samples', '4', '--timeout-ms', '1000']);
    const results = await measureSamples(options);
    const report = summarize(results);

    assert.deepEqual(report.samples, { requested: 4, succeeded: 3, failed: 1 });
    assert.equal(report.gzipBytes.count, 3);
    assert.equal(report.gzipBytes.min, compressedPayload.byteLength);
    assert.equal(report.gzipBytes.max, compressedPayload.byteLength);
    assert.equal(report.transferBytes.min, compressedPayload.byteLength);
    assert.equal(report.transferBytes.max, compressedPayload.byteLength);
    assert.equal(report.uncompressedBytes.min, payload.byteLength);
    assert.equal(report.contentEncoding.gzip, 3);
    assert.deepEqual(report.failures, [{ sample: 3, reason: 'HTTP 503', ttfbMs: report.failures[0].ttfbMs }]);
    assert.equal(report.failures[0].ttfbMs >= 0, true);
    assert.equal(report.ttfbMs.count, 3);
    assert.match(formatReport(report), /样本: 请求=4, 成功=3, 失败=1/);
    assert.doesNotMatch(formatReport(report), /must-not-print/);

    assert.equal(requestLog.length, 4);
    assert.deepEqual(requestLog.map(({ method }) => method), ['GET', 'GET', 'GET', 'GET']);
    for (const { headers } of requestLog) {
      assert.equal(headers.authorization, undefined);
      assert.equal(headers.cookie, undefined);
      assert.equal(headers['accept-encoding'], 'gzip');
    }
  });

  it('reports local gzip estimates for an uncompressed response and emits JSON', async () => {
    const payload = Buffer.from(JSON.stringify({ memos: [{ id: 1, content: 'local fixture' }] }));
    const url = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(payload);
    });

    let stdout = '';
    let stderr = '';
    const exitCode = await main(['--url', url, '--samples', '2', '--json'], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr, '');
    const report = JSON.parse(stdout);
    assert.deepEqual(report.samples, { requested: 2, succeeded: 2, failed: 0 });
    assert.equal(report.transferBytes.p50, payload.byteLength);
    assert.equal(report.gzipBytes.p50, gzipSync(payload).byteLength);
    assert.deepEqual(report.contentEncoding, { identity: 2 });
    assert.doesNotMatch(stdout, /local fixture/);
  });

  it('enforces the timeout for a server that never sends response headers', async () => {
    const url = await startServer((_request, _response) => {});
    const [result] = await measureSamples(parseArgs([
      '--url',
      url,
      '--samples',
      '1',
      '--timeout-ms',
      '20',
    ]));

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'timeout after 20 ms');
    assert.equal(result.ttfbMs, null);
  });

  it('returns usage exit code without making a request', async () => {
    let stdout = '';
    let stderr = '';
    const exitCode = await main([], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });

    assert.equal(exitCode, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /必须显式提供 --url/);
    assert.match(stderr, /没有默认 URL/);
  });
});
