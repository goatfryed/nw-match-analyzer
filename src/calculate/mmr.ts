import { CohesionTracker } from './cohesion.js';
import { generateFriendzoneRecords, PairRecord } from './friendzone.js';

export interface PlayerStats {
  player: string;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
  calibrationGames: number;
}

export interface CsvRecord {
  game: string;
  date: string;
  side: string;
  win: string;
  player: string;
  [key: string]: string;
}

export interface MmrOptions {
  defaultRating: number;
  kFactor: number;
  generations: number;
  calibration: number;
  cohesionScaling: number;
  cohesionDampingGames: number;
  rebuild?: boolean;
  fromMatchRef?: string;
  toMatchRef?: string;
  previousPlayers?: Map<string, { mmr: number; games: number; wins: number; losses: number }>;
  previousFriendshipsSameGame?: Map<string, number>;
  previousFriendshipsSameSide?: Map<string, number>;
  previousMatchHead?: string;
  maxRowsPerGame?: number;
}

interface SortedMatch {
  matchKey: string;
  participants: CsvRecord[];
  date: Date;
  gameId: string;
}

function parseDate(dateStr: string): Date {
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const [_, day, month, year, hour, minute] = match;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10)
    );
  }
  const fallback = Date.parse(dateStr);
  return isNaN(fallback) ? new Date(0) : new Date(fallback);
}

