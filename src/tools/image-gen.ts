/**
 * Image generation tool — calls OpenAI's gpt-image-1 to produce hero
 * images for the weekly blog post cron.
 *
 * Design notes:
 *  - Uses the existing OpenAI key from Settings (same one Whisper uses).
 *  - Style template is enforced in the tool itself (not the prompt the
 *    agent passes in) so every generated image stays on-brand even if a
 *    future routine prompt forgets the style line.
 *  - Output path is validated against the TSAI-Site/public/blog-images/
 *    directory \u2014 the agent can't write images anywhere else on disk.
 *  - gpt-image-1 returns base64 (not a URL) when called without
 *    response_format, so we decode + write directly.
 *
 * Pricing: ~$0.04 per image at standard quality, ~$0.17 at high quality.
 * Weekly cron = $2\u2013$9/year. Trivial.
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { SettingsManager } from '../settings';

export type ImageStyle = 'photo-realistic' | 'editorial-illustration';

export interface GenerateBlogImageInput {
  /** What to draw. The tool prepends a style preamble to this. */
  prompt: string;
  /** Defaults to photo-realistic. */
  style?: ImageStyle;
  /** Absolute path inside ~/dev/TSAI-Site/public/blog-images/ */
  outputPath: string;
  /**
   * If true (default), also save a copy to ~/Desktop/ with a
   * `blog-hero-preview-` prefix so Brett can preview the image natively
   * without hunting through the repo. The Desktop copy is for review
   * only — the repo copy is what gets committed to the PR.
   */
  desktopCopy?: boolean;
  /**
   * If true, generate a SECOND 1024x1024 square image suitable for
   * Instagram. Saved next to outputPath with `-square` appended before
   * the .png extension. Costs ~$0.04 extra at quality:'high'.
   */
  generateSquare?: boolean;
}

export interface GenerateBlogImageResult {
  success: boolean;
  outputPath?: string;
  /** Path of the Desktop preview copy, if one was saved. */
  desktopCopyPath?: string;
  /** Path of the IG-square variant, if generateSquare was true. */
  squarePath?: string;
  /** Path of the Desktop preview of the square image, if generated. */
  squareDesktopCopyPath?: string;
  bytes?: number;
  squareBytes?: number;
  error?: string;
}

/**
 * Where the Desktop preview copy lives. Files here are throwaway —
 * Brett looks at them to decide on the PR, then deletes when the post
 * is merged. The prefix makes them easy to spot/sort/cull.
 */
function desktopPreviewPath(repoPath: string): string {
  const home = process.env.HOME || '';
  // Use the repo filename, prefixed, so the Desktop copy is self-labeling.
  const filename = `blog-hero-preview-${path.basename(repoPath)}`;
  return path.join(home, 'Desktop', filename);
}

// Allowed output directories for generated images. The tool can write
// into any of these but nowhere else — prevents the agent from dropping
// PNGs into random places on disk.
//
// 1. ~/Desktop/Blogs/ — the tester-facing default for the Content Writer
//    sidebar feature. The agent creates per-article subfolders here
//    (e.g. ~/Desktop/Blogs/2026-05-21-my-post/hero.png) so testers can
//    find their generated posts without hunting through the filesystem.
// 2. Each brand's site repo public/blog-images/ — where committed images live
//    for blogs hosted on github-next (currently TSAI).
// 3. The _brand-profiles/_inbox/ folder — where images for GHL-blog brands
//    (PMMA, brett-personal) land. Brett uploads from here.
const ALLOWED_DIRS = [
  path.resolve(process.env.HOME || '', 'Desktop/Blogs'),
  path.resolve(process.env.HOME || '', 'dev/TSAI-Site/public/blog-images'),
  path.resolve(
    process.env.HOME || '',
    'dev/PMMA-Website-2026-Master/public/blog-images',
  ),
  path.resolve(
    process.env.HOME || '',
    'dev/BL-2026-Personal-Site/public/blog-images',
  ),
  path.resolve(process.env.HOME || '', 'dev/_brand-profiles/_inbox'),
];



