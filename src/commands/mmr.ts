import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { calculateMmrAndFriendship, PlayerStats, CsvRecord } from '../calculate/mmr.js';

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

export async function calculateSourceMmr(options: { defaultRating?: number; kFactor?: number; generations?: number; calibration?: number }): Promise<void> {
  const defaultRating = options.defaultRating ?? (config as any).mmr?.defaultRating ?? 1500;
  const kFactor = options.kFactor ?? (config as any).mmr?.kFactor ?? 32;
  const generations = options.generations ?? 1;
  const calibration = options.calibration ?? 10;

  const cohesionScaling = (config as any).mmr?.cohesionScaling ?? 100;
  const cohesionDampingGames = (config as any).mmr?.cohesionDampingGames ?? 5;

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

  console.log('Orchestrating ratings calculation simulation (including moving cohesion)...');
  const { players, friendships } = calculateMmrAndFriendship(records, {
    defaultRating,
    kFactor,
    generations,
    calibration,
    cohesionScaling,
    cohesionDampingGames,
  });

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. Save ratings to .tmp/mmr.csv
  const mmrCsvRows: string[][] = [['player', 'mmr', 'games', 'wins', 'losses']];
  for (const stats of players) {
    mmrCsvRows.push([
      stats.player,
      stats.mmr.toFixed(2),
      String(stats.games),
      String(stats.wins),
      String(stats.losses),
    ]);
  }
  const mmrOutputPath = path.join(tmpDir, 'mmr.csv');
  console.log(`Writing MMR data to ${mmrOutputPath}...`);
  fs.writeFileSync(mmrOutputPath, arrayToCsv(mmrCsvRows), 'utf8');

  // 2. Save friendships to .tmp/friendzone.csv
  const friendzoneCsvRows: string[][] = [
    ['player', 'other', 'same game', 'same side', 'friendship index']
  ];
  for (const pair of friendships) {
    friendzoneCsvRows.push([
      pair.player,
      pair.other,
      String(pair.sameGame),
      String(pair.sameSide),
      pair.friendshipIndex.toFixed(4),
    ]);
  }
  const friendzoneOutputPath = path.join(tmpDir, 'friendzone.csv');
  console.log(`Writing Friendzone data to ${friendzoneOutputPath}...`);
  fs.writeFileSync(friendzoneOutputPath, arrayToCsv(friendzoneCsvRows), 'utf8');

  // 3. Save metadata JSON
  const metaPath = path.join(tmpDir, 'mmr_meta.json');
  const gamesSet = new Set<string>();
  for (const record of records) {
    if (record.game && record.player && record.side) {
      gamesSet.add(record.date ? `${record.game}_${record.date}` : record.game);
    }
  }

  const metadata = {
    totalGames: gamesSet.size,
    generations,
    calibration,
    defaultRating,
    kFactor,
    cohesionScaling,
    cohesionDampingGames
  };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  console.log('✅ MMR and Friendzone calculations complete.');
}

export async function runMmrList(options: { threshold?: number; lines?: number; skip?: number; sort?: string; tail?: boolean }): Promise<void> {
  const threshold = options.threshold ?? (config as any).mmr?.matchThreshold ?? 5;
  const lines = options.lines ?? (config as any).mmr?.amount ?? 20;
  const skip = options.skip ?? 0;
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

  let displayed: PlayerStats[] = [];
  let startIdx = 0;
  if (options.tail) {
    startIdx = Math.max(0, filtered.length - skip - lines);
    const endIdx = Math.max(0, filtered.length - skip);
    displayed = filtered.slice(startIdx, endIdx);
  } else {
    startIdx = skip;
    displayed = filtered.slice(skip, skip + lines);
  }

  // Read total games observed from metadata JSON
  let totalGamesObserved = 0;
  const metaPath = path.resolve(process.cwd(), '.tmp/mmr_meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const metaContent = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(metaContent);
      totalGamesObserved = meta.totalGames || 0;
    } catch (e) {
      // Ignore
    }
  }

  const headingParts = [
    `Sorted: ${ascending ? 'Ascending' : 'Descending'}`,
    `Players: ${filtered.length}`
  ];
  if (totalGamesObserved > 0) {
    headingParts.push(`Games: ${totalGamesObserved}`);
  }
  const headingText = `=== MMR Leaderboard (${headingParts.join(' | ')}) ===`;

  console.log(`\n${headingText}`);
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
    const rankStr = String(startIdx + idx + 1);
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

  if (filtered.length > displayed.length) {
    console.log(`\n  ... and ${filtered.length - displayed.length} more players.`);
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

  const targetLower = playerArg.trim().toLowerCase();

  const stats = players.find((p) => p.player.toLowerCase() === targetLower);
  if (!stats) {
    console.log(`${playerArg} should lock in and grind some OPRs! No matches found`);
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
