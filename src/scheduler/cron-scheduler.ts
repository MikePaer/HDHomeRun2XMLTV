/**
 * Cron Scheduler
 * Manages automatic EPG updates on schedule
 */

import * as cron from 'node-cron';
import { EPGUpdater } from './epg-updater';
import type { AppConfig } from '../types/config';

export class CronScheduler {
  private config: AppConfig;
  private updater: EPGUpdater;
  private task: cron.ScheduledTask | null = null;

  constructor(config: AppConfig, updater: EPGUpdater) {
    this.config = config;
    this.updater = updater;
  }

  /**
   * Start the cron scheduler
   */
  start() {
    if (!cron.validate(this.config.scheduler.cronSchedule)) {
      console.error(`Invalid cron schedule: ${this.config.scheduler.cronSchedule}`);
      throw new Error('Invalid cron schedule format');
    }

    console.log(`Starting cron scheduler: ${this.config.scheduler.cronSchedule}`);
    console.log(`Timezone: ${this.config.timezone}`);

    this.task = cron.schedule(
      this.config.scheduler.cronSchedule,
      async () => {
        console.log('\n========== Scheduled EPG Update Triggered ==========');
        const result = await this.updater.update();

        if (!result.success) {
          console.error('Scheduled update failed:', result.error);
        }
      },
      {
        timezone: this.config.timezone,
      }
    );

    console.log('Cron scheduler started successfully');
  }

  /**
   * Stop the cron scheduler
   */
  stop() {
    if (this.task) {
      this.task.stop();
      console.log('Cron scheduler stopped');
    }
  }

  /**
   * Get next scheduled run time
   */
  getNextRun(): Date | null {
    // node-cron doesn't expose next run time directly
    // This is a simplified implementation
    return null;
  }
}
