import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';

import { getBannedPlayers } from '../common.js';



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

export async function runMmrList(options: {
  lines?: number;
  skip?: number;
  sort?: string;
  tail?: boolean;
  delta?: boolean;
  unredact?: boolean;
}): Promise<void> {
  const lines = options.lines ?? (config as any).mmr?.amount ?? 20;
  const skip = options.skip ?? 0;
  const sortInput = (options.sort || (config as any).mmr?.sort || 'descending').toLowerCase();
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
    'Rank'.padEnd(18) +
    'Player'.padEnd(25) +
    'MMR'.padEnd(18) +
    'Games'.padEnd(8) +
    'Wins'.padEnd(18) +
    'Losses'.padEnd(18) +
    'Win Rate'.padEnd(18) +
    'Delta'.padEnd(18) +
    'Rank Delta'
  );
  console.log('  ' + '-'.repeat(162));

  displayed.forEach((p) => {
    const winRate = p.games > 0 ? (p.wins / p.games) * 100 : 0;
    
    // Check redaction based on the player's stored rank
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
      rankStr.padEnd(18) +
      p.player.padEnd(25) +
      mmrStr.padEnd(18) +
      gamesStr.padEnd(8) +
      winsStr.padEnd(18) +
      lossesStr.padEnd(18) +
      winRateStr.padEnd(18) +
      deltaStr.padEnd(18) +
      rankDeltaStr
    );
  });

  if (filtered.length > displayed.length) {
    console.log(`\n  ... and ${filtered.length - displayed.length} more players.`);
  }
}

export async function runMmrShow(
  playerArg: string,
  options: { unredact?: boolean } = {}
): Promise<void> {
  if (!playerArg) {
    console.error('Error: Player name is required.');
    process.exit(1);
  }

  const redact = !options.unredact;

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
    rank: r.rank || '0',
    games: parseInt(r.games, 10),
    wins: parseInt(r.wins, 10),
    losses: parseInt(r.losses, 10),
    delta: parseFloat(r.delta) || 0.0,
    rankDelta: r['rank delta'] || '',
  }));

  const targetLower = playerArg.trim().toLowerCase();

  const stats = players.find((p) => p.player.toLowerCase() === targetLower);
  if (!stats) {
    console.log(`${playerArg} should lock in and grind some OPRs! No matches found`);
    return;
  }

  const bannedPlayers = getBannedPlayers();
  const totalActiveCount = players.filter(
    (p) => p.rank !== '0' && p.rank !== '' && !bannedPlayers.has(p.player.trim().toLowerCase())
  ).length;

  const isBanned = bannedPlayers.has(stats.player.trim().toLowerCase());
  let rankStr = stats.rank;
  let isRedacted = false;
  let reason = '';

  if (stats.rank !== '0' && stats.rank !== '') {
    rankStr = `${stats.rank}/${totalActiveCount}`;
    const numericRank = parseFloat(stats.rank);
    if (redact) {
      if (isBanned) {
        isRedacted = true;
        reason = 'banned';
      } else if (numericRank > totalActiveCount / 2) {
        isRedacted = true;
        reason = '50%';
      }
    }
  } else {
    if (redact && isBanned) {
      isRedacted = true;
      reason = 'banned';
    }
    rankStr = '0 (unranked)';
  }

  const winRate = stats.games > 0 ? (stats.wins / stats.games) * 100 : 0;
  const deltaStr = (stats.delta >= 0 ? '+' : '') + stats.delta.toFixed(2);

  let eloDisplay = `${stats.mmr.toFixed(2)} [${deltaStr}]`;
  let rankDisplay = stats.rank !== '0' && stats.rank !== '' ? `${rankStr} [${stats.rankDelta}]` : rankStr;
  let gamesDisplay = String(stats.games);
  let winsDisplay = `${stats.wins}-${stats.losses} [${winRate.toFixed(1)}%]`;

  if (isRedacted) {
    const redText = `<redacted:${reason}>`;
    eloDisplay = redText;
    rankDisplay = redText;
    winsDisplay = redText;

    if (reason === '50%') {
      if (stats.delta > 0) {
        eloDisplay = `${redText} [${deltaStr}]`;
      }
      if (stats.rankDelta.startsWith('+') || stats.rankDelta === 'new') {
        rankDisplay = `${redText} [${stats.rankDelta}]`;
      }
    }
  }

  const eloRow = `Elo:`.padEnd(14) + eloDisplay;
  const rankRow = `Rank:`.padEnd(14) + rankDisplay;
  const gamesRow = `Games Played:`.padEnd(14) + gamesDisplay;
  const winsRow = `Wins:`.padEnd(14) + winsDisplay;

  console.log(`\n=== Player Profile: ${stats.player} ===`);
  console.log(`  ${eloRow}`);
  console.log(`  ${rankRow}`);
  console.log(`  ${winsRow}`);
  console.log(`  ${gamesRow}`);
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

  const bannedPlayers = getBannedPlayers();

  const players: { player: string; games: number }[] = records
    .map((r: any) => ({
      player: r.player,
      games: parseInt(r.games, 10) || 0,
    }))
    .filter((p: { player: string; games: number }) => !bannedPlayers.has(p.player.trim().toLowerCase()));

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

