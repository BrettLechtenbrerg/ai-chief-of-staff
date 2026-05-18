/**
 * write_daily_posting_packet \u2014 generates the unified, paste-ready content
 * packet for a brand's daily content drop.
 *
 * Why this is its own tool (vs. having the agent write the file directly):
 *  1. Format consistency. Every packet has the same shape \u2014 same section
 *     dividers, same per-platform order \u2014 so Brett's "first work session"
 *     muscle memory works across all 3 brands. The tool enforces this.
 *  2. Image handling. The tool knows how to copy the hero + IG-square PNGs
 *     into the inbox folder alongside the markdown, with the right names.
 *  3. Topic-queue updates. Done in one place so we don't get a half-updated
 *     queue if the agent crashes mid-routine.
 *
 * The agent calls this once at the end of the weekly routine after it has
 * already written the blog post body (for github-next brands) and generated
 * the hero image(s).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PlatformPacketSection {
  /** Platform key as it appears in profile.json (e.g. "linkedinPersonal"). */
  platformKey: string;
  /** Human-readable platform name for the section header. */
  displayName: string;
  /** Per-platform post body \u2014 paste-ready. */
  postBody: string;
  /** Optional first-comment text (LinkedIn link-in-comment trick). */
  firstComment?: string;
  /** Optional hashtag block, separate from the post body. */
  hashtags?: string;
  /** Optional "what Brett does to post" instructions (e.g. "Link in bio"). */
  instructions?: string;
}

export interface WriteDailyPostingPacketInput {
  /** Brand slug \u2014 must match a folder under ~/dev/_brand-profiles/. */
  brandSlug: string;
  /** Short brand name for the section header (e.g. "TSAI", "PMMA", "Brett"). */
  brandShortName: string;
  /** Slug for the post (also drives image filenames). */
  postSlug: string;
  /** Full title of the post. */
  postTitle: string;
  /** Public URL where the blog post will live once published. */
  blogUrl: string;
  /** "github-next" (we wrote the file) or "ghl" (Brett posts manually). */
  blogBackend: 'github-next' | 'ghl';
  /** Date string YYYY-MM-DD for the inbox filename. */
  date: string;
  /** Absolute path to the hero PNG. Will be copied next to the packet. */
  heroPath: string;
  /** Absolute path to the IG-square PNG, if generated. */
  heroSquarePath?: string;
  /**
   * Per-platform sections. The agent generates these (following the brand's
   * SOCIAL_RULES.md) and hands them in. We just format + write.
   */
  sections: PlatformPacketSection[];
}

export interface WriteDailyPostingPacketResult {
  success: boolean;
  packetPath?: string;
  heroPath?: string;
  heroSquarePath?: string;
  error?: string;
}

const INBOX_DIR = path.resolve(
  process.env.HOME || '',
  'dev/_brand-profiles/_inbox',
);

/** Slug-safe filename component \u2014 lowercase, alphanumeric + dash only. */
function sanitizeForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function validateInput(input: WriteDailyPostingPacketInput): string | null {
  if (!input || typeof input !== 'object') return 'input is required';
  if (typeof input.brandSlug !== 'string' || !input.brandSlug) return 'brandSlug is required';
  if (typeof input.brandShortName !== 'string' || !input.brandShortName)
    return 'brandShortName is required';
  if (typeof input.postSlug !== 'string' || !input.postSlug) return 'postSlug is required';
  if (typeof input.postTitle !== 'string' || !input.postTitle) return 'postTitle is required';
  if (typeof input.blogUrl !== 'string' || !input.blogUrl) return 'blogUrl is required';
  if (input.blogBackend !== 'github-next' && input.blogBackend !== 'ghl')
    return 'blogBackend must be "github-next" or "ghl"';
  if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date))
    return 'date must be YYYY-MM-DD';
  if (typeof input.heroPath !== 'string' || !input.heroPath) return 'heroPath is required';
  if (!Array.isArray(input.sections) || input.sections.length === 0)
    return 'sections must be a non-empty array';
  for (const s of input.sections) {
    if (!s.platformKey || !s.displayName || !s.postBody) {
      return 'each section needs platformKey, displayName, postBody';
    }
  }
  return null;
}

