const path = '/v1/webhook'
console.log('path: ', path)

const body = JSON.stringify({
  data: {
    foo: 'bar'
  }
})

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

const url = 'https://api.loudibly.com/v1/webhook'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(JSON.stringify(data, null, 2)) })
  .catch(err => console.log(err))
