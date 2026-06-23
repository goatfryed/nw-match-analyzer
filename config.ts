export default {
    "spreadsheetId": "1lJrTw9okwrOi9CyzLr_M3ecYi8cDcG4m-4Gtx-NsgCQ",
    "sourceSheetId": 1902818640,
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
        "kFactor": 32,
        "matchThreshold": 5,
        "amount": 20,
        "sort": "descending",
        /**
         * +0: 50% wr
         * +25: 53.6% wr
         * +50: 57.1% wr
         * +75: 60.7% wr
         * +120: 66.6% wr
         */
        "cohesionScaling": 75,
        "cohesionDampingGames": 5
    }
}