/** Build the markdown body for the packet file. */
function buildPacketMarkdown(input: WriteDailyPostingPacketInput): string {
  const lines: string[] = [];
  lines.push(`# Daily Posting Packet \u2014 ${input.date}`);
  lines.push('');
  lines.push(`**Brand:** ${input.brandShortName}`);
  lines.push(`**Title:** ${input.postTitle}`);
  lines.push(`**Blog URL:** ${input.blogUrl}`);
  lines.push(`**Blog backend:** ${input.blogBackend}`);
  lines.push('');
  if (input.blogBackend === 'ghl') {
    lines.push(
      `> **⚠️ IMPORTANT — do this FIRST:** This brand's blog is on GoHighLevel. The social posts below all link to **${input.blogUrl}**, which **does NOT exist yet**. Before posting any social, do one of these two things:`,
    );
    lines.push('>');
    lines.push(
      `> 1. **Publish the GHL blog post** at that URL. Use the \`blog-draft.md\` file in this folder as your starting point — it's the full article, ready to paste into the GHL CMS.`,
    );
    lines.push(
      `> 2. **OR** edit the link in each social post below to point somewhere real (e.g. your homepage or a related existing page).`,
    );
    lines.push('>');
    lines.push(
      `> Skip this step and your posts will broadcast a 404 link. Don't.`,
    );
    lines.push('');
  }
  lines.push(`**Hero image:** \`./${input.date} \u2014 ${input.brandShortName} \u2014 ${sanitizeForFilename(input.postTitle)} \u2014 hero.png\``);
  if (input.heroSquarePath) {
    lines.push(
      `**Instagram square:** \`./${input.date} \u2014 ${input.brandShortName} \u2014 ${sanitizeForFilename(input.postTitle)} \u2014 hero-square.png\``,
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  let sectionNum = 1;
  for (const s of input.sections) {
    lines.push(`## ${sectionNum}. ${s.displayName.toUpperCase()}`);
    lines.push('');
    lines.push('```');
    lines.push(s.postBody);
    lines.push('```');
    lines.push('');
    if (s.firstComment) {
      lines.push('**First comment (paste immediately after posting):**');
      lines.push('');
      lines.push('```');
      lines.push(s.firstComment);
      lines.push('```');
      lines.push('');
    }
    if (s.hashtags) {
      lines.push('**Hashtags:**');
      lines.push('');
      lines.push('```');
      lines.push(s.hashtags);
      lines.push('```');
      lines.push('');
    }
    if (s.instructions) {
      lines.push(`**To post:** ${s.instructions}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    sectionNum++;
  }

  lines.push('');
  lines.push(`_Generated by ACOS weekly content cron \u2014 ${new Date().toISOString()}_`);
  lines.push('');
  return lines.join('\n');
}

export async function writeDailyPostingPacket(
  input: WriteDailyPostingPacketInput,
): Promise<WriteDailyPostingPacketResult> {
  const err = validateInput(input);
  if (err) return { success: false, error: err };

  // Ensure inbox exists.
  fs.mkdirSync(INBOX_DIR, { recursive: true });

  const titleSlug = sanitizeForFilename(input.postTitle);
  const baseName = `${input.date} \u2014 ${input.brandShortName} \u2014 ${titleSlug}`;
  const packetPath = path.join(INBOX_DIR, `${baseName}.md`);
  const heroDest = path.join(INBOX_DIR, `${baseName} \u2014 hero.png`);
  const heroSquareDest = input.heroSquarePath
    ? path.join(INBOX_DIR, `${baseName} \u2014 hero-square.png`)
    : undefined;

  // Copy images.
  try {
    if (!fs.existsSync(input.heroPath)) {
      return { success: false, error: `heroPath does not exist: ${input.heroPath}` };
    }
    fs.copyFileSync(input.heroPath, heroDest);
    if (input.heroSquarePath && heroSquareDest) {
      if (fs.existsSync(input.heroSquarePath)) {
        fs.copyFileSync(input.heroSquarePath, heroSquareDest);
      } else {
        // Square is best-effort \u2014 don't fail the packet if it's missing.
        console.warn(
          `[daily-posting-packet] heroSquarePath does not exist, skipping copy: ${input.heroSquarePath}`,
        );
      }
    }
  } catch (e) {
    return { success: false, error: `Failed to copy images: ${(e as Error).message}` };
  }

  // Write the markdown.
  try {
    const md = buildPacketMarkdown(input);
    fs.writeFileSync(packetPath, md);
  } catch (e) {
    return { success: false, error: `Failed to write packet: ${(e as Error).message}` };
  }

  return {
    success: true,
    packetPath,
    heroPath: heroDest,
    heroSquarePath: heroSquareDest,
  };
}

export function getWriteDailyPostingPacketToolDefinition() {
  return {
    name: 'write_daily_posting_packet',
    description:
      "Write the daily posting packet for a brand. Drops a single markdown file plus hero + IG-square images into ~/dev/_brand-profiles/_inbox/. The .md file contains paste-ready content for every active platform for the brand, formatted per its SOCIAL_RULES.md. Brett opens the file from Mac during his first work session, scans top-to-bottom, pastes each section into the corresponding platform, posts. Call this at the END of the weekly routine after you've already generated per-platform copy following the brand's social rules.",
    input_schema: {
      type: 'object' as const,
      properties: {
        brandSlug: {
          type: 'string',
          description: "Brand slug matching the folder under ~/dev/_brand-profiles/ (e.g. 'tsai', 'pmma', 'brett-personal').",
        },
        brandShortName: {
          type: 'string',
          description: "Short brand name used in the section header (e.g. 'TSAI', 'PMMA', 'Brett').",
        },
        postSlug: {
          type: 'string',
          description: 'URL slug for the post (also drives image filename suffixes).',
        },
        postTitle: {
          type: 'string',
          description: 'Full post title.',
        },
        blogUrl: {
          type: 'string',
          description: 'Public URL where the blog post will live once published.',
        },
        blogBackend: {
          type: 'string',
          enum: ['github-next', 'ghl'],
          description: "'github-next' if the cron wrote the blog file + PR. 'ghl' if Brett posts the blog manually in GoHighLevel.",
        },
        date: {
          type: 'string',
          description: "YYYY-MM-DD date string for the inbox filename and packet header.",
        },
        heroPath: {
          type: 'string',
          description: 'Absolute path to the hero PNG generated by generate_blog_image.',
        },
        heroSquarePath: {
          type: 'string',
          description: 'Optional. Absolute path to the IG-square 1024x1024 PNG variant.',
        },
        sections: {
          type: 'array',
          description: "Per-platform sections, each fully formatted per the brand's SOCIAL_RULES.md. Order matches the order they appear in the packet \u2014 typically LinkedIn Personal, LinkedIn Company, Facebook Business, Instagram, GBP, Medium.",
          items: {
            type: 'object',
            properties: {
              platformKey: {
                type: 'string',
                description: 'Matches the platform key in profile.json (e.g. linkedinPersonal).',
              },
              displayName: {
                type: 'string',
                description: 'Human-readable name for the section header (e.g. "LinkedIn Personal", "Facebook Business Page").',
              },
              postBody: {
                type: 'string',
                description: 'The paste-ready post body for this platform. Plain text. Newlines preserved.',
              },
              firstComment: {
                type: 'string',
                description: "Optional. For LinkedIn personal/company \u2014 the link goes in the first comment, not the body. Include the comment text here.",
              },
              hashtags: {
                type: 'string',
                description: 'Optional. Hashtags as a single line for the user to paste with the post or as a separate comment.',
              },
              instructions: {
                type: 'string',
                description: "Optional. Brief platform-specific instructions like 'Link in bio. Post the square image.' or 'business.google.com \u2192 Posts \u2192 Add Update'.",
              },
            },
            required: ['platformKey', 'displayName', 'postBody'],
          },
        },
      },
      required: [
        'brandSlug',
        'brandShortName',
        'postSlug',
        'postTitle',
        'blogUrl',
        'blogBackend',
        'date',
        'heroPath',
        'sections',
      ],
    },
  };
}

export async function handleWriteDailyPostingPacketTool(input: unknown): Promise<string> {
  const result = await writeDailyPostingPacket(input as WriteDailyPostingPacketInput);
  return JSON.stringify(result);
}
