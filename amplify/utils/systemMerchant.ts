// Owns the system's own customers (direct sign-ups, not onboarded by a merchant).
// Has no API key. Kept free of imports so backend.ts can use it at synth time.
//
// Was `loudibly` until 2026-10-06. Accounts created before the rename keep
// `merchantId: 'loudibly'` on their record, and signing for them reads that id's
// SEED# rows, so those rows must stay. `loudibly` gets nothing new.
export const SYSTEM_MERCHANT_ID = 'internal-001'
export const SYSTEM_MERCHANT_NAME = 'Internal001'
