import { CohesionTracker, CohesionOptions } from './cohesion.js';

export interface PlayerStats {
  player: string;
  elo: number;
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

export interface EloOptions extends CohesionOptions {
  defaultRating: number;
  kFactor: number;
  generations: number;
  calibration: number;
  cohesionDampingGames: number;
  rebuild?: boolean;
  fromMatchRef?: string;
  toMatchRef?: string;
  previousPlayers?: Map<string, { elo: number; games: number; wins: number; losses: number }>;
  previousFriendshipsSameGame?: Map<string, number>;
  previousFriendshipsSameSide?: Map<string, number>;
  previousMatchHead?: string;
  maxRowsPerGame?: number;
  scoreFactor?: number;
  individualWeight?: number;
  defaultLosingScore?: number;
  rewardPoints?: [number, number][];
}

export interface SortedMatch {
  matchKey: string;
  participants: CsvRecord[];
  date: Date;
  gameId: string;
}

export function parseDate(dateStr: string): Date {
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

function getTeamScore(participants: CsvRecord[], side: string): number {
  const p = participants.find((x) => x.side === side);
  return p && p.GameScore ? parseInt(p.GameScore, 10) || 0 : 0;
}

class MonotonicCubicSpline {
  private x: number[];
  private y: number[];
  private d: number[];

  constructor(xPts: number[], yPts: number[]) {
    this.x = xPts;
    this.y = yPts;
    const n = xPts.length;

    // 1. Secant slopes
    const S: number[] = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      S[i] = (yPts[i + 1] - yPts[i]) / (xPts[i + 1] - xPts[i]);
    }

    // 2. Tangents
    const d: number[] = new Array(n);
    d[0] = S[0];
    for (let i = 1; i < n - 1; i++) {
      d[i] = (S[i - 1] + S[i]) / 2.0;
    }
    d[n - 1] = S[n - 2];

    // 3. Fritsch-Carlson adjustment for monotonicity
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(S[i]) < 1e-9) {
        d[i] = 0.0;
        d[i + 1] = 0.0;
      } else {
        const alpha = d[i] / S[i];
        const beta = d[i + 1] / S[i];
        if (alpha * alpha + beta * beta > 9.0) {
          const tau = 3.0 / Math.sqrt(alpha * alpha + beta * beta);
          d[i] = tau * alpha * S[i];
          d[i + 1] = tau * beta * S[i];
        }
      }
    }

    this.d = d;
  }

  public interpolate(xVal: number): number {
    const n = this.x.length;
    if (xVal <= this.x[0]) return this.y[0];
    if (xVal >= this.x[n - 1]) return this.y[n - 1];

    let i = 0;
    while (i < n - 1 && xVal > this.x[i + 1]) {
      i++;
    }

    const h = this.x[i + 1] - this.x[i];
    const t = (xVal - this.x[i]) / h;

    const h00 = 2 * t * t * t - 3 * t * t + 1;
    const h10 = t * t * t - 2 * t * t + t;
    const h01 = -2 * t * t * t + 3 * t * t;
    const h11 = t * t * t - t * t;

    return h00 * this.y[i] + h10 * h * this.d[i] + h01 * this.y[i + 1] + h11 * h * this.d[i + 1];
  }
}

function mapScore(x: number, points: [number, number][]): number {
  if (points.length === 0) {
    return x;
  }

  const transformedPoints: [number, number][] = points.map(([px, py]) => [px, 1 - py]);

  if (transformedPoints.length === 1) {
    const [x1, y1] = transformedPoints[0];
    if (x1 <= 0 || x1 >= 1 || y1 <= 0 || y1 >= 1) {
      return x;
    }
    const p = Math.log(y1) / Math.log(x1);
    return Math.pow(x, p);
  }

  const sorted = [...transformedPoints].sort((a, b) => a[0] - b[0]);
  const xs = [0, ...sorted.map(p => p[0]), 1];
  const ys = [0, ...sorted.map(p => p[1]), 1];

  const spline = new MonotonicCubicSpline(xs, ys);
  return spline.interpolate(x);
}

