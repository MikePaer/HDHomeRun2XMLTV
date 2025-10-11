/**
 * Application configuration types
 */

export interface AppConfig {
  hdhomerun: {
    host: string;
    days: number;
    hoursIncrement: number;
  };
  server: {
    port: number;
  };
  scheduler: {
    cronSchedule: string;
    runOnStart: boolean;
  };
  output: {
    directory: string;
    filename: string;
  };
  timezone: string;
}

export function getConfig(): AppConfig {
  return {
    hdhomerun: {
      host: process.env.HDHOMERUN_HOST || 'hdhomerun.local',
      days: parseInt(process.env.DAYS || '7', 10),
      hoursIncrement: parseInt(process.env.HOURS_INCREMENT || '3', 10),
    },
    server: {
      port: parseInt(process.env.WEB_PORT || '8083', 10),
    },
    scheduler: {
      cronSchedule: process.env.CRON_SCHEDULE || '0 3 * * *',
      runOnStart: process.env.RUN_ON_START === 'true',
    },
    output: {
      directory: process.env.OUTPUT_DIR || './output',
      filename: process.env.EPG_FILENAME || 'epg.xml',
    },
    timezone: process.env.TZ || 'America/Chicago',
  };
}
