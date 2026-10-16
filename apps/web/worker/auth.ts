import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, json, requireSameOrigin } from './http';

const accessIssuer = 'https://nocoo.cloudflareaccess.com';
const accessAudience = '41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726';
const accessKeys = createRemoteJWKSet(new URL(`${accessIssuer}/cdn-cgi/access/certs`));
const localCookie = 'hisfm_local_session';
const sessionLifetime = 60 * 60 * 8;

export function isLocal(request: Request, env: Env) {
  return (
    env.ENVIRONMENT === 'local' &&
    ['localhost', '127.0.0.1', '[::1]', 'hisfm.dev.hexly.ai'].includes(new URL(request.url).hostname)
  );
}

function cookieToken(request: Request) {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${localCookie}=`))
    ?.slice(localCookie.length + 1);
}

async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${localCookie}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function authenticate(request: Request, env: Env) {
  if (isLocal(request, env)) {
    const token = cookieToken(request);
    if (!token) return null;
    const session = await env.DB.prepare(
      'SELECT token_hash FROM local_sessions WHERE token_hash = ? AND expires_at > ?',
    )
      .bind(await tokenHash(token), Date.now())
      .first();
    return session ? { user: { email: 'editor@his.fm' }, mode: 'local' as const } : null;
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, accessKeys, {
      issuer: accessIssuer,
      audience: accessAudience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email'],
    });
    if (typeof payload.email !== 'string' || !payload.email.trim()) return null;
    return { user: { email: payload.email }, mode: 'access' as const };
  } catch {
    return null;
  }
}

export async function localLogin(request: Request, env: Env) {
  if (!isLocal(request, env)) throw new HttpError(404, '页面不存在');
  requireSameOrigin(request);
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM local_sessions WHERE expires_at <= ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO local_sessions (token_hash, expires_at) VALUES (?, ?)').bind(
      await tokenHash(token),
      Date.now() + sessionLifetime * 1000,
    ),
  ]);
  return json({ user: { email: 'editor@his.fm', name: null, avatar: null }, mode: 'local' }, 200, {
    'Set-Cookie': sessionCookie(request, token, sessionLifetime),
  });
}

export async function logout(request: Request, env: Env) {
  requireSameOrigin(request);
  if (isLocal(request, env)) {
    const token = cookieToken(request);
    if (token)
      await env.DB.prepare('DELETE FROM local_sessions WHERE token_hash = ?')
        .bind(await tokenHash(token))
        .run();
    return json({ redirect: '/admin' }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  return json({ redirect: '/cdn-cgi/access/logout' });
}

export function accessLogin() {
  const login = new URL(`${accessIssuer}/cdn-cgi/access/login/his.fm`);
  login.searchParams.set('kid', accessAudience);
  login.searchParams.set('redirect_url', 'https://his.fm/admin');
  return new Response(null, { status: 302, headers: { Location: login.href, 'Cache-Control': 'no-store' } });
}
