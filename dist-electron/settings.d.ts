import type { AppSettings, AutopilotSettings } from './types';
export declare function defaultSettings(): AppSettings;
export declare function defaultAutopilot(): AutopilotSettings;
export declare function getSettings(): AppSettings;
export declare function setSettings(settings: AppSettings): Promise<void>;
