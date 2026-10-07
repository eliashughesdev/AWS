// An account has no name in the backend yet (to confirm with the client), so each one is
// shown under a made-up name. It is picked from the account number, so an account keeps
// the same one between visits.
const first  = ['Trading', 'Business', 'Savings', 'Travel', 'Family', 'Reserve', 'Daily', 'Growth', 'Project', 'Holiday']
const second = ['Wallet', 'Account', 'Fund', 'Vault']

export function placeholderName(accountNo: string) {
  let hash = 0
  for (const char of accountNo) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `${first[hash % first.length]} ${second[(hash >>> 8) % second.length]}`
}
