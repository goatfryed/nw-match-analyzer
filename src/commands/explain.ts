import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import config from '../../config.js';
import { CohesionTracker } from '../calculate/cohesion.js';
import {
  processSingleMatch,
  resolveIndex,
  parseDate,
  PlayerStats,
  CsvRecord,
  SortedMatch
} from '../calculate/mmr.js';

export async function runExplain(gameIdRef: string, playerArg?: string): Promise<void> {
  if (!gameIdRef) {
    console.error('Error: Game reference is required.');
    process.exit(1);
  }

  let defaultRating = (config as any).mmr?.defaultRating ?? 1500;
  let kFactor = (config as any).mmr?.kFactor ?? 32;
  let calibration = (config as any).mmr?.calibration ?? 10;
  let cohesionScaling = (config as any).mmr?.cohesionScaling ?? 100;
  let cohesionDampingGames = (config as any).mmr?.cohesionDampingGames ?? 5;
  let cohesionTolerance = (config as any).mmr?.cohesionTolerance ?? 0.12;
  let cohesionSteepness = (config as any).mmr?.cohesionSteepness ?? 2.0;
  let scoreFactor = (config as any).mmr?.scoreFactor ?? 10;
  let individualWeight = (config as any).mmr?.individualWeight ?? 0.5;
  let matchHead: string | undefined;

  const metaPath = path.resolve(process.cwd(), '.tmp/mmr_meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.defaultRating !== undefined) defaultRating = meta.defaultRating;
      if (meta.kFactor !== undefined) kFactor = meta.kFactor;
      if (meta.calibration !== undefined) calibration = meta.calibration;
      if (meta.cohesionScaling !== undefined) cohesionScaling = meta.cohesionScaling;
      if (meta.cohesionDampingGames !== undefined) cohesionDampingGames = meta.cohesionDampingGames;
      if (meta.cohesionTolerance !== undefined) cohesionTolerance = meta.cohesionTolerance;
      if (meta.cohesionSteepness !== undefined) cohesionSteepness = meta.cohesionSteepness;
      if (meta.scoreFactor !== undefined) scoreFactor = meta.scoreFactor;
      if (meta.individualWeight !== undefined) individualWeight = meta.individualWeight;
      if (meta.matchHead !== undefined) matchHead = meta.matchHead;
    } catch (e) {
      // Ignore and use configuration defaults
    }
  }

  const playerStatsMap = new Map<string, PlayerStats>();
  const mmrCsvPath = path.resolve(process.cwd(), '.tmp/mmr.csv');
  if (fs.existsSync(mmrCsvPath)) {
    try {
      const mmrContent = fs.readFileSync(mmrCsvPath, 'utf8');
      const mmrRecords = parse(mmrContent, { columns: true, skip_empty_lines: true, trim: true });
      for (const r of mmrRecords) {
        if (r.player) {
          const games = parseInt(r.games, 10) || 0;
          playerStatsMap.set(r.player, {
            player: r.player,
            mmr: parseFloat(r.mmr) || defaultRating,
            games,
            wins: parseInt(r.wins, 10) || 0,
            losses: parseInt(r.losses, 10) || 0,
            calibrationGames: Math.min(games, calibration),
          });
        }
      }
    } catch (e) {
      throw new Error(`Failed to parse MMR database at ${mmrCsvPath}: ${e}`);
    }
  } else {
    throw new Error(`MMR database not found at ${mmrCsvPath}. Please run 'calculate' first.`);
  }

  const tracker = new CohesionTracker();
  const friendzoneCsvPath = path.resolve(process.cwd(), '.tmp/friendzone.csv');
  if (fs.existsSync(friendzoneCsvPath)) {
    try {
      const fzContent = fs.readFileSync(friendzoneCsvPath, 'utf8');
      const fzRecords = parse(fzContent, { columns: true, skip_empty_lines: true, trim: true });
      const pairs = fzRecords.map((r: any) => ({
        player: r.player,
        other: r.other,
        sameGame: parseInt(r['same game'], 10) || 0,
        sameSide: parseInt(r['same side'], 10) || 0,
        friendshipIndex: parseFloat(r['friendship index']) || 0.0,
      }));
      tracker.loadFromPairs(pairs);
    } catch (e) {
      throw new Error(`Failed to parse Friendzone database at ${friendzoneCsvPath}: ${e}`);
    }
  } else {
    throw new Error(`Friendzone database not found at ${friendzoneCsvPath}. Please run 'calculate' first.`);
  }

  const sourceCsvPath = path.resolve(process.cwd(), '.tmp/source.csv');
  if (!fs.existsSync(sourceCsvPath)) {
    throw new Error(`Source CSV not found at ${sourceCsvPath}. Please run 'download' command first.`);
  }

  const fileContent = fs.readFileSync(sourceCsvPath, 'utf8');
  const records: CsvRecord[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const games = new Map<string, CsvRecord[]>();
  for (const record of records) {
    const game = record.game;
    const date = record.date;
    const player = record.player;
    const side = record.side;

    if (!game || !player || !side) continue;

    const matchKey = date ? `${game}_${date}` : game;
    if (!games.has(matchKey)) {
      games.set(matchKey, []);
    }
    games.get(matchKey)!.push(record);
  }

  const sortedMatches: SortedMatch[] = Array.from(games.entries())
    .map(([matchKey, participants]) => {
      const dateStr = participants[0]?.date || '';
      const dateObj = dateStr ? parseDate(dateStr) : new Date(0);
      const gameId = participants[0]?.game || '';
      return { matchKey, participants, date: dateObj, gameId };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (sortedMatches.length === 0) {
    throw new Error('No matches found in source dataset.');
  }

  const resolvedHeadIdx = matchHead
    ? sortedMatches.findIndex((m) => m.gameId === matchHead)
    : sortedMatches.length - 1;

  const targetIndex = resolveIndex(
    gameIdRef,
    sortedMatches,
    resolvedHeadIdx === -1 ? sortedMatches.length - 1 : resolvedHeadIdx,
    sortedMatches.length - 1
  );
  const targetMatch = sortedMatches[targetIndex];

  if (!targetMatch) {
    throw new Error(`Could not find match reference: "${gameIdRef}"`);
  }

  let exactPlayerName: string | undefined;
  if (playerArg) {
    const playerArgLower = playerArg.trim().toLowerCase();
    for (const record of targetMatch.participants) {
      if (record.player.toLowerCase() === playerArgLower) {
        exactPlayerName = record.player;
        break;
      }
    }
    if (!exactPlayerName) {
      console.error(`Error: Player "${playerArg}" did not play in game "${targetMatch.gameId}".`);
      process.exit(1);
    }
  }

  const sameGameBefore = new Map(tracker.sameGame);
  const sameSideBefore = new Map(tracker.sameSide);

  const result = processSingleMatch(
    targetMatch,
    playerStatsMap,
    tracker,
    {
      defaultRating,
      kFactor,
      calibration,
      cohesionScaling,
      cohesionDampingGames,
      cohesionTolerance,
      cohesionSteepness,
      scoreFactor,
      individualWeight,
    }
  );

  if (!result) {
    throw new Error(`Simulation failed for match "${targetMatch.gameId}".`);
  }

  console.log(`\n=== Explain Match: ${result.gameId} ===`);
  console.log(`  Date:                 ${result.date}`);
  console.log(`  Winner:               ${result.winner.toUpperCase()}`);
  console.log('');
  const rawTeamChangeBlue = kFactor * (result.blueOutcome - result.expectedBlue);
  const rawTeamChangeRed = kFactor * (result.redOutcome - result.expectedRed);

  const formatLine = (label: string, valBlue: string, valRed: string) => {
    const left = `${label.padStart(20)} ${valBlue}`.padEnd(45);
    const right = `${label.padStart(20)} ${valRed}`;
    return `  ${left}${right}`;
  };

  console.log('  Blue Team:'.padEnd(47) + 'Red Team:');
  console.log(formatLine('Score:', String(result.scoreBlue), String(result.scoreRed)));
  console.log(formatLine('Effective MMR:', result.mmrBlue.toFixed(2), result.mmrRed.toFixed(2)));
  console.log(formatLine('Base MMR (Avg):', result.avgMmrBlue.toFixed(2), result.avgMmrRed.toFixed(2)));
  console.log(
    formatLine(
      'Cohesion Elo Bonus:',
      (result.cohesionBlue >= 0 ? '+' : '') + result.cohesionBlue.toFixed(2),
      (result.cohesionRed >= 0 ? '+' : '') + result.cohesionRed.toFixed(2)
    )
  );
  console.log(
    formatLine(
      'MMR Change:',
      (rawTeamChangeBlue >= 0 ? '+' : '') + rawTeamChangeBlue.toFixed(2),
      (rawTeamChangeRed >= 0 ? '+' : '') + rawTeamChangeRed.toFixed(2)
    )
  );
  console.log('');

  const maxNameLen = Math.max(...result.players.map((p) => p.player.length), 0);

  if (exactPlayerName) {
    const pr = result.players.find((p) => p.player.toLowerCase() === exactPlayerName!.toLowerCase())!;
    const oldMmrStr = pr.oldMmr.toFixed(2).padStart(7);
    const newMmrStr = pr.newMmr.toFixed(2).padStart(7);
    const totalDelta = pr.newMmr - pr.oldMmr;
    const totalDeltaStr = ((totalDelta >= 0 ? '+' : '') + totalDelta.toFixed(2)).padStart(5);
    const teamDeltaStr = ((pr.teamShare >= 0 ? '+' : '') + pr.teamShare.toFixed(2)).padStart(5);
    const personalDeltaStr = ((pr.personalShare >= 0 ? '+' : '') + pr.personalShare.toFixed(2)).padStart(5);

    console.log(`  ${pr.side === 'blue' ? 'Blue' : 'Red'} Team:`);
    console.log(
      `    ${pr.player.padEnd(maxNameLen)} - [mmr] ${oldMmrStr} -> ${newMmrStr} ` +
      `(${totalDeltaStr}: ${teamDeltaStr}, ${personalDeltaStr})  ` +
      `[cohesion] ${pr.oldCohesion.toFixed(2)} -> ${pr.newCohesion.toFixed(2)}`
    );
    console.log('');

    const friendsList: {
      friend: string;
      friendshipAfter: number;
      sideAfter: number;
      gamesAfter: number;
    }[] = [];

    const participantNamesLower = new Set(targetMatch.participants.map((p) => p.player.toLowerCase()));

    for (const key of tracker.sameGame.keys()) {
      const parts = key.split(':');
      if (parts.length !== 2) continue;
      const [p1, p2] = parts;
      if (
        p1.toLowerCase() === exactPlayerName!.toLowerCase() ||
        p2.toLowerCase() === exactPlayerName!.toLowerCase()
      ) {
        const friend = p1.toLowerCase() === exactPlayerName!.toLowerCase() ? p2 : p1;

        if (!participantNamesLower.has(friend.toLowerCase())) {
          continue;
        }

        const gamesAfter = tracker.sameGame.get(key) || 0;
        const sideAfter = tracker.sameSide.get(key) || 0;
        const friendshipAfter = tracker.getDampedFriendship(exactPlayerName!, friend, cohesionDampingGames);

        friendsList.push({
          friend,
          friendshipAfter,
          sideAfter,
          gamesAfter,
        });
      }
    }

    friendsList.sort((a, b) => {
      if (b.friendshipAfter !== a.friendshipAfter) {
        return b.friendshipAfter - a.friendshipAfter;
      }
      return b.gamesAfter - a.gamesAfter;
    });

    const totalMatches = playerStatsMap.get(exactPlayerName)!.games;
    const top8Friends = friendsList.slice(0, 8);
    console.log(`  Top Friends:`);
    if (top8Friends.length === 0) {
      console.log(`    No friends found.`);
    } else {
      const maxFriendNameLen = Math.max(...top8Friends.map((f) => f.friend.length), 0);
      let idx = 0;
      for (const f of top8Friends) {
        if (idx === 4) {
          console.log('    ------');
        }
        console.log(
          `    ${f.friend.padEnd(maxFriendNameLen)} - [cohesion] ${f.friendshipAfter.toFixed(4)} (${f.sideAfter}/${f.gamesAfter}/${totalMatches})`
        );
        idx++;
      }
    }
    console.log('');
  } else {
    console.log(`  Blue Team:`);
    const bluePlayers = result.players
      .filter((p) => p.side === 'blue')
      .sort((a, b) => a.player.localeCompare(b.player, undefined, { sensitivity: 'base' }));

    for (const pr of bluePlayers) {
      const oldMmrStr = pr.oldMmr.toFixed(2).padStart(7);
      const newMmrStr = pr.newMmr.toFixed(2).padStart(7);
      const totalDelta = pr.newMmr - pr.oldMmr;
      const totalDeltaStr = ((totalDelta >= 0 ? '+' : '') + totalDelta.toFixed(2)).padStart(5);
      const teamDeltaStr = ((pr.teamShare >= 0 ? '+' : '') + pr.teamShare.toFixed(2)).padStart(5);
      const personalDeltaStr = ((pr.personalShare >= 0 ? '+' : '') + pr.personalShare.toFixed(2)).padStart(5);

      console.log(
        `    ${pr.player.padEnd(maxNameLen)} - [mmr] ${oldMmrStr} -> ${newMmrStr} ` +
        `(${totalDeltaStr}: ${teamDeltaStr}, ${personalDeltaStr})  ` +
        `[cohesion] ${pr.oldCohesion.toFixed(2)} -> ${pr.newCohesion.toFixed(2)}`
      );
    }
    console.log('');

    console.log(`  Red Team:`);
    const redPlayers = result.players
      .filter((p) => p.side === 'red')
      .sort((a, b) => a.player.localeCompare(b.player, undefined, { sensitivity: 'base' }));

    for (const pr of redPlayers) {
      const oldMmrStr = pr.oldMmr.toFixed(2).padStart(7);
      const newMmrStr = pr.newMmr.toFixed(2).padStart(7);
      const totalDelta = pr.newMmr - pr.oldMmr;
      const totalDeltaStr = ((totalDelta >= 0 ? '+' : '') + totalDelta.toFixed(2)).padStart(5);
      const teamDeltaStr = ((pr.teamShare >= 0 ? '+' : '') + pr.teamShare.toFixed(2)).padStart(5);
      const personalDeltaStr = ((pr.personalShare >= 0 ? '+' : '') + pr.personalShare.toFixed(2)).padStart(5);

      console.log(
        `    ${pr.player.padEnd(maxNameLen)} - [mmr] ${oldMmrStr} -> ${newMmrStr} ` +
        `(${totalDeltaStr}: ${teamDeltaStr}, ${personalDeltaStr})  ` +
        `[cohesion] ${pr.oldCohesion.toFixed(2)} -> ${pr.newCohesion.toFixed(2)}`
      );
    }
    console.log('');
  }
}
