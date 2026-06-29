import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { getBannedPlayers } from '../common.js';

export async function runListPlayers(options: {
  threshold?: number;
}): Promise<void> {
  const threshold = options.threshold ?? (config as any).elo?.seedingGames ?? 15;

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
    .filter((p: any) => p.player && p.games >= threshold && !bannedPlayers.has(p.player.trim().toLowerCase()));

  // Sort in alphabetical order
  players.sort((a: any, b: any) => a.player.localeCompare(b.player, undefined, { sensitivity: 'base' }));

  players.forEach((p: any) => {
    console.log(p.player);
  });
}
