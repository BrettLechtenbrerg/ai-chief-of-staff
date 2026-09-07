'use strict';
/** @param {string} text @returns {string[]} */
function captionChunks(text) {
  const chunks = [];
  let current = '';
  for (const word of text.match(/\s*\S+(?:\s+|$)/g) || []) {
    if (current && current.length + word.length > 72) { chunks.push(current); current = ''; }
    current += word;
  }
  if (current) chunks.push(current);
  return chunks;
}
/** @param {string} text @param {number} frames @param {number} fps */
function makeSrt(text, frames, fps) {
  const chunks = captionChunks(text);
  /** @param {number} frame */
  const stamp = (frame) => {
    const ms = Math.round(frame / fps * 1000);
    return new Date(ms).toISOString().slice(11, 23).replace('.', ',');
  };
  return chunks.map((chunk, i) => `${i + 1}\n${stamp(Math.ceil(i * frames / chunks.length))} --> ${stamp(Math.ceil((i + 1) * frames / chunks.length))}\n${chunk.replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n');
}
module.exports = { captionChunks, makeSrt };
