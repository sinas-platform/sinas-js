import { SinasError, SinasAuthError, SinasPermissionError, SinasNotFoundError } from './errors';
import type { SinasConfig } from './types';

declare global {
  interface Window {
    __SINAS_CONFIG__?: SinasConfig;
    __SINAS_AUTH_TOKEN__?: string | null;
  }
}

export class SinasClient {
  private configOverride?: SinasConfig;

  constructor(config?: SinasConfig) {
    this.configOverride = config;
  }

  getConfig(): SinasConfig {
    const config = this.configOverride || window.__SINAS_CONFIG__;
    if (!config) {
      return {
        apiBase: '',
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

  getAuthHeaders(): Record<string, string> {
    const token = window.__SINAS_AUTH_TOKEN__;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  getProxyBase(): string {
    const config = this.getConfig();
    const comp = config.component;
    return `${config.apiBase}/components/${comp.namespace}/${comp.name}/proxy`;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...(options.headers as Record<string, string> || {}),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      const message = body.detail || body.message || res.statusText;

      if (res.status === 401) throw new SinasAuthError(message);
      if (res.status === 403) throw new SinasPermissionError(message);
      if (res.status === 404) throw new SinasNotFoundError(message);
      throw new SinasError(message, res.status);
    }

    return res;
  }
}
