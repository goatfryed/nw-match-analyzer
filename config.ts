export default {
    "sheets": {
        "spreadsheetId": "1lJrTw9okwrOi9CyzLr_M3ecYi8cDcG4m-4Gtx-NsgCQ",
        "scoreboardSheetId": 1902818640,
        "matchSheetId": 258871598,
        "eloSheetId": 558216310,
    },
    "friendzone": {
        "matchThreshold": 5,
        "amount": 10,
        "cliqueThreshold": 0.75,
    },
    "validation": {
        "maxRowsPerGame": 45
    },
    "elo": {
        "defaultRating": 1500,
        "seedingGames": 15,
        "calibration": 5,
        "calibrationFactor": 2,
        "kFactor": 44,
        "defaultLosingScore": 500,
        "individualWeight": 0.5,
        "scoreFactor": 5,
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
        "cohesionPenalty": 100,
        "cohesionBonus": 0,
        "cohesionSoloQ": 0.67,
        "cohesionDampingGames": 8,
        "cohesionTolerance": 0.10,
        "cohesionSteepness": 2.25,
        "amount": 25,
        "sort": "descending",
    }
}