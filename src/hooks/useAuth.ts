import React from 'react';
import { useClient } from './context';
import { SinasAuthError } from '../client/errors';
import type {
  AuthUser,
  InfoResponse,
  LoginResponse,
  OTPVerifyResponse,
} from '../client/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface UseAuthResult {
  status: AuthStatus;
  user: AuthUser | null;
  info: InfoResponse | null;
  error: string | null;

  /**
   * Refresh the session by calling /auth/me with the current access token.
   * Call this on app boot and after token changes.
   */
  refresh: () => Promise<void>;

  /**
   * Start a login. In password-only mode this completes the login and
   * returns access/refresh tokens. In OTP / password+OTP mode the response
   * carries a `session_id` to feed into `verifyOTP`.
   */
  login: (email: string, password?: string) => Promise<LoginResponse>;

  /** Second step for OTP / password+OTP. Returns the final tokens. */
  verifyOTP: (sessionId: string, otpCode: string) => Promise<OTPVerifyResponse>;

  /** Revoke the refresh token and clear local auth state. */
  logout: (refreshToken?: string) => Promise<void>;
}

export interface UseAuthOptions {
  /** Refresh on mount. Default true. */
  autoRefresh?: boolean;
}

/**
 * React hook for the standalone Sinas login flow. The hosting app is
 * responsible for storing the tokens it receives (typically in localStorage)
 * and wiring `getAccessToken` / `getRefreshToken` / `onTokenRefresh` on the
 * SinasProvider so this hook can read the current session.
 */
export function useAuth(options: UseAuthOptions = {}): UseAuthResult {
  const { autoRefresh = true } = options;
  const client = useClient();

  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [info, setInfo] = React.useState<InfoResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      // Fetch /info in parallel with /me (info is unauthenticated and cheap).
      const [infoResp, meResp] = await Promise.all([
        client.auth.getInfo().catch(() => null),
        client.getAccessToken() ? client.auth.getMe().catch(() => null) : Promise.resolve(null),
      ]);
      if (infoResp) setInfo(infoResp);
      if (meResp) {
        setUser(meResp);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('unauthenticated');
    }
  }, [client]);

  React.useEffect(() => {
    if (autoRefresh) void refresh();
  }, [autoRefresh, refresh]);

  const login = React.useCallback(
    async (email: string, password?: string) => {
      setError(null);
      try {
        return await client.auth.login({ email, password });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [client],
  );

  const verifyOTP = React.useCallback(
    async (sessionId: string, otpCode: string) => {
      setError(null);
      try {
        return await client.auth.verifyOTP({ session_id: sessionId, otp_code: otpCode });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [client],
  );

  const logout = React.useCallback(
    async (refreshToken?: string) => {
      if (refreshToken) {
        try {
          await client.auth.logout(refreshToken);
        } catch (e) {
          if (!(e instanceof SinasAuthError)) throw e;
        }
      }
      setUser(null);
      setStatus('unauthenticated');
    },
    [client],
  );

  return { status, user, info, error, refresh, login, verifyOTP, logout };
}
