import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../../config.js';
import { getBannedPlayers } from '../../common.js';

interface CsvPlayerStats {
  player: string;
  mmr: number;
  rank: string;
  games: number;
  wins: number;
  losses: number;
  delta: number;
  rankDelta: string;
}

export async function runEloList(options: {
  lines?: number;
  skip?: number;
  sort?: string;
  delta?: boolean;
  unredact?: boolean;
  tail?: boolean;
}): Promise<void> {
  const lines = options.lines ?? (config as any).elo?.amount ?? 20;
  const skip = options.skip ?? 0;
  const sortInput = (options.sort || (config as any).elo?.sort || 'descending').toLowerCase();
  const redact = !options.unredact;

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

  const bannedPlayers = getBannedPlayers();

  const players: CsvPlayerStats[] = records.map((r: any) => ({
    player: r.player,
    mmr: parseFloat(r.mmr),
    rank: r.rank || '0',
    games: parseInt(r.games, 10),
    wins: parseInt(r.wins, 10),
    losses: parseInt(r.losses, 10),
    delta: parseFloat(r.delta) || 0.0,
    rankDelta: r['rank delta'] || '',
  }));

  const activePlayerCount = players.filter(
    (p) => p.rank !== '0' && p.rank !== '' && !bannedPlayers.has(p.player.trim().toLowerCase())
  ).length;

  const filtered = players.filter(
    (p) => p.rank !== '0' && p.rank !== '' && (!redact || !bannedPlayers.has(p.player.trim().toLowerCase()))
  );

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

  let totalGamesObserved = 0;
  const metaPath = path.resolve(process.cwd(), '.tmp/meta.elo.json');
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
  const headingText = `=== Elo Leaderboard (${headingParts.join(' | ')}) ===`;

  console.log(`\n${headingText}`);
  console.log(
    '  ' +
    'Rank'.padEnd(6) +
    'Player'.padEnd(25) +
    'Elo'.padEnd(10) +
    'Games'.padEnd(8) +
    'Wins'.padEnd(6) +
    'Losses'.padEnd(8) +
    'Win Rate'.padEnd(10) +
    'Delta'.padEnd(10) +
    'Rank Delta'
  );
  console.log('  ' + '-'.repeat(90));

  displayed.forEach((p) => {
    const winRate = p.games > 0 ? (p.wins / p.games) * 100 : 0;
    
    const numericRank = parseFloat(p.rank);
    const isBanned = bannedPlayers.has(p.player.trim().toLowerCase());
    
    let isRedacted = false;
    let reason = '';
    if (redact) {
      if (isBanned) {
        isRedacted = true;
        reason = 'banned';
      } else if (numericRank > activePlayerCount / 2) {
        isRedacted = true;
        reason = '50%';
      }
    }

    let rankStr = p.rank;
    let mmrStr = p.mmr.toFixed(2);
    let gamesStr = String(p.games);
    let winsStr = String(p.wins);
    let lossesStr = String(p.losses);
    let winRateStr = `${winRate.toFixed(1)}%`;
    let deltaStr = (p.delta >= 0 ? '+' : '') + p.delta.toFixed(2);
    let rankDeltaStr = p.rankDelta;

    if (isRedacted) {
      const redText = `<redacted:${reason}>`;
      rankStr = redText;
      mmrStr = redText;
      winsStr = redText;
      lossesStr = redText;
      winRateStr = redText;
      if (reason === '50%') {
        if (p.delta > 0) {
          deltaStr = (p.delta >= 0 ? '+' : '') + p.delta.toFixed(2);
        } else {
          deltaStr = redText;
        }
        if (p.rankDelta.startsWith('+') || p.rankDelta === 'new') {
          rankDeltaStr = p.rankDelta;
        } else {
          rankDeltaStr = redText;
        }
      } else {
        deltaStr = redText;
        rankDeltaStr = redText;
      }
    }

    console.log(
      '  ' +
      rankStr.padEnd(6) +
      p.player.padEnd(25) +
      mmrStr.padEnd(10) +
      gamesStr.padEnd(8) +
      winsStr.padEnd(6) +
      lossesStr.padEnd(8) +
      winRateStr.padEnd(10) +
      deltaStr.padEnd(10) +
      rankDeltaStr
    );
  });

  if (filtered.length > displayed.length) {
    console.log(`\n  ... and ${filtered.length - displayed.length} more players.`);
  }
}