const PHOTO_REALISTIC_PREAMBLE =
  'Photo-realistic editorial photograph, natural lighting, clean composition, professional quality, no text in image, no watermarks, no logos. Subject:';
const EDITORIAL_ILLUSTRATION_PREAMBLE =
  "Clean editorial illustration, navy and silver color palette (#0A1F44, #C0C0C0), isometric or flat vector style, no people's faces, no text in image, no watermarks, no logos. Subject:";

/**
 * Build the final image prompt by prepending the style preamble.
 * Exported for tests so we can assert the wiring without an API call.
 */
export function buildPrompt(userPrompt: string, style: ImageStyle): string {
  const preamble =
    style === 'editorial-illustration'
      ? EDITORIAL_ILLUSTRATION_PREAMBLE
      : PHOTO_REALISTIC_PREAMBLE;
  return `${preamble} ${userPrompt.trim()}`;
}

/**
 * Validate that outputPath is inside the allowed directory. Throws so the
 * caller surfaces the failure to the agent (which can fix the path and
 * retry) instead of silently writing somewhere unexpected.
 */
function validateOutputPath(outputPath: string): string {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('outputPath is required');
  }
  if (!outputPath.toLowerCase().endsWith('.png')) {
    throw new Error('outputPath must end with .png');
  }
  const resolved = path.resolve(outputPath);
  const allowed = ALLOWED_DIRS.some(
    (dir) => resolved === dir || resolved.startsWith(dir + path.sep),
  );
  if (!allowed) {
    throw new Error(
      `outputPath must be inside one of: ${ALLOWED_DIRS.join(', ')} (got: ${resolved})`,
    );
  }
  return resolved;
}

/**
 * Generate a hero image and save to disk. Returns the saved path so the
 * agent can reference it in the blog frontmatter.
 */
export async function generateBlogImage(
  input: GenerateBlogImageInput,
): Promise<GenerateBlogImageResult> {
  if (!input || typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    return { success: false, error: 'prompt is required' };
  }
  const style: ImageStyle = input.style === 'editorial-illustration'
    ? 'editorial-illustration'
    : 'photo-realistic';

  let resolved: string;
  try {
    resolved = validateOutputPath(input.outputPath);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  const apiKey = SettingsManager.get('openai.apiKey');
  if (!apiKey) {
    return {
      success: false,
      error:
        'OpenAI API key not configured. Add your OpenAI key in Settings to enable image generation.',
    };
  }

  const finalPrompt = buildPrompt(input.prompt, style);

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: finalPrompt,
      size: '1536x1024',
      quality: 'high',
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      return { success: false, error: 'OpenAI returned no image data' };
    }

    const buffer = Buffer.from(b64, 'base64');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, buffer);

    // Desktop preview copy (default ON). Best-effort — if the write fails
    // we still return success for the repo file. The preview is a
    // convenience, not a contract.
    let desktopCopyPath: string | undefined;
    if (input.desktopCopy !== false) {
      try {
        const previewPath = desktopPreviewPath(resolved);
        fs.mkdirSync(path.dirname(previewPath), { recursive: true });
        fs.writeFileSync(previewPath, buffer);
        desktopCopyPath = previewPath;
      } catch (err) {
        console.warn(
          '[image-gen] Desktop preview copy failed (repo file is still saved):',
          (err as Error).message,
        );
      }
    }

    // Optional Instagram-square variant. Same prompt + style, different size.
    // Best-effort: if the square generation fails, we still return success
    // for the main image so the routine can continue.
    let squarePath: string | undefined;
    let squareBytes: number | undefined;
    let squareDesktopCopyPath: string | undefined;
    if (input.generateSquare === true) {
      try {
        const squareResolvedPath = resolved.replace(/\.png$/i, '-square.png');
        // Square output stays in the same allowed dir as the hero — inheriting
        // its validation. Re-validate to be safe.
        validateOutputPath(squareResolvedPath);

        const squareResponse = await openai.images.generate({
          model: 'gpt-image-1',
          prompt: finalPrompt,
          size: '1024x1024',
          quality: 'high',
          n: 1,
        });
        const sb64 = squareResponse.data?.[0]?.b64_json;
        if (sb64) {
          const sbuffer = Buffer.from(sb64, 'base64');
          fs.writeFileSync(squareResolvedPath, sbuffer);
          squarePath = squareResolvedPath;
          squareBytes = sbuffer.length;

          // Desktop preview for the square too, if desktopCopy is on.
          if (input.desktopCopy !== false) {
            try {
              const sPreview = desktopPreviewPath(squareResolvedPath);
              fs.writeFileSync(sPreview, sbuffer);
              squareDesktopCopyPath = sPreview;
            } catch (err) {
              console.warn(
                '[image-gen] Square Desktop preview failed:',
                (err as Error).message,
              );
            }
          }
        } else {
          console.warn('[image-gen] Square generation returned no image data');
        }
      } catch (err) {
        console.warn(
          '[image-gen] Square generation failed (main hero is still saved):',
          (err as Error).message,
        );
      }
    }

    return {
      success: true,
      outputPath: resolved,
      desktopCopyPath,
      squarePath,
      squareBytes,
      squareDesktopCopyPath,
      bytes: buffer.length,
    };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) {
        return {
          success: false,
          error: 'Invalid OpenAI API key. Please check your key in Settings.',
        };
      }
      if (err.status === 429) {
        return {
          success: false,
          error: 'OpenAI rate limit exceeded. Please try again in a moment.',
        };
      }
      return { success: false, error: `OpenAI API error: ${err.message}` };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/** Tool definition exposed to the agent. */
