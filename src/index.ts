/**
 * HDHomeRun2XMLTV
 * Main entry point
 */

import 'dotenv/config';
import { getConfig } from './types/config';
import { EPGServer } from './server/express-server';
import { EPGUpdater } from './scheduler/epg-updater';
import { CronScheduler } from './scheduler/cron-scheduler';

async function main() {
  console.log('========================================');
  console.log('HDHomeRun2XMLTV v2.0.0');
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

  // Run initial update if configured (non-blocking with timeout)
  if (config.scheduler.runOnStart) {
    console.log('\n========== Initial EPG Update ==========');

    // Run update in background with timeout protection
    Promise.race([
      updater.update(),
      new Promise<{success: false, message: string, error: string}>((resolve) =>
        setTimeout(() => resolve({
          success: false,
          message: 'Initial EPG update timed out',
          error: 'Update took longer than 60 seconds - will retry on schedule'
        }), 60000) // 60 second max for initial update
      )
    ]).then((result) => {
      if (result.success) {
        server.updateStatus('success', new Date().toISOString());
        console.log('Initial EPG update completed successfully');
      } else {
        server.updateStatus('failed', new Date().toISOString());
        console.error('Initial EPG update failed:', result.error);
        console.log('Server will continue running - EPG will update on schedule');
      }
    }).catch((error) => {
      server.updateStatus('failed', new Date().toISOString());
      console.error('Initial EPG update error:', error);
      console.log('Server will continue running - EPG will update on schedule');
    });
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
