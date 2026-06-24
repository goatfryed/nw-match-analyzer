# Team Cohesion & Elo Adjustment Curve

This document explains the concept of **Team Cohesion** and how it modifies match MMR ratings using a smooth, asymmetric Double S-Curve.

---

## 1. What is Team Cohesion?

For each player on a team, we look at their **Friendship Index** with their teammates. The Friendship Index is a damped ratio of:
$$\text{Friendship Index} = \frac{\text{Matches played together on same team}}{\text{Total matches played in same game}}$$

To calculate the player's personal cohesion contribution, we sort their friendships with their teammates descending and take the average of the **top 4 friends**.

The **Team Cohesion** ($C$) is the average of the individual cohesion scores of all players on the team:
$$C = \frac{1}{T} \sum_{i=1}^{T} \text{Player Cohesion}_i$$
where $T$ is the team size.

---

## 2. Expected Solo Baseline & cohesionSoloQ Shift

Even in a purely random, solo matchmaking queue, players will naturally happen to play together multiple times. Therefore, the expected average top-4 friendship index (the baseline $B$) for a team of solo players is not $0.50$, but depends on the team size.

We use a configurable parameter **`cohesionSoloQ`** (defaulting to `0.65`) to define the expected baseline for a team of 19 players. Setting `cohesionSoloQ` shifts the entire baseline mapping table up or down by the offset `cohesionSoloQ - 0.65`:
- **Small teams (size $\le 5$):** $B = 0.50 + \text{offset}$ (clamped between 0 and 1)
- **Large teams (size $\ge 22$):** $B = 0.65 + \text{offset}$ (clamped between 0 and 1)
- **Intermediate sizes:** Linearly interpolated between $0.50$ and $0.65$ (and then shifted by $\text{offset}$).

For example, setting `cohesionSoloQ = 0.67` shifts the baseline for a 15v15 match from $0.63$ to $0.65$, cutting more slack for matchmaking pools with frequent group queuing.

---

## 3. Asymmetric Double S-Curve

To convert the raw cohesion $C$ into an Elo/MMR bonus or penalty, we map the deviation from baseline $B$ to a normalized offset $u \in [-1, 1]$:
- If $C \ge B$, we scale the positive deviation: $u = \frac{C - B}{1 - B}$
- If $C < B$, we scale the negative deviation: $u = \frac{C - B}{B}$

To ensure smooth transitions and avoid sudden "bends" or slope discontinuities, we apply a smooth Double S-curve parameterized by:
- **`cohesionTolerance` ($u_{0}$):** The width of the soft tolerance zone where deviations have minimal impact (default: `0.12`).
- **`cohesionSteepness` ($p$):** The exponent controlling how fast the penalty or reward scales outside the tolerance zone (default: `2.0`).

### Asymmetry Design
To give players a larger safety net and avoid penalizing them too harshly for slightly unlucky matchmaking matchups, the **negative tolerance zone is twice as wide as the positive one**:
- Positive turning point: $u_{0, pos} = u_{0}$
- Negative turning point: $u_{0, neg} = \min(1.0, 2 \times u_{0})$

### Curve Formulas
For a normalized offset $u$:
- **Positive side ($u \ge 0$):**
  - If $u \le u_{0, pos}$:
    $$y(u) = \left(\frac{u}{u_{0, pos}}\right)^p \cdot u_{0, pos}$$
  - If $u > u_{0, pos}$:
    $$y(u) = 1 - \left(\frac{1 - u}{1 - u_{0, pos}}\right)^p \cdot (1 - u_{0, pos})$$
  The final effective MMR adjustment is:
  $$\text{MMR Adjustment} = \text{cohesionPenalty} \cdot y(u)$$
- **Negative side ($u < 0$):**
  Let $t = -u$:
  - If $t \le u_{0, neg}$:
    $$y(u) = - \left[ \left(\frac{t}{u_{0, neg}}\right)^p \cdot u_{0, neg} \right]$$
  - If $t > u_{0, neg}$:
    $$y(u) = - \left[ 1 - \left(\frac{1 - t}{1 - u_{0, neg}}\right)^p \cdot (1 - u_{0, neg}) \right]$$
  The final effective MMR adjustment is:
  $$\text{MMR Adjustment} = \text{cohesionBonus} \cdot y(u)$$
  *(If `cohesionBonus` is set to `0`, negative cohesion adjustments are disabled, restoring the old behavior).*

---

## 4. Parameter Configurations Comparison

Here is how different parameters shape the cohesion scaling:

### 1. Default Configuration
- `cohesionTolerance = 0.12`
- `cohesionSteepness = 2.5`
- `cohesionPenalty = 75`
- `cohesionBonus = 30`
- Negative tolerance is $0.24$. Gives a gentle, smooth curve in both directions.

![Default Curve](img/cohesion_curve_default.png)

### 2. Steeper Punishment Configuration
- `cohesionTolerance = 0.12`
- `cohesionSteepness = 3.5`
- `cohesionPenalty = 75`
- `cohesionBonus = 30`
- Negative tolerance is $0.24$. Modifiers are flat near the baseline, but escalate very rapidly once the tolerance threshold is crossed.

![Steeper Curve](img/cohesion_curve_steeper.png)

### 3. More Tolerant Configuration
- `cohesionTolerance = 0.20`
- `cohesionSteepness = 2.5`
- `cohesionPenalty = 75`
- `cohesionBonus = 30`
- Negative tolerance is $0.40$. Delays onset of both rewards and penalties.

![More Tolerant Curve](img/cohesion_curve_tolerant.png)

---

## 5. Unknown Player Special Rules

The player named `"unknown"` (case-insensitive) is treated as a neutral placeholder in calculations:
1. **Average Team MMR**: Excluded from the calculations of team base average MMR.
2. **Cohesion**:
   - Skips `"unknown"` when determining teammate rosters for other players (so they do not affect other players' cohesion scores).
   - Any friendship containing `"unknown"` is always exactly `0.5` (neutral).
   - `"unknown"`'s personal cohesion contribution is always `0.5`.
   - Ignored when calculating the overall team cohesion Elo bonus.
3. **MMR Gains**: `"unknown"` still calculates and receives their own MMR gains/losses in the ratings database so that their stats can be queried.

---

## 6. Personal Share Cohesion Adjustment

To reward solo queue players and prevent Elo inflation for cohesive groups, we incorporate the player's personal cohesion bonus/penalty directly into their individual expected win probability ($\text{expectedIndiv}$).

$$\text{expectedIndiv} = \frac{1}{1 + 10^{\frac{\text{opponentEffective} - (\text{stats.mmr} + B_{\text{cohesion, player}})}{400}}}$$

Where:
- $B_{\text{cohesion, player}}$ is the player's individual cohesion bonus/penalty calculated by applying the Double S-curve to the player's personal cohesion deviation from the solo baseline.
- If a player is in a highly cohesive group, $B_{\text{cohesion, player}} > 0$. This increases their effective rating in the formula, raising their expected win rate and reducing their `personalShare` reward on a win, or increasing their penalty on a loss.
- If a player is solo queue, $B_{\text{cohesion, player}} < 0$. This decreases their effective rating in the formula, lowering their expected win rate and increasing their `personalShare` reward on a win, or reducing their penalty on a loss.
- Group players still affect the overall team cohesion bonus/penalty $B_{\text{cohesion, team}}$, which is used in `expectedBlue` / `expectedRed` and determines `teamShare`.

