/**
 * The seeded project list.
 *
 * `verified_projects` is populated from two copies of the same list — the
 * serverless auto-seed in `api/_lib/storage.js` and the CLI seed in
 * `server/seed-projects.js` — because the function bundle cannot import from
 * `server/`. They are not generated from one source, so they can drift, and they
 * already did: the `database-dashboard` entry pointed at a different repository
 * than the one the project actually lives in, and the live row had no GitHub URL
 * at all, so the detail page showed no source link.
 *
 * A repository URL is what a visitor clicks to reach the source, so a wrong one
 * is worse than none. These tests pin the two copies together and check that
 * every GitHub URL is a real, well-formed repository address.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// `server/seed-projects.js` is CommonJS and exports the array directly.
const serverSeeds = require('../server/seed-projects.js');
const seeds = Array.isArray(serverSeeds) ? serverSeeds : serverSeeds.default;
assert.ok(Array.isArray(seeds) && seeds.length > 0, 'the CLI seed must export a non-empty array');

const storageSource = source('api/_lib/storage.js');

/** Reads the auto-seed array out of the serverless storage module. */
function serverlessSeeds() {
  const start = storageSource.indexOf('const SEED_PROJECTS');
  assert.ok(start !== -1, 'api/_lib/storage.js must define SEED_PROJECTS');
  const open = storageSource.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < storageSource.length; i += 1) {
    const ch = storageSource[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end !== -1, 'SEED_PROJECTS must be a complete array literal');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${storageSource.slice(open, end)}`)();
}

const autoSeeds = serverlessSeeds();

test('the two seed copies carry the same slugs and GitHub URLs', () => {
  const bySlug = (list) => Object.fromEntries(list.map((p) => [p.slug, p]));
  const cli = bySlug(seeds);
  const auto = bySlug(autoSeeds);

  assert.deepEqual(
    Object.keys(cli).sort(),
    Object.keys(auto).sort(),
    'the two seed lists must cover the same projects',
  );

  for (const slug of Object.keys(cli)) {
    assert.equal(
      cli[slug].githubUrl ?? null,
      auto[slug].githubUrl ?? null,
      `${slug}: the CLI and serverless seeds disagree on the GitHub URL`,
    );
  }
});

test('database-dashboard points at the repository the project actually lives in', () => {
  // The regression this file exists for: the entry named a different repo, so
  // the detail page's source link went somewhere unrelated.
  const expected = 'https://github.com/ProjectHub-fie/Database-dashboard';

  for (const [name, list] of [['serverless', autoSeeds], ['cli', seeds]]) {
    const project = list.find((p) => p.slug === 'database-dashboard');
    assert.ok(project, `${name} seed must include database-dashboard`);
    assert.equal(project.githubUrl, expected, `${name} seed points at the wrong repository`);
  }
});

test('every seeded GitHub URL is a well-formed repository address', () => {
  const seen = new Set();
  for (const [name, list] of [['serverless', autoSeeds], ['cli', seeds]]) {
    for (const project of list) {
      const url = project.githubUrl;
      if (url == null) continue;

      assert.equal(typeof url, 'string', `${name}/${project.slug}: githubUrl must be a string`);
      const match = url.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)$/);
      assert.ok(
        match,
        `${name}/${project.slug}: "${url}" must be an https://github.com/<owner>/<repo> URL`,
      );
      assert.ok(
        !match[2].endsWith('.git'),
        `${name}/${project.slug}: the stored URL must not carry the .git clone suffix`,
      );
      seen.add(match[2].toLowerCase());
    }
  }
  assert.ok(seen.size > 0, 'at least one seeded project must carry a GitHub URL');
});

test('the seed GitHub URLs are distinct per repository', () => {
  // Two projects pointing at one repo is almost always a copy-paste, which is
  // how the wrong URL got in.
  const byRepo = new Map();
  for (const project of autoSeeds) {
    if (!project.githubUrl) continue;
    const key = project.githubUrl.toLowerCase();
    const previous = byRepo.get(key);
    assert.equal(
      previous,
      undefined,
      `${project.slug} and ${previous} share the repository ${project.githubUrl}`,
    );
    byRepo.set(key, project.slug);
  }
});

test('the project list reads the GitHub URL the seeds store', () => {
  // The URL is only useful if the pages render it. The public read path maps the
  // column in `server/storage.ts`; the dashboard maps it in `api/admin/index.js`
  // and writes it back through `toColumns`. If any of those stopped, a correct
  // seed would still show no source link.
  const publicStorage = source('server/storage.ts');
  assert.match(publicStorage, /githubUrl: r\.github_url/, 'the public read must map github_url');
  assert.match(
    publicStorage,
    /githubUrl: projectData\.githubUrl \|\| null/,
    'the in-memory fallback must carry it',
  );

  const adminApi = source('api/admin/index.js');
  assert.match(adminApi, /githubUrl: p\.github_url/, 'the admin read must map github_url');
  assert.match(adminApi, /github_url: pick\(data, 'githubUrl'/, 'the admin write must accept githubUrl');

  const list = source('client/src/pages/verified-projects-page.tsx');
  assert.match(list, /href=\{project\.githubUrl\}/, 'the admin list must link the repository');

  const detail = source('client/src/components/app-detail.tsx');
  assert.match(detail, /repoUrl\(project\.githubUrl\)/, 'the app detail page must link the repository');
});
