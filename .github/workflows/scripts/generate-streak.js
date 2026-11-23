
const fs = require("fs");
const path = require("path");

const USERNAME = "Achal-kashyap";
const TOKEN = process.env.GH_TOKEN;

const API = "https://api.github.com/graphql";

async function githubQuery(query, variables = {}) {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  const result = await response.json();

  if (!response.ok || result.errors) {
    throw new Error(JSON.stringify(result.errors || result));
  }

  return result.data;
}

async function getContributionYears() {
  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  const data = await githubQuery(query, {
    username: USERNAME
  });

  if (!data.user) throw new Error("GitHub user not found");

  return data.user.contributionsCollection.contributionYears;
}

async function getYearData(year) {
  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const data = await githubQuery(query, {
    username: USERNAME,
    from: `${year}-01-01T00:00:00Z`,
    to: `${year}-12-31T23:59:59Z`
  });

  if (!data.user) throw new Error("User not found");

  const calendar =
    data.user.contributionsCollection.contributionCalendar;

  return calendar.weeks.flatMap(week =>
    week.contributionDays.filter(day =>
      day.date.startsWith(String(year))
    )
  );
}

function calculateStreaks(days) {
  const activeDates = new Set(
    days
      .filter(day => day.contributionCount > 0)
      .map(day => day.date)
  );

  const dates = [...activeDates].sort();

  let longest = 0;
  let current = 0;
  let run = 0;
  let previous = null;

  for (const date of dates) {
    const timestamp = Date.parse(date + "T00:00:00Z");

    if (
      previous !== null &&
      timestamp - previous === 86400000
    ) {
      run++;
    } else {
      run = 1;
    }

    longest = Math.max(longest, run);
    previous = timestamp;
  }

  const today = new Date().toISOString().slice(0, 10);

  const yesterday = new Date(
    Date.now() - 86400000
  ).toISOString().slice(0, 10);

  let checkDate = activeDates.has(today) ? today : yesterday;

  while (activeDates.has(checkDate)) {
    current++;

    const previousDate = new Date(
      Date.parse(checkDate + "T00:00:00Z") - 86400000
    );

    checkDate = previousDate.toISOString().slice(0, 10);
  }

  return { current, longest };
}

function generateSVG(stats) {
  return `
<svg width="760" height="220" viewBox="0 0 760 220"
  fill="none" xmlns="http://www.w3.org/2000/svg">

  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="760" y2="220">
      <stop stop-color="#100D20"/>
      <stop offset="1" stop-color="#19102E"/>
    </linearGradient>

    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#A855F7"/>
      <stop offset="1" stop-color="#EC4899"/>
    </linearGradient>
  </defs>

  <rect width="760" height="220" rx="18" fill="url(#bg)"/>
  <rect x="1" y="1" width="758" height="218" rx="17"
    stroke="#7137A8" stroke-opacity=".45"/>

  <text x="30" y="38" fill="#FFFFFF"
    font-size="19" font-weight="bold">
    GITHUB STREAK STATS
  </text>

  <text x="730" y="38" fill="#A78BFA"
    font-size="11" text-anchor="end">
    ACHAL-KASHYAP
  </text>

  <path d="M30 55 H730" stroke="#392653"/>

  <g text-anchor="middle">
    <text x="145" y="111" fill="#FFFFFF"
      font-size="43" font-weight="bold">
      ${stats.current}
    </text>
    <text x="145" y="137" fill="#C4B5FD" font-size="13">
      CURRENT STREAK
    </text>

    <text x="380" y="111" fill="#FFFFFF"
      font-size="43" font-weight="bold">
      ${stats.longest}
    </text>
    <text x="380" y="137" fill="#C4B5FD" font-size="13">
      LONGEST STREAK
    </text>

    <text x="615" y="111" fill="#FFFFFF"
      font-size="43" font-weight="bold">
      ${stats.total}
    </text>
    <text x="615" y="137" fill="#C4B5FD" font-size="13">
      CONTRIBUTIONS
    </text>
  </g>

  <rect x="30" y="166" width="700" height="1"
    fill="#392653"/>

  <circle cx="38" cy="190" r="4" fill="#A855F7"/>

  <text x="50" y="194" fill="#A78BFA" font-size="11">
    LIVE GITHUB CONTRIBUTION DATA
  </text>

  <text x="730" y="194" fill="#8B829B"
    font-size="10" text-anchor="end">
    Updated: ${new Date().toISOString().slice(0, 10)}
  </text>
</svg>`;
}

async function main() {
  if (!TOKEN) throw new Error("GH_TOKEN is missing");

  console.log("Fetching GitHub contributions...");

  const years = await getContributionYears();
  const allDays = [];

  for (const year of years) {
    console.log("Fetching year:", year);

    const days = await getYearData(year);
    allDays.push(...days);
  }

  const uniqueDays = [
    ...new Map(allDays.map(day => [day.date, day])).values()
  ];

  const streaks = calculateStreaks(uniqueDays);

  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);

  const startDate = start.toISOString().slice(0, 10);
  const endDate = today.toISOString().slice(0, 10);

  const total = uniqueDays
    .filter(day =>
      day.date >= startDate &&
      day.date <= endDate
    )
    .reduce((sum, day) => sum + day.contributionCount, 0);

  const stats = {
    ...streaks,
    total
  };

  const output = path.join(
    process.cwd(),
    "assets",
    "streak.svg"
  );

  fs.mkdirSync(path.dirname(output), { recursive: true });

  fs.writeFileSync(output, generateSVG(stats));

  console.log("Streak generated:", stats);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
