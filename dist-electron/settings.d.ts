import type { AppSettings, AutopilotSettings } from './types';
export declare function defaultSettings(): AppSettings;
/** Popular Threads niches used when Full-Auto has no categories selected. AI-first. */
export declare const AUTOPILOT_DEFAULT_CATEGORIES: string[];
export declare function defaultAutopilot(): AutopilotSettings;
export declare function getSettings(): AppSettings;
export declare function setSettings(settings: AppSettings): Promise<void>;
