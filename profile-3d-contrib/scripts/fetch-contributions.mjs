// Fetches every year of a user's public contributions from the GitHub GraphQL API
// and writes them to contributions.json (read by index.html).
//
// Usage:  GITHUB_TOKEN=xxx GH_USER=Achal-kashyap node scripts/fetch-contributions.mjs

import { writeFileSync } from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const user = process.env.GH_USER || 'Achal-kashyap';
if (!token) {
  console.error('GITHUB_TOKEN is missing');
  process.exit(1);
}

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

async function gql(variables, query = QUERY) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'contrib-3d' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  if (!json.data.user) throw new Error(`User "${user}" not found`);
  return json.data.user;
}

const now = new Date();
const first = await gql({ login: user, from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to: now.toISOString() });
const startYear = new Date(first.createdAt).getUTCFullYear();

const byDate = new Map();
for (let year = startYear; year <= now.getUTCFullYear(); year++) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = year === now.getUTCFullYear() ? now : new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const u = await gql({ login: user, from: from.toISOString(), to: to.toISOString() });
  for (const week of u.contributionsCollection.contributionCalendar.weeks) {
    for (const d of week.contributionDays) {
      byDate.set(d.date, { date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 });
    }
  }
}

// ---- Per-repo commit pass --------------------------------------------------
// Lets us (a) remove commits from noisy repos, e.g. a repo whose workflow commits
// automatically every day, and (b) print which repos produce the most commits.
// Set EXCLUDE_REPOS="owner/repo,owner/other" to drop their commits from the graph.
const EXCLUDE = (process.env.EXCLUDE_REPOS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const MONTH_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner }
        contributions(first: 100) { nodes { occurredAt commitCount } }
      }
    }
  }
}`;

const repoTotals = new Map();
const removed = new Map(); // date -> commits removed
const cursor = new Date(Date.UTC(startYear, 0, 1));
while (cursor <= now) {
  const from = new Date(cursor);
  const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  const to = next > now ? now : new Date(next.getTime() - 1000);
  const u = await gql({ login: user, from: from.toISOString(), to: to.toISOString() }, MONTH_QUERY);
  for (const r of u.contributionsCollection.commitContributionsByRepository) {
    const name = r.repository.nameWithOwner;
    for (const n of r.contributions.nodes) {
      repoTotals.set(name, (repoTotals.get(name) || 0) + n.commitCount);
      if (EXCLUDE.includes(name.toLowerCase())) {
        const k = n.occurredAt.slice(0, 10);
        removed.set(k, (removed.get(k) || 0) + n.commitCount);
      }
    }
  }
  cursor.setTime(next.getTime());
}

console.log('Top repos by commit contributions (all years):');
[...repoTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([name, n]) => console.log(`  ${String(n).padStart(5)}  ${name}`));

if (EXCLUDE.length) {
  let total = 0;
  for (const [date, n] of removed) {
    const d = byDate.get(date);
    if (d) { d.count = Math.max(0, d.count - n); total += n; }
  }
  // GitHub's own levels no longer match the corrected counts; let the page recompute them.
  for (const d of byDate.values()) delete d.level;
  console.log(`Excluded ${total} commits from: ${EXCLUDE.join(', ')}`);
}

const contributions = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
writeFileSync('contributions.json', JSON.stringify({ user, generatedAt: now.toISOString(), contributions }));
console.log(`Saved ${contributions.length} days for ${user} (${startYear}–${now.getUTCFullYear()})`);
