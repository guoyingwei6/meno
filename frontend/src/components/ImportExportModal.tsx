import { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { useTheme, colors } from '../lib/theme';
import { createMemo, fetchDashboardMemos, uploadFile } from '../lib/api';
import type { MemoVisibility } from '../types/shared';

interface ImportExportModalProps {
  onClose: () => void;
  onImportDone?: () => void;
}

// ── Parse helpers ────────────────────────────────────────────────

function parseFrontmatterDate(raw: string): string {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const dateMatch = match[1].match(/^date:\s*(\S+)/m);
  return dateMatch?.[1]?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
}

function parseFrontmatterBody(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1].trim() : raw.trim();
}

/** Find all `images/xxx` local refs in content */
function findLocalImagePaths(content: string): string[] {
  const results: string[] = [];
  const re = /!\[.*?\]\((images\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) results.push(m[1]);
  return [...new Set(results)];
}

/** Find all absolute image URLs in content */
function findAbsoluteImageUrls(content: string): string[] {
  const results: string[] = [];
  const re = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) results.push(m[1]);
  return [...new Set(results)];
}

/** Generate MD text for a memo (for export) */
function memoToMD(memo: {
  slug: string;
  displayDate: string;
  createdAt: string;
  updatedAt: string;
  visibility: string;
  tags: string[];
  content: string;
}): string {
  const lines = [
    '---',
    `slug: ${memo.slug}`,
    `date: ${memo.displayDate}`,
    `created: ${memo.createdAt}`,
    `updated: ${memo.updatedAt}`,
    `visibility: ${memo.visibility}`,
  ];
  if (memo.tags.length > 0) {
    lines.push('tags:');
    for (const tag of memo.tags) lines.push(`  - ${tag}`);
  }
  lines.push('---', '', memo.content, '');
  return lines.join('\n');
}

/** Derive a short filename from a URL */
function filenameFromUrl(url: string): string {
  const path = url.split('?')[0];
  return path.split('/').pop() || `img_${Date.now()}`;
}

// ── Component ────────────────────────────────────────────────────

