/**
 * Express HTTP Server
 * Serves EPG file and status endpoints
 */

import express, { Express, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import type { AppConfig } from '../types/config';

export interface ServerStatus {
  server: string;
  epgFileExists: boolean;
  epgFileSize: number;
  epgLastModified: string | null;
  hdhomerunHost: string;
  updateSchedule: string;
  serverTime: string;
  lastUpdateStatus?: string;
  lastUpdateTime?: string;
}

export class EPGServer {
  private app: Express;
  private config: AppConfig;
  private lastUpdateStatus: string = 'not started';
  private lastUpdateTime: string | undefined = undefined;

  constructor(config: AppConfig) {
    this.config = config;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Main EPG endpoint
    this.app.get('/epg.xml', this.serveEPG.bind(this));
    this.app.get('/xmltv.xml', this.serveEPG.bind(this)); // Alias
    this.app.get('/guide.xml', this.serveEPG.bind(this)); // Alias

    // Status endpoint
    this.app.get('/status', this.serveStatus.bind(this));

    // Health check endpoint
    this.app.get('/health', this.serveHealth.bind(this));

    // Icon endpoint
    this.app.get('/icon.png', this.serveIcon.bind(this));

    // Manual update trigger
    this.app.post('/update', this.triggerUpdate.bind(this));

    // Root endpoint
    this.app.get('/', this.serveRoot.bind(this));
  }

  private async serveEPG(req: Request, res: Response) {
    const epgPath = path.join(this.config.output.directory, this.config.output.filename);

    try {
      // Check if file exists
      await fs.access(epgPath);

      const dummyParam = req.query.dummy as string | undefined;
      const daysParam = req.query.days as string | undefined;

      // If no modifications needed, serve file directly
      if (!dummyParam && !daysParam) {
        const epgContent = await fs.readFile(epgPath, 'utf-8');
        res.set({
          'Content-Type': 'application/xml; charset=UTF-8',
          'Cache-Control': 'public, max-age=1800', // Cache for 30 minutes
          'Access-Control-Allow-Origin': '*',
        });
        res.send(epgContent);
        console.log('Served EPG successfully');
        return;
      }

      // Modifications requested - use streaming approach
      const tempDir = path.join(this.config.output.directory, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempFile = path.join(tempDir, `epg-${Date.now()}.xml`);
      let currentFile = epgPath;

      try {
        // Apply days filter first if requested
        if (daysParam) {
          console.log(`Applying days filter: ${daysParam} days`);
          const { streamFilterEPG } = await import('../xmltv/streaming-filter');
          const filteredFile = `${tempFile}.filtered`;
          await streamFilterEPG(currentFile, filteredFile, {
            days: parseInt(daysParam, 10),
          });
          currentFile = filteredFile;
        }

        // Apply dummy programming if requested
        if (dummyParam && this.config.dummyProgramming?.enabled) {
          console.log(`Applying dummy programming with duration: ${dummyParam}`);
          const { streamDummyProgramming } = await import('../xmltv/streaming-dummy');
          const dummyFile = `${tempFile}.dummy`;
          await streamDummyProgramming(
            currentFile,
            dummyFile,
            {
              duration: dummyParam,
              title: this.config.dummyProgramming.title,
              description: this.config.dummyProgramming.description,
              daysFilter: daysParam ? parseInt(daysParam, 10) : undefined,
            },
            this.config.hdhomerun.host
          );
          currentFile = dummyFile;
        }

        // Read final result and send
        const finalContent = await fs.readFile(currentFile, 'utf-8');

        res.set({
          'Content-Type': 'application/xml; charset=UTF-8',
          'Cache-Control': 'public, max-age=1800',
          'Access-Control-Allow-Origin': '*',
        });
        res.send(finalContent);
        console.log('Served modified EPG successfully');
      } finally {
        // Clean up temp files
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      console.error('Error serving EPG:', error);
      res.status(404).send(
        'EPG file not found. The system may still be generating the initial EPG data. Please check back in a few moments.'
      );
    }
  }

  private async serveStatus(_req: Request, res: Response) {
    const epgPath = path.join(this.config.output.directory, this.config.output.filename);

    let fileExists = false;
    let fileSize = 0;
    let lastModified: string | null = null;

    try {
      const stats = await fs.stat(epgPath);
      fileExists = true;
      fileSize = stats.size;
      lastModified = stats.mtime.toISOString();
    } catch {
      // File doesn't exist yet
    }

    const status: ServerStatus = {
      server: 'running',
      epgFileExists: fileExists,
      epgFileSize: fileSize,
      epgLastModified: lastModified,
      hdhomerunHost: this.config.hdhomerun.host,
      updateSchedule: this.config.scheduler.cronSchedule,
      serverTime: new Date().toISOString(),
      lastUpdateStatus: this.lastUpdateStatus,
      lastUpdateTime: this.lastUpdateTime,
    };

    res.set({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });

    res.json(status);
  }

  private serveHealth(_req: Request, res: Response) {
    res.set('Content-Type', 'text/plain');
    res.send('OK');
  }

  private async serveIcon(_req: Request, res: Response) {
    try {
      const iconPath = path.join(process.cwd(), 'icon.png');
      await fs.access(iconPath);
      res.set('Content-Type', 'image/png');
      res.sendFile(iconPath);
    } catch {
      res.status(404).send('Icon not found');
    }
  }

  private triggerUpdate(_req: Request, res: Response) {
    // This will be implemented in the orchestrator
    res.status(501).json({
      error: 'Manual update trigger not yet implemented',
      message: 'This endpoint will trigger an EPG update when implemented',
    });
  }

  private serveRoot(_req: Request, res: Response) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>HDHomeRun EPG Server</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
      background: #f5f5f5;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 2px solid #4CAF50;
      padding-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    h1 img {
      width: 144px;
      height: 144px;
    }
    .endpoint {
      background: #f9f9f9;
      padding: 15px;
      margin: 15px 0;
      border-left: 4px solid #4CAF50;
      border-radius: 5px;
    }
    .endpoint h3 {
      margin-top: 0;
      color: #4CAF50;
    }
    .endpoint a {
      color: #2196F3;
      text-decoration: none;
      font-family: monospace;
      font-size: 14px;
    }
    .endpoint a:hover {
      text-decoration: underline;
    }
    .status {
      margin-top: 20px;
      padding: 15px;
      background: #e8f5e9;
      border-radius: 5px;
    }
    .description {
      color: #666;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1><img src="/icon.png" alt="HDHomeRun EPG Icon"> HDHomeRun2EPG</h1>
    <p>Electronic Program Guide (EPG) to XMLTV converter</p>

    <div class="endpoint">
      <h3>EPG Data</h3>
      <a href="/epg.xml" target="_blank">/epg.xml</a> - Standard format<br>
      <a href="/epg.xml?dummy=1hr" target="_blank">/epg.xml?dummy=1hr</a> - With 1-hour dummy blocks<br>
      <a href="/epg.xml?dummy=30min" target="_blank">/epg.xml?dummy=30min</a> - With 30-minute dummy blocks<br>
      <a href="/epg.xml?days=3" target="_blank">/epg.xml?days=3</a> - Limited to 3 days<br>
      <a href="/epg.xml?dummy=1hr&days=3" target="_blank">/epg.xml?dummy=1hr&days=3</a> - Combined<br>
      <a href="/xmltv.xml" target="_blank">/xmltv.xml</a> (alias)<br>
      <a href="/guide.xml" target="_blank">/guide.xml</a> (alias)
      <p class="description">
        XMLTV formatted EPG data for Plex, Jellyfin, Emby<br>
        <strong>Parameters:</strong><br>
        • dummy=30min|1hr|2hr|3hr|6hr (fills channels with no EPG)<br>
        • days=1-7 (limits EPG duration, streaming efficient)<br>
        <em>Note: Memory-efficient streaming for all block durations</em>
      </p>
    </div>

    <div class="endpoint">
      <h3>Server Status</h3>
      <a href="/status" target="_blank">/status</a>
      <p class="description">JSON with current server status and last update time</p>
    </div>

    <div class="endpoint">
      <h3>Health Check</h3>
      <a href="/health" target="_blank">/health</a>
      <p class="description">Simple health check endpoint for monitoring</p>
    </div>

    <div class="status">
      <strong>Configuration:</strong><br>
      • HDHomeRun Host: ${this.config.hdhomerun.host}<br>
      • Update Schedule: ${this.config.scheduler.cronSchedule}<br>
      • Port: ${this.config.server.port}
    </div>
  </div>
</body>
</html>`;

    res.set('Content-Type', 'text/html');
    res.send(html);
  }

  updateStatus(status: string, time: string) {
    this.lastUpdateStatus = status;
    this.lastUpdateTime = time;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.config.server.port, () => {
        console.log(`EPG HTTP Server started on port ${this.config.server.port}`);
        console.log(`Access EPG at: http://localhost:${this.config.server.port}/epg.xml`);
        console.log(`Status page: http://localhost:${this.config.server.port}/`);
        resolve();
      });
    });
  }
}
