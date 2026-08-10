import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { designTokens, useTheme } from '../lib/theme';
import { createMemo, fetchDashboardMemos, uploadFile } from '../lib/api';
import type { MemoVisibility } from '../types/shared';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface ImportExportModalProps {
  onClose: () => void;
  onImportDone?: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const getFocusableElements = (container: HTMLElement) => Array.from(
  container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
).filter((element) => {
  const computedStyle = window.getComputedStyle(element);
  return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
});

// ── Parse helpers ────────────────────────────────────────────────

function parseFrontmatterDate(raw: string): string {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const dateMatch = match[1].match(/^date:\s*(\S+)/m);
  return dateMatch?.[1]?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
}

function parseFrontmatterBody(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  const body = match ? match[1].trim() : raw.trim();
  return body.replace(/^#{1,6} +/gm, '');
}

/** Find all `images/xxx` local refs in content, return just filenames */
function findRequiredImageNames(content: string): string[] {
  const results: string[] = [];
  const re = /!\[.*?\]\(images\/([^)]+)\)/g;
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

function memoToMD(memo: {
  slug: string; displayDate: string; createdAt: string; updatedAt: string;
  visibility: string; tags: string[]; content: string;
}): string {
  const lines = ['---', `slug: ${memo.slug}`, `date: ${memo.displayDate}`,
    `created: ${memo.createdAt}`, `updated: ${memo.updatedAt}`, `visibility: ${memo.visibility}`];
  if (memo.tags.length > 0) { lines.push('tags:'); for (const t of memo.tags) lines.push(`  - ${t}`); }
  lines.push('---', '', memo.content, '');
  return lines.join('\n');
}

function filenameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() || `img_${Date.now()}`;
}

// ── Component ────────────────────────────────────────────────────

export const ImportExportModal = ({ onClose, onImportDone }: ImportExportModalProps) => {
  const { isDark } = useTheme();
  const { colors: c, spacing: s, radius: r, shadow, interaction: i } = designTokens(isDark);
  const dialogRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<'import' | 'export'>('import');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const mdInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Step 1: MD files
  const [mdFiles, setMdFiles] = useState<File[]>([]);
  // Required image names (parsed from MD files)
  const [requiredImgNames, setRequiredImgNames] = useState<string[]>([]);
  // Step 2: image files (only the ones the user picks)
  const [imgMap, setImgMap] = useState<Map<string, File>>(new Map());

  const [visibility, setVisibility] = useState<MemoVisibility>('public');
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importDone, setImportDone] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement;
    const previouslyFocusedElement = previouslyFocused instanceof HTMLElement ? previouslyFocused : null;
    const dialog = dialogRef.current;
    const firstFocusable = dialog ? getFocusableElements(dialog)[0] : null;
    (firstFocusable ?? dialog)?.focus();

    return () => {
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
    };
  }, []);

  const addLog = (msg: string) => setImportLog((prev) => [...prev, msg]);

  // Parse MD files immediately on selection to find required images
  const handleMdSelect = async (files: File[]) => {
    setMdFiles(files);
    setImportLog([]);
    setImportDone(false);
    setImgMap(new Map());

    const needed = new Set<string>();
    for (const f of files) {
      const raw = await f.text();
      const body = parseFrontmatterBody(raw);
      for (const name of findRequiredImageNames(body)) needed.add(name);
    }
    setRequiredImgNames([...needed]);
  };

  // ── Import ──────────────────────────────────────────────────────

  const handleImport = async () => {
    if (mdFiles.length === 0) return;
    setImporting(true);
    setImportLog([]);
    setImportDone(false);

    let ok = 0, fail = 0;

    for (const mdFile of mdFiles) {
      try {
        const raw = await mdFile.text();
        const displayDate = parseFrontmatterDate(raw);
        let content = parseFrontmatterBody(raw);

        for (const imgName of findRequiredImageNames(content)) {
          const imgFile = imgMap.get(imgName);
          if (imgFile) {
            try {
              const { url } = await uploadFile(imgFile);
              content = content.replaceAll(`images/${imgName}`, url);
              addLog(`  ↑ ${imgName}`);
            } catch {
              addLog(`  ✗ 上传失败: ${imgName}`);
            }
          } else {
            addLog(`  ⚠ 跳过图片: ${imgName}`);
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
      const imgCache = new Map<string, string>();

      for (let i = 0; i < memos.length; i++) {
        const memo = memos[i];
        setExportProgress(`处理 ${i + 1}/${memos.length}: ${memo.displayDate}`);
        let content = memo.content;
        for (const url of findAbsoluteImageUrls(content)) {
          if (!imgCache.has(url)) {
            try {
              const resp = await fetch(url, { credentials: 'include' });
              const blob = await resp.blob();
              const ext = filenameFromUrl(url).split('.').pop() || 'jpg';
              const fname = `${memo.slug}_${imgCache.size}.${ext}`;
              imagesFolder.file(fname, blob);
              imgCache.set(url, fname);
            } catch { /* keep url */ }
          }
          const local = imgCache.get(url);
          if (local) content = content.replaceAll(url, `images/${local}`);
        }
        zip.file(`${memo.displayDate}_${memo.slug}.md`, memoToMD({ ...memo, content }));
      }

      setExportProgress('压缩中…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `meno_export_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(a.href);
      setExportProgress(`完成！共 ${memos.length} 篇笔记，${imgCache.size} 张图片`);
    } catch (e) {
      setExportProgress(`失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(event.currentTarget);
    if (focusableElements.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }

    const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault();
      focusableElements[focusableElements.length - 1].focus();
    } else if (!event.shiftKey && (currentIndex === -1 || currentIndex === focusableElements.length - 1)) {
      event.preventDefault();
      focusableElements[0].focus();
    }
  };

  // ── Styles ───────────────────────────────────────────────────────

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: c.overlay, zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: c.cardBg, border: `1px solid ${c.borderMedium}`, borderRadius: r.lg, padding: s['3xl'], width: 500, maxWidth: '95vw',
    maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: s.lg,
    boxShadow: shadow.panel, overflowY: 'auto', color: c.textPrimary,
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: `${s.xs}px ${s.controlX}px`, borderRadius: s.none,
    fontWeight: active ? 600 : 400, fontSize: 14,
    color: active ? c.accent : c.textSecondary,
    borderBottom: active ? `2px solid ${c.accent}` : '2px solid transparent',
    transition: i.transition,
  });
  const logBox: React.CSSProperties = {
    background: c.pageBg, borderRadius: r.md, padding: s.md, fontSize: 12,
    fontFamily: 'monospace', overflowY: 'auto', maxHeight: 160,
    border: `1px solid ${c.borderMedium}`, color: c.textSecondary, whiteSpace: 'pre-wrap',
  };

  const matchedCount = requiredImgNames.filter((n) => imgMap.has(n)).length;
  const needsImageSelection = imgMap.size === 0 || matchedCount < requiredImgNames.length;

  return (
    <div role="presentation" style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="导入 / 导出"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        style={modal}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: c.textPrimary }}>导入 / 导出</h3>
          <IconButton label="关闭导入 / 导出" onClick={onClose} style={{ fontSize: 20, lineHeight: 1, color: c.textTertiary }}>×</IconButton>
        </div>

        <div style={{ display: 'flex', gap: s.xs, borderBottom: `1px solid ${c.borderMedium}`, paddingBottom: s.md }}>
          <Button variant="ghost" size="sm" aria-pressed={tab === 'import'} style={tabBtn(tab === 'import')} onClick={() => setTab('import')}>导入 MD</Button>
          <Button variant="ghost" size="sm" aria-pressed={tab === 'export'} style={tabBtn(tab === 'export')} onClick={() => setTab('export')}>导出 ZIP</Button>
        </div>

        {tab === 'import' && (
          <>
            {/* Step 1: pick MD files */}
            <input ref={mdInputRef} type="file" accept=".md" multiple style={{ display: 'none' }}
              onChange={(e) => handleMdSelect(Array.from(e.target.files ?? []))} />
            <Button variant="secondary" onClick={() => mdInputRef.current?.click()}>
              {mdFiles.length > 0 ? `✓ 已选 ${mdFiles.length} 篇笔记` : '① 选择 .md 文件（可多选）'}
            </Button>

            {/* Step 2: pick only required images */}
            {mdFiles.length > 0 && (
              <>
                {requiredImgNames.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: c.textSecondary }}>这些笔记没有本地图片引用，可直接导入。</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: s.sm }}>
                    <p style={{ margin: 0, fontSize: 13, color: c.textSecondary }}>
                      需要以下 <strong>{requiredImgNames.length}</strong> 张图片，请从 <code>images/</code> 目录中选择它们：
                    </p>
                    <div style={{ ...logBox, maxHeight: 100, fontSize: 11 }}>
                      {requiredImgNames.map((n) => (
                        `${imgMap.has(n) ? '✓' : '○'} ${n}`
                      )).join('\n')}
                    </div>
                    <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        setImgMap(new Map(files.map((f) => [f.name, f])));
                      }} />
                    <Button
                      variant={needsImageSelection ? 'primary' : 'secondary'}
                      style={needsImageSelection ? { background: c.goldText, color: c.textPrimary } : undefined}
                      onClick={() => imgInputRef.current?.click()}
                    >
                      {imgMap.size === 0
                        ? `② 选择图片文件（进入 images/ 目录，Ctrl+A 全选）`
                        : `✓ 已选 ${imgMap.size} 张图片（匹配 ${matchedCount}/${requiredImgNames.length}）`}
                    </Button>
                  </div>
                )}
              </>
            )}

            {/* Visibility */}
            {mdFiles.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: s.md, fontSize: 13, color: c.textSecondary }}>
                <span>导入为：</span>
                {(['public', 'private'] as MemoVisibility[]).map((v) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: s.xs, cursor: 'pointer', color: c.textPrimary }}>
                    <input type="radio" name="vis" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v === 'private' ? '私密' : '公开'}
                  </label>
                ))}
              </div>
            )}

            {importLog.length > 0 && <div style={logBox}>{importLog.join('\n')}</div>}

            {/* Missing images warning */}
            {!importing && !importDone && mdFiles.length > 0 && requiredImgNames.length > 0 && matchedCount < requiredImgNames.length && (
              <p style={{ margin: 0, fontSize: 12, color: c.danger, background: c.pageBg, border: `1px solid ${c.danger}`, borderRadius: r.sm, padding: `${s.sm}px ${s.inputX}px` }}>
                ⚠ 还有 {requiredImgNames.length - matchedCount} 张图片未选择，导入后将显示为断图。请先完成第②步。
              </p>
            )}

            <div style={{ display: 'flex', gap: s.md, justifyContent: 'flex-end' }}>
              {importDone && <Button variant="secondary" onClick={onClose}>关闭</Button>}
              {/* Allow import without images only if user explicitly sees the warning */}
              <Button variant="primary" onClick={handleImport} disabled={importing || mdFiles.length === 0}>
                {importing
                  ? `导入中… (${importLog.filter((l) => l.startsWith('✓')).length}/${mdFiles.length})`
                  : requiredImgNames.length > 0 && matchedCount < requiredImgNames.length
                    ? `强制导入（${matchedCount}/${requiredImgNames.length} 张图片）`
                    : `导入 ${mdFiles.length} 篇笔记`}
              </Button>
            </div>
          </>
        )}

        {tab === 'export' && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: c.textSecondary, lineHeight: 1.6 }}>
              导出所有笔记为 ZIP：每篇一个 .md 文件，图片保存到 <code>images/</code> 目录。
            </p>
            {exportProgress && <div style={{ ...logBox, maxHeight: 60 }}>{exportProgress}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: s.md }}>
              {!exporting && exportProgress.startsWith('完成') && (
                <Button variant="secondary" onClick={onClose}>关闭</Button>
              )}
              <Button variant="primary" onClick={handleExport} disabled={exporting}>
                {exporting ? '导出中…' : '下载 ZIP'}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
