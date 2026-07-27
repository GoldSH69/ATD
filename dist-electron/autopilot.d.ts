import type { AutopilotStatus } from './types';
export declare function setAutopilotStatusListener(cb: (status: AutopilotStatus) => void): void;
export declare function buildAutopilotStatus(): AutopilotStatus;
export declare function startAutopilot(): void;
/** Force one pass immediately (the "Run once now" button). Ignores the interval. */
export declare function runAutopilotNow(): Promise<AutopilotStatus>;
