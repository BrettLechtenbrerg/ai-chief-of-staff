/**
 * scaffold_video_project — idempotently prepare the external Remotion workspace
 * the Video Studio renders from.
 *
 * Ensures ~/dev/_video-studio exists as a real Remotion v4 project:
 *  - First run: write a minimal, deterministic Remotion template (package.json,
 *    src/index.ts, src/Root.tsx, a sample composition) then `npm install`.
 *  - Every run: copy the bundled Remotion SKILL.md into
 *    <workspace>/.agents/skills/remotion/SKILL.md (the literal path the desktop
 *    doc requested) and refresh src/brand.json from the session's brand.
 *
 * We deliberately write the template directly rather than shelling out to the
 * interactive `create-video` scaffolder — the scaffolder prompts for a template
 * and would hang a non-interactive tool. The template here is byte-stable and
 * follows the bundled skill's rules (frame-based, named exports, src/remotion/).
 *
 * Heavy native bits (headless Chrome shell, ffmpeg) are NOT installed here; they
 * are fetched lazily by Remotion on the first render, inside the workspace —
 * never bundled into the signed .app. See docs/VIDEO-STUDIO.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getDbPath } from '../utils/db-path';
import { getCurrentSessionId } from './session-context';
import {
  resolveVideoWorkspace,
  resolveBundledSkill,
  runInWorkspace,
  workspaceExists,
  tailLog,
  DEFAULT_FPS,
} from './video-shared';

const REMOTION_VERSION_RANGE = '^4.0.0';
const REACT_VERSION_RANGE = '^18.3.1';

export interface ScaffoldVideoResult {
  ready: boolean;
  workspacePath: string;
  skillPath: string;
  remotionVersion: string | null;
  didScaffold: boolean;
  brandName?: string;
  error?: string;
}

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  site_url: string;
  business: string;
  brand_style: string;
  writing_rules: string;
}

/** Read the session's brand (or the default brand) straight from the DB. */
function readSessionBrand(): BrandRow | null {
  let db: Database.Database | null = null;
  try {
    if (!fs.existsSync(getDbPath())) return null;
    db = new Database(getDbPath(), { readonly: true });
    const sessionId = getCurrentSessionId();
    const cols =
      'id, name, slug, COALESCE(site_url, \'\') as site_url, COALESCE(business, \'\') as business, COALESCE(brand_style, \'\') as brand_style, COALESCE(writing_rules, \'\') as writing_rules';
    let brand: BrandRow | undefined;
    try {
      const sess = db
        .prepare('SELECT brand_id FROM sessions WHERE id = ?')
        .get(sessionId) as { brand_id?: string } | undefined;
      if (sess?.brand_id) {
        brand = db
          .prepare(`SELECT ${cols} FROM brands WHERE id = ?`)
          .get(sess.brand_id) as BrandRow | undefined;
      }
    } catch {
      // sessions table may lack brand_id in odd states — fall through to default
    }
    if (!brand) {
      brand = db
        .prepare(`SELECT ${cols} FROM brands ORDER BY is_default DESC, created_at ASC LIMIT 1`)
        .get() as BrandRow | undefined;
    }
    return brand || null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Files for the minimal, deterministic Remotion template. */
function templateFiles(): Record<string, string> {
  const pkg = {
    name: 'video-studio-workspace',
    version: '1.0.0',
    private: true,
    description: 'External Remotion workspace driven by AI Chief of Staff Video Studio.',
    scripts: {
      studio: 'remotion studio',
      render: 'remotion render',
      still: 'remotion still',
    },
    dependencies: {
      '@remotion/cli': REMOTION_VERSION_RANGE,
      react: REACT_VERSION_RANGE,
      'react-dom': REACT_VERSION_RANGE,
      remotion: REMOTION_VERSION_RANGE,
    },
    devDependencies: {
      '@types/react': REACT_VERSION_RANGE,
      typescript: '^5.4.0',
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      lib: ['DOM', 'DOM.Iterable', 'ESNext'],
    },
    include: ['src'],
  };

  const indexTs = `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
`;

  const rootTsx = `import { Composition } from 'remotion';
import { HelloWorld } from './remotion/compositions/HelloWorld';

// Each Video Studio video registers its composition here with the pixel
// dimensions chosen in the panel (9:16 -> 1080x1920, 16:9 -> 1920x1080,
// 1:1 -> 1080x1080). The agent edits this file when it builds a new video.
export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={${DEFAULT_FPS * 10}}
        fps={${DEFAULT_FPS}}
        width={1080}
        height={1920}
      />
    </>
  );
};
`;

  const helloWorld = `import { useCurrentFrame, interpolate, AbsoluteFill } from 'remotion';
import brand from '../../brand.json';

// Sample composition following the Remotion best-practices skill:
// frame-based animation only, individual transform keys, deterministic, and a
// named export. Safe to delete once a real video is built.
export const HelloWorld = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, 20], [24, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#0b0b0f',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          opacity,
          translateY,
          color: 'white',
          fontFamily: 'sans-serif',
          fontSize: 80,
          fontWeight: 700,
          textAlign: 'center',
          padding: 60,
        }}
      >
        {brand.name || 'Video Studio'}
      </div>
    </AbsoluteFill>
  );
};
`;

  const remotionConfig = `import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
`;

  const gitignore = `node_modules/
out/
.remotion/
`;

  const readme = `# Video Studio workspace

External Remotion project driven by AI Chief of Staff's **Video Studio**. The
agent writes compositions under \`src/remotion/\`, registers them in
\`src/Root.tsx\`, and renders MP4s with \`npx remotion render\`. Finished videos
are copied to \`~/Desktop/Videos/<date>-<slug>/\`.

The Remotion best-practices skill lives at
\`.agents/skills/remotion/SKILL.md\` — read it before writing compositions.

Do not move this folder into an iCloud/Drive-synced location; it breaks
\`node_modules\` and the headless Chrome shell.
`;

  return {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'tsconfig.json': JSON.stringify(tsconfig, null, 2) + '\n',
    'remotion.config.ts': remotionConfig,
    '.gitignore': gitignore,
    'README.md': readme,
    'src/index.ts': indexTs,
    'src/Root.tsx': rootTsx,
    'src/remotion/compositions/HelloWorld.tsx': helloWorld,
  };
}

function writeTemplate(workspace: string): void {
  const files = templateFiles();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  // Empty public/ dir so staticFile() assets have a home.
  fs.mkdirSync(path.join(workspace, 'public'), { recursive: true });
}

function writeBrandJson(workspace: string, brand: BrandRow | null): void {
  const data = {
    name: brand?.name || 'Video Studio',
    slug: brand?.slug || '',
    site_url: brand?.site_url || '',
    business: brand?.business || '',
    // No colors column exists in the brands table yet; expose an empty object
    // so compositions can read brand.colors?.primary without crashing.
    colors: {} as Record<string, string>,
  };
  fs.writeFileSync(path.join(workspace, 'src', 'brand.json'), JSON.stringify(data, null, 2) + '\n');
}

function copySkill(workspace: string): string {
  const src = resolveBundledSkill();
  const dest = path.join(workspace, '.agents', 'skills', 'remotion', 'SKILL.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
  return dest;
}

/** Read the installed remotion version from the workspace, if present. */
function installedRemotionVersion(workspace: string): string | null {
  try {
    const pkgPath = path.join(workspace, 'node_modules', 'remotion', 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version || null;
  } catch {
    return null;
  }
}

export async function scaffoldVideoProject(): Promise<ScaffoldVideoResult> {
  const workspace = resolveVideoWorkspace();
  const skillPath = path.join(workspace, '.agents', 'skills', 'remotion', 'SKILL.md');

  let didScaffold = false;
  const brand = readSessionBrand();

  try {
    fs.mkdirSync(workspace, { recursive: true });

    const hasProject = workspaceExists(workspace);
    if (!hasProject) {
      // Fresh workspace: write the template (only if package.json missing — never
      // clobber an in-progress project the agent already started editing).
      if (!fs.existsSync(path.join(workspace, 'package.json'))) {
        writeTemplate(workspace);
        didScaffold = true;
      }
    }

    // Always refresh the skill + brand.json so they track the current session.
    copySkill(workspace);
    writeBrandJson(workspace, brand);

    // Install deps if node_modules is missing (first run, or a wiped workspace).
    if (!fs.existsSync(path.join(workspace, 'node_modules'))) {
      const install = await runInWorkspace('npm install --no-audit --no-fund', {
        cwd: workspace,
        timeoutMs: 12 * 60 * 1000,
      });
      if (!install.ok) {
        return {
          ready: false,
          workspacePath: workspace,
          skillPath,
          remotionVersion: null,
          didScaffold,
          brandName: brand?.name,
          error:
            `npm install failed in the Remotion workspace.\n` +
            tailLog(install.stderr || install.stdout, 30),
        };
      }
    }

    const remotionVersion = installedRemotionVersion(workspace);
    const ready = workspaceExists(workspace) && Boolean(remotionVersion);

    return {
      ready,
      workspacePath: workspace,
      skillPath,
      remotionVersion,
      didScaffold,
      brandName: brand?.name,
      error: ready
        ? undefined
        : 'Workspace prepared but Remotion not detected in node_modules — try again.',
    };
  } catch (e) {
    return {
      ready: false,
      workspacePath: workspace,
      skillPath,
      remotionVersion: null,
      didScaffold,
      brandName: brand?.name,
      error: (e as Error).message,
    };
  }
}

export function getScaffoldVideoProjectToolDefinition() {
  return {
    name: 'scaffold_video_project',
    description:
      "Idempotently prepare the external Remotion workspace at ~/dev/_video-studio used by Video Studio. On first run it writes a minimal Remotion v4 project template and runs npm install; on every run it copies the bundled Remotion best-practices skill to <workspace>/.agents/skills/remotion/SKILL.md and refreshes src/brand.json from the current session's brand. Returns { ready, workspacePath, skillPath, remotionVersion, didScaffold }. Call this before writing compositions or rendering. First run can take a few minutes (npm install).",
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  };
}

export async function handleScaffoldVideoProjectTool(_input: unknown): Promise<string> {
  const result = await scaffoldVideoProject();
  return JSON.stringify(result);
}
