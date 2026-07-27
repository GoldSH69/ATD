import type { ThreadsOAuthResult, ThreadsSettings } from './types';
type OAuthCfg = Pick<ThreadsSettings, 'appId' | 'appSecret' | 'redirectUri' | 'scopes'>;
export declare function startThreadsOAuth(cfg: OAuthCfg): Promise<ThreadsOAuthResult>;
export {};
