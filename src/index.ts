// Client
export { SinasClient, SinasClientAuth, type SinasClientOptions } from './client/SinasClient';
export { executeQuery } from './client/queries';
export {
  executeFunction,
  enqueueFunction,
  submitFunctionBatch,
  submitAgentBatch,
  getBatch,
  listBatchExecutions,
  cancelBatch,
} from './client/functions';
export type {
  EnqueueFunctionOptions,
  EnqueueFunctionResult,
  SubmitFunctionBatchOptions,
  SubmitFunctionBatchResult,
  AgentBatchItem,
  SubmitAgentBatchOptions,
  SubmitAgentBatchResult,
  BatchStatus,
  BatchExecutionItem,
} from './client/functions';
export { stateGet, stateSet, stateDelete, stateList } from './client/states';
export { createChat, sendMessage, streamMessage, getChat, approveToolCall, streamFromChannel } from './client/chat';
export { listCollections, listFiles, uploadFile, generateFileUrl } from './client/collections';
export {
  getInfo,
  login,
  verifyOTP,
  refresh,
  logout,
  getMe,
  checkPermissions,
} from './client/auth';
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
export { useAuth } from './hooks/useAuth';
export { SinasProvider, useClient } from './hooks/context';

// Types
export type {
  SinasConfig,
  QueryResult,
  FunctionResult,
  StateGetResult,
  StateListResult,
  ChatCreateResult,
  ChatMessage,
  ChatMessageFull,
  ToolCallInfo,
  ChatDetail,
  ApprovalRequest,
  ApprovalResult,
  ContentPart,
  TextContentPart,
  ImageContentPart,
  AudioContentPart,
  FileContentPart,
  ComponentContentPart,
  MessageContent,
  SSEChunk,
  Collection,
  FileInfo,
  FileUploadRequest,
  FileUrlResult,
  AuthMode,
  AuthUser,
  InfoResponse,
  LoginRequest,
  LoginResponse,
  OTPVerifyRequest,
  OTPVerifyResponse,
  RefreshResponse,
  PermissionCheckRequest,
  PermissionCheckResult,
  PermissionCheckResponse,
} from './client/types';
export type { UseQueryOptions, UseQueryResult } from './hooks/useQuery';
export type { UseExecuteResult } from './hooks/useExecute';
export type { UseStateStoreResult, UseStateStoreOptions } from './hooks/useStateStore';
export type { ChatSessionMessage, ToolResult, ToolStatus, UseChatResult, UseChatOptions } from './hooks/useChat';
export type { UseSinasResult } from './hooks/useSinas';
export type { UseAuthResult, UseAuthOptions, AuthStatus } from './hooks/useAuth';
export type { SinasProviderProps } from './hooks/context';
