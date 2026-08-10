#!/usr/bin/env node

import * as http from 'node:http';
import * as https from 'node:https';
import { performance } from 'node:perf_hooks';
import { brotliDecompressSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SAMPLES = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_DELAY_MS = 0;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_SAMPLES = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_DELAY_MS = 60_000;
const MAX_BODY_BYTES = 128 * 1024 * 1024;

const SENSITIVE_QUERY_NAME = /(?:token|cookie|secret|password|authorization|auth|session|api[-_]?key|signature|sig|^key$)/i;

export const HELP_TEXT = `用法:
  node scripts/measure-public-feed.mjs --url <公开 feed URL> [选项]

说明:
  该 CLI 只对显式指定的 URL 顺序发送 GET 请求，不设置 Authorization 或 Cookie，
  不读取环境中的认证信息，也不打印响应正文。没有默认 URL；必须显式提供 --url。

选项:
  --url <URL>             必填，只允许 http:// 或 https:// URL
  --samples <整数>        重复采样次数，默认 10，范围 1-1000
  --timeout-ms <整数>     单次请求超时，默认 10000，范围 1-120000
  --delay-ms <整数>       两次采样之间的等待时间，默认 0，范围 0-60000
  --max-body-bytes <整数> 单次响应体上限，默认 16777216，范围 1-134217728
  --json                  以 JSON 输出汇总结果
  -h, --help              显示帮助

示例（仅示意，需替换为你明确要测量的 endpoint）:
  node scripts/measure-public-feed.mjs \\
    --url http://127.0.0.1:8787/api/public/memos?limit=20 \\
    --samples 20

指标:
  TTFB 是收到响应头的耗时；gzip 是实际 gzip 响应体大小，或非 gzip 响应的本地 gzip 等价估算；
  transfer 是实际收到的响应体字节数（不含 HTTP 头和 chunk framing）。p50/p75 只基于成功样本。

退出码:
  0  全部采样成功
  1  至少一次采样失败
  2  参数校验失败
`;

class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

const optionNames = new Set([
  '--url',
  '--samples',
  '--timeout-ms',
  '--delay-ms',
  '--max-body-bytes',
]);

const isPlainInteger = (value) => /^\d+$/.test(value);

const parseIntegerOption = (value, label, min, max) => {
  if (!isPlainInteger(value)) {
    throw new CliError(`${label} 必须是十进制整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new CliError(`${label} 必须在 ${min} 到 ${max} 之间。`);
  }
  return parsed;
};

const validateUrl = (value) => {
  if (!value || typeof value !== 'string') {
    throw new CliError('--url 不能为空。');
  }

  let target;
  try {
    target = new URL(value);
  } catch {
    throw new CliError('--url 必须是有效的 http:// 或 https:// URL。');
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new CliError('--url 只允许使用 http:// 或 https://。');
  }
  if (!target.hostname || target.username || target.password) {
    throw new CliError('--url 不得包含用户名、密码或缺失主机名。');
  }
  if (target.hash) {
    throw new CliError('--url 不得包含 fragment（# 后面的内容）。');
  }
  for (const key of target.searchParams.keys()) {
    if (SENSITIVE_QUERY_NAME.test(key)) {
      throw new CliError('--url 不得包含 token、cookie 或其他认证凭据参数。');
    }
  }

  return target;
};

const readOptionValue = (argv, index, optionName) => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CliError(`${optionName} 需要一个值。`);
  }
  return value;
};

export const parseArgs = (argv) => {
  const options = {
    url: null,
    samples: DEFAULT_SAMPLES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    delayMs: DEFAULT_DELAY_MS,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    json: false,
    help: false,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      if (seen.has(arg)) throw new CliError('--json 不得重复指定。');
      seen.add(arg);
      options.json = true;
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    const optionName = equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg;
    if (!optionNames.has(optionName)) {
      throw new CliError(`无法识别参数 ${arg.startsWith('-') ? arg.replace(/=.*/, '') : '（不支持位置参数）'}。`);
    }
    if (seen.has(optionName)) {
      throw new CliError(`${optionName} 不得重复指定。`);
    }
    seen.add(optionName);

    const value = equalsIndex > 0
      ? arg.slice(equalsIndex + 1)
      : readOptionValue(argv, index++, optionName);
    if (!value) throw new CliError(`${optionName} 需要一个非空值。`);

    if (optionName === '--url') {
      options.url = validateUrl(value);
    } else if (optionName === '--samples') {
      options.samples = parseIntegerOption(value, '--samples', 1, MAX_SAMPLES);
    } else if (optionName === '--timeout-ms') {
      options.timeoutMs = parseIntegerOption(value, '--timeout-ms', 1, MAX_TIMEOUT_MS);
    } else if (optionName === '--delay-ms') {
      options.delayMs = parseIntegerOption(value, '--delay-ms', 0, MAX_DELAY_MS);
    } else if (optionName === '--max-body-bytes') {
      options.maxBodyBytes = parseIntegerOption(value, '--max-body-bytes', 1, MAX_BODY_BYTES);
    }
  }

  if (options.help) return options;
  if (!options.url) throw new CliError('必须显式提供 --url；此 CLI 没有默认目标。');
  return options;
};

const normaliseHostname = (hostname) => hostname.replace(/^\[/, '').replace(/\]$/, '');

const requestOptionsFor = (target) => ({
  protocol: target.protocol,
  hostname: normaliseHostname(target.hostname),
  ...(target.port ? { port: target.port } : {}),
  method: 'GET',
  path: `${target.pathname || '/'}${target.search}`,
  headers: {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
  },
  agent: false,
});

const contentEncodingOf = (headers) => {
  const value = headers['content-encoding'];
  if (Array.isArray(value)) return value.join(',');
  return value ?? '';
};

const decodeResponseBody = (rawBody, contentEncoding) => {
  const encodings = contentEncoding
    .split(',')
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean);
  if (encodings.length === 0 || (encodings.length === 1 && encodings[0] === 'identity')) {
    return rawBody;
  }

  let body = rawBody;
  for (let index = encodings.length - 1; index >= 0; index -= 1) {
    const encoding = encodings[index];
    if (encoding === 'identity') continue;
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      body = gunzipSync(body);
    } else if (encoding === 'deflate') {
      body = inflateSync(body);
    } else if (encoding === 'br') {
      body = brotliDecompressSync(body);
    } else {
      throw new Error('unsupported content encoding');
    }
  }
  return body;
};

const safeRequestErrorReason = (error) => {
  const code = typeof error?.code === 'string' ? error.code : '';
  const knownCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);
  return knownCodes.has(code) ? `request error (${code})` : 'request failed';
};

const failedSample = (sample, reason, ttfbMs = null) => ({
  ok: false,
  sample,
  reason,
  ttfbMs,
});

const requestOnce = (target, { sample, timeoutMs, maxBodyBytes }) => new Promise((resolveResult) => {
  const startedAt = performance.now();
  let settled = false;
  let ttfbMs = null;
  let timeoutHandle = null;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    resolveResult(result);
  };

  const transport = target.protocol === 'https:' ? https : http;
  let request;
  try {
    request = transport.request(requestOptionsFor(target), (incomingResponse) => {
      ttfbMs = performance.now() - startedAt;
      const statusCode = incomingResponse.statusCode ?? 0;

      if (statusCode < 200 || statusCode >= 300) {
        incomingResponse.resume();
        incomingResponse.once('end', () => finish(failedSample(sample, `HTTP ${statusCode}`, ttfbMs)));
        incomingResponse.once('error', () => finish(failedSample(sample, `HTTP ${statusCode}`, ttfbMs)));
        return;
      }

      const chunks = [];
      let receivedBytes = 0;
      incomingResponse.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBodyBytes) {
          incomingResponse.destroy();
          finish(failedSample(sample, `response body exceeds ${maxBodyBytes} bytes`, ttfbMs));
          return;
        }
        chunks.push(chunk);
      });
      incomingResponse.once('error', () => finish(failedSample(sample, 'response read failed', ttfbMs)));
      incomingResponse.once('end', () => {
        if (settled) return;
        const rawBody = Buffer.concat(chunks);
        const contentEncoding = contentEncodingOf(incomingResponse.headers);
        let decodedBody;
        try {
          decodedBody = decodeResponseBody(rawBody, contentEncoding);
        } catch {
          finish(failedSample(sample, 'unsupported or invalid compressed response', ttfbMs));
          return;
        }
        if (decodedBody.length > maxBodyBytes) {
          finish(failedSample(sample, `decoded response body exceeds ${maxBodyBytes} bytes`, ttfbMs));
          return;
        }

        const isWireGzip = contentEncoding.trim().toLowerCase() === 'gzip';
        finish({
          ok: true,
          sample,
          ttfbMs,
          transferBytes: rawBody.byteLength,
          gzipBytes: isWireGzip ? rawBody.byteLength : gzipSync(decodedBody).byteLength,
          gzipBytesSource: isWireGzip ? 'wire' : 'local-estimate',
          uncompressedBytes: decodedBody.byteLength,
          contentEncoding: contentEncoding.trim().toLowerCase() || 'identity',
        });
      });
    });
  } catch {
    finish(failedSample(sample, 'request setup failed'));
    return;
  }

  timeoutHandle = setTimeout(() => {
    request.destroy();
    finish(failedSample(sample, `timeout after ${timeoutMs} ms`, ttfbMs));
  }, timeoutMs);
  request.once('error', (error) => {
    if (!settled) finish(failedSample(sample, safeRequestErrorReason(error), ttfbMs));
  });
  request.end();
});

const sleep = (milliseconds) => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, milliseconds);
});

export const measureSamples = async (options) => {
  const results = [];
  for (let sample = 1; sample <= options.samples; sample += 1) {
    if (sample > 1 && options.delayMs > 0) await sleep(options.delayMs);
    results.push(await requestOnce(options.url, {
      sample,
      timeoutMs: options.timeoutMs,
      maxBodyBytes: options.maxBodyBytes,
    }));
  }
  return results;
};

const percentile = (values, probability) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

const metricStats = (values, decimals) => {
  if (values.length === 0) return null;
  const round = (value) => decimals === 0 ? Math.round(value) : Number(value.toFixed(decimals));
  return {
    count: values.length,
    min: round(Math.min(...values)),
    p50: round(percentile(values, 0.5)),
    p75: round(percentile(values, 0.75)),
    max: round(Math.max(...values)),
  };
};

export const summarize = (results) => {
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok).map((result) => ({
    sample: result.sample,
    reason: result.reason,
    ...(result.ttfbMs === null ? {} : { ttfbMs: Number(result.ttfbMs.toFixed(2)) }),
  }));
  const encodingCounts = {};
  for (const result of successes) {
    encodingCounts[result.contentEncoding] = (encodingCounts[result.contentEncoding] ?? 0) + 1;
  }

  return {
    samples: {
      requested: results.length,
      succeeded: successes.length,
      failed: failures.length,
    },
    ttfbMs: metricStats(successes.map((result) => result.ttfbMs), 2),
    gzipBytes: metricStats(successes.map((result) => result.gzipBytes), 0),
    transferBytes: metricStats(successes.map((result) => result.transferBytes), 0),
    uncompressedBytes: metricStats(successes.map((result) => result.uncompressedBytes), 0),
    contentEncoding: encodingCounts,
    failures,
  };
};

const formatMetric = (metric, unit) => {
  if (!metric) return 'n/a';
  return `p50=${metric.p50}${unit}, p75=${metric.p75}${unit}, min=${metric.min}${unit}, max=${metric.max}${unit}`;
};

export const formatReport = (report) => {
  const lines = [
    '公开 feed 性能测量',
    `样本: 请求=${report.samples.requested}, 成功=${report.samples.succeeded}, 失败=${report.samples.failed}`,
    `TTFB（成功样本）: ${formatMetric(report.ttfbMs, ' ms')}`,
    `gzip 体积（成功样本）: ${formatMetric(report.gzipBytes, ' B')}`,
    `传输体积（响应体，成功样本）: ${formatMetric(report.transferBytes, ' B')}`,
    `解压后体积（成功样本）: ${formatMetric(report.uncompressedBytes, ' B')}`,
    'gzip 说明: Content-Encoding=gzip 时为实际 gzip 响应体；其他编码为本地 gzip 等价估算。',
  ];

  const encodings = Object.entries(report.contentEncoding);
  if (encodings.length > 0) {
    lines.push(`Content-Encoding: ${encodings.map(([encoding, count]) => `${encoding}=${count}`).join(', ')}`);
  }

  if (report.failures.length === 0) {
    lines.push('失败详情: 无');
  } else {
    lines.push('失败详情:');
    for (const failure of report.failures) {
      const ttfb = failure.ttfbMs === undefined ? '' : `, TTFB=${failure.ttfbMs} ms`;
      lines.push(`  #${failure.sample}: ${failure.reason}${ttfb}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

const isMainModule = () => process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const main = async (argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) => {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const message = error instanceof CliError ? error.message : '参数校验失败。';
    io.stderr.write(`错误: ${message}\n\n${HELP_TEXT}`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  const results = await measureSamples(options);
  const report = summarize(results);
  io.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  return report.samples.failed === 0 ? 0 : 1;
};

if (isMainModule()) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
