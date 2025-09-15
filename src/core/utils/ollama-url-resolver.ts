import { ConfigManager } from '../config.js';

export class OllamaUrlResolver {
  /**
   * Get the appropriate Ollama URL based on configuration
   * Priority: Environment variable > Config setting > Default
   */
  static getOllamaUrl(): string {
    // Check for environment override first
    const envUrl = process.env.OLLAMA_BASE_URL;
    if (envUrl) {
      return envUrl;
    }

    const config = ConfigManager.getConfig();
    
    // Check environment variable for load balancer preference
    const useLoadBalancer = process.env.USE_LOAD_BALANCER === 'true' || config.ai.useLoadBalancer;
    
    // Use load balancer if enabled, otherwise use direct URL
    if (useLoadBalancer) {
      return config.ai.loadBalancerUrl;
    }
    
    return config.ai.baseUrl;
  }

  /**
   * Check if load balancer is enabled
   */
  static isLoadBalancerEnabled(): boolean {
    const config = ConfigManager.getConfig();
    return config.ai.useLoadBalancer;
  }

  /**
   * Get load balancer URL
   */
  static getLoadBalancerUrl(): string {
    const config = ConfigManager.getConfig();
    return config.ai.loadBalancerUrl;
  }

  /**
   * Get direct Ollama URL
   */
  static getDirectUrl(): string {
    const config = ConfigManager.getConfig();
    return config.ai.baseUrl;
  }
}
