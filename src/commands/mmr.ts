import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { resolvePlayerName } from '../common.js';
import config from '../../config.js';

interface PlayerStats {
  player: string;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
}

interface CsvRecord {
  game: string;
  date: string;
  side: string;
  win: string;
  name: string;
  [key: string]: string;
}

function parseDate(dateStr: string): Date {
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const [_, day, month, year, hour, minute] = match;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10)
    );
  }
  const fallback = Date.parse(dateStr);
  return isNaN(fallback) ? new Date(0) : new Date(fallback);
}

function arrayToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('\n') || cell.includes('"')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(',')
    )
    .join('\n');
}

export async function calculateSourceMmr(options: { defaultRating?: number; kFactor?: number; generations?: number }): Promise<void> {
  const defaultRating = options.defaultRating ?? (config as any).mmr?.defaultRating ?? 1500;
  const kFactor = options.kFactor ?? (config as any).mmr?.kFactor ?? 32;
  const generations = options.generations ?? 1;

  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run 'download' command first.`);
  }

  console.log(`Reading source CSV from ${sourceCsvPath}...`);
  const fileContent = fs.readFileSync(sourceCsvPath, 'utf8');

  console.log('Parsing CSV data...');
  const records: CsvRecord[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty.');
  }

  // Group records by game / match
  const games = new Map<string, CsvRecord[]>();
  for (const record of records) {
    const game = record.game;
    const date = record.date;
    const name = record.name;
    const side = record.side;

    if (!game || !name || !side) continue;

    const matchKey = date ? `${game}_${date}` : game;
    if (!games.has(matchKey)) {
      games.set(matchKey, []);
    }
    games.get(matchKey)!.push(record);
  }

  console.log(`Grouping matches and sorting chronologically...`);
  // Sort matches chronologically
  const sortedMatches = Array.from(games.entries())
    .map(([matchKey, participants]) => {
      const dateStr = participants[0]?.date || '';
      const dateObj = dateStr ? parseDate(dateStr) : new Date(0);
      return { matchKey, participants, date: dateObj };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(`Processing ${sortedMatches.length} matches over ${generations} generation(s)...`);

  const playerStatsMap = new Map<string, PlayerStats>();

  function getOrCreatePlayer(name: string): PlayerStats {
    let stats = playerStatsMap.get(name);
    if (!stats) {
      stats = { player: name, mmr: defaultRating, games: 0, wins: 0, losses: 0 };
      playerStatsMap.set(name, stats);
    }
    return stats;
  }

  for (let gen = 1; gen <= generations; gen++) {
    // Reset stats for all players before each generation, keeping their MMR
    for (const stats of playerStatsMap.values()) {
      stats.games = 0;
      stats.wins = 0;
      stats.losses = 0;
    }

    for (const match of sortedMatches) {
      const participants = match.participants;

      // Check who won using the `win` column
      let blueWon = false;
      let redWon = false;

      for (const p of participants) {
        const isWin = p.win?.toUpperCase() === 'TRUE';
        if (isWin) {
          if (p.side === 'blue') blueWon = true;
          if (p.side === 'red') redWon = true;
        }
      }

      const blueOutcome = blueWon ? 1 : 0;
      const redOutcome = redWon ? 1 : 0;

      // Separate players by team and resolve aliases
      const bluePlayers = participants
        .filter((p) => p.side === 'blue')
        .map((p) => resolvePlayerName(p.name));
      const redPlayers = participants
        .filter((p) => p.side === 'red')
        .map((p) => resolvePlayerName(p.name));

      if (bluePlayers.length === 0 || redPlayers.length === 0) {
        // Cannot calculate average MMR for a team with 0 players
        continue;
      }

      // Average ratings
      let blueSum = 0;
      for (const name of bluePlayers) {
        blueSum += getOrCreatePlayer(name).mmr;
      }
      const blueAvg = blueSum / bluePlayers.length;

      let redSum = 0;
      for (const name of redPlayers) {
        redSum += getOrCreatePlayer(name).mmr;
      }
      const redAvg = redSum / redPlayers.length;

      // Expected outcomes
      const expectedBlue = 1 / (1 + Math.pow(10, (redAvg - blueAvg) / 400));
      const expectedRed = 1 - expectedBlue;

      // Update stats
      for (const name of bluePlayers) {
        const stats = getOrCreatePlayer(name);
        stats.mmr += kFactor * (blueOutcome - expectedBlue);
        stats.games += 1;
        if (blueWon) {
          stats.wins += 1;
        } else {
          stats.losses += 1;
        }
      }

      for (const name of redPlayers) {
        const stats = getOrCreatePlayer(name);
        stats.mmr += kFactor * (redOutcome - expectedRed);
        stats.games += 1;
        if (redWon) {
          stats.wins += 1;
        } else {
          stats.losses += 1;
        }
      }
    }
  }

  // Save to .tmp/mmr.csv
  const csvRows: string[][] = [['player', 'mmr', 'games', 'wins', 'losses']];
  for (const stats of playerStatsMap.values()) {
    csvRows.push([
      stats.player,
      stats.mmr.toFixed(2),
      String(stats.games),
      String(stats.wins),
      String(stats.losses),
    ]);
  }

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const outputPath = path.join(tmpDir, 'mmr.csv');

  console.log(`Writing MMR data to ${outputPath}...`);
  fs.writeFileSync(outputPath, arrayToCsv(csvRows), 'utf8');
  console.log('✅ MMR calculation complete.');
}

export async function runMmrList(options: { threshold?: number; amount?: number; sort?: string }): Promise<void> {
  const threshold = options.threshold ?? (config as any).mmr?.matchThreshold ?? 5;
  const amount = options.amount ?? (config as any).mmr?.amount ?? 20;
  const sortInput = (options.sort || (config as any).mmr?.sort || 'descending').toLowerCase();

  let ascending = true;
  if ('ascending'.startsWith(sortInput)) {
    ascending = true;
  } else if ('descending'.startsWith(sortInput)) {
    ascending = false;
  } else {
    console.error(`Error: Invalid sort option "${options.sort}". Must be a prefix of "ascending" or "descending".`);
    process.exit(1);
  }

  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');
  if (!fs.existsSync(mmrCsvPath)) {
    throw new Error(`MMR CSV not found at ${mmrCsvPath}. Please run 'mmr calculate' first.`);
  }

  const fileContent = fs.readFileSync(mmrCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const players: PlayerStats[] = records.map((r: any) => ({
    player: r.player,
    mmr: parseFloat(r.mmr),
    games: parseInt(r.games, 10),
    wins: parseInt(r.wins, 10),
    losses: parseInt(r.losses, 10),
  }));

  const filtered = players.filter((p) => p.games >= threshold);

  // Sort by MMR
  filtered.sort((a, b) => (ascending ? a.mmr - b.mmr : b.mmr - a.mmr));

  const displayed = filtered.slice(0, amount);

  console.log(`\n=== MMR Leaderboard (Sorted: ${ascending ? 'Ascending' : 'Descending'}) ===`);
  console.log(
    '  ' +
    'Rank'.padEnd(6) +
    'Player'.padEnd(25) +
    'MMR'.padEnd(10) +
    'Games'.padEnd(8) +
    'Wins'.padEnd(6) +
    'Losses'.padEnd(8) +
    'Win Rate'
  );
  console.log('  ' + '-'.repeat(75));

  displayed.forEach((p, idx) => {
    const winRate = p.games > 0 ? (p.wins / p.games) * 100 : 0;
    const rankStr = String(idx + 1);
    console.log(
      '  ' +
      rankStr.padEnd(6) +
      p.player.padEnd(25) +
      p.mmr.toFixed(2).padEnd(10) +
      String(p.games).padEnd(8) +
      String(p.wins).padEnd(6) +
      String(p.losses).padEnd(8) +
      `${winRate.toFixed(1)}%`
    );
  });

  if (filtered.length > amount) {
    console.log(`\n  ... and ${filtered.length - amount} more players.`);
  }
}

export async function runMmrShow(playerArg: string, options: { threshold?: number } = {}): Promise<void> {
  if (!playerArg) {
    console.error('Error: Player name is required.');
    process.exit(1);
  }

  const threshold = options.threshold ?? (config as any).mmr?.matchThreshold ?? 5;

  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');
  if (!fs.existsSync(mmrCsvPath)) {
    throw new Error(`MMR CSV not found at ${mmrCsvPath}. Please run 'mmr calculate' first.`);
  }

  const fileContent = fs.readFileSync(mmrCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const players: PlayerStats[] = records.map((r: any) => ({
    player: r.player,
    mmr: parseFloat(r.mmr),
    games: parseInt(r.games, 10),
    wins: parseInt(r.wins, 10),
    losses: parseInt(r.losses, 10),
  }));

  // Resolve player name (handling aliases)
  const resolvedName = resolvePlayerName(playerArg);
  const targetLower = resolvedName.toLowerCase();

  const stats = players.find((p) => p.player.toLowerCase() === targetLower);
  if (!stats) {
    console.log(`Player "${playerArg}" (resolved as "${resolvedName}") not found in the MMR dataset.`);
    return;
  }

  // Calculate rank within threshold (effective threshold is the minimum of player's games and option threshold)
  const effectiveThreshold = Math.min(stats.games, threshold);
  const filtered = players.filter((p) => p.games >= effectiveThreshold);
  filtered.sort((a, b) => b.mmr - a.mmr); // Descending order for ranking

  let rankStr = 'N/A';
  const rankIdx = filtered.findIndex((p) => p.player.toLowerCase() === targetLower);
  if (rankIdx !== -1) {
    rankStr = `${rankIdx + 1}/${filtered.length}`;
  }

  const winRate = stats.games > 0 ? (stats.wins / stats.games) * 100 : 0;

  console.log(`\n=== Player Profile: ${stats.player} ===`);
  console.log(`  MMR:          ${stats.mmr.toFixed(2)}`);
  console.log(`  Rank:         ${rankStr}`);
  console.log(`  Games Played: ${stats.games}`);
  console.log(`  Wins:         ${stats.wins}`);
  console.log(`  Losses:       ${stats.losses}`);
  console.log(`  Win Rate:     ${winRate.toFixed(1)}%`);
}
