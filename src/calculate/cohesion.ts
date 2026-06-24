export interface CohesionOptions {
  cohesionPenalty: number;
  cohesionBonus: number;
  cohesionSoloQ?: number;
  cohesionTolerance?: number;
  cohesionSteepness?: number;
}

export class CohesionTracker {
  // Map of key "player1:player2" (alphabetically sorted) to games played together
  sameGame = new Map<string, number>();
  // Map of key "player1:player2" (alphabetically sorted) to games played on the same team
  sameSide = new Map<string, number>();

  private getPairKey(p1: string, p2: string): string {
    return p1 < p2 ? `${p1}:${p2}` : `${p2}:${p1}`;
  }

  loadFromPairs(pairs: { player: string; other: string; sameGame: number; sameSide: number }[]): void {
    for (const p of pairs) {
      const key = this.getPairKey(p.player, p.other);
      this.sameGame.set(key, p.sameGame);
      this.sameSide.set(key, p.sameSide);
    }
  }

  /**
   * Record match participants to update running cohesion stats
   */
  recordMatch(bluePlayers: string[], redPlayers: string[]): void {
    const allPlayers = [...bluePlayers, ...redPlayers];

    // 1. Increment sameGame for all pairs in the match
    for (let i = 0; i < allPlayers.length; i++) {
      for (let j = i + 1; j < allPlayers.length; j++) {
        const key = this.getPairKey(allPlayers[i], allPlayers[j]);
        this.sameGame.set(key, (this.sameGame.get(key) || 0) + 1);
      }
    }

    // 2. Increment sameSide for blue teammates
    for (let i = 0; i < bluePlayers.length; i++) {
      for (let j = i + 1; j < bluePlayers.length; j++) {
        const key = this.getPairKey(bluePlayers[i], bluePlayers[j]);
        this.sameSide.set(key, (this.sameSide.get(key) || 0) + 1);
      }
    }

    // 3. Increment sameSide for red teammates
    for (let i = 0; i < redPlayers.length; i++) {
      for (let j = i + 1; j < redPlayers.length; j++) {
        const key = this.getPairKey(redPlayers[i], redPlayers[j]);
        this.sameSide.set(key, (this.sameSide.get(key) || 0) + 1);
      }
    }
  }

  getDampedFriendship(p1: string, p2: string, minGames: number): number {
    if (p1 === p2) return 1.0;
    if (p1.toLowerCase() === 'unknown' || p2.toLowerCase() === 'unknown') {
      return 0.5;
    }
    const key = this.getPairKey(p1, p2);

    const gameCount = this.sameGame.get(key) || 0;
    if (gameCount === 0) return 0.5;

    const sideCount = this.sameSide.get(key) || 0;
    const rawIndex = sideCount / gameCount;

    const excess = rawIndex - 0.5;
    const dampingWeight = Math.min(1.0, gameCount / minGames);

    const value = 0.5 + excess * dampingWeight;
    return Math.max(0.0, Math.min(1.0, value));
  }

  /**
   * Get the cohesion contribution (top 4 average friendship) for a single player within a roster
   */
  getPlayerCohesion(player: string, roster: string[], minGames: number): number {
    if (player.toLowerCase() === 'unknown') {
      return 0.5;
    }
    const friendships: number[] = [];
    for (const teammate of roster) {
      if (teammate === player || teammate.toLowerCase() === 'unknown') continue;
      friendships.push(this.getDampedFriendship(player, teammate, minGames));
    }

    if (friendships.length === 0) return 0.5;

    // Sort descending to find top friends on the team
    friendships.sort((a, b) => b - a);

    // Take the top 4 friendships (representing a maximum group of 5)
    const topFriendships = friendships.slice(0, 4);
    const sum = topFriendships.reduce((acc, val) => acc + val, 0);
    return sum / topFriendships.length;
  }

