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

    // Cap the friendship index excess at 0 (only positive relationships count as cohesion)
    const excess = Math.max(0, rawIndex - 0.5);
    const dampingWeight = Math.min(1.0, gameCount / minGames);

    return 0.5 + excess * dampingWeight;
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
  getTeamCohesionBonus(players: string[], minGames: number, scalingFactor: number): number {
    if (players.length <= 1 || scalingFactor === 0) {
      return 0;
    }

    let totalCp = 0;
    for (const p of players) {
      totalCp += this.getPlayerCohesion(p, players, minGames);
    }

    const teamCohesion = totalCp / players.length;

    // Normalizing so that scalingFactor maps exactly to a full 5-stack with 1.0 friendship (excess 0.125)
    return scalingFactor * (teamCohesion - 0.50) / 0.125;
  }
}
