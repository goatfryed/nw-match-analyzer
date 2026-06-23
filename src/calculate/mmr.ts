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

export function calculateMmrAndFriendship(
  records: CsvRecord[],
  options: MmrOptions
): { players: PlayerStats[]; friendships: PairRecord[] } {
  const { defaultRating, kFactor, generations, calibration, cohesionScaling, cohesionDampingGames } = options;

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
  const sortedMatches = Array.from(games.entries())
    .map(([matchKey, participants]) => {
      const dateStr = participants[0]?.date || '';
      const dateObj = dateStr ? parseDate(dateStr) : new Date(0);
      return { matchKey, participants, date: dateObj };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const playerStatsMap = new Map<string, PlayerStats>();
  const tracker = new CohesionTracker();

  function getOrCreatePlayer(name: string): PlayerStats {
    let stats = playerStatsMap.get(name);
    if (!stats) {
      stats = { player: name, mmr: defaultRating, games: 0, wins: 0, losses: 0, calibrationGames: 0 };
      playerStatsMap.set(name, stats);
    }
    return stats;
  }

  for (let gen = 1; gen <= generations; gen++) {
    // Reset stats for all players before each generation, keeping their MMR and calibrationGames
    for (const stats of playerStatsMap.values()) {
      stats.games = 0;
      stats.wins = 0;
      stats.losses = 0;
    }

    // Reset friendship history mapping at start of generation to maintain chronological moving state
    tracker.sameGame.clear();
    tracker.sameSide.clear();

    for (const match of sortedMatches) {
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

      // 1. Gather baseline MMR stats and calculate trust weights for Blue
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

      // 2. Compute trust-weighted average MMR
      const sumBlueWeights = blueWeights.reduce((sum, w) => sum + w, 0);
      const sumRedWeights = redWeights.reduce((sum, w) => sum + w, 0);

      const blueAvg = sumBlueWeights > 0
        ? blueStats.reduce((sum, s, idx) => sum + s.mmr * blueWeights[idx], 0) / sumBlueWeights
        : defaultRating;
      const redAvg = sumRedWeights > 0
        ? redStats.reduce((sum, s, idx) => sum + s.mmr * redWeights[idx], 0) / sumRedWeights
        : defaultRating;

      // 3. Compute team cohesion Elo bonus (using current moving friendship ratings)
      const blueCohesionBonus = tracker.getTeamCohesionBonus(bluePlayers, cohesionDampingGames, cohesionScaling);
      const redCohesionBonus = tracker.getTeamCohesionBonus(redPlayers, cohesionDampingGames, cohesionScaling);

      const blueEffective = blueAvg + blueCohesionBonus;
      const redEffective = redAvg + redCohesionBonus;

      // 4. Calculate expected win probabilities
      const expectedBlue = 1 / (1 + Math.pow(10, (redEffective - blueEffective) / 400));
      const expectedRed = 1 / (1 + Math.pow(10, (blueEffective - redEffective) / 400));

      // 5. Update Elo ratings and games stats for players
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

      // 6. Record match in cohesion tracker to update relationship data chronologically
      tracker.recordMatch(bluePlayers, redPlayers);
    }
  }

  const players = Array.from(playerStatsMap.values());
  const friendships = generateFriendzoneRecords(tracker);

  return { players, friendships };
}
