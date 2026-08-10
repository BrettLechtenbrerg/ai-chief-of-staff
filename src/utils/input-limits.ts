import path from 'path';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_READ_BYTES = 20 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf', '.log', '.sql', '.graphql', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.svg', '.bmp', '.ico', '.pdf', '.docx', '.doc', '.rtf', '.odt', '.pages', '.xlsx', '.xls', '.ods',
  '.numbers', '.pptx', '.ppt', '.odp', '.keynote', '.epub', '.zip', '.tar', '.gz',
]);

export function getValidatedBase64ByteLength(value: string, maxBytes: number): number {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new Error('Base64 payload exceeds the size limit');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('Invalid base64 payload');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedSize = (value.length / 4) * 3 - padding;
  if (decodedSize <= 0 || decodedSize > maxBytes) throw new Error('Base64 payload exceeds the size limit');
  return decodedSize;
}

export interface DecodedDataUrl {
  bytes: Buffer;
  mimeType: string;
  safeName: string;
}

export function decodeBoundedAttachment(name: string, dataUrl: string): DecodedDataUrl {
  if (typeof name !== 'string' || !name || name.length > 255 || name.includes('\0')) {
    throw new Error('Invalid attachment name');
  }
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 1024) {
    throw new Error('Attachment exceeds the 10 MB limit');
  }

  if (path.basename(name) !== name) throw new Error('Attachment name must not contain a path');
  const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const extension = path.extname(safeName).toLowerCase();
  if (!safeName || !ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported attachment type');
  }

  const match = /^data:([^;,]{1,127});base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new Error('Invalid attachment data URL');
  const mimeType = match[1].toLowerCase();
  if (!/^(?:image|text|application)\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new Error('Unsupported attachment MIME type');
  }

  const decodedSize = getValidatedBase64ByteLength(match[2], MAX_ATTACHMENT_BYTES);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length !== decodedSize) throw new Error('Invalid attachment encoding');
  return { bytes, mimeType, safeName };
}
