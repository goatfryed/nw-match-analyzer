import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
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

export async function runEloShow(
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
