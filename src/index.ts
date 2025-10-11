/**
 * HDHomeRun EPG Server
 * Main entry point
 */

import 'dotenv/config';
import { getConfig } from './types/config';
import { EPGServer } from './server/express-server';
import { EPGUpdater } from './scheduler/epg-updater';
import { CronScheduler } from './scheduler/cron-scheduler';

async function main() {
  console.log('========================================');
  console.log('HDHomeRun EPG Server v2.0.0');
  console.log('========================================');

  // Load configuration
  const config = getConfig();

  console.log('\nConfiguration:');
  console.log(`  HDHomeRun Host: ${config.hdhomerun.host}`);
  console.log(`  EPG Days: ${config.hdhomerun.days}`);
  console.log(`  Update Schedule: ${config.scheduler.cronSchedule}`);
  console.log(`  Timezone: ${config.timezone}`);
  console.log(`  HTTP Port: ${config.server.port}`);
  console.log(`  Output: ${config.output.directory}/${config.output.filename}`);
  console.log('');

  // Initialize components
  const updater = new EPGUpdater(config);
  const server = new EPGServer(config);
  const scheduler = new CronScheduler(config, updater);

  // Start HTTP server
  await server.start();

  // Run initial update if configured
  if (config.scheduler.runOnStart) {
    console.log('\n========== Initial EPG Update ==========');
    const result = await updater.update();

    if (result.success) {
      server.updateStatus('success', new Date().toISOString());
      console.log('Initial EPG update completed successfully');
    } else {
      server.updateStatus('failed', new Date().toISOString());
      console.error('Initial EPG update failed:', result.error);
    }
  } else {
    console.log('\nSkipping initial EPG update (RUN_ON_START=false)');
  }

  // Start cron scheduler
  scheduler.start();

  console.log('\n========================================');
  console.log('Server is running');
  console.log('Press Ctrl+C to stop');
  console.log('========================================\n');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down gracefully...');
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\nShutting down gracefully...');
    scheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
