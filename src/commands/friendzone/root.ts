import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../../config.js';

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

export async function runFriendzoneAnalysis(): Promise<void> {
  const csvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Source CSV not found at ${csvPath}. Please run 'download' command first.`);
  }

  console.log(`Reading source CSV from ${csvPath}...`);
  const fileContent = fs.readFileSync(csvPath, 'utf8');

  console.log('Parsing CSV data...');
  const records: Array<{ game: string; player: string; side: string; [key: string]: string }> = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty.');
  }

  const firstRecord = records[0];
  if (!firstRecord.game || !firstRecord.player || !firstRecord.side) {
    throw new Error(`CSV must contain 'game', 'player', and 'side' columns. Found columns: ${Object.keys(firstRecord).join(', ')}`);
  }

  const games = new Map<string, Array<{ player: string; side: string }>>();
  const allPlayers = new Set<string>();

  for (const record of records) {
    const game = record.game;
    const date = record.date;
    const player = record.player;
    const side = record.side;

    if (!game || !player || !side) continue;

    allPlayers.add(player);

    // Combine game and date to uniquely identify a match
    const matchKey = date ? `${game}_${date}` : game;

    if (!games.has(matchKey)) {
      games.set(matchKey, []);
    }
    games.get(matchKey)!.push({ player, side });
  }

  console.log(`Found ${allPlayers.size} unique players across ${games.size} matches.`);

  const sameMatchCount = new Map<string, number>();
  const sameSideCount = new Map<string, number>();

  console.log('Calculating pair statistics...');
  for (const [_, participants] of games) {
    for (let i = 0; i < participants.length; i++) {
      const p1 = participants[i];
      for (let j = i + 1; j < participants.length; j++) {
        const p2 = participants[j];

        if (p1.player === p2.player) continue;

        const [a, b] = p1.player < p2.player ? [p1.player, p2.player] : [p2.player, p1.player];
        const pairKey = `${a}:${b}`;

        sameMatchCount.set(pairKey, (sameMatchCount.get(pairKey) || 0) + 1);
        if (p1.side === p2.side) {
          sameSideCount.set(pairKey, (sameSideCount.get(pairKey) || 0) + 1);
        }
      }
    }
  }

  console.log('Generating friendship analysis table...');
  const pairList: Array<{
    player: string;
    other: string;
    sameGame: number;
    sameSide: number;
    friendshipIndex: number;
  }> = [];

  const playersArray = Array.from(allPlayers);
  for (let i = 0; i < playersArray.length; i++) {
    const pA = playersArray[i];
    for (let j = i + 1; j < playersArray.length; j++) {
      const pB = playersArray[j];
      
      const [player, other] = pA < pB ? [pA, pB] : [pB, pA];
      const pairKey = `${player}:${other}`;
      const sameMatch = sameMatchCount.get(pairKey) || 0;

      if (sameMatch > 0) {
        const sameSide = sameSideCount.get(pairKey) || 0;
        const quota = sameSide / sameMatch;
        pairList.push({
          player,
          other,
          sameGame: sameMatch,
          sameSide,
          friendshipIndex: quota,
        });
      }
    }
  }

  // Sort by player name ascending, then by other name ascending
  pairList.sort((a, b) => {
    const compPlayer = a.player.localeCompare(b.player, undefined, { sensitivity: 'base' });
    if (compPlayer !== 0) return compPlayer;
    return a.other.localeCompare(b.other, undefined, { sensitivity: 'base' });
  });

  const csvRows: string[][] = [
    ['player', 'other', 'same game', 'same side', 'friendship index']
  ];

  for (const pair of pairList) {
    csvRows.push([
      pair.player,
      pair.other,
      String(pair.sameGame),
      String(pair.sameSide),
      pair.friendshipIndex.toFixed(4),
    ]);
  }

  const tmpDir = path.resolve(process.cwd(), '.tmp');
  const outputPath = path.join(tmpDir, 'friendzone.csv');

  console.log(`Writing list to ${outputPath}...`);
  const csvContent = arrayToCsv(csvRows);
  fs.writeFileSync(outputPath, csvContent, 'utf8');

  console.log(`Successfully generated and saved to ${outputPath}`);
}
