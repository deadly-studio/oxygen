import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resendAdapter } from './resend.js'

describe('resendAdapter', () => {
  const apiUrl = 'https://example.test/emails'

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the message to the Resend API with the configured from address and auth header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 200 }))

    const adapter = resendAdapter({ apiKey: 're_test_key', from: 'noreply@example.com', apiUrl })
    await adapter.send({ to: 'user@example.com', subject: 'Your code', text: '123456' })

    expect(fetch).toHaveBeenCalledWith(
      apiUrl,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
        },
      }),
    )
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toEqual({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Your code',
      text: '123456',
      html: undefined,
    })
  })

  it('throws with the Resend error message when the API responds with a non-2xx status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid `to` field' }), { status: 422 }),
    )

    const adapter = resendAdapter({ apiKey: 're_test_key', from: 'noreply@example.com', apiUrl })
    await expect(adapter.send({ to: 'not-an-email', subject: 'x' })).rejects.toThrow(
      'Resend API error (422): Invalid `to` field',
    )
  })

  it('falls back to the raw response body when the error is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Service unavailable', { status: 503 }))

    const adapter = resendAdapter({ apiKey: 're_test_key', from: 'noreply@example.com', apiUrl })
    await expect(adapter.send({ to: 'user@example.com', subject: 'x' })).rejects.toThrow(
      'Resend API error (503): Service unavailable',
    )
  })
})
