import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { captionChunks } from './captions.cjs';

type Props = {
  elements: { verbal: string; text: string; visual: string; audio: string; caption: string };
  brandName?: string;
  background?: string;
  foreground?: string;
  accent?: string;
  cta?: string;
};

/** Silent, deterministic typography preset. Visual/sonic directions remain review notes. */
export const Storyboard = ({ elements, brandName = '', background = '#132031', foreground = '#f1f5f9', accent = '#61dbef', cta = '' }: Props) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const chunks = captionChunks(elements.verbal);
  const caption = chunks[Math.min(chunks.length - 1, Math.floor(frame / durationInFrames * chunks.length))] || '';
  const scale = Math.min(width, height) / 1080;
  return <AbsoluteFill style={{ background, color: foreground, padding: `${height * 0.1}px ${width * 0.1}px`, fontFamily: 'Arial, sans-serif', justifyContent: 'space-between', boxSizing: 'border-box' }}>
    <div style={{ fontSize: 30 * scale, color: accent, overflowWrap: 'anywhere' }}>{brandName}</div>
    <div style={{ fontSize: 64 * scale, lineHeight: 1.15, fontWeight: 700, overflowWrap: 'anywhere', opacity: Math.min(1, (frame + 1) / 12) }}>{elements.text}</div>
    <div style={{ fontSize: 44 * scale, lineHeight: 1.3, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{caption}</div>
    <div style={{ fontSize: 36 * scale, color: accent, overflowWrap: 'anywhere' }}>{cta}</div>
  </AbsoluteFill>;
};
