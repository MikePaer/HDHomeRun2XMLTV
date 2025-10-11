/**
 * Streaming Dummy Programming Generator
 * Memory-efficient implementation using streams
 */

import { XMLParser } from 'fast-xml-parser';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import axios from 'axios';

export interface StreamingDummyOptions {
  duration: string;
  title?: string;
  description?: string;
  daysFilter?: number; // Optional days limit
}

interface LineupItem {
  GuideNumber: string;
  GuideName: string;
}

interface ChannelInfo {
  id: string;
  name: string;
}

/**
 * Parse duration string to hours
 */
function parseDuration(durationStr: string): number {
  let hours = 1.0;
  const normalized = durationStr.toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return 1.0;
  }

  const match = normalized.match(/(\d+(?:\.\d+)?)(hr|hour|hours|min|mins|minutes?)?/);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2] || 'hr';
    hours = unit.startsWith('min') ? value / 60.0 : value;
    hours = Math.max(0.5, Math.min(12, hours));
  }

  return hours;
}

/**
 * Format XMLTV timestamp
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMinutes = String(Math.abs(tzOffset) % 60).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds} ${tzSign}${tzHours}${tzMinutes}`;
}

/**
 * Escape XML
 */
function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate dummy programmes as streaming chunks
 */
function* generateDummyProgrammes(
  channel: ChannelInfo,
  durationHours: number,
  title: string,
  descTemplate: string,
  days: number
): Generator<string> {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);

  let currentTime = new Date(startDate);
  const description = descTemplate.replace('{channel}', channel.name);

  while (currentTime < endDate) {
    const nextTime = new Date(currentTime);
    nextTime.setHours(nextTime.getHours() + durationHours);

    yield `  <programme channel="${escapeXML(channel.id)}" start="${formatTimestamp(currentTime)}" stop="${formatTimestamp(nextTime)}">
    <title lang="en">${escapeXML(title)}</title>
    <desc lang="en">${escapeXML(description)}</desc>
  </programme>\n`;

    currentTime = nextTime;
  }
}

/**
 * Stream dummy programming to output file
 */
export async function streamDummyProgramming(
  inputPath: string,
  outputPath: string,
  options: StreamingDummyOptions,
  hdhomerunHost: string
): Promise<{ channelsAdded: number; dummyChannels: number }> {
  const durationHours = parseDuration(options.duration);
  const title = options.title || 'No Information';
  const descTemplate = options.description || 'No program information is currently available for {channel}.';
  const days = options.daysFilter || 7;

  // Parse input XML to identify channels needing dummy programming
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
  });

  const inputContent = await (await import('fs/promises')).readFile(inputPath, 'utf-8');
  const parsed = parser.parse(inputContent) as any;

  // Fetch lineup
  let lineup: LineupItem[] = [];
  try {
    const response = await axios.get<LineupItem[]>(`http://${hdhomerunHost}/lineup.json`, { timeout: 5000 });
    lineup = response.data;
  } catch {
    // Continue without lineup
  }

  // Identify channels
  const channels = Array.isArray(parsed.tv.channel) ? parsed.tv.channel : [parsed.tv.channel].filter(Boolean);
  const programmes = Array.isArray(parsed.tv.programme) ? parsed.tv.programme : [parsed.tv.programme].filter(Boolean);

  const channelsWithPrograms = new Set(programmes.map((p: any) => p['@_channel']).filter(Boolean));
  const existingChannels = new Set(channels.map((c: any) => c['@_id']).filter(Boolean));

  const missingChannels: ChannelInfo[] = [];
  const channelsNeedingDummy: ChannelInfo[] = [];

  // Find missing channels
  for (const item of lineup) {
    if (item.GuideNumber && !existingChannels.has(item.GuideNumber)) {
      missingChannels.push({ id: item.GuideNumber, name: item.GuideName });
    }
  }

  // Find channels without programmes
  for (const channel of channels) {
    if (channel['@_id'] && !channelsWithPrograms.has(channel['@_id'])) {
      const lineupItem = lineup.find((l) => l.GuideNumber === channel['@_id']);
      const displayName =
        typeof channel['display-name'] === 'string'
          ? channel['display-name']
          : channel['display-name']?.['#text'] || channel['@_id'];
      channelsNeedingDummy.push({ id: channel['@_id'], name: lineupItem?.GuideName || displayName });
    }
  }

  if (missingChannels.length === 0 && channelsNeedingDummy.length === 0) {
    // No changes needed, just copy file
    await (await import('fs/promises')).copyFile(inputPath, outputPath);
    return { channelsAdded: 0, dummyChannels: 0 };
  }

  // Stream processing
  const writeStream = createWriteStream(outputPath, { encoding: 'utf-8' });
  let insideClosingTag = false;
  let buffer = '';

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      const data = chunk.toString();
      buffer += data;

      // Check if we've hit the closing </tv> tag
      if (buffer.includes('</tv>') && !insideClosingTag) {
        insideClosingTag = true;
        const parts = buffer.split('</tv>');

        // Write everything before </tv>
        this.push(parts[0]);

        // Add new channel definitions if needed
        if (missingChannels.length > 0) {
          for (const channel of missingChannels) {
            this.push(`  <channel id="${escapeXML(channel.id)}">\n`);
            this.push(`    <display-name lang="en">${escapeXML(channel.name)}</display-name>\n`);
            this.push(`  </channel>\n`);
          }
        }

        // Add dummy programmes
        const allChannelsNeedingDummy = [...channelsNeedingDummy, ...missingChannels];
        for (const channel of allChannelsNeedingDummy) {
          for (const programme of generateDummyProgrammes(channel, durationHours, title, descTemplate, days)) {
            this.push(programme);
          }
        }

        // Write closing tag
        this.push('</tv>');
        this.push(parts[1] || '');
        buffer = '';
      } else if (!insideClosingTag) {
        // Haven't found </tv> yet, keep most of buffer but output earlier parts
        if (buffer.length > 10000) {
          const output = buffer.slice(0, -1000);
          this.push(output);
          buffer = buffer.slice(-1000);
        }
      }

      callback();
    },
    flush(callback) {
      if (buffer && !insideClosingTag) {
        this.push(buffer);
      }
      callback();
    },
  });

  await pipeline(createReadStream(inputPath, { encoding: 'utf-8' }), transform, writeStream);

  const durationStr = durationHours >= 1 ? `${durationHours.toFixed(1)} hour` : `${Math.round(durationHours * 60)} minute`;
  console.log(
    `Added ${missingChannels.length} channel definitions and ${durationStr} dummy programming for ${missingChannels.length + channelsNeedingDummy.length} channels`
  );

  return {
    channelsAdded: missingChannels.length,
    dummyChannels: missingChannels.length + channelsNeedingDummy.length,
  };
}
