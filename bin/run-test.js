#!/usr/bin/env node

/**
 * Run automated tests against a URL using the orchestrator.
 * Usage: node bin/run-test.js [url] [profile]
 */

import { runOrchestration } from '../dist/testing/orchestrator.js';

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const url = args[0] || 'https://example.com';
  const profile = args[1] || 'standard';

  // Validate profile
  const validProfiles = ['quick', 'standard', 'comprehensive'];
  if (!validProfiles.includes(profile)) {
    console.error(`Error: Invalid profile '${profile}'. Valid profiles: ${validProfiles.join(', ')}`);
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('MCP Router - Automated Test Orchestrator');
  console.log('='.repeat(70));
  console.log(`Target URL: ${url}`);
  console.log(`Test Profile: ${profile}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(70));
  console.log();

  const startTime = Date.now();

  try {
    const report = await runOrchestration({
      url,
      profile,
    });

    const duration = Date.now() - startTime;

    console.log();
    console.log('='.repeat(70));
    console.log('ORCHESTRATION REPORT');
    console.log('='.repeat(70));
    console.log();

    // Overall verdict
    const verdictColor = report.overallVerdict === 'pass' 
      ? '\x1b[32m' // green
      : report.overallVerdict === 'warning'
        ? '\x1b[33m' // yellow
        : '\x1b[31m'; // red
    const resetColor = '\x1b[0m';
    
    console.log(`Overall Verdict: ${verdictColor}${report.overallVerdict.toUpperCase()}${resetColor}`);
    console.log(`Total Duration: ${(report.totalDuration / 1000).toFixed(2)}s`);
    console.log();

    // Step summary
    console.log('--- Step Summary ---');
    console.log(`Total Steps: ${report.summary.total}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Skipped: ${report.summary.skipped}`);
    console.log();

    // Detailed step results
    console.log('--- Step Results ---');
    for (const step of report.steps) {
      const statusColor = step.status === 'passed' 
        ? '\x1b[32m'
        : step.status === 'failed'
          ? '\x1b[31m'
          : '\x1b[33m';
      console.log(`  ${statusColor}[${step.status.toUpperCase()}]${resetColor} ${step.name} (${step.duration}ms)`);
      if (step.error) {
        console.log(`      Error: ${step.error}`);
      }
    }
    console.log();

    // Web Vitals
    if (report.webVitals && Object.keys(report.webVitals).length > 0) {
      console.log('--- Web Vitals ---');
      const vitals = report.webVitals;
      if (vitals.lcp !== undefined) console.log(`  LCP: ${vitals.lcp}ms`);
      if (vitals.cls !== undefined) console.log(`  CLS: ${vitals.cls}`);
      if (vitals.fid !== undefined) console.log(`  FID: ${vitals.fid}ms`);
      if (vitals.fcp !== undefined) console.log(`  FCP: ${vitals.fcp}ms`);
      if (vitals.ttfb !== undefined) console.log(`  TTFB: ${vitals.ttfb}ms`);
      if (vitals.inp !== undefined) console.log(`  INP: ${vitals.inp}ms`);
      console.log();
    }

    // Design Audit
    if (report.designAudit && Object.keys(report.designAudit).length > 0) {
      console.log('--- Design Audit ---');
      const audit = report.designAudit;
      
      if (audit.colorContrast) {
        const violations = audit.colorContrast.violations;
        console.log(`  Color Contrast Violations: ${Array.isArray(violations) ? violations.length : 0}`);
      }
      if (audit.images) {
        const missingAlt = audit.images.missingAlt;
        const oversized = audit.images.oversized;
        console.log(`  Images Missing Alt: ${Array.isArray(missingAlt) ? missingAlt.length : 0}`);
        console.log(`  Oversized Images: ${Array.isArray(oversized) ? oversized.length : 0}`);
      }
      if (audit.touchTargets) {
        console.log(`  Undersized Touch Targets: ${audit.touchTargets.failing || 0}`);
      }
      if (audit.forms) {
        console.log(`  Form Fields Without Labels: ${audit.forms.withoutLabels || 0}`);
      }
      console.log();
    }

    // Screenshots
    if (report.screenshots && report.screenshots.length > 0) {
      console.log('--- Screenshots ---');
      for (const path of report.screenshots) {
        console.log(`  ${path}`);
      }
      console.log();
    }

    // Recommendations
    if (report.recommendations && report.recommendations.length > 0) {
      console.log('--- Recommendations ---');
      for (let i = 0; i < report.recommendations.length; i++) {
        console.log(`  ${i + 1}. ${report.recommendations[i]}`);
      }
      console.log();
    }

    // Full JSON report (for programmatic use)
    console.log('='.repeat(70));
    console.log('FULL JSON REPORT');
    console.log('='.repeat(70));
    console.log(JSON.stringify(report, null, 2));
    console.log();

    console.log('='.repeat(70));
    console.log('Orchestration completed successfully');
    console.log('='.repeat(70));

    // Exit with appropriate code
    process.exit(report.overallVerdict === 'fail' ? 1 : 0);

  } catch (error) {
    console.error();
    console.error('='.repeat(70));
    console.error('ORCHESTRATION FAILED');
    console.error('='.repeat(70));
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error();
      console.error('Stack trace:');
      console.error(error.stack);
    }
    console.error('='.repeat(70));
    process.exit(1);
  }
}

main();
