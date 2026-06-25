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

export async function calculateSourceMmr(options: {
  defaultRating?: number;
  kFactor?: number;
  generations?: number;
  calibration?: number;
  rebuild?: boolean;
  from?: string;
  to?: string;
  scoreFactor?: number;
}): Promise<void> {
  const defaultRating = options.defaultRating ?? (config as any).mmr?.defaultRating ?? 1500;
  const kFactor = options.kFactor ?? (config as any).mmr?.kFactor ?? 32;
  const generations = options.generations ?? 1;
  const calibration = options.calibration ?? (config as any).mmr?.calibration ?? 10;
  const defaultLosingScore = (config as any).mmr?.defaultLosingScore ?? 600;
  const scoreFactor = options.scoreFactor ?? (config as any).mmr?.scoreFactor ?? 10;

  const cohesionPenalty = (config as any).mmr?.cohesionPenalty ?? 100;
  const cohesionBonus = (config as any).mmr?.cohesionBonus ?? 100;
  const cohesionSoloQ = (config as any).mmr?.cohesionSoloQ ?? 0.65;
  const cohesionDampingGames = (config as any).mmr?.cohesionDampingGames ?? 5;
  const cohesionTolerance = (config as any).mmr?.cohesionTolerance ?? 0.12;
  const cohesionSteepness = (config as any).mmr?.cohesionSteepness ?? 2.0;
  const maxRowsPerGame = (config as any).validation?.maxRowsPerGame;
  const individualWeight = (config as any).mmr?.individualWeight ?? 0.5;

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

  // Load previous state if rebuild option is not set
  const rebuild = !!options.rebuild;
  const previousPlayers = new Map<string, { mmr: number; games: number; wins: number; losses: number }>();
  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');

  if (!rebuild && fs.existsSync(mmrCsvPath)) {
    try {
      console.log('Loading previous MMR ratings...');
      const mmrContent = fs.readFileSync(mmrCsvPath, 'utf8');
      const mmrRecords = parse(mmrContent, { columns: true, skip_empty_lines: true, trim: true });
      for (const r of mmrRecords) {
        if (r.player) {
          previousPlayers.set(r.player, {
            mmr: parseFloat(r.mmr) || defaultRating,
            games: parseInt(r.games, 10) || 0,
            wins: parseInt(r.wins, 10) || 0,
            losses: parseInt(r.losses, 10) || 0,
          });
        }
      }
    } catch (e) {
      console.warn('Could not parse previous mmr.csv, starting fresh.');
    }
  }

  const previousFriendshipsSameGame = new Map<string, number>();
  const previousFriendshipsSameSide = new Map<string, number>();
  const previousFriendshipsIndex = new Map<string, number>();
  const friendzoneCsvPath = path.resolve(process.cwd(), '.tmp/friendzone.csv');

  if (!rebuild && fs.existsSync(friendzoneCsvPath)) {
    try {
      console.log('Loading previous Friendzone relationship stats...');
      const fzContent = fs.readFileSync(friendzoneCsvPath, 'utf8');
      const fzRecords = parse(fzContent, { columns: true, skip_empty_lines: true, trim: true });
      for (const r of fzRecords) {
        if (r.player && r.other) {
          const p1 = r.player;
          const p2 = r.other;
          const key = p1 < p2 ? `${p1}:${p2}` : `${p2}:${p1}`;
          previousFriendshipsSameGame.set(key, parseInt(r['same game'], 10) || 0);
          previousFriendshipsSameSide.set(key, parseInt(r['same side'], 10) || 0);
          previousFriendshipsIndex.set(key, parseFloat(r['friendship index']) || 0.0);
        }
      }
    } catch (e) {
      console.warn('Could not parse previous friendzone.csv, starting fresh.');
    }
  }

  const matchesCsvPath = path.resolve(process.cwd(), '.tmp/matches.csv');
  const previousMatchRecords: any[] = [];
  if (!rebuild && fs.existsSync(matchesCsvPath)) {
    try {
      console.log('Loading previous match records...');
      const matchesContent = fs.readFileSync(matchesCsvPath, 'utf8');
      const parsedRecords = parse(matchesContent, { columns: true, skip_empty_lines: true, trim: true });
      previousMatchRecords.push(...parsedRecords);
    } catch (e) {
      console.warn('Could not parse previous matches.csv, starting fresh.');
    }
  }

  let previousMatchHead: string | undefined;
  const metaPath = path.resolve(process.cwd(), '.tmp/mmr_meta.json');
  if (!rebuild && fs.existsSync(metaPath)) {
    try {
      const metaContent = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(metaContent);
      previousMatchHead = meta.matchHead;
    } catch (e) {
      // Ignore
    }
  }

  console.log('Orchestrating ratings calculation simulation (including moving cohesion)...');
  const { players, friendships, matchHead, processedMatches, prefixGameIds } = calculateMmrAndFriendship(records, {
    defaultRating,
    kFactor,
    generations,
    calibration,
    cohesionPenalty,
    cohesionBonus,
    cohesionSoloQ,
    cohesionDampingGames,
    cohesionTolerance,
    cohesionSteepness,
    rebuild,
    fromMatchRef: options.from,
    toMatchRef: options.to,
    previousPlayers,
    previousFriendshipsSameGame,
    previousFriendshipsSameSide,
    previousMatchHead,
    maxRowsPerGame,
    scoreFactor,
    individualWeight,
    defaultLosingScore,
  });

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const seedingGames = (config as any).mmr?.seedingGames ?? 10;

  // 1. Save ratings to .tmp/mmr.csv with delta values and ranks
  // Sort by MMR descending first to assign ranks. Only players with games >= seedingGames get a rank.
  const rankedPlayers = [...players].filter((p) => p.games >= seedingGames).sort((a, b) => b.mmr - a.mmr);
  const playerRankMap = new Map<string, number>();
  rankedPlayers.forEach((p, idx) => {
    playerRankMap.set(p.player, idx + 1);
  });

  // Now sort players alphabetically by name
  players.sort((a, b) => a.player.localeCompare(b.player, undefined, { sensitivity: 'base' }));

  const mmrCsvRows: string[][] = [['player', 'mmr', 'rank', 'games', 'wins', 'losses', 'delta']];
  for (const stats of players) {
    const prev = previousPlayers.get(stats.player);
    const prevMmr = prev ? prev.mmr : defaultRating;
    const deltaVal = stats.mmr - prevMmr;
    const deltaStr = (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(2);
    const rank = playerRankMap.get(stats.player) || 0;

    mmrCsvRows.push([
      stats.player,
      stats.mmr.toFixed(2),
      String(rank),
      String(stats.games),
      String(stats.wins),
      String(stats.losses),
      deltaStr,
    ]);
  }
  const mmrOutputPath = path.join(tmpDir, 'mmr.csv');
  console.log(`Writing MMR data to ${mmrOutputPath}...`);
  fs.writeFileSync(mmrOutputPath, arrayToCsv(mmrCsvRows), 'utf8');

  // 2. Save friendships to .tmp/friendzone.csv with delta values
  const friendzoneCsvRows: string[][] = [
    ['player', 'other', 'same game', 'same side', 'friendship index', 'delta']
  ];
  for (const pair of friendships) {
    const key = pair.player < pair.other ? `${pair.player}:${pair.other}` : `${pair.other}:${pair.player}`;
    const prevIndex = previousFriendshipsIndex.get(key) ?? 0.0;
    const deltaVal = pair.friendshipIndex - prevIndex;
    const deltaStr = (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(4);

    friendzoneCsvRows.push([
      pair.player,
      pair.other,
      String(pair.sameGame),
      String(pair.sameSide),
      pair.friendshipIndex.toFixed(4),
      deltaStr,
    ]);
  }
  const friendzoneOutputPath = path.join(tmpDir, 'friendzone.csv');
  console.log(`Writing Friendzone data to ${friendzoneOutputPath}...`);
  fs.writeFileSync(friendzoneOutputPath, arrayToCsv(friendzoneCsvRows), 'utf8');

  // 3. Save matches to .tmp/matches.csv
  const keptMatches = previousMatchRecords.filter((r) => prefixGameIds.has(r['game id']));

  const matchesCsvRows: string[][] = [
    [
      'game id',
      'date',
      'winner',
      'score blue',
      'score red',
      'mmr blue',
      'avg mmr blue',
      'cohesion blue',
      'mmr red',
      'avg mmr red',
      'cohesion red',
    ]
  ];

  // Add kept matches
  for (const r of keptMatches) {
    let scoreBlue = r['score blue'];
    let scoreRed = r['score red'];
    if (scoreBlue === undefined || scoreBlue === '' || scoreRed === undefined || scoreRed === '') {
      const winner = r['winner'];
      if (winner === 'blue') {
        scoreBlue = '1000';
        scoreRed = '500';
      } else {
        scoreBlue = '500';
        scoreRed = '1000';
      }
    }
    matchesCsvRows.push([
      r['game id'],
      r['date'] || '',
      r['winner'],
      String(scoreBlue),
      String(scoreRed),
      r['mmr blue'],
      r['avg mmr blue'],
      r['cohesion blue'],
      r['mmr red'],
      r['avg mmr red'],
      r['cohesion red']
    ]);
  }

  // Add new processed matches
  for (const m of processedMatches) {
    matchesCsvRows.push([
      m.gameId,
      m.date,
      m.winner,
      String(m.scoreBlue),
      String(m.scoreRed),
      m.mmrBlue.toFixed(2),
      m.avgMmrBlue.toFixed(2),
      m.cohesionBlue.toFixed(2),
      m.mmrRed.toFixed(2),
      m.avgMmrRed.toFixed(2),
      m.cohesionRed.toFixed(2)
    ]);
  }

  const matchesOutputPath = path.join(tmpDir, 'matches.csv');
  console.log(`Writing matches history to ${matchesOutputPath}...`);
  fs.writeFileSync(matchesOutputPath, arrayToCsv(matchesCsvRows), 'utf8');

  // 4. Save metadata JSON
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
    cohesionPenalty,
    cohesionBonus,
    cohesionSoloQ,
    cohesionDampingGames,
    cohesionTolerance,
    cohesionSteepness,
    matchHead,
    defaultLosingScore
  };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  console.log('✅ MMR and Friendzone calculations complete.');
}

interface CsvPlayerStats {
  player: string;
  mmr: number;
  rank: number;
  games: number;
  wins: number;
  losses: number;
  delta: number;
}

export async function runMmrList(options: {
  lines?: number;
  skip?: number;
  sort?: string;
  tail?: boolean;
  delta?: boolean;
}): Promise<void> {
  const seedingGames = (config as any).mmr?.seedingGames ?? 10;
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
    throw new Error(`MMR CSV not found at ${mmrCsvPath}. Please run 'calculate' first.`);
  }

  const fileContent = fs.readFileSync(mmrCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const players: CsvPlayerStats[] = records.map((r: any) => ({
    player: r.player,
    mmr: parseFloat(r.mmr),
    rank: parseInt(r.rank, 10),
    games: parseInt(r.games, 10),
    wins: parseInt(r.wins, 10),
    losses: parseInt(r.losses, 10),
    delta: parseFloat(r.delta) || 0.0,
  }));

  const filtered = players;

  // Assign dynamic MMR rank within the subset (only players with games >= seedingGames get ranked)
  const sortedByMmr = [...filtered].filter((p) => p.games >= seedingGames).sort((a, b) => b.mmr - a.mmr);
  const playerRankMap = new Map<string, number>();
  sortedByMmr.forEach((p, idx) => {
    playerRankMap.set(p.player, idx + 1);
  });

  // Sort by MMR or Delta MMR
  if (options.delta) {
    filtered.sort((a, b) => (ascending ? a.delta - b.delta : b.delta - a.delta));
  } else {
    filtered.sort((a, b) => (ascending ? a.mmr - b.mmr : b.mmr - a.mmr));
  }

  let displayed: CsvPlayerStats[] = [];
  if (options.tail) {
    const startIdx = Math.max(0, filtered.length - skip - lines);
    const endIdx = Math.max(0, filtered.length - skip);
    displayed = filtered.slice(startIdx, endIdx);
  } else {
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
    `Sorted: ${options.delta ? 'Delta ' : ''}${ascending ? 'Ascending' : 'Descending'}`,
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
    'Win Rate'.padEnd(10) +
    'Delta'
  );
  console.log('  ' + '-'.repeat(80));

  displayed.forEach((p) => {
    const winRate = p.games > 0 ? (p.wins / p.games) * 100 : 0;
    const deltaStr = (p.delta >= 0 ? '+' : '') + p.delta.toFixed(2);
    const dynamicRank = playerRankMap.get(p.player) || 0;
    console.log(
      '  ' +
      String(dynamicRank).padEnd(6) +
      p.player.padEnd(25) +
      p.mmr.toFixed(2).padEnd(10) +
      String(p.games).padEnd(8) +
      String(p.wins).padEnd(6) +
      String(p.losses).padEnd(8) +
      `${winRate.toFixed(1)}%`.padEnd(10) +
      deltaStr
    );
  });

  if (filtered.length > displayed.length) {
    console.log(`\n  ... and ${filtered.length - displayed.length} more players.`);
  }
}

export async function runMmrShow(playerArg: string): Promise<void> {
  if (!playerArg) {
    console.error('Error: Player name is required.');
    process.exit(1);
  }

  const seedingGames = (config as any).mmr?.seedingGames ?? 10;

  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');
  if (!fs.existsSync(mmrCsvPath)) {
    throw new Error(`MMR CSV not found at ${mmrCsvPath}. Please run 'calculate' first.`);
  }

  const fileContent = fs.readFileSync(mmrCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const players: CsvPlayerStats[] = records.map((r: any) => ({
    player: r.player,
    mmr: parseFloat(r.mmr),
    rank: parseInt(r.rank, 10),
    games: parseInt(r.games, 10),
    wins: parseInt(r.wins, 10),
    losses: parseInt(r.losses, 10),
    delta: parseFloat(r.delta) || 0.0,
  }));

  const targetLower = playerArg.trim().toLowerCase();

  const stats = players.find((p) => p.player.toLowerCase() === targetLower);
  if (!stats) {
    console.log(`${playerArg} should lock in and grind some OPRs! No matches found`);
    return;
  }

  let rankStr = '0 (unranked)';
  if (stats.games >= seedingGames) {
    const filtered = players.filter((p) => p.games >= seedingGames);
    filtered.sort((a, b) => b.mmr - a.mmr); // Descending order for ranking
    const rankIdx = filtered.findIndex((p) => p.player.toLowerCase() === targetLower);
    if (rankIdx !== -1) {
      rankStr = `${rankIdx + 1}/${filtered.length}`;
    }
  }

  const winRate = stats.games > 0 ? (stats.wins / stats.games) * 100 : 0;
  const deltaStr = (stats.delta >= 0 ? '+' : '') + stats.delta.toFixed(2);

  console.log(`\n=== Player Profile: ${stats.player} ===`);
  console.log(`  MMR:          ${stats.mmr.toFixed(2)}`);
  console.log(`  Rank:         ${rankStr}`);
  console.log(`  Games Played: ${stats.games}`);
  console.log(`  Wins:         ${stats.wins}`);
  console.log(`  Losses:       ${stats.losses}`);
  console.log(`  Win Rate:     ${winRate.toFixed(1)}%`);
  console.log(`  Delta:        ${deltaStr}`);
}

export async function runMmrListGrinder(options: {
  lines?: number;
  skip?: number;
  tail?: boolean;
}): Promise<void> {
  const lines = options.lines ?? 5;
  const skip = options.skip ?? 0;

  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');
  if (!fs.existsSync(mmrCsvPath)) {
    throw new Error(`MMR CSV not found at ${mmrCsvPath}. Please run 'calculate' first.`);
  }

  const fileContent = fs.readFileSync(mmrCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const players: { player: string; games: number }[] = records.map((r: any) => ({
    player: r.player,
    games: parseInt(r.games, 10) || 0,
  }));

  // Sort by games descending, then alphabetically by player name
  players.sort((a: any, b: any) => {
    if (b.games !== a.games) {
      return b.games - a.games;
    }
    return a.player.localeCompare(b.player, undefined, { sensitivity: 'base' });
  });

  let displayed: { player: string; games: number }[] = [];
  if (options.tail) {
    const startIdx = Math.max(0, players.length - skip - lines);
    const endIdx = Math.max(0, players.length - skip);
    displayed = players.slice(startIdx, endIdx);
  } else {
    displayed = players.slice(skip, skip + lines);
  }

  // Header
  console.log(`\n=== MMR Grinders (Players: ${players.length}) ===`);
  console.log(
    '  ' +
    'Rank'.padEnd(6) +
    'Player'.padEnd(25) +
    'Games'
  );
  console.log('  ' + '-'.repeat(40));

  displayed.forEach((p) => {
    const rank = players.findIndex((x) => x.player === p.player) + 1;
    console.log(
      '  ' +
      String(rank).padEnd(6) +
      p.player.padEnd(25) +
      String(p.games)
    );
  });

  if (players.length > displayed.length) {
    console.log(`\n  ... and ${players.length - displayed.length} more players.`);
  }
}

