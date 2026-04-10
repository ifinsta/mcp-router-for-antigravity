#!/usr/bin/env node

/**
 * Icon Generator for ifin Platform
 * Creates application icons in various sizes and formats
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class IconGenerator {
  constructor() {
    this.assetsDir = path.join(__dirname, '..');
    this.sizes = [16, 32, 48, 64, 128, 256, 512];
  }

  generate() {
    console.log('🎨 Generating application icons...');

    // Create a simple placeholder icon
    this.createPlaceholderIcon();

    // Create icon files in different formats
    this.createICOFile();
    this.createPNGFiles();

    console.log('✅ Icons generated successfully');
  }

  createPlaceholderIcon() {
    // Create a simple SVG icon
    const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="64" fill="url(#grad1)"/>
  <circle cx="256" cy="200" r="80" fill="white" opacity="0.9"/>
  <path d="M 200 280 Q 256 380 312 280" stroke="white" stroke-width="8" fill="none" opacity="0.9"/>
  <circle cx="160" cy="350" r="20" fill="white" opacity="0.7"/>
  <circle cx="352" cy="350" r="20" fill="white" opacity="0.7"/>
  <rect x="220" y="320" width="72" height="12" rx="6" fill="white" opacity="0.8"/>
</svg>
    `.trim();

    const iconPath = path.join(this.assetsDir, 'icon.svg');
    fs.writeFileSync(iconPath, svgIcon);
    console.log('  Created: icon.svg');
  }

  createICOFile() {
    // Note: This is a placeholder. In production, you would use a tool like
    // 'png-to-ico' or 'electron-icon-builder' to create proper .ico files

    const placeholderPath = path.join(this.assetsDir, 'icon.ico');

    if (!fs.existsSync(placeholderPath)) {
      // Create a placeholder file
      fs.writeFileSync(placeholderPath, 'Placeholder ICO file - Use electron-icon-builder for production');
      console.log('  Created: icon.ico (placeholder)');
    } else {
      console.log('  Exists: icon.ico');
    }
  }

  createPNGFiles() {
    // Note: In production, you would convert the SVG to PNG
    // using a tool like 'sharp' or 'electron-icon-builder'

    const placeholderPath = path.join(this.assetsDir, 'icon.png');

    if (!fs.existsSync(placeholderPath)) {
      // Create a placeholder file
      fs.writeFileSync(placeholderPath, 'Placeholder PNG file - Use electron-icon-builder for production');
      console.log('  Created: icon.png (placeholder)');
    } else {
      console.log('  Exists: icon.png');
    }
  }
}

// Run generator
const generator = new IconGenerator();
generator.generate();