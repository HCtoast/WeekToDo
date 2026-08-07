import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { OAuth2Client } from 'google-auth-library'
import { GOOGLE_AUTH_TIMEOUT_MS, GOOGLE_SCOPES } from '@shared/constants'
import {
  getClientCredentials,
  getRefreshToken,
  setRefreshToken,
} from '@main/google/credentials'

/**
 * 데스크톱 앱용 OAuth 루프백 흐름.
 *
 * 브라우저를 열어 사용자가 구글에 로그인하면, 구글이 로컬에 띄운 임시 서버로 코드를 돌려준다.
 * 포트는 0으로 열어 OS가 비어 있는 것을 주게 한다 — 고정 포트는 이미 쓰이고 있을 수 있다.
 * (구글의 데스크톱 앱 클라이언트는 http://127.0.0.1 의 임의 포트를 허용한다)
 */

function successPage(): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연결 완료</title>
<style>body{font-family:system-ui,sans-serif;background:#14161c;color:#e8eaf0;
display:grid;place-items:center;height:100vh;margin:0}p{color:#98a0b0}</style></head>
<body><div style="text-align:center"><h2>연결됐습니다</h2>
<p>이 창을 닫고 위젯으로 돌아가세요.</p></div></body></html>`
}

function errorPage(message: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연결 실패</title>
<style>body{font-family:system-ui,sans-serif;background:#14161c;color:#e8eaf0;
display:grid;place-items:center;height:100vh;margin:0}p{color:#ff9a9a}</style></head>
<body><div style="text-align:center"><h2>연결 실패</h2><p>${message}</p></div></body></html>`
}

function closeQuietly(server: Server): void {
  server.close(() => {})
}

/**
 * 브라우저를 열어 인증하고 refresh token을 저장한다.
 * 이미 연결돼 있어도 다시 부르면 계정을 갈아끼울 수 있다.
 */
export async function connectGoogle(): Promise<{ account: string }> {
  const creds = getClientCredentials()
  if (!creds) {
    throw new Error('구글 클라이언트 ID와 시크릿을 먼저 설정에서 입력하세요.')
  }

  // state로 응답이 우리가 시작한 요청의 것인지 확인한다.
  const state = randomBytes(16).toString('hex')

  return await new Promise<{ account: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      // 브라우저는 파비콘도 같이 요청한다. 콜백이 아닌 요청은 무시.
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(204).end()
        return
      }

      const fail = (message: string): void => {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(errorPage(message))
        closeQuietly(server)
        reject(new Error(message))
      }

      if (url.searchParams.get('state') !== state) return fail('요청이 일치하지 않습니다.')

      const error = url.searchParams.get('error')
      if (error) return fail(`구글이 거절했습니다: ${error}`)

      const code = url.searchParams.get('code')!
      const port = (server.address() as AddressInfo).port
      const client = new OAuth2Client({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: `http://127.0.0.1:${port}`,
      })

      void client
        .getToken(code)
        .then(async ({ tokens }) => {
          if (!tokens.refresh_token) {
            // prompt=consent를 줬는데도 없으면 이전 승인이 남아 있는 경우다.
            throw new Error(
              'refresh token을 받지 못했습니다. 구글 계정의 앱 권한에서 이 앱을 지우고 다시 시도하세요.',
            )
          }
          client.setCredentials(tokens)

          let account = ''
          try {
            const info = await client.getTokenInfo(tokens.access_token!)
            account = info.email ?? ''
          } catch {
            // 계정 표시는 부가 정보일 뿐이라 실패해도 연결은 성립한다.
          }

          setRefreshToken(tokens.refresh_token, account)
          res
            .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end(successPage())
          closeQuietly(server)
          resolve({ account })
        })
        .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
    })

    server.on('error', reject)

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const client = new OAuth2Client({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: `http://127.0.0.1:${port}`,
      })

      void shell.openExternal(
        client.generateAuthUrl({
          // offline + consent라야 refresh token이 온다. 없으면 앱을 껐다 켤 때마다 재인증이다.
          access_type: 'offline',
          prompt: 'consent',
          scope: [...GOOGLE_SCOPES],
          state,
        }),
      )
    })

    setTimeout(() => {
      closeQuietly(server)
      reject(new Error('인증 대기 시간이 지났습니다. 다시 시도하세요.'))
    }, GOOGLE_AUTH_TIMEOUT_MS).unref?.()
  })
}

export function disconnectGoogle(): void {
  setRefreshToken(null)
}

export function isConnected(): boolean {
  return getClientCredentials() !== null && getRefreshToken() !== null
}

/**
 * API 호출용 클라이언트. refresh token만 넣어두면 access token은 라이브러리가 알아서 갱신한다.
 */
export function getAuthorizedClient(): OAuth2Client {
  const creds = getClientCredentials()
  const refreshToken = getRefreshToken()
  if (!creds || !refreshToken) throw new Error('구글 계정이 연결되어 있지 않습니다.')

  const client = new OAuth2Client({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  })
  client.setCredentials({ refresh_token: refreshToken })
  return client
}