function calculateOutcomeShares(
  winnerScore: number,
  loserScore: number,
  scoreFactor: number,
  rewardPoints?: [number, number][]
): { winnerShare: number; loserShare: number } {
  const sMax = winnerScore;
  const totalPoints = 1000 + 2 * scoreFactor * sMax;
  if (totalPoints <= 0) {
    return { winnerShare: 0.5, loserShare: 0.5 };
  }

  const x = sMax > 0 ? loserScore / sMax : 0;
  const mappedX = mapScore(x, rewardPoints ?? []);
  const effectiveLoserScore = mappedX * sMax;

  const winnerRaw = 1000 + scoreFactor * (2 * sMax - effectiveLoserScore);
  const loserRaw = scoreFactor * effectiveLoserScore;
  return {
    winnerShare: winnerRaw / totalPoints,
    loserShare: loserRaw / totalPoints,
  };
}

export function resolveIndex(
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

  if (finalIndex < 0) finalIndex = 0;
  if (finalIndex >= sortedMatches.length) finalIndex = sortedMatches.length - 1;

  return finalIndex;
}

export interface PlayerMatchOutcome {
  player: string;
  side: 'blue' | 'red';
  oldElo: number;
  newElo: number;
  personalShare: number;
  teamShare: number;
  oldCohesion: number;
  newCohesion: number;
  personalCohesionBonus: number;
}

export interface MatchResult {
  gameId: string;
  date: string;
  winner: 'blue' | 'red';
  scoreBlue: number;
  scoreRed: number;
  eloBlue: number;
  avgEloBlue: number;
  cohesionBlue: number;
  eloRed: number;
  avgEloRed: number;
  cohesionRed: number;
  blueOutcome: number;
  redOutcome: number;
  expectedBlue: number;
  expectedRed: number;
  players: PlayerMatchOutcome[];
}

