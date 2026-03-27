import { useRef, useState } from 'react';
import { useTheme, colors } from '../lib/theme';
import { createMemo, fetchDashboardMemos, uploadFile } from '../lib/api';
import type { MemoVisibility } from '../types/shared';

interface ImportExportModalProps {
  onClose: () => void;
  onImportDone?: () => void;
}

// Parse flomo/meno YAML frontmatter
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

// Find all "images/xxx" references in content
function findImagePaths(content: string): string[] {
  const results: string[] = [];
  const re = /!\[.*?\]\((images\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    results.push(m[1]);
  }
  return [...new Set(results)];
}

// Generate MD export for a single memo
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

export const ImportExportModal = ({ onClose, onImportDone }: ImportExportModalProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [tab, setTab] = useState<'import' | 'export'>('import');

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [visibility, setVisibility] = useState<MemoVisibility>('private');
  const [importing, setImporting] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  const mdFiles = selectedFiles.filter((f) => f.name.endsWith('.md'));
  const imgFileMap = new Map<string, File>(
    selectedFiles.filter((f) => !f.name.endsWith('.md')).map((f) => [f.name, f]),
  );

  const handleImport = async () => {
    if (mdFiles.length === 0) return;
    setImporting(true);
    setLog([]);
    setDone(false);

    let ok = 0;
    let fail = 0;

    for (const mdFile of mdFiles) {
      try {
        const raw = await mdFile.text();
        const displayDate = parseFrontmatterDate(raw);
        let content = parseFrontmatterBody(raw);

        // Upload referenced images
        const imgPaths = findImagePaths(content);
        for (const imgPath of imgPaths) {
          const filename = imgPath.replace('images/', '');
          const imgFile = imgFileMap.get(filename);
          if (imgFile) {
            try {
              const { url } = await uploadFile(imgFile);
              content = content.replaceAll(imgPath, url);
              addLog(`  ↑ 上传: ${filename}`);
            } catch {
              addLog(`  ✗ 图片上传失败: ${filename}`);
            }
          } else {
            addLog(`  ⚠ 未找到图片: ${filename}`);
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
    setDone(true);
    if (ok > 0) onImportDone?.();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { memos } = await fetchDashboardMemos('all');
      const content = memos.map(memoToMD).join('\n---separator---\n\n');
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meno_export_${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: c.cardBg, borderRadius: 12, padding: 24, width: 480, maxWidth: '95vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  };
  const tabBar: React.CSSProperties = { display: 'flex', gap: 4, borderBottom: `1px solid ${c.borderMedium}`, paddingBottom: 8 };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 12px',
    borderRadius: 6, fontWeight: active ? 600 : 400, fontSize: 14,
    color: active ? c.accent : c.textSecondary,
    borderBottom: active ? `2px solid ${c.accent}` : '2px solid transparent',
  });
  const btn = (primary?: boolean): React.CSSProperties => ({
    border: primary ? 'none' : `1px solid ${c.borderMedium}`,
    background: primary ? c.accent : c.cardBg,
    color: primary ? '#fff' : c.textPrimary,
    borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  });
  const logBox: React.CSSProperties = {
    background: c.pageBg, borderRadius: 8, padding: 12, fontSize: 12,
    fontFamily: 'monospace', overflowY: 'auto', maxHeight: 200,
    border: `1px solid ${c.borderMedium}`, color: c.textSecondary,
    whiteSpace: 'pre-wrap',
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: c.textPrimary }}>导入 / 导出</h3>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: c.textTertiary }}>×</button>
        </div>

        <div style={tabBar}>
          <button type="button" style={tabBtn(tab === 'import')} onClick={() => setTab('import')}>导入 MD</button>
          <button type="button" style={tabBtn(tab === 'export')} onClick={() => setTab('export')}>导出 MD</button>
        </div>

        {tab === 'import' && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: c.textSecondary }}>
              支持 flomo 导出格式。选择 .md 文件，同时选择 <code>images/</code> 目录下的图片文件（如有）。
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  setSelectedFiles(Array.from(e.target.files ?? []));
                  setLog([]);
                  setDone(false);
                }}
              />
              <button type="button" style={btn()} onClick={() => fileInputRef.current?.click()}>
                {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件 (${mdFiles.length} 篇笔记, ${imgFileMap.size} 张图片)` : '选择文件'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: c.textSecondary }}>导入为：</span>
                {(['private', 'public', 'draft'] as MemoVisibility[]).map((v) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.textPrimary }}>
                    <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v === 'private' ? '私密' : v === 'public' ? '公开' : '草稿'}
                  </label>
                ))}
              </div>
            </div>

            {log.length > 0 && <div style={logBox}>{log.join('\n')}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {done && <button type="button" style={btn()} onClick={onClose}>关闭</button>}
              <button
                type="button"
                style={btn(true)}
                onClick={handleImport}
                disabled={importing || mdFiles.length === 0}
              >
                {importing ? `导入中… (${log.filter((l) => l.startsWith('✓')).length}/${mdFiles.length})` : `导入 ${mdFiles.length} 篇笔记`}
              </button>
            </div>
          </>
        )}

        {tab === 'export' && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: c.textSecondary }}>
              导出所有笔记为单个 MD 文件，每篇笔记包含 YAML frontmatter（slug、date、tags 等）。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={btn(true)} onClick={handleExport} disabled={exporting}>
                {exporting ? '导出中…' : '下载 meno_export.md'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
