/**
 * HDHomeRun API Client
 * Handles all communication with HDHomeRun device and cloud API
 */

import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import type {
  DeviceDiscovery,
  ChannelLineupItem,
  EPGResponse,
} from '../types/hdhomerun';

export class HDHomeRunClient {
  private readonly host: string;
  private readonly axiosInstance: AxiosInstance;
  private deviceAuth: string | null = null;

  constructor(host: string) {
    this.host = host;

    // Create axios instance with retry logic
    this.axiosInstance = axios.create({
      timeout: 30000, // 30 second timeout
    });

    // Configure retry logic - exponential backoff
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        // Retry on network errors and 5xx errors
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (error.response?.status ?? 0) >= 500
        );
      },
      onRetry: (retryCount, error) => {
        console.log(`Retry attempt ${retryCount} for ${error.config?.url}`);
      },
    });
  }

  /**
   * Fetch DeviceAuth token from HDHomeRun device
   * Token expires after 8 hours, should be refreshed before each EPG generation
   */
  async fetchDeviceAuth(): Promise<string> {
    const url = `http://${this.host}/discover.json`;
    console.log(`Fetching DeviceAuth from ${url}`);

    try {
      const response = await this.axiosInstance.get<DeviceDiscovery>(url);

      if (!response.data.DeviceAuth) {
        throw new Error('DeviceAuth not found in response');
      }

      this.deviceAuth = response.data.DeviceAuth;
      console.log('DeviceAuth obtained successfully');
      return this.deviceAuth;
    } catch (error) {
      console.error('Failed to fetch DeviceAuth:', error);
      throw new Error(`Failed to fetch DeviceAuth from ${url}: ${error}`);
    }
  }

  /**
   * Fetch channel lineup from HDHomeRun device
   */
  async fetchLineup(): Promise<ChannelLineupItem[]> {
    const url = `http://${this.host}/lineup.json`;
    console.log(`Fetching lineup from ${url}`);

    try {
      const response = await this.axiosInstance.get<ChannelLineupItem[]>(url);
      console.log(`Fetched ${response.data.length} channels from lineup`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch lineup:', error);
      throw new Error(`Failed to fetch lineup from ${url}: ${error}`);
    }
  }

  /**
   * Fetch EPG data from HDHomeRun cloud API
   * Fetches data in time-windowed chunks to get complete 7-day guide
   */
  async fetchEPGData(days: number, hoursIncrement: number): Promise<EPGResponse> {
    if (!this.deviceAuth) {
      await this.fetchDeviceAuth();
    }

    const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp
    const maxTimestamp = now + days * 86400; // 86400 seconds = 1 day
    const timestampIncrementHrs = (86400 / 24) * hoursIncrement;

    // Fetch initial EPG data (from now)
    console.log('Fetching initial EPG data...');
    const baseGuide = await this.fetchEPGChunk(this.deviceAuth!);

    let nextTimestamp = now + timestampIncrementHrs;
    let chunkCount = 1;

    // Loop to fetch subsequent time windows
    while (nextTimestamp <= maxTimestamp) {
      console.log(
        `Fetching EPG chunk ${++chunkCount} (timestamp: ${new Date(nextTimestamp * 1000).toISOString()})`
      );

      const chunkData = await this.fetchEPGChunk(this.deviceAuth!, nextTimestamp);

      if (!chunkData || chunkData.length === 0) {
        console.log('No more EPG data available, stopping fetch');
        break;
      }

      // Merge chunk data into base guide (deduplicate by StartTime)
      this.mergeEPGData(baseGuide, chunkData);

      nextTimestamp += timestampIncrementHrs;
    }

    console.log(`EPG fetch complete. Retrieved ${chunkCount} chunks.`);
    return baseGuide;
  }

  /**
   * Fetch a single EPG chunk from the HDHomeRun cloud API
   */
  private async fetchEPGChunk(
    deviceAuth: string,
    startTimestamp?: number
  ): Promise<EPGResponse> {
    const baseUrl = 'https://api.hdhomerun.com/api/guide';
    const params = new URLSearchParams({
      DeviceAuth: deviceAuth,
      SynopsisLength: '160',
    });

    if (startTimestamp) {
      params.append('Start', startTimestamp.toString());
    }

    const url = `${baseUrl}?${params.toString()}`;

    const headers = {
      'Cache-Control': 'no-cache',
      'Content-Type': 'multipart/form-data',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; WebView/3.0) AppleWebKit/537.36',
    };

    const postData = {
      AppName: 'HDHomeRun',
      AppVersion: '20241007',
      DeviceAuth: deviceAuth,
      Platform: 'WINDOWS',
      PlatformInfo: { Vendor: 'Web' },
    };

    try {
      const response = await this.axiosInstance.post<EPGResponse>(url, postData, { headers });
      return response.data;
    } catch (error) {
      // Handle 403 errors by refreshing DeviceAuth
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        console.log('Got 403, DeviceAuth may be expired. Refreshing...');
        await this.fetchDeviceAuth();
        throw new Error('DeviceAuth expired, please retry operation');
      }

      console.error('Failed to fetch EPG chunk:', error);
      throw new Error(`Failed to fetch EPG data: ${error}`);
    }
  }

  /**
   * Merge new EPG data into existing guide
   * Deduplicates programs by StartTime
   */
  private mergeEPGData(baseGuide: EPGResponse, newData: EPGResponse): void {
    for (const newChannel of newData) {
      // Find matching channel in base guide
      const baseChannel = baseGuide.find((ch) => ch.GuideNumber === newChannel.GuideNumber);

      if (baseChannel) {
        // Add new programs that don't already exist (by StartTime)
        for (const newProgram of newChannel.Guide) {
          const exists = baseChannel.Guide.some(
            (p) => p.StartTime === newProgram.StartTime
          );

          if (!exists) {
            baseChannel.Guide.push(newProgram);
          }
        }
      }
    }
  }
}
