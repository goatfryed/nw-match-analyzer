import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export interface PairRecord {
  player: string;
  other: string;
  sameGame: number;
  sameSide: number;
  friendshipIndex: number;
}

export function loadPlayerGameCounts(): Map<string, number> {
  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run download command first.`);
  }

  const sourceContent = fs.readFileSync(sourceCsvPath, 'utf8');
  const sourceRecords = parse(sourceContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const playerGameCounts = new Map<string, number>();
  for (const r of sourceRecords) {
    if (r.player) {
      playerGameCounts.set(r.player, (playerGameCounts.get(r.player) || 0) + 1);
    }
  }
  return playerGameCounts;
}

export function loadPairRecords(): PairRecord[] {
  const csvPath = path.resolve(process.cwd(), '.tmp/friendzone.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Friendzone CSV not found at ${csvPath}. Please run 'friendzone' generate command first.`);
  }

  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map((r: any) => ({
    player: r.player,
    other: r.other,
    sameGame: parseInt(r['same game'], 10),
    sameSide: parseInt(r['same side'], 10),
    friendshipIndex: parseFloat(r['friendship index']),
  }));
}

export function findExactCasing(name: string, counts: Map<string, number>): string | undefined {
  const lower = name.trim().toLowerCase();
  for (const key of counts.keys()) {
    if (key.toLowerCase() === lower) {
      return key;
    }
  }
  return undefined;
}
