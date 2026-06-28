import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { getBannedPlayers } from '../common.js';

export async function runListGrinders(options: {
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

  console.log(`\n=== Elo Grinders (Players: ${players.length}) ===`);
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
