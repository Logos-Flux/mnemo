/**
 * Base interface for all source adapters
 * Adapters convert external sources into LoadedSource format
 */

import type { LoadedSource, FileInfo } from '../types';

export interface SourceAdapter {
  /**
   * Unique identifier for this adapter type
   */
  readonly type: string;

  /**
   * Human-readable name for this adapter
   */
  readonly name: string;

  /**
   * Validate that the provided source configuration is valid for this adapter
   * @param source - Source configuration to validate
   * @returns True if valid, false otherwise
   */
  canHandle(source: SourceConfig): boolean;

  /**
   * Load content from the source
   * @param source - Source configuration
   * @param options - Optional loading options
   * @returns Loaded source with content and metadata
   */
  load(source: SourceConfig, options?: AdapterLoadOptions): Promise<LoadedSource>;
}

/**
 * Configuration for a source to load
 */
export interface SourceConfig {
  /** Type of source (repo, docs, slack, etc.) */
  type: string;

  /** Source-specific path, URL, or identifier */
  path?: string;
  url?: string;
  id?: string;

  /** Optional authentication */
  token?: string;
  apiKey?: string;

  /** Source-specific options */
  options?: Record<string, any>;
}

/**
 * Options for loading sources via adapters
 */
export interface AdapterLoadOptions {
  /** Maximum tokens to load */
  maxTokens?: number;

  /** Include/exclude patterns */
  include?: string[];
  exclude?: string[];

  /** Additional adapter-specific options */
  [key: string]: any;
}

/**
 * Registry for managing source adapters
 */
export class AdapterRegistry {
  private adapters = new Map<string, SourceAdapter>();

  /**
   * Register a new adapter
   */
  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /**
   * Get adapter by type
   */
  get(type: string): SourceAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Find adapter that can handle the given source
   */
  find(source: SourceConfig): SourceAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(source)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * List all registered adapter types
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}

/**
 * Global adapter registry
 */
export const registry = new AdapterRegistry();
