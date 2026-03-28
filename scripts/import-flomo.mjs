#!/usr/bin/env node
/**
 * 批量导入 flomo 导出的 md 文件到 Meno
 * 用法：node scripts/import-flomo.mjs
 *
 * 需要 Node.js 18+（内置 fetch、FormData、Blob）
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// ── 配置 ──────────────────────────────────────────────────────────
const FLOMO_DIR = '/Volumes/Store/Downloads/flomo_export';
const IMAGES_DIR = path.join(FLOMO_DIR, 'images');
const API_BASE = 'https://api.meno.guoyingwei.top';
const API_KEY = 'meno-quick-api-2026';
const PROGRESS_FILE = path.join(import.meta.dirname, 'flomo-imported.json');
const CONCURRENCY = 5; // 并发图片上传数
// ─────────────────────────────────────────────────────────────────

// ── 解析 frontmatter ───────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { date: null, body: raw.trim() };

  const fm = match[1];
  const body = match[2];

  // date: 2025-02-24 10:01:55
  const dateMatch = fm.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  const date = dateMatch?.[1] ?? null;

  return { date, body };
}

// ── 分离正文和附件区 ──────────────────────────────────────────

function splitBodyAndAttachments(body) {
  // 找 ---\n**附件：** 或 ---\n**附件:**
  const sepIdx = body.search(/\n---+\n\*\*附件[：:]\*\*/);
  if (sepIdx === -1) return { text: body.trim(), imageNames: [] };

  const text = body.slice(0, sepIdx).trim();
  const attachPart = body.slice(sepIdx);

  // 提取所有 images/xxx 引用
  const imageNames = [];
  const re = /!\[.*?\]\(images\/([^)]+)\)/g;
  let m;
  while ((m = re.exec(attachPart)) !== null) imageNames.push(m[1]);

  return { text, imageNames: [...new Set(imageNames)] };
}

// ── 修复行内容格式 ────────────────────────────────────────────

function fixLineBreaks(text) {
  // 确保 发布者: 发布者主页: 原笔记链接: 各自单独成段（前加空行）
  return text
    .replace(/([^\n])\n(发布者[：:])/g, '$1\n\n$2')
    .replace(/([^\n])\n(发布者主页[：:])/g, '$1\n\n$2')
    .replace(/([^\n])\n(原笔记链接[：:])/g, '$1\n\n$2');
}

// ── 剥掉 Markdown 标题语法 ────────────────────────────────────
// 只剥 "## 文字"（# 后紧跟空格），不动 "#标签"（# 后无空格）

function stripMarkdownHeadings(text) {
  return text.replace(/^#{1,6} +/gm, '');
}

// ── 检查并补充小红书标签 ──────────────────────────────────────

function ensureXiaohongshuTag(text) {
  const hasXhsContent = /小红书/.test(text);
  const hasXhsTag = /#平台\/小红书/.test(text);
  if (hasXhsContent && !hasXhsTag) {
    // 在第一行末尾添加标签（如果第一行已有 # 标签则追加，否则前置）
    const lines = text.split('\n');
    const firstTagLine = lines.findIndex((l) => /^#\S/.test(l.trim()));
    if (firstTagLine !== -1) {
      lines[firstTagLine] = lines[firstTagLine].trimEnd() + ' #平台/小红书';
    } else {
      lines.unshift('#平台/小红书');
    }
    return lines.join('\n');
  }
  return text;
}

// ── 并发控制 ──────────────────────────────────────────────────

async function mapConcurrent(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── 上传图片 ──────────────────────────────────────────────────

async function uploadImage(imgName) {
  const imgPath = path.join(IMAGES_DIR, imgName);
  if (!existsSync(imgPath)) return null;

  const fileBuffer = await readFile(imgPath);
  const ext = imgName.split('.').pop() || 'jpg';
  const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  const mime = mimeTypes[ext.toLowerCase()] || 'image/jpeg';

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mime });
  formData.append('file', blob, imgName);

  const res = await fetch(`${API_BASE}/api/quick/upload`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`上传失败 ${imgName}: ${res.status} ${text}`);
  }

  const { url } = await res.json();
  return url;
}

// ── 创建 memo ─────────────────────────────────────────────────

async function createMemo({ content, displayDate, imageUrls }) {
  const imgPart = imageUrls.map((url) => `![](${url})`).join('\n');
  const fullContent = [content, imgPart].filter(Boolean).join('\n');

  const res = await fetch(`${API_BASE}/api/quick/memos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ content: fullContent, visibility: 'public', displayDate }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`创建 memo 失败: ${res.status} ${text}`);
  }

  return res.json();
}

// ── 主流程 ────────────────────────────────────────────────────

async function main() {
  // 加载进度
  let imported = new Set();
  if (existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(await readFile(PROGRESS_FILE, 'utf8'));
    imported = new Set(data);
    console.log(`已跳过 ${imported.size} 个已导入文件`);
  }

  // 读取所有 md 文件
  const allFiles = (await readdir(FLOMO_DIR)).filter((f) => f.endsWith('.md')).sort();
  const pending = allFiles.filter((f) => !imported.has(f));
  console.log(`共 ${allFiles.length} 个文件，待导入 ${pending.length} 个\n`);

  let ok = 0, fail = 0;

  for (let i = 0; i < pending.length; i++) {
    const filename = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${filename}`);

    try {
      const raw = await readFile(path.join(FLOMO_DIR, filename), 'utf8');
      const { date, body } = parseFrontmatter(raw);
      const displayDate = date ?? new Date().toISOString().slice(0, 10);

      const { text, imageNames } = splitBodyAndAttachments(body);

      // 处理文本
      let content = stripMarkdownHeadings(text);
      content = fixLineBreaks(content);
      content = ensureXiaohongshuTag(content);

      // 并发上传图片
      let imageUrls = [];
      if (imageNames.length > 0) {
        console.log(`  上传 ${imageNames.length} 张图片...`);
        const results = await mapConcurrent(imageNames, CONCURRENCY, async (name) => {
          try {
            const url = await uploadImage(name);
            if (url) {
              process.stdout.write(`  ↑ ${name}\n`);
              return url;
            } else {
              process.stdout.write(`  ⚠ 图片不存在: ${name}\n`);
              return null;
            }
          } catch (e) {
            process.stdout.write(`  ✗ ${e.message}\n`);
            return null;
          }
        });
        imageUrls = results.filter(Boolean);
      }

      // 创建 memo
      await createMemo({ content, displayDate, imageUrls });
      ok++;
      imported.add(filename);

      // 每10个保存一次进度
      if (ok % 10 === 0) {
        await writeFile(PROGRESS_FILE, JSON.stringify([...imported], null, 2));
        console.log(`  [进度已保存] 成功 ${ok} 个\n`);
      }

      console.log(`  ✓ ${displayDate} (${imageUrls.length}张图)`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${e.message}`);
    }
  }

  // 保存最终进度
  await writeFile(PROGRESS_FILE, JSON.stringify([...imported], null, 2));
  console.log(`\n完成！成功 ${ok} 个，失败 ${fail} 个`);
  console.log(`进度保存至: ${PROGRESS_FILE}`);
}

main().catch((e) => {
  console.error('致命错误:', e);
  process.exit(1);
});