export const ImportExportModal = ({ onClose, onImportDone }: ImportExportModalProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [tab, setTab] = useState<'import' | 'export'>('import');

  // Import state
  const mdInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [mdFiles, setMdFiles] = useState<File[]>([]);
  const [imgMap, setImgMap] = useState<Map<string, File>>(new Map());
  const [visibility, setVisibility] = useState<MemoVisibility>('private');
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importDone, setImportDone] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');


  // webkitdirectory is not in React types, set via ref
  useEffect(() => {
    imgInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const addLog = (msg: string) => setImportLog((prev) => [...prev, msg]);

  // ── Import ──────────────────────────────────────────────────────

  const handleImport = async () => {
    if (mdFiles.length === 0) return;
    setImporting(true);
    setImportLog([]);
    setImportDone(false);

    let ok = 0;
    let fail = 0;

    for (const mdFile of mdFiles) {
      try {
        const raw = await mdFile.text();
        const displayDate = parseFrontmatterDate(raw);
        let content = parseFrontmatterBody(raw);

        // Upload each referenced local image
        const localPaths = findLocalImagePaths(content);
        for (const imgPath of localPaths) {
          const filename = imgPath.replace('images/', '');
          const imgFile = imgMap.get(filename);
          if (imgFile) {
            try {
              const { url } = await uploadFile(imgFile);
              content = content.replaceAll(imgPath, url);
              addLog(`  ↑ ${filename}`);
            } catch {
              addLog(`  ✗ 上传失败: ${filename}`);
            }
          } else {
            addLog(`  ⚠ 未找到: ${filename}`);
          }
        }

        await createMemo({ content, visibility, displayDate });
        ok++;
        addLog(`✓ ${mdFile.name} (${displayDate})`);
      } catch (e) {
        fail++;
        addLog(`✗ ${mdFile.name}: ${e instanceof Error ? e.message : '失败'}`);
      }
    }

    addLog(`\n完成: ${ok} 成功, ${fail} 失败`);
    setImporting(false);
    setImportDone(true);
    if (ok > 0) onImportDone?.();
  };

  // ── Export ──────────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    setExportProgress('获取笔记列表…');
    try {
      const { memos } = await fetchDashboardMemos('all');
      const zip = new JSZip();
      const imagesFolder = zip.folder('images')!;
      const imgCache = new Map<string, string>(); // url -> filename in zip

      for (let i = 0; i < memos.length; i++) {
        const memo = memos[i];
        setExportProgress(`处理 ${i + 1}/${memos.length}: ${memo.displayDate}`);

        let content = memo.content;
        const urls = findAbsoluteImageUrls(content);

        for (const url of urls) {
          if (!imgCache.has(url)) {
            try {
              const resp = await fetch(url, { credentials: 'include' });
              const blob = await resp.blob();
              const ext = filenameFromUrl(url).split('.').pop() || 'jpg';
              const imgFilename = `${memo.slug}_${imgCache.size}.${ext}`;
              imagesFolder.file(imgFilename, blob);
              imgCache.set(url, imgFilename);
            } catch {
              // keep original URL if download fails
            }
          }
          const localName = imgCache.get(url);
          if (localName) content = content.replaceAll(url, `images/${localName}`);
        }

        const md = memoToMD({ ...memo, content });
        zip.file(`${memo.displayDate}_${memo.slug}.md`, md);
      }

      setExportProgress('压缩中…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `meno_export_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      setExportProgress(`完成！共 ${memos.length} 篇笔记，${imgCache.size} 张图片`);
    } catch (e) {
      setExportProgress(`失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Styles ───────────────────────────────────────────────────────

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: c.cardBg, borderRadius: 12, padding: 24, width: 500, maxWidth: '95vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 14px',
    borderRadius: 6, fontWeight: active ? 600 : 400, fontSize: 14,
    color: active ? c.accent : c.textSecondary,
    borderBottom: active ? `2px solid ${c.accent}` : '2px solid transparent',
  });
  const btn = (primary?: boolean, disabled?: boolean): React.CSSProperties => ({
    border: primary ? 'none' : `1px solid ${c.borderMedium}`,
    background: primary ? (disabled ? '#aaa' : c.accent) : c.cardBg,
    color: primary ? '#fff' : c.textPrimary,
    borderRadius: 8, padding: '8px 16px', cursor: disabled ? 'default' : 'pointer',
    fontSize: 13, fontWeight: 500, opacity: disabled ? 0.7 : 1,
  });
  const logBox: React.CSSProperties = {
    background: c.pageBg, borderRadius: 8, padding: 12, fontSize: 12,
    fontFamily: 'monospace', overflowY: 'auto', maxHeight: 180, flexShrink: 0,
    border: `1px solid ${c.borderMedium}`, color: c.textSecondary, whiteSpace: 'pre-wrap',
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: c.textPrimary }}>导入 / 导出</h3>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: c.textTertiary }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${c.borderMedium}`, paddingBottom: 8 }}>
          <button type="button" style={tabBtn(tab === 'import')} onClick={() => setTab('import')}>导入 MD</button>
          <button type="button" style={tabBtn(tab === 'export')} onClick={() => setTab('export')}>导出 ZIP</button>
        </div>

        {/* ── Import Tab ── */}
        {tab === 'import' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* MD file picker */}
              <input
                ref={mdInputRef}
                type="file"
                accept=".md"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  setMdFiles(Array.from(e.target.files ?? []));
                  setImportLog([]);
                  setImportDone(false);
                }}
              />
              <button type="button" style={btn()} onClick={() => mdInputRef.current?.click()}>
                {mdFiles.length > 0 ? `已选 ${mdFiles.length} 篇笔记` : '① 选择 .md 文件（可多选）'}
              </button>

              {/* Images folder picker (webkitdirectory) */}
              <input
                ref={imgInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setImgMap(new Map(files.map((f) => [f.name, f])));
                }}
              />
              <button type="button" style={{ ...btn(), fontSize: 12 }} onClick={() => imgInputRef.current?.click()}>
                {imgMap.size > 0 ? `已选图片目录：${imgMap.size} 张图片` : '② 选择 images/ 文件夹（可选，自动匹配）'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: c.textSecondary }}>
                <span>导入为：</span>
                {(['private', 'public', 'draft'] as MemoVisibility[]).map((v) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.textPrimary }}>
                    <input type="radio" name="vis" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v === 'private' ? '私密' : v === 'public' ? '公开' : '草稿'}
                  </label>
                ))}
              </div>
            </div>

            {importLog.length > 0 && <div style={logBox}>{importLog.join('\n')}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {importDone && <button type="button" style={btn()} onClick={onClose}>关闭</button>}
              <button
                type="button"
                style={btn(true, importing || mdFiles.length === 0)}
                onClick={handleImport}
                disabled={importing || mdFiles.length === 0}
              >
                {importing
                  ? `导入中… (${importLog.filter((l) => l.startsWith('✓')).length}/${mdFiles.length})`
                  : `导入 ${mdFiles.length} 篇笔记`}
              </button>
            </div>
          </>
        )}

        {/* ── Export Tab ── */}
        {tab === 'export' && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: c.textSecondary, lineHeight: 1.6 }}>
              将所有笔记导出为 ZIP 文件：每篇笔记一个 .md 文件，图片下载后放在 <code>images/</code> 目录中。
            </p>
            {exportProgress && (
              <div style={{ ...logBox, maxHeight: 60 }}>{exportProgress}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {!exporting && exportProgress.startsWith('完成') && (
                <button type="button" style={btn()} onClick={onClose}>关闭</button>
              )}
              <button type="button" style={btn(true, exporting)} onClick={handleExport} disabled={exporting}>
                {exporting ? '导出中…' : '下载 ZIP'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
