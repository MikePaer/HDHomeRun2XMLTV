/**
 * EPG Update Orchestrator
 * Coordinates API fetching, XMLTV generation, validation, and file writing
 */

import { promises as fs } from 'fs';
import path from 'path';
import { HDHomeRunClient } from '../api/hdhomerun-client';
import { XMLTVGenerator } from '../xmltv/generator';
import { validateXMLTV } from '../xmltv/validator';
import { streamDummyProgramming } from '../xmltv/streaming-dummy';
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

      // Step 6: Validate and write versioned file
      console.log('[6/6] Validating and writing EPG file...');
      const validationResult = validateXMLTV(xmlContent);

      if (!validationResult.valid) {
        throw new Error(`XML validation failed: ${validationResult.error}`);
      }

      console.log('XML validation passed');

      // Write versioned EPG file
      const versionedPath = await this.writeVersionedEPGFile(xmlContent);

      // Add dummy programming if enabled
      let finalPath = versionedPath;
      if (this.config.dummyProgramming?.enabled) {
        console.log('Adding dummy programming to versioned file...');
        const dummyPath = versionedPath.replace('.xml', '-with-dummy.xml');
        await streamDummyProgramming(versionedPath, dummyPath, {
          duration: '1hr',
          title: this.config.dummyProgramming.title,
          description: this.config.dummyProgramming.description,
          daysFilter: this.config.hdhomerun.days,
        }, this.config.hdhomerun.host);
        finalPath = dummyPath;
      }

      // Update symlink to point to current version
      await this.updateSymlink(finalPath);

      // Clean up old versions
      await this.cleanupOldVersions();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log('\n========== EPG Update Completed ==========');
      console.log(`Duration: ${duration} seconds`);
      console.log(`Versioned file: ${finalPath}`);
      console.log(`Symlink: ${this.getEPGPath()}`);

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
   * Write versioned EPG file atomically
   * Format: epg-YYYY-MM-DD.xml
   * Returns path to the versioned file
   */
  private async writeVersionedEPGFile(content: string): Promise<string> {
    // Ensure output directory exists
    await fs.mkdir(this.config.output.directory, { recursive: true });

    // Generate versioned filename
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const versionedFilename = `epg-${year}-${month}-${day}.xml`;
    const versionedPath = path.join(this.config.output.directory, versionedFilename);
    const tempPath = `${versionedPath}.tmp`;

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Rename atomically
      await fs.rename(tempPath, versionedPath);

      console.log(`Versioned EPG file written: ${versionedPath}`);
      return versionedPath;
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to write versioned EPG file: ${error}`);
    }
  }

  /**
   * Update symlink to point to current version
   * Creates epg.xml -> epg-YYYY-MM-DD.xml (or epg-YYYY-MM-DD-with-dummy.xml)
   */
  private async updateSymlink(targetPath: string): Promise<void> {
    const symlinkPath = this.getEPGPath();
    const targetFilename = path.basename(targetPath);

    try {
      // Remove existing symlink if it exists
      try {
        await fs.unlink(symlinkPath);
      } catch {
        // Symlink doesn't exist, that's fine
      }

      // Create new symlink
      await fs.symlink(targetFilename, symlinkPath);
      console.log(`Symlink updated: ${symlinkPath} -> ${targetFilename}`);
    } catch (error) {
      throw new Error(`Failed to update symlink: ${error}`);
    }
  }

  /**
   * Clean up old versioned EPG files
   * Keeps last 5 versions, deletes older ones
   */
  private async cleanupOldVersions(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.output.directory);

      // Find all versioned EPG files (epg-YYYY-MM-DD.xml and epg-YYYY-MM-DD-with-dummy.xml)
      const versionedFiles = files
        .filter(f => f.startsWith('epg-') && f.endsWith('.xml') && f !== 'epg.xml')
        .map(f => ({
          name: f,
          path: path.join(this.config.output.directory, f),
        }));

      // Sort by filename (which sorts by date due to YYYY-MM-DD format)
      versionedFiles.sort((a, b) => b.name.localeCompare(a.name));

      // Keep last 5, delete rest
      const toDelete = versionedFiles.slice(5);

      if (toDelete.length > 0) {
        console.log(`Cleaning up ${toDelete.length} old EPG versions...`);
        for (const file of toDelete) {
          await fs.unlink(file.path);
          console.log(`Deleted old version: ${file.name}`);
        }
      }
    } catch (error) {
      console.warn(`Failed to clean up old versions: ${error}`);
      // Non-fatal error, continue
    }
  }

  private getEPGPath(): string {
    return path.join(this.config.output.directory, this.config.output.filename);
  }

  isUpdateInProgress(): boolean {
    return this.isUpdating;
  }
}
