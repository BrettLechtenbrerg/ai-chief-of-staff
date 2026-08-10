import fs from 'fs';
import path from 'path';

function isContained(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve an existing file/directory and reject sibling, traversal, and symlink escapes. */
export function resolveExistingPathWithin(baseDirectory: string, candidatePath: string): string {
  const canonicalBase = fs.realpathSync.native(baseDirectory);
  const canonicalCandidate = fs.realpathSync.native(path.resolve(candidatePath));
  if (!isContained(canonicalBase, canonicalCandidate)) {
    throw new Error('Access denied: path is outside the allowed directory');
  }
  return canonicalCandidate;
}

/** Resolve a not-yet-created direct child while checking the canonical parent directory. */
export function resolvePathForCreateWithin(baseDirectory: string, candidatePath: string): string {
  if (fs.existsSync(candidatePath)) return resolveExistingPathWithin(baseDirectory, candidatePath);
  const canonicalBase = fs.realpathSync.native(baseDirectory);
  const resolvedCandidate = path.resolve(candidatePath);
  const canonicalParent = fs.realpathSync.native(path.dirname(resolvedCandidate));
  const canonicalCandidate = path.join(canonicalParent, path.basename(resolvedCandidate));
  if (!isContained(canonicalBase, canonicalCandidate)) {
    throw new Error('Access denied: path is outside the allowed directory');
  }
  return canonicalCandidate;
}

export function isPathWithin(baseDirectory: string, candidatePath: string): boolean {
  return isContained(path.resolve(baseDirectory), path.resolve(candidatePath));
}