  /**
   * Calculate the team cohesion Elo bonus
   */
  getTeamCohesionBonus(
    players: string[],
    minGames: number,
    options: CohesionOptions
  ): number {
    const activePlayers = players.filter(pName => pName.toLowerCase() !== 'unknown');
    if (activePlayers.length <= 1) {
      return 0;
    }

    let totalCp = 0;
    for (const player of activePlayers) {
      totalCp += this.getPlayerCohesion(player, activePlayers, minGames);
    }

    const teamCohesion = totalCp / activePlayers.length;

    return this.computeCohesionAdjustment(
      teamCohesion,
      activePlayers.length,
      options
    );
  }

  /**
   * Calculate the individual player cohesion Elo bonus/penalty
   */
  getPlayerCohesionBonus(
    player: string,
    players: string[],
    minGames: number,
    options: CohesionOptions
  ): number {
    if (player.toLowerCase() === 'unknown') {
      return 0;
    }
    const activePlayers = players.filter(pName => pName.toLowerCase() !== 'unknown');
    if (activePlayers.length <= 1) {
      return 0;
    }

    const playerCohesion = this.getPlayerCohesion(player, activePlayers, minGames);

    return this.computeCohesionAdjustment(
      playerCohesion,
      activePlayers.length,
      options
    );
  }

  private computeCohesionAdjustment(
    cohesionVal: number,
    teamSize: number,
    options: CohesionOptions
  ): number {
    const {
      cohesionPenalty,
      cohesionBonus,
      cohesionSoloQ = 0.65,
      cohesionTolerance = 0.12,
      cohesionSteepness = 2.0,
    } = options;

    const B = getExpectedSoloBaseline(teamSize, cohesionSoloQ);

    let u = 0;
    if (cohesionVal >= B) {
      const denominator = 1.0 - B;
      u = denominator > 0 ? (cohesionVal - B) / denominator : 0;
    } else {
      u = B > 0 ? (cohesionVal - B) / B : 0;
    }

    const modifier = generalizedSCurve(u, cohesionTolerance, cohesionSteepness);

    if (modifier >= 0) {
      return cohesionPenalty * modifier;
    } else {
      return cohesionBonus * modifier;
    }
  }
}

function generalizedSCurve(u: number, u0_pos: number, p: number): number {
  let u0 = u0_pos;
  let absU = u;
  if (u < 0) {
    u0 = Math.min(1.0, 2.0 * u0_pos);
    absU = -u;
  }

  let y = 0;
  if (absU <= u0) {
    y = u0 > 0 ? Math.pow(absU / u0, p) * u0 : absU;
  } else {
    y = u0 < 1.0 ? 1.0 - Math.pow((1.0 - absU) / (1.0 - u0), p) * (1.0 - u0) : absU;
  }

  return u >= 0 ? y : -y;
}

const SOLO_BASELINE_POINTS = [
  [5, 0.50],
  [7, 0.53],
  [9, 0.56],
  [11, 0.59],
  [13, 0.61],
  [15, 0.63],
  [17, 0.64],
  [19, 0.65],
  [21, 0.65],
  [22, 0.65]
];

function getExpectedSoloBaseline(teamSize: number, cohesionSoloQ = 0.65): number {
  const shift = cohesionSoloQ - 0.65;
  const getShiftedVal = (val: number) => Math.max(0.0, Math.min(1.0, val + shift));

  if (teamSize <= 5) return getShiftedVal(0.50);
  if (teamSize >= 22) return getShiftedVal(0.65);
  for (let i = 0; i < SOLO_BASELINE_POINTS.length - 1; i++) {
    const [s1, v1] = SOLO_BASELINE_POINTS[i];
    const [s2, v2] = SOLO_BASELINE_POINTS[i + 1];
    if (teamSize >= s1 && teamSize <= s2) {
      const rawVal = v1 + ((teamSize - s1) / (s2 - s1)) * (v2 - v1);
      return getShiftedVal(rawVal);
    }
  }
  return getShiftedVal(0.65);
}
