const crypto = require('crypto')

const publicKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtezAU0IMfIJArpGh0Tcp\nGTAzN9+1XuTcuTOrGp9Wgsjb5A/We4/s7pg2wnVRsd4YVVnguQ9mhBkuXbrGMLw8\nSBqVeae9dUAUa+/LbdLrOQvsDl1IshNyc7GtjfKXOUavWqHOGhy4LIEswppR7ShP\nD5aGSSPWs5nPlo45TW/Ea7UCI+VuyJgOpbQVrTw29y0Acp4xTt5Z5TEOlTllwOvY\nOast121hBrNQ7wEasnjqTcw3mYWQ/wpy3SzAvi5F0CbBHbCZFJPkk8zeetivJlru\nDhQRGMyCp7kd6CSeLTz8iDsGplubKyTlqOSB0BaZ81+RjUt/YRkojmrUNtFZWczZ\nuwIDAQAB\n-----END PUBLIC KEY-----'
const privateKey = '-----BEGIN PRIVATE KEY-----\n' +
  'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC17MBTQgx8gkCu\n' +
  'kaHRNykZMDM337Ve5Ny5M6san1aCyNvkD9Z7j+zumDbCdVGx3hhVWeC5D2aEGS5d\n' +
  'usYwvDxIGpV5p711QBRr78tt0us5C+wOXUiyE3Jzsa2N8pc5Rq9aoc4aHLgsgSzC\n' +
  'mlHtKE8PloZJI9azmc+WjjlNb8RrtQIj5W7ImA6ltBWtPDb3LQBynjFO3lnlMQ6V\n' +
  'OWXA69g5qy3XbWEGs1DvARqyeOpNzDeZhZD/CnLdLMC+LkXQJsEdsJkUk+STzN56\n' +
  '2K8mWu4OFBEYzIKnuR3oJJ4tPPyIOwamW5srJOWo5IHQFpnzX5GNS39hGSiOatQ2\n' +
  '0VlZzNm7AgMBAAECggEAAOBGmAZymb7lOz7Hfek7SqKPli5+zxnHCyITXUN0xTIQ\n' +
  'Bp8htBXTWRExyLa/Hl4ooj1jXNphu5nrcT21ap93CUBBHzh0xYKTfP/6OM/4aTcd\n' +
  '4eVtGv5tx95yxk/R9QKnVLmZ80ikHzXxozyrz4dcKhtz3H8bSS4g1v0qvxOEtjtD\n' +
  'OhUc7iTI2ZflsMPwsf2YTXz2vUWtbsF0OIJVXVDM0ryDgHei3xhpG32cHEeDUqXG\n' +
  'p1cTlqCObTkgBxc7qeBKK+Gwr+xC7JUNx+CyOU0f/2o11WzMd1hjIW+tliaYEfLa\n' +
  'xm/fy0WEJVgmu9evgbV3jMLrDHrK7L3ZCrSzL9Y88QKBgQDwyGS8qjaPA10jhOa8\n' +
  'XMTuY1hdrKq+NByk+WX0SkjHY2lMbttHTMiL7bJV98FLOD6wA1E7osAMO82Ef/WQ\n' +
  'GqNKVdtbtcLcpdV5cGtiRxzJtduq8RFiw33hs20M28ub+ty/B4lvyvlXijTWt4tx\n' +
  'm35BwJWu7QPlLIZfqwGqlbEhBQKBgQDBbBlYMmeBmUwrstqe/7o+7h+uIQ1mIPLZ\n' +
  'k+nu/Xq4T36vnntGjrJ5KUiaUJlx2pU8DiZHAAa1ASCSsvpzRKOMDlp017hVcL3+\n' +
  'uowKrxoL5YRImcC6ivYQOO2SbixphXrk6OudTjxAMzXulr5NLJX9M4JhALQVXLkn\n' +
  'Mx5KEnILvwKBgQCKfcirV3/gDEBDEMsiJn3C2/NUld7zXcfn/+brdtqbjIthQhXv\n' +
  '0bM8ALDlj4ZnPGeaF55encK2hqM0BeF5TEkFlZKBEm+NN/ksS0QIl/xv7KD3loa4\n' +
  'dtbtvaUIk1duVQEpAy3C1k1KU50GrzWOV7BsI1g07/CgnVaAqjxgII9r/QKBgDd8\n' +
  '/HRZ2WnLgZeTsrYkZNjC1WHN55sh3qlejqDaJQeU/qIBFBp0u2yY1FQ4xRxteZyF\n' +
  '7qM1tbbdgOu03raMvWJjh723WRFhy4+1EpHKE+3PxThSq4CYdujGfBki9Ci9ezkK\n' +
  'PPWeyRgd2N3+bs+S9+Bwk3miiwcJ17AQMSNM0VzfAoGBAOU4Xz0vCJ/GynI4DYht\n' +
  'L3c2FQnlX9trqKLT9Xa3LWMUTZnVjYkZf/xHhZOoV06I9pMvCG2IH5yxVwqpg07L\n' +
  'FqFM0M6ssDWM6MZNkqvvRWXJsWzKgra9l35l910YGRwbNG4p8oPC/0O9z6sw2h+O\n' +
  'qDhvQmYdCukk53i9RdP4I7n9\n' +
  '-----END PRIVATE KEY-----'

const path = '/v1/accounts/details'
console.log('path: ', path)

const body = JSON.stringify({ foo: 'bar', baz: 1 })
const bodyHash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex')
console.log('bodyHash', bodyHash)

const timestamp = Date.now()
console.log('timestamp', timestamp)

console.log('stringToSign: ', `${path}${timestamp}${bodyHash}`)

// create signature
const signature = crypto
  .createSign('RSA-SHA256')
  .update(`${path}${timestamp}${bodyHash}`)
  .sign(privateKey, 'base64')
console.log('signature: ', signature)

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Project': 'e2e-rsa',
  'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`
}

const url = 'https://api.loudibly.com/v1/accounts/details'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))