export function processSingleMatch(
  match: { gameId: string; date: string; participants: CsvRecord[] },
  playerStatsMap: Map<string, PlayerStats>,
  tracker: CohesionTracker,
  options: {
    defaultRating: number;
    kFactor: number;
    calibration: number;
    cohesionDampingGames: number;
    scoreFactor: number;
    individualWeight: number;
    defaultLosingScore?: number;
    rewardPoints?: [number, number][];
  } & CohesionOptions
): MatchResult | null {
  const { participants } = match;
  const {
    defaultRating,
    kFactor,
    calibration,
    cohesionDampingGames,
    scoreFactor,
    individualWeight,
    defaultLosingScore = 600,
    rewardPoints,
  } = options;

  let blueWon = false;
  let redWon = false;
  for (const p of participants) {
    const isWin = p.win?.toUpperCase() === 'TRUE';
    if (isWin) {
      if (p.side === 'blue') blueWon = true;
      if (p.side === 'red') redWon = true;
    }
  }

  const winnerColor: 'blue' | 'red' | undefined = blueWon ? 'blue' : (redWon ? 'red' : undefined);
  const loserColor: 'blue' | 'red' | undefined = winnerColor ? (winnerColor === 'blue' ? 'red' : 'blue') : undefined;

  let scoreBlue = getTeamScore(participants, 'blue');
  let scoreRed = getTeamScore(participants, 'red');

  if (scoreBlue >= 1000 && scoreRed >= 1000) {
    console.warn(`⚠️ Warning: Match "${match.gameId}" has scores >= 1000 for both sides (Blue: ${scoreBlue}, Red: ${scoreRed})`);
  } else if (scoreBlue > 1100 || scoreRed > 1100) {
    console.warn(`⚠️ Warning: Match "${match.gameId}" has a side with score > 1100 (Blue: ${scoreBlue}, Red: ${scoreRed})`);
  }

  if (scoreBlue === 0 && scoreRed === 0) {
    if (winnerColor === 'blue') {
      scoreBlue = 1000;
      scoreRed = defaultLosingScore;
    } else if (winnerColor === 'red') {
      scoreRed = 1000;
      scoreBlue = defaultLosingScore;
    } else {
      scoreBlue = 1000;
      scoreRed = 1000;
    }
  } else {
    scoreBlue = Math.min(1000, scoreBlue);
    scoreRed = Math.min(1000, scoreRed);
  }

  let blueOutcome = 0.5;
  let redOutcome = 0.5;

  if (winnerColor && loserColor) {
    const winnerScore = winnerColor === 'blue' ? scoreBlue : scoreRed;
    const loserScore = winnerColor === 'blue' ? scoreRed : scoreBlue;
    const { winnerShare, loserShare } = calculateOutcomeShares(winnerScore, loserScore, scoreFactor, rewardPoints);

    if (winnerColor === 'blue') {
      blueOutcome = winnerShare;
      redOutcome = loserShare;
    } else {
      blueOutcome = loserShare;
      redOutcome = winnerShare;
    }
  }

  const bluePlayers = participants
    .filter((p) => p.side === 'blue')
    .map((p) => p.player);
  const redPlayers = participants
    .filter((p) => p.side === 'red')
    .map((p) => p.player);

  if (bluePlayers.length === 0 || redPlayers.length === 0) {
    return null;
  }

  const getOrCreatePlayer = (name: string): PlayerStats => {
    let stats = playerStatsMap.get(name);
    if (!stats) {
      stats = { player: name, elo: defaultRating, games: 0, wins: 0, losses: 0, calibrationGames: 0 };
      playerStatsMap.set(name, stats);
    }
    return stats;
  };

  const blueWeights: number[] = [];
  const blueStats: PlayerStats[] = [];
  for (const name of bluePlayers) {
    const stats = getOrCreatePlayer(name);
    const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
    blueWeights.push(w);
    blueStats.push(stats);
  }

  const redWeights: number[] = [];
  const redStats: PlayerStats[] = [];
  for (const name of redPlayers) {
    const stats = getOrCreatePlayer(name);
    const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
    redWeights.push(w);
    redStats.push(stats);
  }

  const blueWeightsForAvg: number[] = [];
  const blueStatsForAvg: PlayerStats[] = [];
  for (let i = 0; i < bluePlayers.length; i++) {
    if (bluePlayers[i].toLowerCase() !== 'unknown') {
      blueWeightsForAvg.push(blueWeights[i]);
      blueStatsForAvg.push(blueStats[i]);
    }
  }

  const redWeightsForAvg: number[] = [];
  const redStatsForAvg: PlayerStats[] = [];
  for (let i = 0; i < redPlayers.length; i++) {
    if (redPlayers[i].toLowerCase() !== 'unknown') {
      redWeightsForAvg.push(redWeights[i]);
      redStatsForAvg.push(redStats[i]);
    }
  }

  const sumBlueWeightsForAvg = blueWeightsForAvg.reduce((sum, w) => sum + w, 0);
  const sumRedWeightsForAvg = redWeightsForAvg.reduce((sum, w) => sum + w, 0);

  const blueAvg = sumBlueWeightsForAvg > 0
    ? blueStatsForAvg.reduce((sum, s, idx) => sum + s.elo * blueWeightsForAvg[idx], 0) / sumBlueWeightsForAvg
    : defaultRating;
  const redAvg = sumRedWeightsForAvg > 0
    ? redStatsForAvg.reduce((sum, s, idx) => sum + s.elo * redWeightsForAvg[idx], 0) / sumRedWeightsForAvg
    : defaultRating;

  const blueCohesionBonus = tracker.getTeamCohesionBonus(
    bluePlayers,
    cohesionDampingGames,
    options
  );
  const redCohesionBonus = tracker.getTeamCohesionBonus(
    redPlayers,
    cohesionDampingGames,
    options
  );

  const blueEffective = blueAvg + blueCohesionBonus;
  const redEffective = redAvg + redCohesionBonus;

  const expectedBlue = 1 / (1 + Math.pow(10, (redEffective - blueEffective) / 400));
  const expectedRed = 1 / (1 + Math.pow(10, (blueEffective - redEffective) / 400));

  const playersResult: PlayerMatchOutcome[] = [];

  const oldStatsMap = new Map<string, { elo: number; cohesion: number }>();
  for (const p of bluePlayers) {
    oldStatsMap.set(p, {
      elo: getOrCreatePlayer(p).elo,
      cohesion: tracker.getPlayerCohesion(p, bluePlayers, cohesionDampingGames),
    });
  }
  for (const p of redPlayers) {
    oldStatsMap.set(p, {
      elo: getOrCreatePlayer(p).elo,
      cohesion: tracker.getPlayerCohesion(p, redPlayers, cohesionDampingGames),
    });
  }

  for (const stats of blueStats) {
    const oldVal = oldStatsMap.get(stats.player)!;
    const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
    const k = kFactor * (2.0 - w);
    const playerCohesionBonus = tracker.getPlayerCohesionBonus(
      stats.player,
      bluePlayers,
      cohesionDampingGames,
      options
    );
    const expectedIndiv = 1 / (1 + Math.pow(10, (redEffective - (stats.elo + playerCohesionBonus)) / 400));
    const expectedHybrid = (1 - individualWeight) * expectedBlue + individualWeight * expectedIndiv;

    const totalChange = k * (blueOutcome - expectedHybrid);
    const personalShare = k * individualWeight * (blueOutcome - expectedIndiv);
    const teamShare = k * (1 - individualWeight) * (blueOutcome - expectedBlue);

    stats.elo += totalChange;
    stats.games++;
    stats.wins += blueWon ? 1 : 0;
    stats.losses += blueWon ? 0 : 1;
    if (stats.calibrationGames < calibration) {
      stats.calibrationGames++;
    }

    playersResult.push({
      player: stats.player,
      side: 'blue',
      oldElo: oldVal.elo,
      newElo: stats.elo,
      personalShare,
      teamShare,
      oldCohesion: oldVal.cohesion,
      newCohesion: 0,
      personalCohesionBonus: playerCohesionBonus,
    });
  }

  for (const stats of redStats) {
    const oldVal = oldStatsMap.get(stats.player)!;
    const w = Math.max(0.1, Math.min(1.0, stats.calibrationGames / calibration));
    const k = kFactor * (2.0 - w);
    const playerCohesionBonus = tracker.getPlayerCohesionBonus(
      stats.player,
      redPlayers,
      cohesionDampingGames,
      options
    );
    const expectedIndiv = 1 / (1 + Math.pow(10, (blueEffective - (stats.elo + playerCohesionBonus)) / 400));
    const expectedHybrid = (1 - individualWeight) * expectedRed + individualWeight * expectedIndiv;

    const totalChange = k * (redOutcome - expectedHybrid);
    const personalShare = k * individualWeight * (redOutcome - expectedIndiv);
    const teamShare = k * (1 - individualWeight) * (redOutcome - expectedRed);

    stats.elo += totalChange;
    stats.games++;
    stats.wins += redWon ? 1 : 0;
    stats.losses += redWon ? 0 : 1;
    if (stats.calibrationGames < calibration) {
      stats.calibrationGames++;
    }

    playersResult.push({
      player: stats.player,
      side: 'red',
      oldElo: oldVal.elo,
      newElo: stats.elo,
      personalShare,
      teamShare,
      oldCohesion: oldVal.cohesion,
      newCohesion: 0,
      personalCohesionBonus: playerCohesionBonus,
    });
  }

  tracker.recordMatch(bluePlayers, redPlayers);

  for (const pr of playersResult) {
    const roster = pr.side === 'blue' ? bluePlayers : redPlayers;
    pr.newCohesion = tracker.getPlayerCohesion(pr.player, roster, cohesionDampingGames);
  }

  return {
    gameId: match.gameId,
    date: match.date,
    winner: winnerColor || 'blue',
    scoreBlue,
    scoreRed,
    eloBlue: blueEffective,
    avgEloBlue: blueAvg,
    cohesionBlue: blueCohesionBonus,
    eloRed: redEffective,
    avgEloRed: redAvg,
    cohesionRed: redCohesionBonus,
    blueOutcome,
    redOutcome,
    expectedBlue,
    expectedRed,
    players: playersResult,
  };
}

