/**
 * Context-tab file-extraction IPC.
 *
 * Renders the Personalize → Context drag-drop: when a user drops a .txt,
 * .md, .docx, or .pdf file onto one of the five Context textareas, the
 * renderer sends the absolute path here and we return the extracted
 * plain text. The renderer then appends it to the field's existing value.
 *
 * Security notes:
 *  - Only handles the four extensions we explicitly support.
 *  - 10 MB hard cap on file size to keep this responsive and prevent
 *    runaway extraction on a hostile PDF.
 *  - Returns text only — never writes anything to disk.
 */
import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.docx', '.pdf']);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ExtractTextResult {
  success: boolean;
  text?: string;
  filename?: string;
  /** Number of characters extracted (after light whitespace normalization). */
  charCount?: number;
  /** Cleaned filename for display in toasts. */
  error?: string;
}

async function extractTxt(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

async function extractDocx(filePath: string): Promise<string> {
  // mammoth converts .docx to text, dropping formatting but preserving
  // paragraph breaks and list structure.
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function extractPdf(filePath: string): Promise<string> {
  // pdfjs-dist is Mozilla's PDF.js. We load the file as a buffer, then
  // iterate every page and concatenate the text items. Works for any
  // PDF with a real text layer; image-only / scanned PDFs return empty
  // text (we surface this as a friendly error to the renderer).
  const data = await fs.readFile(filePath);
  // Dynamic import to keep cold-start fast and avoid pulling pdf.js into
  // the main bundle when nobody uses drag-drop.
  // The legacy build is the right one for Node-side parsing.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs wants a Uint8Array, not a Node Buffer reference.
  const uint8 = new Uint8Array(data);
  const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string }>;
    const pageText = items
      .map((it) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (pageText) pageTexts.push(pageText);
  }
  await doc.destroy();
  return pageTexts.join('\n\n');
}

export function registerContextIPC(): void {
  ipcMain.handle('context:extractText', async (_, filePath: string): Promise<ExtractTextResult> => {
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { success: false, error: 'No file path provided.' };
      }

      const absPath = path.resolve(filePath);
      const ext = path.extname(absPath).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return {
          success: false,
          error: `Unsupported file type: ${ext || '(none)'}. Supported: .txt, .md, .docx, .pdf`,
        };
      }

      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch {
        return { success: false, error: 'File not found or unreadable.' };
      }
      if (!stat.isFile()) {
        return { success: false, error: 'Drop target is not a file.' };
      }
      if (stat.size > MAX_FILE_BYTES) {
        const mb = (stat.size / 1024 / 1024).toFixed(1);
        return {
          success: false,
          error: `File too large (${mb} MB). Max 10 MB \u2014 split into smaller chunks or paste manually.`,
        };
      }

      let text: string;
      if (ext === '.txt' || ext === '.md') {
        text = await extractTxt(absPath);
      } else if (ext === '.docx') {
        text = await extractDocx(absPath);
      } else if (ext === '.pdf') {
        text = await extractPdf(absPath);
      } else {
        // Unreachable thanks to the set check above; satisfies the compiler.
        return { success: false, error: `Unsupported file type: ${ext}` };
      }

      // Light normalization: trim ends, collapse runs of >2 blank lines.
      text = text.trim().replace(/\n{3,}/g, '\n\n');

      if (!text) {
        return {
          success: false,
          error:
            ext === '.pdf'
              ? 'No text found in this PDF \u2014 it may be a scanned image. Open it, copy the text, and paste it directly.'
              : 'File contained no extractable text.',
        };
      }

      return {
        success: true,
        text,
        filename: path.basename(absPath),
        charCount: text.length,
      };
    } catch (err) {
      console.error('[Context IPC] extractText failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown extraction error.',
      };
    }
  });
}
