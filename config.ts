export default {
    "sheets": {
        "spreadsheetId": "1lJrTw9okwrOi9CyzLr_M3ecYi8cDcG4m-4Gtx-NsgCQ",
        "scoreboardSheetId": 1902818640,
        "matchSheetId": 258871598,
        "mmrSheetId": 558216310,
    },
    "friendzone": {
        "matchThreshold": 5,
        "amount": 10,
        "cliqueThreshold": 0.75,
    },
    "validation": {
        "maxRowsPerGame": 45
    },
    "mmr": {
        "defaultRating": 1500,
        "kFactor": 64,
        "amount": 20,
        "sort": "descending",
        "seedingGames": 15,
        "defaultLosingScore": 500,
        "calibration": 1,
        // MMR Reward Curve control points: [ [normalized_score, normalized_mapping] ]
        // Examples:
        // [] -> Linear
        // [ [0.5, 0.80] ] -> Power curve through (500, 0.80)
        // [ [0.15, 0.60], [0.85, 0.90] ] -> S-Curve (Monotonic Spline)
        "rewardPoints": [
        ],
        /**
         * +0: 50% wr
         * +25: 53.6% wr
         * +50: 57.1% wr
         * +75: 60.7% wr
         * +120: 66.6% wr
         */
        "cohesionPenalty": 140,
        "cohesionBonus": 30,
        "cohesionSoloQ": 0.69,
        "cohesionDampingGames": 20,
        "cohesionTolerance": 0.12,
        "cohesionSteepness": 2.5,
        "scoreFactor": 4,
        "individualWeight": 0.5,
    }
}