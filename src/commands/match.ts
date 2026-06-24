import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { CohesionTracker } from '../calculate/cohesion.js';
import { loadPairRecords } from './friendzone/common.js';

interface CsvMatchRecord {
  gameId: string;
  date: string;
  winner: string;
  scoreBlue: number;
  scoreRed: number;
  mmrBlue: number;
  avgMmrBlue: number;
  cohesionBlue: number;
  mmrRed: number;
  avgMmrRed: number;
  cohesionRed: number;
}

export async function runMatchList(options: {
  lines?: number;
  skip?: number;
  tail?: boolean;
}): Promise<void> {
  const lines = options.lines ?? 20;
  const skip = options.skip ?? 0;

  const matchesCsvPath = path.resolve(process.cwd(), '.tmp/matches.csv');
  if (!fs.existsSync(matchesCsvPath)) {
    throw new Error(`Matches CSV not found at ${matchesCsvPath}. Please run 'calculate' first.`);
  }

  const fileContent = fs.readFileSync(matchesCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const matches: CsvMatchRecord[] = records.map((r: any) => {
    let scoreBlue = parseInt(r['score blue'], 10);
    let scoreRed = parseInt(r['score red'], 10);
    if (isNaN(scoreBlue) || isNaN(scoreRed)) {
      if (r['winner'] === 'blue') {
        scoreBlue = 1000;
        scoreRed = 500;
      } else {
        scoreBlue = 500;
        scoreRed = 1000;
      }
    }
    return {
      gameId: r['game id'],
      date: r['date'] || '',
      winner: r['winner'],
      scoreBlue,
      scoreRed,
      mmrBlue: parseFloat(r['mmr blue']),
      avgMmrBlue: parseFloat(r['avg mmr blue']),
      cohesionBlue: parseFloat(r['cohesion blue']),
      mmrRed: parseFloat(r['mmr red']),
      avgMmrRed: parseFloat(r['avg mmr red']),
      cohesionRed: parseFloat(r['cohesion red']),
    };
  });

  let displayed: CsvMatchRecord[] = [];
  if (options.tail) {
    const startIdx = Math.max(0, matches.length - skip - lines);
    const endIdx = Math.max(0, matches.length - skip);
    displayed = matches.slice(startIdx, endIdx);
  } else {
    displayed = matches.slice(skip, skip + lines);
  }

  console.log(`\n=== Matches List (Sorted: Chronological | Matches: ${matches.length}) ===`);
  console.log(
    '  ' +
    'Game ID'.padEnd(20) +
    'Date'.padEnd(20) +
    'Winner'.padEnd(8) +
    'Blue Score'.padEnd(12) +
    'Red Score'.padEnd(12) +
    'Favorite'.padEnd(10) +
    'Blue MMR'.padEnd(12) +
    'Blue Avg'.padEnd(12) +
    'Blue Coh'.padEnd(12) +
    'Red MMR'.padEnd(12) +
    'Red Avg'.padEnd(12) +
    'Red Coh'
  );
  console.log('  ' + '-'.repeat(150));

  displayed.forEach((m) => {
    const favorite = m.mmrBlue - m.mmrRed;
    const favStr = (favorite >= 0 ? '+' : '') + favorite.toFixed(2);
    const cohBlueStr = (m.cohesionBlue >= 0 ? '+' : '') + m.cohesionBlue.toFixed(2);
    const cohRedStr = (m.cohesionRed >= 0 ? '+' : '') + m.cohesionRed.toFixed(2);
    console.log(
      '  ' +
      m.gameId.padEnd(20) +
      m.date.padEnd(20) +
      m.winner.padEnd(8) +
      String(m.scoreBlue).padEnd(12) +
      String(m.scoreRed).padEnd(12) +
      favStr.padEnd(10) +
      m.mmrBlue.toFixed(2).padEnd(12) +
      m.avgMmrBlue.toFixed(2).padEnd(12) +
      cohBlueStr.padEnd(12) +
      m.mmrRed.toFixed(2).padEnd(12) +
      m.avgMmrRed.toFixed(2).padEnd(12) +
      cohRedStr
    );
  });

  if (matches.length > displayed.length) {
    console.log(`\n  ... and ${matches.length - displayed.length} more matches.`);
  }
}

function resolveMatchIndex(ref: string, matches: CsvMatchRecord[], matchHeadIndex: number): number {
  const trimmed = ref.trim();
  const regexMatch = trimmed.match(/^(start|head|end|[a-zA-Z0-9_-]+)(?:([+-])(\d{1,3}))?$/);
  if (!regexMatch) {
    throw new Error(`Invalid match reference format: "${ref}"`);
  }

  const base = regexMatch[1];
  const sign = regexMatch[2];
  const offsetStr = regexMatch[3];

  let baseIndex = -1;
  if (base === 'start') {
    baseIndex = 0;
  } else if (base === 'head' || base === 'end') {
    baseIndex = matchHeadIndex;
  } else {
    baseIndex = matches.findIndex((m) => m.gameId === base);
    if (baseIndex === -1) {
      throw new Error(`Game ID "${base}" not found in matches database`);
    }
  }

  let finalIndex = baseIndex;
  if (sign && offsetStr) {
    const offset = parseInt(offsetStr, 10);
    if (sign === '+') {
      finalIndex = baseIndex + offset;
    } else {
      finalIndex = baseIndex - offset;
    }
  }

  if (finalIndex < 0) finalIndex = 0;
  if (finalIndex >= matches.length) finalIndex = matches.length - 1;

  return finalIndex;
}

export async function runMatchShow(matchRef: string): Promise<void> {
  if (!matchRef) {
    console.error('Error: Match reference is required.');
    process.exit(1);
  }

  const matchesCsvPath = path.resolve(process.cwd(), '.tmp/matches.csv');
  if (!fs.existsSync(matchesCsvPath)) {
    throw new Error(`Matches CSV not found at ${matchesCsvPath}. Please run 'calculate' first.`);
  }

  const fileContent = fs.readFileSync(matchesCsvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const matches: CsvMatchRecord[] = records.map((r: any) => {
    let scoreBlue = parseInt(r['score blue'], 10);
    let scoreRed = parseInt(r['score red'], 10);
    if (isNaN(scoreBlue) || isNaN(scoreRed)) {
      if (r['winner'] === 'blue') {
        scoreBlue = 1000;
        scoreRed = 500;
      } else {
        scoreBlue = 500;
        scoreRed = 1000;
      }
    }
    return {
      gameId: r['game id'],
      date: r['date'] || '',
      winner: r['winner'],
      scoreBlue,
      scoreRed,
      mmrBlue: parseFloat(r['mmr blue']),
      avgMmrBlue: parseFloat(r['avg mmr blue']),
      cohesionBlue: parseFloat(r['cohesion blue']),
      mmrRed: parseFloat(r['mmr red']),
      avgMmrRed: parseFloat(r['avg mmr red']),
      cohesionRed: parseFloat(r['cohesion red']),
    };
  });

  let matchHeadIndex = matches.length - 1;
  const metaPath = path.resolve(process.cwd(), '.tmp/mmr_meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const headId = meta.matchHead;
      if (headId) {
        const idx = matches.findIndex((m) => m.gameId === headId);
        if (idx !== -1) {
          matchHeadIndex = idx;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  const targetIndex = resolveMatchIndex(matchRef, matches, matchHeadIndex);
  const targetMatch = matches[targetIndex];

  if (!targetMatch) {
    throw new Error(`Match not found for reference: "${matchRef}"`);
  }

  // Load roster from source.csv if available
  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  let blueRoster: string[] = [];
  let redRoster: string[] = [];
  if (fs.existsSync(sourceCsvPath)) {
    try {
      const sourceContent = fs.readFileSync(sourceCsvPath, 'utf8');
      const records = parse(sourceContent, { columns: true, skip_empty_lines: true, trim: true });
      const matchParticipants = records.filter((r: any) => r.game === targetMatch.gameId);
      
      blueRoster = matchParticipants
        .filter((r: any) => r.side === 'blue')
        .map((r: any) => r.player)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      redRoster = matchParticipants
        .filter((r: any) => r.side === 'red')
        .map((r: any) => r.player)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch (e) {
      // Ignore
    }
  }

  const favorite = targetMatch.mmrBlue - targetMatch.mmrRed;
  const favStr = (favorite >= 0 ? '+' : '') + favorite.toFixed(2);
  const cohBlueStr = (targetMatch.cohesionBlue >= 0 ? '+' : '') + targetMatch.cohesionBlue.toFixed(2);
  const cohRedStr = (targetMatch.cohesionRed >= 0 ? '+' : '') + targetMatch.cohesionRed.toFixed(2);

  // Load friendzone records and populate CohesionTracker for top 4 average calculation
  const tracker = new CohesionTracker();
  try {
    tracker.loadFromPairs(loadPairRecords());
  } catch (e) {
    // Ignore if friendzone.csv doesn't exist yet
  }

  // Load player games count from mmr.csv
  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');
  const playerGamesMap = new Map<string, number>();
  if (fs.existsSync(mmrCsvPath)) {
    try {
      const mmrContent = fs.readFileSync(mmrCsvPath, 'utf8');
      const mmrRecords = parse(mmrContent, { columns: true, skip_empty_lines: true, trim: true });
      for (const r of mmrRecords) {
        if (r.player) {
          playerGamesMap.set(r.player.toLowerCase(), parseInt(r.games, 10) || 0);
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  const dampingGames = (config as any).mmr?.cohesionDampingGames ?? 5;

  console.log(`\n=== Match Details: ${targetMatch.gameId} ===`);
  console.log(`  Date:                 ${targetMatch.date}`);
  console.log(`  Winner:               ${targetMatch.winner.toUpperCase()}`);
  console.log(`  Favorite:             ${favStr}`);
  console.log('');
  console.log(`  Blue Team:`);
  console.log(`    Score:              ${targetMatch.scoreBlue}`);
  console.log(`    Effective MMR:      ${targetMatch.mmrBlue.toFixed(2)}`);
  console.log(`    Base MMR (Avg):     ${targetMatch.avgMmrBlue.toFixed(2)}`);
  console.log(`    Cohesion Elo Bonus: ${cohBlueStr}`);
  console.log('');
  console.log(`  Red Team:`);
  console.log(`    Score:              ${targetMatch.scoreRed}`);
  console.log(`    Effective MMR:      ${targetMatch.mmrRed.toFixed(2)}`);
  console.log(`    Base MMR (Avg):     ${targetMatch.avgMmrRed.toFixed(2)}`);
  console.log(`    Cohesion Elo Bonus: ${cohRedStr}`);
  console.log('');

  if (blueRoster.length > 0 || redRoster.length > 0) {
    console.log('  Roster:');

    const maxNameLen = Math.max(
      ...blueRoster.map((p) => p.length),
      ...redRoster.map((p) => p.length),
      0
    );

    const maxLen = Math.max(blueRoster.length, redRoster.length);
    for (let i = 0; i < maxLen; i++) {
      const bluePlayer = blueRoster[i] || '';
      const redPlayer = redRoster[i] || '';

      let blueText = '';
      if (bluePlayer) {
        const blueAvg = tracker.getPlayerCohesion(bluePlayer, blueRoster, dampingGames);
        const blueGames = playerGamesMap.get(bluePlayer.toLowerCase()) || 0;
        const blueGamesStr = String(blueGames).padStart(2, '0');
        blueText = `${bluePlayer.padStart(maxNameLen)} (${blueAvg.toFixed(4)}🫂  / ${blueGamesStr}⚔️  )`;
      }

      let redText = '';
      if (redPlayer) {
        const redAvg = tracker.getPlayerCohesion(redPlayer, redRoster, dampingGames);
        const redGames = playerGamesMap.get(redPlayer.toLowerCase()) || 0;
        const redGamesStr = String(redGames).padStart(2, '0');
        redText = `${redPlayer.padStart(maxNameLen)} (${redAvg.toFixed(4)}🫂  / ${redGamesStr}⚔️  )`;
      }

      const leftPart = blueText ? blueText : ''.padStart(maxNameLen + 21);
      console.log(`  ${leftPart}  |  ${redText}`);
    }
    console.log('');
  }
}
