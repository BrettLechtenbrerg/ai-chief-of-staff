import { validateBrowserUrl } from '../agent/safety.js';

/** Browser reads must not turn an already-open local document into model context. */
export async function readWebPage<T>(getUrl: () => string, read: () => Promise<T>): Promise<T> {
  const url = getUrl();
  if (!validateBrowserUrl(url).allowed) throw new Error('Local/internal browser content is blocked. Use explicitly approved file tools.');
  const result = await read();
  if (getUrl() !== url) throw new Error('Page changed during browser read. Retry on the intended web page.');
  return result;
}
