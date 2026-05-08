import * as functions from 'firebase-functions/v1'

const DEFAULT_REGION = 'europe-west6'

export const regionalFunctions = functions.region(DEFAULT_REGION)

export { functions }
