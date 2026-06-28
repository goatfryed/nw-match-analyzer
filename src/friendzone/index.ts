import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { calculateFriends } from './calculation.js';
import type { PairRecord } from './calculation.js';

export type { PairRecord };

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

export async function calculateSourceFriends(options: {
  rebuild?: boolean;
  from?: string;
  to?: string;
}): Promise<void> {
  const rebuild = !!options.rebuild;
  const maxRowsPerGame = (config as any).validation?.maxRowsPerGame;

  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run 'download' command first.`);
  }

  console.log(`Reading source CSV from ${sourceCsvPath}...`);
  const fileContent = fs.readFileSync(sourceCsvPath, 'utf8');

  console.log('Parsing CSV data...');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty.');
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

  let previousMatchHead: string | undefined;
  const metaPath = path.resolve(process.cwd(), '.tmp/meta.friends.json');
  if (!rebuild && fs.existsSync(metaPath)) {
    try {
      const metaContent = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(metaContent);
      previousMatchHead = meta.matchHead;
    } catch (e) {
      // Ignore
    }
  }

  console.log('Orchestrating friendship index calculations...');
  const { friendships, matchHead } = calculateFriends(records, {
    rebuild,
    fromMatchRef: options.from,
    toMatchRef: options.to,
    previousFriendshipsSameGame,
    previousFriendshipsSameSide,
    previousMatchHead,
    maxRowsPerGame,
  });

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

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

  const gamesSet = new Set<string>();
  for (const record of records) {
    if (record.game && record.player && record.side) {
      gamesSet.add(record.date ? `${record.game}_${record.date}` : record.game);
    }
  }

  const metadata = {
    totalGames: gamesSet.size,
    matchHead,
  };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  console.log('✅ Friendzone calculation complete.');
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
    throw new Error(`Friendzone CSV not found at ${csvPath}. Please run 'calculate' or 'calculate friends' command first.`);
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
