/**
 * Device Emulation Profiles
 *
 * Pre-configured device profiles for responsive design testing and mobile emulation.
 * Supports viewport, user agent, device scale factor, and touch emulation.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Device profile configuration
 */
export interface DeviceProfile {
  name: string;
  category: 'desktop' | 'tablet' | 'mobile' | 'phablet';
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
  };
  userAgent?: string;
  touchEnabled: boolean;
  orientation: 'portrait' | 'landscape';
}

/**
 * Custom device configuration
 */
export interface CustomDeviceConfig {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  userAgent?: string;
  touchEnabled?: boolean;
}

// ============================================================================
// Device Profile Library
// ============================================================================

/**
 * Pre-configured device profiles for common devices
 */
export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  // Desktop
  desktop_1920x1080: {
    name: 'Desktop 1920x1080',
    category: 'desktop',
    viewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    },
    touchEnabled: false,
    orientation: 'landscape',
  },
  desktop_1366x768: {
    name: 'Desktop 1366x768',
    category: 'desktop',
    viewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    },
    touchEnabled: false,
    orientation: 'landscape',
  },
  desktop_1440x900: {
    name: 'Desktop 1440x900',
    category: 'desktop',
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    },
    touchEnabled: false,
    orientation: 'landscape',
  },

  // Mobile - Apple
  iphone_14_pro_max: {
    name: 'iPhone 14 Pro Max',
    category: 'mobile',
    viewport: {
      width: 430,
      height: 932,
      deviceScaleFactor: 3,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'portrait',
  },
  iphone_14_pro: {
    name: 'iPhone 14 Pro',
    category: 'mobile',
    viewport: {
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'portrait',
  },
  iphone_13: {
    name: 'iPhone 13',
    category: 'mobile',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'portrait',
  },
  iphone_se: {
    name: 'iPhone SE',
    category: 'mobile',
    viewport: {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'portrait',
  },

  // Mobile - Android
  pixel_7_pro: {
    name: 'Google Pixel 7 Pro',
    category: 'mobile',
    viewport: {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    touchEnabled: true,
    orientation: 'portrait',
  },
  pixel_6: {
    name: 'Google Pixel 6',
    category: 'mobile',
    viewport: {
      width: 393,
      height: 851,
      deviceScaleFactor: 2.625,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    touchEnabled: true,
    orientation: 'portrait',
  },
  samsung_galaxy_s23: {
    name: 'Samsung Galaxy S23',
    category: 'mobile',
    viewport: {
      width: 412,
      height: 915,
      deviceScaleFactor: 3,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    touchEnabled: true,
    orientation: 'portrait',
  },

  // Tablet
  ipad_pro_129: {
    name: 'iPad Pro 12.9"',
    category: 'tablet',
    viewport: {
      width: 1024,
      height: 1366,
      deviceScaleFactor: 2,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'portrait',
  },
  ipad_pro_129_landscape: {
    name: 'iPad Pro 12.9" Landscape',
    category: 'tablet',
    viewport: {
      width: 1366,
      height: 1024,
      deviceScaleFactor: 2,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'landscape',
  },
  ipad_air: {
    name: 'iPad Air',
    category: 'tablet',
    viewport: {
      width: 820,
      height: 1180,
      deviceScaleFactor: 2,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    touchEnabled: true,
    orientation: 'portrait',
  },

  // Phablet
  samsung_galaxy_note: {
    name: 'Samsung Galaxy Note',
    category: 'phablet',
    viewport: {
      width: 414,
      height: 896,
      deviceScaleFactor: 3,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-N986B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    touchEnabled: true,
    orientation: 'portrait',
  },
  google_pixel_fold: {
    name: 'Google Pixel Fold',
    category: 'phablet',
    viewport: {
      width: 798,
      height: 1812,
      deviceScaleFactor: 3,
      mobile: true,
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    touchEnabled: true,
    orientation: 'portrait',
  },
};

// ============================================================================
// Device Profile Manager
// ============================================================================

/**
 * Device Profile Manager
 *
 * Manages device emulation profiles and provides utilities for
 * responsive design testing.
 */
export class DeviceProfileManager {
  private customProfiles: Map<string, DeviceProfile> = new Map();

  /**
   * Get device profile by name
   */
  getProfile(profileName: string): DeviceProfile | undefined {
    return DEVICE_PROFILES[profileName] || this.customProfiles.get(profileName);
  }

  /**
   * Get all available profiles
   */
  getAllProfiles(): Record<string, DeviceProfile> {
    return {
      ...DEVICE_PROFILES,
      ...Object.fromEntries(this.customProfiles),
    };
  }

  /**
   * Get profiles by category
   */
  getProfilesByCategory(category: DeviceProfile['category']): DeviceProfile[] {
    const allProfiles = this.getAllProfiles();
    return Object.values(allProfiles).filter(profile => profile.category === category);
  }

  /**
   * Create custom device profile
   */
  createCustomProfile(name: string, config: CustomDeviceConfig): DeviceProfile {
    const profile: DeviceProfile = {
      name,
      category: config.mobile ? 'mobile' : 'desktop',
      viewport: {
        width: config.width,
        height: config.height,
        deviceScaleFactor: config.deviceScaleFactor ?? 1,
        mobile: config.mobile ?? false,
      },
      ...(config.userAgent !== undefined ? { userAgent: config.userAgent } : {}),
      touchEnabled: config.touchEnabled ?? config.mobile ?? false,
      orientation: config.width > config.height ? 'landscape' : 'portrait',
    };

    this.customProfiles.set(name, profile);
    return profile;
  }

  /**
   * Remove custom profile
   */
  removeCustomProfile(name: string): boolean {
    return this.customProfiles.delete(name);
  }

  /**
   * Get popular profiles
   */
  getPopularProfiles(): DeviceProfile[] {
    return [
      DEVICE_PROFILES['iphone_14_pro_max']!,
      DEVICE_PROFILES['pixel_7_pro']!,
      DEVICE_PROFILES['ipad_pro_129']!,
      DEVICE_PROFILES['desktop_1920x1080']!,
    ];
  }

  /**
   * Search profiles by name
   */
  searchProfiles(query: string): DeviceProfile[] {
    const allProfiles = this.getAllProfiles();
    const lowerQuery = query.toLowerCase();

    return Object.values(allProfiles).filter(profile =>
      profile.name.toLowerCase().includes(lowerQuery) ||
      profile.category.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Convert device profile to viewport config
   */
  toViewportConfig(profile: DeviceProfile): {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
  } {
    return {
      width: profile.viewport.width,
      height: profile.viewport.height,
      deviceScaleFactor: profile.viewport.deviceScaleFactor,
      mobile: profile.viewport.mobile,
    };
  }

  /**
   * Get responsive breakpoints
   */
  getResponsiveBreakpoints(): {
    mobile: number;
    tablet: number;
    desktop: number;
  } {
    return {
      mobile: 480,
      tablet: 768,
      desktop: 1024,
    };
  }

  /**
   * Suggest profiles based on viewport
   */
  suggestProfiles(viewport: { width: number; height: number }): DeviceProfile[] {
    const allProfiles = this.getAllProfiles();
    const allProfilesArray = Object.values(allProfiles);

    return allProfilesArray
      .map(profile => ({
        profile,
        diff: Math.abs(profile.viewport.width - viewport.width) +
              Math.abs(profile.viewport.height - viewport.height),
      }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3)
      .map(item => item.profile);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let deviceProfileManagerInstance: DeviceProfileManager | null = null;

/**
 * Get singleton device profile manager instance
 */
export function getDeviceProfileManager(): DeviceProfileManager {
  if (!deviceProfileManagerInstance) {
    deviceProfileManagerInstance = new DeviceProfileManager();
  }
  return deviceProfileManagerInstance;
}