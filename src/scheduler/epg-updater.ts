/**
 * EPG Update Orchestrator
 * Coordinates API fetching, XMLTV generation, validation, and file writing
 */

import { promises as fs } from 'fs';
import path from 'path';
import { HDHomeRunClient } from '../api/hdhomerun-client';
import { XMLTVGenerator } from '../xmltv/generator';
import { validateXMLTV } from '../xmltv/validator';
import type { AppConfig } from '../types/config';

export interface UpdateResult {
  success: boolean;
  message: string;
  error?: string;
}

export class EPGUpdater {
  private config: AppConfig;
  private isUpdating = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Perform complete EPG update
   * Returns success/failure status
   */
  async update(): Promise<UpdateResult> {
    // Prevent concurrent updates
    if (this.isUpdating) {
      return {
        success: false,
        message: 'Update already in progress',
      };
    }

    this.isUpdating = true;
    const startTime = Date.now();

    try {
      console.log('========== EPG Update Started ==========');
      console.log(`Time: ${new Date().toISOString()}`);

      // Step 1: Initialize HDHomeRun client
      console.log('\n[1/6] Initializing HDHomeRun client...');
      const client = new HDHomeRunClient(this.config.hdhomerun.host);

      // Step 2: Fetch DeviceAuth (always refresh before update)
      console.log('[2/6] Fetching DeviceAuth token...');
      await client.fetchDeviceAuth();

      // Step 3: Fetch channel lineup
      console.log('[3/6] Fetching channel lineup...');
      const lineup = await client.fetchLineup();
      console.log(`Found ${lineup.length} channels`);

      // Step 4: Fetch EPG data
      console.log(
        `[4/6] Fetching EPG data (${this.config.hdhomerun.days} days, ${this.config.hdhomerun.hoursIncrement} hour windows)...`
      );
      const epgData = await client.fetchEPGData(
        this.config.hdhomerun.days,
        this.config.hdhomerun.hoursIncrement
      );
      console.log(`Retrieved EPG data for ${epgData.length} channels`);

      // Step 5: Generate XMLTV
      console.log('[5/6] Generating XMLTV...');
      const generator = new XMLTVGenerator();
      const deviceUrl = `http://${this.config.hdhomerun.host}/discover.json`;
      const xmlContent = generator.generate(epgData, lineup, deviceUrl);
      console.log(`Generated XML (${Math.round(xmlContent.length / 1024)} KB)`);

      // Step 6: Validate and write
      console.log('[6/6] Validating and writing EPG file...');
      const validationResult = validateXMLTV(xmlContent);

      if (!validationResult.valid) {
        throw new Error(`XML validation failed: ${validationResult.error}`);
      }

      console.log('XML validation passed');

      // Atomic write: write to temp file, then rename
      await this.writeEPGFile(xmlContent);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log('\n========== EPG Update Completed ==========');
      console.log(`Duration: ${duration} seconds`);
      console.log(`File: ${this.getEPGPath()}`);

      return {
        success: true,
        message: `EPG update completed successfully in ${duration}s`,
      };
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error('\n========== EPG Update Failed ==========');
      console.error(`Duration: ${duration} seconds`);
      console.error('Error:', error);

      return {
        success: false,
        message: `EPG update failed after ${duration}s`,
        error: String(error),
      };
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Write EPG file atomically
   * Writes to temp file first, then renames to final location
   * This ensures HTTP server never serves a partial file
   */
  private async writeEPGFile(content: string): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(this.config.output.directory, { recursive: true });

    const finalPath = this.getEPGPath();
    const tempPath = `${finalPath}.tmp`;

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Rename atomically
      await fs.rename(tempPath, finalPath);

      console.log(`EPG file written successfully: ${finalPath}`);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to write EPG file: ${error}`);
    }
  }

  private getEPGPath(): string {
    return path.join(this.config.output.directory, this.config.output.filename);
  }

  isUpdateInProgress(): boolean {
    return this.isUpdating;
  }
}
