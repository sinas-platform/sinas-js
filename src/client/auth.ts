import {
  SinasError,
  SinasAuthError,
  SinasPermissionError,
  SinasNotFoundError,
} from './errors';
import type {
  AuthUser,
  InfoResponse,
  LoginRequest,
  LoginResponse,
  OTPVerifyRequest,
  OTPVerifyResponse,
  PermissionCheckRequest,
  PermissionCheckResponse,
  RefreshResponse,
} from './types';

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function authFetch(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${trimBase(baseUrl)}${path}`, { ...init, headers });
  if (res.ok || res.status === 204) return res;

  let detail: string = res.statusText;
  try {
    const body = await res.clone().json();
    detail = body.detail || body.message || detail;
  } catch {
    // body wasn't JSON
  }
  if (res.status === 401) throw new SinasAuthError(detail);
  if (res.status === 403) throw new SinasPermissionError(detail);
  if (res.status === 404) throw new SinasNotFoundError(detail);
  throw new SinasError(detail, res.status, detail);
}

/** Fetch unauthenticated instance info. Use before showing a login screen. */
export async function getInfo(baseUrl: string): Promise<InfoResponse> {
  const res = await authFetch(baseUrl, '/info');
  return (await res.json()) as InfoResponse;
}

/**
 * Start a login. Response shape depends on the workspace's auth_mode:
 *   - "password":     access_token + refresh_token are set → done.
 *   - "otp" or "password+otp": session_id is set → call verifyOTP next.
 */
export async function login(
  baseUrl: string,
  request: LoginRequest,
): Promise<LoginResponse> {
  const res = await authFetch(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return (await res.json()) as LoginResponse;
}

/** Second step for "otp" / "password+otp" modes. Returns final tokens. */
export async function verifyOTP(
  baseUrl: string,
  request: OTPVerifyRequest,
): Promise<OTPVerifyResponse> {
  const res = await authFetch(baseUrl, '/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return (await res.json()) as OTPVerifyResponse;
}

/** Exchange a refresh token for a new access token. */
export async function refresh(
  baseUrl: string,
  refreshToken: string,
): Promise<RefreshResponse> {
  const res = await authFetch(baseUrl, '/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return (await res.json()) as RefreshResponse;
}

/** Revoke a refresh token. Best-effort; ignore 404. */
export async function logout(
  baseUrl: string,
  refreshToken: string,
): Promise<void> {
  try {
    await authFetch(baseUrl, '/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (e) {
    if (e instanceof SinasNotFoundError) return;
    throw e;
  }
}

/** Return the authenticated user (id, email, roles). */
export async function getMe(
  baseUrl: string,
  accessToken: string,
): Promise<AuthUser> {
  const res = await authFetch(baseUrl, '/auth/me', { method: 'GET' }, accessToken);
  return (await res.json()) as AuthUser;
}

/** Check whether the authenticated user has the given permissions. */
export async function checkPermissions(
  baseUrl: string,
  accessToken: string,
  request: PermissionCheckRequest,
): Promise<PermissionCheckResponse> {
  const res = await authFetch(
    baseUrl,
    '/auth/check-permissions',
    {
      method: 'POST',
      body: JSON.stringify({ logic: 'AND', ...request }),
    },
    accessToken,
  );
  return (await res.json()) as PermissionCheckResponse;
}
