
const fs = require("fs");
const path = require("path");

const USERNAME = "Achal-kashyap";
const TOKEN = process.env.GH_TOKEN;
const API = "https://api.github.com/graphql";

async function graphql(query, variables = {}) {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ query, variables })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `GitHub API HTTP ${response.status}: ${JSON.stringify(result)}`
    );
  }

  if (result.errors) {
    throw new Error(
      `GraphQL Error: ${JSON.stringify(result.errors)}`
    );
  }

  return result.data;
}

async function getYears() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        login
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  const data = await graphql(query, {
    login: USERNAME
  });

  if (!data.user) {
    throw new Error(`GitHub user ${USERNAME} not found`);
  }

  return data.user.contributionsCollection.contributionYears;
}

async function getYearContributions(year) {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
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

  const data = await graphql(query, {
    login: USERNAME,
    from: `${year}-01-01T00:00:00Z`,
    to: `${Number(year) + 1}-01-01T00:00:00Z`
  });

  if (!data.user) {
    throw new Error("Unable to fetch contribution data");
  }

  return data.user.contributionsCollection
    .contributionCalendar.weeks
    .flatMap(week => week.contributionDays)
    .filter(day => day.date.startsWith(String(year)));
}

function getDate(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function calculateStats(days) {
  const activeDates = new Set(
    days
      .filter(day => day.contributionCount > 0)
      .map(day => day.date)
  );

  const sortedDates = [...activeDates].sort();

  let longest = 0;
  let running = 0;
  let previous = null;

  for (const date of sortedDates) {
    const current = getDate(date);

    if (
      previous !== null &&
      current - previous === 86400000
    ) {
      running++;
    } else {
      running = 1;
    }

    longest = Math.max(longest, running);
    previous = current;
  }

  const today = new Date().toISOString().slice(0, 10);

  const yesterday = new Date(
    Date.now() - 86400000
  ).toISOString().slice(0, 10);

  let currentStreak = 0;

  let checkDate = activeDates.has(today)
    ? today
    : yesterday;

  while (activeDates.has(checkDate)) {
    currentStreak++;

    checkDate = new Date(
      getDate(checkDate) - 86400000
    ).toISOString().slice(0, 10);
  }

  return {
    current: currentStreak,
    longest
  };
}

function createSVG(stats) {
  return `<svg xmlns="http://www.w3.org/2000/svg"
    width="760" height="220" viewBox="0 0 760 220">

    <defs>
      <linearGradient id="bg" x2="1" y2="1">
        <stop stop-color="#100D20"/>
        <stop offset="1" stop-color="#25123D"/>
      </linearGradient>
      <linearGradient id="accent">
        <stop stop-color="#A855F7"/>
        <stop offset="1" stop-color="#EC4899"/>
      </linearGradient>
    </defs>

    <rect width="760" height="220" rx="18" fill="url(#bg)"/>
    <rect x="1" y="1" width="758" height="218" rx="17"
      fill="none" stroke="#7137A8" opacity=".6"/>

    <text x="30" y="39" fill="#fff"
      font-size="20" font-weight="bold">
      GITHUB STREAK STATS
    </text>

    <text x="730" y="39" fill="#C084FC"
      text-anchor="end" font-size="12">
      ${USERNAME.toUpperCase()}
    </text>

    <path d="M30 55 H730" stroke="#49315F"/>

    <g text-anchor="middle">
      <text x="145" y="112" fill="#fff"
        font-size="43" font-weight="bold">
        ${stats.current}
      </text>
      <text x="145" y="139" fill="#C4B5FD" font-size="13">
        CURRENT STREAK
      </text>

      <text x="380" y="112" fill="#fff"
        font-size="43" font-weight="bold">
        ${stats.longest}
      </text>
      <text x="380" y="139" fill="#C4B5FD" font-size="13">
        LONGEST STREAK
      </text>

      <text x="615" y="112" fill="#fff"
        font-size="43" font-weight="bold">
        ${stats.total}
      </text>
      <text x="615" y="139" fill="#C4B5FD" font-size="13">
        TOTAL CONTRIBUTIONS
      </text>
    </g>

    <path d="M30 165 H730" stroke="#49315F"/>

    <circle cx="38" cy="190" r="4" fill="url(#accent)"/>

    <text x="50" y="194" fill="#C084FC" font-size="11">
      OFFICIAL GITHUB CONTRIBUTION CALENDAR
    </text>

    <text x="730" y="194" fill="#9386A5"
      text-anchor="end" font-size="10">
      UPDATED ${new Date().toISOString().slice(0, 10)}
    </text>
  </svg>`;
}

async function main() {
  if (!TOKEN) {
    throw new Error("GH_TOKEN secret is missing!");
  }

  console.log("Starting GitHub Streak Generator...");
  console.log("Username:", USERNAME);

  const years = await getYears();

  console.log("Contribution years:", years);

  if (!years || years.length === 0) {
    throw new Error("No contribution years returned by GitHub.");
  }

  let allDays = [];

  for (const year of years) {
    console.log(`Fetching contributions for ${year}...`);

    const days = await getYearContributions(year);

    allDays.push(...days);

    console.log(`${year}: ${days.length} days fetched`);
  }

  const uniqueDays = [
    ...new Map(
      allDays.map(day => [day.date, day])
    ).values()
  ];

  const streak = calculateStats(uniqueDays);

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
    .reduce(
      (sum, day) => sum + day.contributionCount,
      0
    );

  const stats = {
    current: streak.current,
    longest: streak.longest,
    total
  };

  const outputPath = path.join(
    process.cwd(),
    "assets",
    "streak.svg"
  );

  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true
  });

  fs.writeFileSync(
    outputPath,
    createSVG(stats),
    "utf8"
  );

  console.log("Successfully generated streak!");
  console.log("Statistics:", stats);
  console.log("SVG saved:", outputPath);
}

main().catch(error => {
  console.error("STREAK GENERATION FAILED:");
  console.error(error);
  process.exit(1);
});
