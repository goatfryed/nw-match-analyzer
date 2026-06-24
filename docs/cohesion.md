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

## 2. Expected Solo Baseline

Even in a purely random, solo matchmaking queue, players will naturally happen to play together multiple times. Therefore, the expected average top-4 friendship index (the baseline $B$) for a team of solo players is not $0.50$, but depends on the team size:
- **Small teams (size $\le 5$):** $B = 0.50$
- **Large teams (size $\ge 22$):** $B = 0.65$
- **Intermediate sizes:** Linearly interpolated between $0.50$ and $0.65$ based on the team size.

---

## 3. Asymmetric Double S-Curve

To convert the raw cohesion $C$ into an Elo/MMR bonus or penalty, we map the deviation from baseline $B$ to a normalized offset $u \in [-1, 1]$:
- If $C \ge B$, we scale the positive deviation: $u = \frac{C - B}{1 - B}$
- If $C < B$, we scale the negative deviation: $u = \frac{C - B}{B}$

To ensure smooth transitions and avoid sudden "bends" or slope discontinuities, we apply a smooth Double S-curve parameterized by:
- **`cohesionTolerance` ($u_{0}$):** The width of the soft tolerance zone where deviations have minimal impact.
- **`cohesionSteepness` ($p$):** The exponent controlling how fast the penalty or reward scales outside the tolerance zone.

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
- **Negative side ($u < 0$):**
  Let $t = -u$:
  - If $t \le u_{0, neg}$:
    $$y(u) = - \left[ \left(\frac{t}{u_{0, neg}}\right)^p \cdot u_{0, neg} \right]$$
  - If $t > u_{0, neg}$:
    $$y(u) = - \left[ 1 - \left(\frac{1 - t}{1 - u_{0, neg}}\right)^p \cdot (1 - u_{0, neg}) \right]$$

---

## 4. Parameter Configurations Comparison

Here is how different parameters shape the cohesion scaling:

### 1. Default Configuration
- `cohesionTolerance = 0.12`
- `cohesionSteepness = 2.0`
- Negative tolerance is $0.24$. Gives a gentle, smooth curve in both directions.

![Default Curve](img/cohesion_curve_default.png)

### 2. Steeper Punishment Configuration
- `cohesionTolerance = 0.12`
- `cohesionSteepness = 3.5`
- Negative tolerance is $0.24$. Modifiers are flat near the baseline, but escalate very rapidly once the tolerance threshold is crossed.

![Steeper Curve](img/cohesion_curve_steeper.png)

### 3. More Tolerant Configuration
- `cohesionTolerance = 0.20`
- `cohesionSteepness = 2.0`
- Negative tolerance is $0.40$. Delays onset of both rewards and penalties.

![More Tolerant Curve](img/cohesion_curve_tolerant.png)