function resolveIndex(
  ref: string | undefined,
  sortedMatches: SortedMatch[],
  matchHeadIndex: number,
  defaultIndex: number
): number {
  if (!ref) return defaultIndex;

  const trimmed = ref.trim();
  const regexMatch = trimmed.match(/^(start|head|end|.*?)(?:([+-])(\d{1,3}))?$/);
  if (!regexMatch) {
    throw new Error(`Invalid game ID reference format: "${ref}"`);
  }

  const base = regexMatch[1];
  const sign = regexMatch[2];
  const offsetStr = regexMatch[3];

  let baseIndex = -1;
  if (base === 'start') {
    baseIndex = 0;
  } else if (base === 'head') {
    baseIndex = matchHeadIndex;
  } else if (base === 'end') {
    baseIndex = sortedMatches.length - 1;
  } else {
    baseIndex = sortedMatches.findIndex((m) => m.gameId === base);
    if (baseIndex === -1) {
      throw new Error(`Game ID "${base}" not found in matches dataset`);
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

  // Clamp index to valid match range
  if (finalIndex < 0) finalIndex = 0;
  if (finalIndex >= sortedMatches.length) finalIndex = sortedMatches.length - 1;

  return finalIndex;
}

export interface MatchRecord {
  gameId: string;
  date: string;
  winner: 'blue' | 'red';
  mmrBlue: number;
  avgMmrBlue: number;
  cohesionBlue: number;
  mmrRed: number;
  avgMmrRed: number;
  cohesionRed: number;
}

export function calculateMmrAndFriendship(
  records: CsvRecord[],
  options: MmrOptions
): {
  players: PlayerStats[];
  friendships: PairRecord[];
  matchHead: string;
  processedMatches: MatchRecord[];
  prefixGameIds: Set<string>;
} {
  const maxRowsPerGame = options.maxRowsPerGame ?? 45;
  const {
    defaultRating,
    kFactor,
    generations,
    calibration,
    cohesionScaling,
    cohesionDampingGames,
    rebuild = false,
    fromMatchRef,
    toMatchRef,
    previousPlayers = new Map(),
    previousFriendshipsSameGame = new Map(),
    previousFriendshipsSameSide = new Map(),
    previousMatchHead,
  } = options;

  // Group records by game / match
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

  // Sort matches chronologically
  const sortedMatches: SortedMatch[] = Array.from(games.entries())
    .map(([matchKey, participants]) => {
      const dateStr = participants[0]?.date || '';
      const dateObj = dateStr ? parseDate(dateStr) : new Date(0);
      const gameId = participants[0]?.game || '';
      return { matchKey, participants, date: dateObj, gameId };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Check for duplicate game IDs across matches
  const gameIdToKeys = new Map<string, string[]>();
  for (const m of sortedMatches) {
    if (!gameIdToKeys.has(m.gameId)) {
      gameIdToKeys.set(m.gameId, []);
    }
    gameIdToKeys.get(m.gameId)!.push(m.matchKey);
  }

  for (const [gameId, keys] of gameIdToKeys.entries()) {
    if (keys.length > 1) {
      console.warn(`⚠️ Warning: Duplicate Game ID "${gameId}" found across multiple matches: ${keys.join(', ')}`);
    }
  }

  // Check for matches exceeding maxRowsPerGame
  for (const m of sortedMatches) {
    if (m.participants.length >= maxRowsPerGame) {
      console.warn(`⚠️ Warning: Match "${m.matchKey}" has ${m.participants.length} participants (exceeds limit of ${maxRowsPerGame})`);
    }
  }

  // Find index of previous matchHead
  const matchHeadIndex = previousMatchHead
    ? sortedMatches.findIndex((m) => m.gameId === previousMatchHead)
    : -1;

  // Resolve boundary indices
  const defaultFromIndex = (rebuild || matchHeadIndex === -1) ? 0 : matchHeadIndex + 1;
  const defaultToIndex = sortedMatches.length - 1;

  const fromIndex = resolveIndex(fromMatchRef, sortedMatches, matchHeadIndex, defaultFromIndex);
  const toIndex = resolveIndex(toMatchRef, sortedMatches, matchHeadIndex, defaultToIndex);

  const matchesToProcess = sortedMatches.slice(fromIndex, toIndex + 1);

  const playerStatsMap = new Map<string, PlayerStats>();
  const tracker = new CohesionTracker();

  // Populate map with previous players to preserve their Elo rating history
  if (!rebuild) {
    for (const [name, prev] of previousPlayers.entries()) {
      playerStatsMap.set(name, {
        player: name,
        mmr: prev.mmr,
        games: prev.games,
        wins: prev.wins,
        losses: prev.losses,
        calibrationGames: Math.min(prev.games, calibration),
      });
    }
  }

  function getOrCreatePlayer(name: string): PlayerStats {
    let stats = playerStatsMap.get(name);
    if (!stats) {
      stats = { player: name, mmr: defaultRating, games: 0, wins: 0, losses: 0, calibrationGames: 0 };
      playerStatsMap.set(name, stats);
    }
    return stats;
  }

  const processedMatches: MatchRecord[] = [];

  for (let gen = 1; gen <= generations; gen++) {
    // Reset stats for all players before each generation to their baseline previous state
    for (const [name, stats] of playerStatsMap.entries()) {
      const prev = previousPlayers.get(name);
      if (!rebuild && prev) {
        stats.games = prev.games;
        stats.wins = prev.wins;
        stats.losses = prev.losses;
      } else {
        stats.games = 0;
        stats.wins = 0;
        stats.losses = 0;
      }
    }

    // Reset friendship history tracker to the baseline previous state
    tracker.sameGame.clear();
    tracker.sameSide.clear();
    if (!rebuild) {
      for (const [k, v] of previousFriendshipsSameGame.entries()) {
        tracker.sameGame.set(k, v);
      }
      for (const [k, v] of previousFriendshipsSameSide.entries()) {
        tracker.sameSide.set(k, v);
      }
    }

    for (const match of matchesToProcess) {
      const participants = match.participants;

      // Determine match outcomes
      let blueWon = false;
      let redWon = false;
      for (const p of participants) {
        const isWin = p.win?.toUpperCase() === 'TRUE';
        if (isWin) {
          if (p.side === 'blue') blueWon = true;
          if (p.side === 'red') redWon = true;
        }
      }

      const blueOutcome = blueWon ? 1 : 0;
      const redOutcome = redWon ? 1 : 0;

      const bluePlayers = participants
        .filter((p) => p.side === 'blue')
        .map((p) => p.player);
      const redPlayers = participants
        .filter((p) => p.side === 'red')
        .map((p) => p.player);

      if (bluePlayers.length === 0 || redPlayers.length === 0) {
        continue;
      }

      // Gather baseline MMR stats and calculate trust weights for Blue
      const blueWeights: number[] = [];
      const blueStats: PlayerStats[] = [];
      for (const name of bluePlayers) {
        const stats = getOrCreatePlayer(name);
        const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
        blueWeights.push(w);
        blueStats.push(stats);
      }

      // Gather baseline MMR stats and calculate trust weights for Red
      const redWeights: number[] = [];
      const redStats: PlayerStats[] = [];
      for (const name of redPlayers) {
        const stats = getOrCreatePlayer(name);
        const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
        redWeights.push(w);
        redStats.push(stats);
      }

      // Compute trust-weighted average MMR
      const sumBlueWeights = blueWeights.reduce((sum, w) => sum + w, 0);
      const sumRedWeights = redWeights.reduce((sum, w) => sum + w, 0);

      const blueAvg = sumBlueWeights > 0
        ? blueStats.reduce((sum, s, idx) => sum + s.mmr * blueWeights[idx], 0) / sumBlueWeights
        : defaultRating;
      const redAvg = sumRedWeights > 0
        ? redStats.reduce((sum, s, idx) => sum + s.mmr * redWeights[idx], 0) / sumRedWeights
        : defaultRating;

      // Compute team cohesion Elo bonus (using current moving friendship ratings)
      const blueCohesionBonus = tracker.getTeamCohesionBonus(bluePlayers, cohesionDampingGames, cohesionScaling);
      const redCohesionBonus = tracker.getTeamCohesionBonus(redPlayers, cohesionDampingGames, cohesionScaling);

      const blueEffective = blueAvg + blueCohesionBonus;
      const redEffective = redAvg + redCohesionBonus;

      if (gen === generations) {
        const matchDateStr = match.participants[0]?.date || '';
        processedMatches.push({
          gameId: match.gameId,
          date: matchDateStr,
          winner: blueWon ? 'blue' : 'red',
          mmrBlue: blueEffective,
          avgMmrBlue: blueAvg,
          cohesionBlue: blueCohesionBonus,
          mmrRed: redEffective,
          avgMmrRed: redAvg,
          cohesionRed: redCohesionBonus,
        });
      }

      // Calculate expected win probabilities
      const expectedBlue = 1 / (1 + Math.pow(10, (redEffective - blueEffective) / 400));
      const expectedRed = 1 / (1 + Math.pow(10, (blueEffective - redEffective) / 400));

      // Update Elo ratings and games stats for players
      for (const stats of blueStats) {
        const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
        const k = kFactor * (2.0 - w);
        stats.mmr += k * (blueOutcome - expectedBlue);
        stats.games++;
        stats.wins += blueOutcome;
        stats.losses += (1 - blueOutcome);
        if (stats.calibrationGames < calibration) {
          stats.calibrationGames++;
        }
      }

      for (const stats of redStats) {
        const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
        const k = kFactor * (2.0 - w);
        stats.mmr += k * (redOutcome - expectedRed);
        stats.games++;
        stats.wins += redOutcome;
        stats.losses += (1 - redOutcome);
        if (stats.calibrationGames < calibration) {
          stats.calibrationGames++;
        }
      }

      // Record match in cohesion tracker to update relationship data chronologically
      tracker.recordMatch(bluePlayers, redPlayers);
    }
  }

  const players = Array.from(playerStatsMap.values());
  const friendships = generateFriendzoneRecords(tracker);

  const lastProcessed = matchesToProcess[matchesToProcess.length - 1];
  const matchHead = lastProcessed ? lastProcessed.gameId : (previousMatchHead || '');

  const prefixGameIds = new Set<string>();
  for (let i = 0; i < fromIndex; i++) {
    prefixGameIds.add(sortedMatches[i].gameId);
  }

  return { players, friendships, matchHead, processedMatches, prefixGameIds };
}
