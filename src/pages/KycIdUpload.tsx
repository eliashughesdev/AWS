import { useState } from 'react'
import axios from 'axios'
import { fetchAuthSession } from 'aws-amplify/auth'

export default function KycIdUpload() {
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!frontFile) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const session = await fetchAuthSession()
      const token = session.tokens?.accessToken?.toString()

      const frontBase64 = await toBase64(frontFile)
      const backBase64 = backFile ? await toBase64(backFile) : undefined

      const { data } = await axios.post(
        'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/kyc/didit/id-verify',
        { front_image: frontBase64, back_image: backBase64 },
        { headers: { 'X-Project': 'e2e-hmac', Authorization: `Bearer ${token}` } }
      )

      setResult(data)
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: '2rem', maxWidth: 600 }}>
      <h1>ID Verification Test</h1>
      <p>Upload a document image to test the standalone Didit ID verification API (liveness disabled).</p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label>Front image (required)</label><br />
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={e => setFrontFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        <div>
          <label>Back image (optional)</label><br />
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={e => setBackFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <button type="submit" disabled={loading || !frontFile}>
          {loading ? 'Verifying...' : 'Run Verification'}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: '1rem', color: 'red' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1rem' }}>
          <strong>Status:</strong> {result.status}<br />
          <details>
            <summary>Full response</summary>
            <pre style={{ fontSize: 12, overflow: 'auto' }}>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </main>
  )
}