export function getGenerateBlogImageToolDefinition() {
  return {
    name: 'generate_blog_image',
    description:
      "Generate a hero image for a blog post using OpenAI gpt-image-1, save it to ~/dev/TSAI-Site/public/blog-images/, AND drop a preview copy on Brett's Desktop (prefixed blog-hero-preview-) so he can eyeball it without hunting through the repo. Use photo-realistic style when the subject is a real-world scene/object/place/activity; use editorial-illustration when the subject is abstract (data, software, concepts). The tool enforces a style preamble \u2014 you only need to describe the subject.",
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description:
            "Describe what to depict. Don't include style words like 'photo-realistic' \u2014 the tool adds the style preamble automatically. Example: 'A small business owner reviewing a laptop dashboard at a clean wooden desk, morning light through a window.'",
        },
        style: {
          type: 'string',
          enum: ['photo-realistic', 'editorial-illustration'],
          description: "Default 'photo-realistic'. Use 'editorial-illustration' for abstract subjects.",
        },
        outputPath: {
          type: 'string',
          description:
            "Absolute path. Must end with .png. Allowed parent dirs: ~/dev/TSAI-Site/public/blog-images/, ~/dev/PMMA-Website-2026-Master/public/blog-images/, ~/dev/BL-2026-Personal-Site/public/blog-images/, or ~/dev/_brand-profiles/_inbox/. The cron picks the right dir per the brand's blog backend.",
        },
        desktopCopy: {
          type: 'boolean',
          description:
            'Default true. Save a preview copy to ~/Desktop/blog-hero-preview-[filename] for Brett to eyeball before merging the PR. Pass false to skip the Desktop copy.',
        },
        generateSquare: {
          type: 'boolean',
          description:
            'Default false. When true, generate a SECOND 1024x1024 square image variant for Instagram. Saved next to outputPath with `-square` appended before .png. Costs an extra ~$0.04 at quality:high. Pass true for any brand whose profile.image.generateSquareForInstagram is true (TSAI, PMMA, Brett-personal all enabled by default).',
        },
      },
      required: ['prompt', 'outputPath'],
    },
  };
}

export async function handleGenerateBlogImageTool(input: unknown): Promise<string> {
  const result = await generateBlogImage(input as GenerateBlogImageInput);
  return JSON.stringify(result);
}
