import type { EmailAdapter } from '@deadly-studio/oxygen-email'

/**
 * Logs OTP codes to stdout instead of sending real email — a zero-setup dev
 * stand-in for `resendAdapter()`. Swap in the real thing (or your own
 * `EmailAdapter`) for anything beyond local dev — see
 * docs/GUIDE.md#cms-user-auth-otp--cookies.
 */
export const consoleEmail: EmailAdapter = {
  async send(message) {
    console.log(`[email] to=${message.to} subject="${message.subject}"\n${message.text ?? ''}`)
  },
}
