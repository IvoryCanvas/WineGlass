import type { Browser, BrowserContext, Page } from 'playwright';

export interface PlatformFont {
  familyName: string;
  postScriptName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface CaptureMetadata {
  label: string;
  version: string;
  url: string;
  platform: string;
  userAgent: string;
  viewport: Dimensions & { devicePixelRatio: number };
  scrollbarWidth: number;
  bodyFont: string;
  documentSize: Dimensions;
  platformFonts: PlatformFont[];
  fontSampleLimit: number;
  pageErrors: string[];
}

export type CapturePair = readonly [CaptureMetadata, CaptureMetadata];

export interface ComparisonMetadata {
  capturedAt: string;
  target: string;
  renderer: string;
  fidelity: string;
  changedPixels: number;
  changedPercent: number;
  captures: CapturePair;
}

export interface CaptureOptions extends Dimensions {
  url: string;
  file: string;
  label: string;
  selector?: string;
  delay?: number;
  signal?: AbortSignal;
  timeout?: number;
}

export interface CapturePage {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  label: string;
  errors: string[];
  close(): Promise<void>;
}

export interface BrowserSession {
  browser: Browser;
  close(): Promise<void>;
}

export interface WineSession extends BrowserSession {
  logPath: string;
}

export interface DemoServer {
  url: string;
  close(): Promise<void>;
}
