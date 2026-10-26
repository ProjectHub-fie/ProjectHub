/**
 * Project skeleton loaders.
 *
 * The client has no DOM test environment installed, so instead of rendering
 * React these tests read the source and pin the invariants that prevent the
 * loading state from drifting from the rendered card (or worse, being dropped
 * when a page is touched).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const skeletons = source('client/src/components/project-skeletons.tsx');
const grid = source('client/src/components/projects-section.tsx');
const allProjects = source('client/src/pages/projects.tsx');
const projectDetail = source('client/src/pages/project.tsx');

test('the shared skeletons are built on the Skeleton primitive', () => {
  assert.match(
    skeletons,
    /import \{ Skeleton \} from "@\/components\/ui\/skeleton"/,
    'a skeleton placeholders must reuse the pulse primitive instead of hand-rolled divs',
  );
  assert.ok(
    !/<div className="[^"]*animate-pulse/.test(skeletons),
    'the shared skeletons must not re-implement the pulse animation',
  );
});

test('every project surface consumes the shared skeleton loader', () => {
  assert.match(
    grid,
    /import \{ ProjectsGridSkeleton \} from "@\/components\/project-skeletons"/,
    'the projects section must import the shared skeleton',
  );
  assert.match(grid, /<ProjectsGridSkeleton \/>/,
    'the projects section must render the shared skeleton while loading');

  assert.match(
    allProjects,
    /import \{ ProjectsGridSkeleton \} from "@\/components\/project-skeletons"/,
    'the all-projects page must import the shared skeleton',
  );
  assert.match(allProjects, /<ProjectsGridSkeleton \/>/,
    'the all-projects page must render the shared skeleton while loading');

  assert.match(
    projectDetail,
    /import \{ ProjectDetailSkeleton \} from "@\/components\/project-skeletons"/,
    'the project detail page must import the shared skeleton',
  );
  assert.match(projectDetail, /<ProjectDetailSkeleton \/>/,
    'the project detail page must render the shared skeleton while loading');
});

test('the shared skeleton is used everywhere a card is loaded', () => {
  // No inline grid skeleton may remain: it would drift from the rendered card
  // and defeat the point of the shared component.
  for (const [name, src] of [
    ['projects-section', grid],
    ['projects page', allProjects],
    ['project page', projectDetail],
  ]) {
    assert.ok(
      !/\[\.\.\.Array\(6\)\]|\[\.\.\.Array\(4\)\]|\[\.\.\.Array\(6\)\]\.map/.test(src),
      `${name} must not rebuild a fixed six-card loading grid by hand`,
    );
  }
});

test('the grid skeleton exposes a status role for assistive tech', () => {
  assert.match(skeletons, /role="status"/, 'the grid must announce itself as loading');
  assert.match(skeletons, /aria-label="Loading projects"/,
    'the grid must carry an accessible loading label');
});

test('the project detail page no longer carries its dead ProjectSkeleton copy', () => {
  assert.ok(
    !/function ProjectSkeleton\(\)/.test(projectDetail),
    'the unused local ProjectSkeleton must be gone in favour of ProjectDetailSkeleton',
  );
});

test('the shared skeletons accept only the count the grids need', () => {
  assert.match(
    skeletons,
    /export function ProjectsGridSkeleton\(\{ count = 6 \}: \{ count\?: number \}\)/,
    'the grid skeleton must default to six cards to match the rendered grid',
  );
  assert.ok(
    /count\?: number/.test(skeletons),
    'the count must be typed so a call site cannot pass an untyped value',
  );
});