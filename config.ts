export default {
    "sheets": {
        "spreadsheetId": "1lJrTw9okwrOi9CyzLr_M3ecYi8cDcG4m-4Gtx-NsgCQ",
        "scoreboardSheetId": 1902818640,
        "matchSheetId": 258871598,
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
        "kFactor": 80,
        "amount": 20,
        "sort": "descending",
        "matchThreshold": 10,
        "defaultLosingScore": 333,
        "calibration": 1,
        /**
         * +0: 50% wr
         * +25: 53.6% wr
         * +50: 57.1% wr
         * +75: 60.7% wr
         * +120: 66.6% wr
         */
        "cohesionPenalty": 80,
        "cohesionBonus": 30,
        "cohesionSoloQ": 0.666,
        "cohesionDampingGames": 10,
        "cohesionTolerance": 0.12,
        "cohesionSteepness": 2.5,
        "scoreFactor": 5,
        "individualWeight": 0.33,
    }
}