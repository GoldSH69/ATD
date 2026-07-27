import type { LlmSettings, TestResult } from './types';
export declare function testLlm(llm: LlmSettings): Promise<TestResult>;
export declare function generateText(llm: LlmSettings, system: string, user: string): Promise<string>;
