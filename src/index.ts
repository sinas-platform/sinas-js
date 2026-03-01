// Client
export { SinasClient } from './client/SinasClient';
export { executeQuery } from './client/queries';
export { executeFunction } from './client/functions';
export { stateGet, stateSet, stateDelete, stateList } from './client/states';
export { createChat, sendMessage, streamMessage } from './client/chat';
export {
  SinasError,
  SinasAuthError,
  SinasPermissionError,
  SinasNotFoundError,
  SinasTimeoutError,
} from './client/errors';

// Hooks
export { useQuery } from './hooks/useQuery';
export { useExecute } from './hooks/useExecute';
export { useStateStore } from './hooks/useStateStore';
export { useChat } from './hooks/useChat';
export { useSinas } from './hooks/useSinas';
export { SinasProvider } from './hooks/context';

// Types
export type {
  SinasConfig,
  QueryResult,
  FunctionResult,
  StateGetResult,
  StateListResult,
  ChatCreateResult,
  ChatMessage,
  SSEChunk,
} from './client/types';
export type { UseQueryOptions, UseQueryResult } from './hooks/useQuery';
export type { UseExecuteResult } from './hooks/useExecute';
export type { UseStateStoreResult, UseStateStoreOptions } from './hooks/useStateStore';
export type { UseChatResult } from './hooks/useChat';
export type { UseSinasResult } from './hooks/useSinas';
export type { SinasProviderProps } from './hooks/context';
