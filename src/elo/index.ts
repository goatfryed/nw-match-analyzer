import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { calculateElo, CsvRecord } from './calculation.js';
import { getBannedPlayers } from '../common.js';

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

export async function calculateSourceElo(options: {
  defaultRating?: number;
  kFactor?: number;
  generations?: number;
  calibration?: number;
  rebuild?: boolean;
  from?: string;
  to?: string;
  scoreFactor?: number;
}): Promise<void> {
  const defaultRating = options.defaultRating ?? (config as any).elo?.defaultRating ?? 1500;
  const kFactor = options.kFactor ?? (config as any).elo?.kFactor ?? 32;
  const generations = options.generations ?? 1;
  const calibration = options.calibration ?? (config as any).elo?.calibration ?? 10;
  const defaultLosingScore = (config as any).elo?.defaultLosingScore ?? 600;
  const scoreFactor = options.scoreFactor ?? (config as any).elo?.scoreFactor ?? 10;

  const cohesionPenalty = (config as any).elo?.cohesionPenalty ?? 100;
  const cohesionBonus = (config as any).elo?.cohesionBonus ?? 100;
  const cohesionSoloQ = (config as any).elo?.cohesionSoloQ ?? 0.65;
  const cohesionDampingGames = (config as any).elo?.cohesionDampingGames ?? 5;
  const cohesionTolerance = (config as any).elo?.cohesionTolerance ?? 0.12;
  const cohesionSteepness = (config as any).elo?.cohesionSteepness ?? 2.0;
  const maxRowsPerGame = (config as any).validation?.maxRowsPerGame;
  const individualWeight = (config as any).elo?.individualWeight ?? 0.5;
  const rewardPoints = (config as any).elo?.rewardPoints;

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

  const rebuild = !!options.rebuild;
  const previousPlayers = new Map<string, { elo: number; rank: string; games: number; wins: number; losses: number }>();
  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');

  if (!rebuild && fs.existsSync(mmrCsvPath)) {
    try {
      console.log('Loading previous Elo ratings...');
      const mmrContent = fs.readFileSync(mmrCsvPath, 'utf8');
      const mmrRecords = parse(mmrContent, { columns: true, skip_empty_lines: true, trim: true });
      for (const r of mmrRecords) {
        if (r.player) {
          previousPlayers.set(r.player, {
            elo: parseFloat(r.mmr) || defaultRating,
            rank: r.rank || '0',
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
  const metaPath = path.resolve(process.cwd(), '.tmp/meta.elo.json');
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
  const { players, matchHead, processedMatches, prefixGameIds } = calculateElo(records, {
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
    rewardPoints,
  });

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const seedingGames = (config as any).elo?.seedingGames ?? 10;

  const bannedPlayers = getBannedPlayers();
  const rankedPlayers = [...players].filter((p) => p.games >= seedingGames).sort((a, b) => b.elo - a.elo);
  const playerRankMap = new Map<string, string>();
  let activeCount = 0;
  rankedPlayers.forEach((p) => {
    const isBanned = bannedPlayers.has(p.player.trim().toLowerCase());
    if (!isBanned) {
      activeCount++;
      playerRankMap.set(p.player, String(activeCount));
    } else {
      playerRankMap.set(p.player, `${activeCount}.1`);
    }
  });

  players.sort((a, b) => a.player.localeCompare(b.player, undefined, { sensitivity: 'base' }));

  const mmrCsvRows: string[][] = [['player', 'mmr', 'rank', 'games', 'wins', 'losses', 'delta', 'rank delta']];
  for (const stats of players) {
    const prev = previousPlayers.get(stats.player);
    const rank = playerRankMap.get(stats.player) || '0';
    const prevRank = prev ? prev.rank : '0';

    let prevMmr = prev ? prev.elo : defaultRating;
    if (rank !== '0' && prevRank === '0') {
      prevMmr = defaultRating;
    }

    const deltaVal = stats.elo - prevMmr;
    const deltaStr = (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(2);

    let rankDeltaStr = '';
    if (rank !== '0') {
      if (prevRank === '0') {
        rankDeltaStr = 'new';
      } else {
        const rVal = parseFloat(rank);
        const prevRVal = parseFloat(prevRank);
        const diff = prevRVal - rVal;
        if (diff === 0) {
          rankDeltaStr = '--';
        } else {
          const formattedDiff = Number.isInteger(diff) ? diff.toFixed(0) : diff.toFixed(1);
          rankDeltaStr = (diff > 0 ? '+' : '') + formattedDiff;
        }
      }
    }

    mmrCsvRows.push([
      stats.player,
      stats.elo.toFixed(2),
      rank,
      String(stats.games),
      String(stats.wins),
      String(stats.losses),
      deltaStr,
      rankDeltaStr,
    ]);
  }
  const mmrOutputPath = path.join(tmpDir, 'mmr.csv');
  console.log(`Writing Elo data to ${mmrOutputPath}...`);
  fs.writeFileSync(mmrOutputPath, arrayToCsv(mmrCsvRows), 'utf8');

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

  for (const m of processedMatches) {
    matchesCsvRows.push([
      m.gameId,
      m.date,
      m.winner,
      String(m.scoreBlue),
      String(m.scoreRed),
      m.eloBlue.toFixed(2),
      m.avgEloBlue.toFixed(2),
      m.cohesionBlue.toFixed(2),
      m.eloRed.toFixed(2),
      m.avgEloRed.toFixed(2),
      m.cohesionRed.toFixed(2)
    ]);
  }

  const matchesOutputPath = path.join(tmpDir, 'matches.csv');
  console.log(`Writing matches history to ${matchesOutputPath}...`);
  fs.writeFileSync(matchesOutputPath, arrayToCsv(matchesCsvRows), 'utf8');

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
    defaultLosingScore,
    rewardPoints
  };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  console.log('✅ Elo calculation complete.');
}
