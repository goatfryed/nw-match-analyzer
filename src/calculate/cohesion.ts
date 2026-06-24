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

  /**
   * Get the damped friendship index between two players
   */
  getDampedFriendship(p1: string, p2: string, minGames: number): number {
    if (p1 === p2) return 1.0;
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
    const friendships: number[] = [];
    for (const teammate of roster) {
      if (teammate === player) continue;
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
    scalingFactor: number,
    u0_pos = 0.12,
    p = 2.0
  ): number {
    if (players.length <= 1 || scalingFactor === 0) {
      return 0;
    }

    let totalCp = 0;
    for (const player of players) {
      totalCp += this.getPlayerCohesion(player, players, minGames);
    }

    const teamCohesion = totalCp / players.length;

    const B = getExpectedSoloBaseline(players.length);

    let u = 0;
    if (teamCohesion >= B) {
      const denominator = 1.0 - B;
      u = denominator > 0 ? (teamCohesion - B) / denominator : 0;
    } else {
      u = B > 0 ? (teamCohesion - B) / B : 0;
    }

    const modifier = generalizedSCurve(u, u0_pos, p);
    return scalingFactor * modifier;
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

function getExpectedSoloBaseline(teamSize: number): number {
  if (teamSize <= 5) return 0.50;
  if (teamSize >= 22) return 0.65;
  for (let i = 0; i < SOLO_BASELINE_POINTS.length - 1; i++) {
    const [s1, v1] = SOLO_BASELINE_POINTS[i];
    const [s2, v2] = SOLO_BASELINE_POINTS[i + 1];
    if (teamSize >= s1 && teamSize <= s2) {
      return v1 + ((teamSize - s1) / (s2 - s1)) * (v2 - v1);
    }
  }
  return 0.65;
}
