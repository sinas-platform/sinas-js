export { SinasClient, SinasClientAuth, type SinasClientOptions } from './SinasClient';
export { executeQuery } from './queries';
export {
  executeFunction,
  enqueueFunction,
  submitFunctionBatch,
  submitAgentBatch,
  getBatch,
  listBatchExecutions,
  cancelBatch,
} from './functions';
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
} from './functions';
export { stateGet, stateSet, stateDelete, stateList } from './states';
export { createChat, sendMessage, streamMessage, getChat, approveToolCall, streamFromChannel } from './chat';
export { listCollections, listFiles, uploadFile, generateFileUrl } from './collections';
export {
  getInfo,
  login,
  verifyOTP,
  refresh,
  logout,
  getMe,
  checkPermissions,
} from './auth';
export {
  SinasError,
  SinasAuthError,
  SinasPermissionError,
  SinasNotFoundError,
  SinasTimeoutError,
} from './errors';
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
} from './types';
