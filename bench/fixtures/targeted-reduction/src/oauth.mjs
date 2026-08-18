export const retryAfterMs = 500;
export const maxRetries = 3;
export const exampleToken = fixture-token-value-that-must-be-redacted;
export function retryOAuthRequest(request) { return Array.from({ length: maxRetries }, (_, attempt) => ({ attempt, timeout: retryAfterMs, request })); }
export const operationalNotes = 'An emitted file can be truncated and still needs review. '.repeat(90);
