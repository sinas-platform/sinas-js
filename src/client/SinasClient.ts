import {
  SinasError,
  SinasAuthError,
  SinasPermissionError,
  SinasNotFoundError,
} from './errors';
import * as authApi from './auth';
import type {
  SinasConfig,
  InfoResponse,
  LoginRequest,
  LoginResponse,
  OTPVerifyRequest,
  OTPVerifyResponse,
  PermissionCheckRequest,
  PermissionCheckResponse,
  RefreshResponse,
  AuthUser,
} from './types';

declare global {
  interface Window {
    __SINAS_CONFIG__?: SinasConfig;
    __SINAS_AUTH_TOKEN__?: string | null;
  }
}

export interface SinasClientOptions {
  /** Embedded-component config. Falls back to window.__SINAS_CONFIG__. */
  config?: SinasConfig;
  /** Workspace base URL for standalone use. Overrides config.apiBase for non-proxy calls. */
  baseUrl?: string;
  /** Returns the current access token, or null. Falls back to window.__SINAS_AUTH_TOKEN__. */
  getAccessToken?: () => string | null;
  /** Returns the current refresh token. Required for auto-refresh on 401. */
  getRefreshToken?: () => string | null;
  /** Called with the new access token after a successful /auth/refresh. */
  onTokenRefresh?: (accessToken: string) => void;
  /** Called when a request remains unauthenticated after a refresh attempt. */
  onUnauthenticated?: () => void;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function trim(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Auth namespace on SinasClient. Standalone counterparts live in client/auth.ts.
 */
export class SinasClientAuth {
  constructor(private readonly client: SinasClient) {}

  getInfo(): Promise<InfoResponse> {
    return authApi.getInfo(this.client.requireBaseUrl());
  }

  login(request: LoginRequest): Promise<LoginResponse> {
    return authApi.login(this.client.requireBaseUrl(), request);
  }

  verifyOTP(request: OTPVerifyRequest): Promise<OTPVerifyResponse> {
    return authApi.verifyOTP(this.client.requireBaseUrl(), request);
  }

  refresh(refreshToken: string): Promise<RefreshResponse> {
    return authApi.refresh(this.client.requireBaseUrl(), refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return authApi.logout(this.client.requireBaseUrl(), refreshToken);
  }

  getMe(): Promise<AuthUser> {
    const token = this.client.getAccessToken();
    if (!token) throw new SinasAuthError('No access token available');
    return authApi.getMe(this.client.requireBaseUrl(), token);
  }

  checkPermissions(request: PermissionCheckRequest): Promise<PermissionCheckResponse> {
    const token = this.client.getAccessToken();
    if (!token) throw new SinasAuthError('No access token available');
    return authApi.checkPermissions(this.client.requireBaseUrl(), token, request);
  }
}

export class SinasClient {
  readonly auth: SinasClientAuth;

  private readonly options: SinasClientOptions;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(options: SinasClientOptions = {}) {
    this.options = options;
    this.auth = new SinasClientAuth(this);
  }

  // ─── Config / base URL ───

  getConfig(): SinasConfig {
    const config =
      this.options.config || (hasWindow() ? window.__SINAS_CONFIG__ : undefined);
    if (!config) {
      return {
        apiBase: this.options.baseUrl ? `${trim(this.options.baseUrl)}/api/v1` : '',
        component: { namespace: '', name: '', version: '' },
        resources: {
          enabledAgents: [],
          enabledFunctions: [],
          enabledQueries: [],
          enabledComponents: [],
          enabledStores: [],
        },
        input: {},
      };
    }
    return config;
  }

  getInput(): Record<string, unknown> {
    return this.getConfig().input || {};
  }

  /** Workspace base URL (root of the Sinas instance). Throws if unset. */
  requireBaseUrl(): string {
    const url = this.getBaseUrl();
    if (!url) {
      throw new SinasError(
        'No baseUrl configured. Construct with `new SinasClient({ baseUrl })` for standalone use.',
        0,
      );
    }
    return url;
  }

  getBaseUrl(): string | null {
    if (this.options.baseUrl) return trim(this.options.baseUrl);
    // Embedded mode: derive from config.apiBase by stripping /api/v1
    const apiBase = this.getConfig().apiBase;
    if (!apiBase) return null;
    return trim(apiBase).replace(/\/api\/v1$/, '');
  }

  // ─── Tokens ───

  getAccessToken(): string | null {
    if (this.options.getAccessToken) return this.options.getAccessToken();
    if (hasWindow()) return window.__SINAS_AUTH_TOKEN__ ?? null;
    return null;
  }

  private getRefreshToken(): string | null {
    return this.options.getRefreshToken ? this.options.getRefreshToken() : null;
  }

  private async tryRefresh(): Promise<string | null> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return null;
    if (this.refreshInFlight) return this.refreshInFlight;
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return null;

    this.refreshInFlight = (async () => {
      try {
        const resp = await authApi.refresh(baseUrl, refreshToken);
        this.options.onTokenRefresh?.(resp.access_token);
        return resp.access_token;
      } catch {
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  // ─── Headers / proxy ───

  getAuthHeaders(): Record<string, string> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  getProxyBase(): string {
    const config = this.getConfig();
    const comp = config.component;
    return `${config.apiBase}/components/${comp.namespace}/${comp.name}/proxy`;
  }

  // ─── Fetch with refresh-on-401 ───

  async fetch(url: string, options: RequestInit = {}, _retried = false): Promise<Response> {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (res.ok || res.status === 204) return res;

    if (res.status === 401 && !_retried) {
      const newToken = await this.tryRefresh();
      if (newToken) return this.fetch(url, options, true);
      this.options.onUnauthenticated?.();
    }

    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const message = body.detail || body.message || res.statusText;

    if (res.status === 401) throw new SinasAuthError(message);
    if (res.status === 403) throw new SinasPermissionError(message);
    if (res.status === 404) throw new SinasNotFoundError(message);
    throw new SinasError(message, res.status);
  }
}