export function calculateElo(
  records: CsvRecord[],
  options: EloOptions
): {
  players: PlayerStats[];
  matchHead: string;
  processedMatches: MatchResult[];
  prefixGameIds: Set<string>;
} {
  const maxRowsPerGame = options.maxRowsPerGame ?? 45;
  const scoreFactor = options.scoreFactor ?? 10;
  const individualWeight = options.individualWeight ?? 0.5;
  const defaultLosingScore = options.defaultLosingScore ?? 600;
  const {
    defaultRating,
    kFactor,
    generations,
    calibration,
    cohesionPenalty,
    cohesionBonus,
    cohesionSoloQ,
    cohesionDampingGames,
    cohesionTolerance,
    cohesionSteepness,
    rebuild = false,
    fromMatchRef,
    toMatchRef,
    previousPlayers = new Map(),
    previousFriendshipsSameGame = new Map(),
    previousFriendshipsSameSide = new Map(),
    previousMatchHead,
    rewardPoints,
  } = options;

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

  for (const m of sortedMatches) {
    if (m.participants.length >= maxRowsPerGame) {
      console.warn(`⚠️ Warning: Match "${m.matchKey}" has ${m.participants.length} participants (exceeds limit of ${maxRowsPerGame})`);
    }
  }

  const matchHeadIndex = previousMatchHead
    ? sortedMatches.findIndex((m) => m.gameId === previousMatchHead)
    : -1;

  const defaultFromIndex = (rebuild || matchHeadIndex === -1) ? 0 : matchHeadIndex + 1;
  const defaultToIndex = sortedMatches.length - 1;

  const fromIndex = resolveIndex(fromMatchRef, sortedMatches, matchHeadIndex, defaultFromIndex);
  const toIndex = resolveIndex(toMatchRef, sortedMatches, matchHeadIndex, defaultToIndex);

  const matchesToProcess = sortedMatches.slice(fromIndex, toIndex + 1);

  if (matchesToProcess.length > 0) {
    console.log(`Processing matches starting from ${matchesToProcess[0].gameId}`);
  }

  const playerStatsMap = new Map<string, PlayerStats>();
  const tracker = new CohesionTracker();

  if (!rebuild) {
    for (const [name, prev] of previousPlayers.entries()) {
      playerStatsMap.set(name, {
        player: name,
        elo: prev.elo,
        games: prev.games,
        wins: prev.wins,
        losses: prev.losses,
        calibrationGames: Math.min(prev.games, calibration),
      });
    }
  }

  const processedMatches: MatchResult[] = [];

  for (let gen = 1; gen <= generations; gen++) {
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
      const result = processSingleMatch(
        { gameId: match.gameId, date: match.participants[0]?.date || '', participants: match.participants },
        playerStatsMap,
        tracker,
        {
          defaultRating,
          kFactor,
          calibration,
          cohesionPenalty,
          cohesionBonus,
          cohesionSoloQ,
          cohesionDampingGames,
          cohesionTolerance,
          cohesionSteepness,
          scoreFactor,
          individualWeight,
          defaultLosingScore,
          rewardPoints,
        }
      );

      if (!result) continue;

      if (gen === generations) {
        processedMatches.push(result);
      }
    }
  }

  const players = Array.from(playerStatsMap.values());

  const lastProcessed = matchesToProcess[matchesToProcess.length - 1];
  if (lastProcessed) {
    console.log(`Processed ${matchesToProcess.length} matches up to ${lastProcessed.gameId}`);
  }
  const matchHead = lastProcessed ? lastProcessed.gameId : (previousMatchHead || '');

  const prefixGameIds = new Set<string>();
  for (let i = 0; i < fromIndex; i++) {
    prefixGameIds.add(sortedMatches[i].gameId);
  }

  return { players, matchHead, processedMatches, prefixGameIds };
}
