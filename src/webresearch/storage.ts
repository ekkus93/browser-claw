/**
 * Store a research bundle in the workspace (Part E10). Search results and the
 * read pages are written under `/workspace/research/<slug>/`, with safe slugs so
 * the paths always pass workspace path validation.
 */

import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import type { ResearchBundle } from './types.ts';

/** A filesystem-safe slug: lowercase, alnum + dashes, never empty, capped. */
export function researchSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'research';
}

export interface StoredResearch {
  dir: string;
  resultsPath: string;
  pagePaths: string[];
}

/**
 * Write the bundle to `/workspace/research/<query-slug>/`:
 * `search-results.json`, then one markdown/text file per page. Returns the paths
 * written so the caller can reference them.
 */
export async function storeResearchBundle(
  fs: WorkspaceFs,
  bundle: ResearchBundle,
  now: () => number = Date.now,
): Promise<StoredResearch> {
  const dir = `/workspace/research/${researchSlug(bundle.query)}-${now()}`;
  const resultsPath = `${dir}/search-results.json`;
  await fs.createFile(resultsPath, JSON.stringify(bundle.results, null, 2), {
    actor: 'script',
    mimeType: 'application/json',
    overwrite: true,
  });

  const pagePaths: string[] = [];
  let index = 0;
  for (const page of bundle.pages) {
    let host = 'page';
    try {
      host = new URL(page.finalUrl || page.url).host;
    } catch {
      // keep the default host slug
    }
    const path = `${dir}/pages/${researchSlug(host)}-${index}.md`;
    const body = page.markdown ?? page.text;
    await fs.createFile(path, body, { actor: 'script', overwrite: true });
    pagePaths.push(path);
    index += 1;
  }
  return { dir, resultsPath, pagePaths };
}
