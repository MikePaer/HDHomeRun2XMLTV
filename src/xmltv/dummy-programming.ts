/**
 * Dummy Programming Generator
 * Fills channels without EPG data with placeholder programs
 * Uses string manipulation for memory efficiency
 */

import { XMLParser } from 'fast-xml-parser';
import axios from 'axios';

export interface DummyProgrammingOptions {
  duration: string; // e.g., "30min", "1hr", "2hr"
  title?: string;
  description?: string;
}

interface Channel {
  '@_id': string;
  'display-name': string | { '#text': string; '@_lang': string };
}

interface Programme {
  '@_channel': string;
}

interface LineupItem {
  GuideNumber: string;
  GuideName: string;
  URL?: string;
}

interface TVRoot {
  tv: {
    channel: Channel | Channel[];
    programme: Programme | Programme[];
  };
}

/**
 * Parse duration string to hours
 * Examples: "30min", "1hr", "2hr", "90min"
 */
export function parseDuration(durationStr: string): number {
  let hours = 1.0;

  const normalized = durationStr.toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return 1.0;
  }

  const match = normalized.match(/(\d+(?:\.\d+)?)(hr|hour|hours|min|mins|minutes?)?/);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2] || 'hr';

    if (unit.startsWith('min')) {
      hours = value / 60.0;
    } else {
      hours = value;
    }

    // Reasonable limits
    hours = Math.max(0.5, Math.min(12, hours));
  }

  return hours;
}

/**
 * Format timestamp for XMLTV (YYYYMMDDHHmmss +ZZZZ)
 */
function formatXMLTVTimestamp(date: Date): string {
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
 * Escape XML special characters
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
 * Get channel name from lineup or use channel ID
 */
function getChannelName(channelId: string, lineup: LineupItem[]): string {
  const lineupItem = lineup.find((item) => item.GuideNumber === channelId);
  return lineupItem?.GuideName || channelId;
}

/**
 * Generate dummy programme XML strings for a channel
 */
function generateDummyProgrammes(
  channelId: string,
  channelName: string,
  durationHours: number,
  title: string,
  descriptionTemplate: string
): string[] {
  const programmes: string[] = [];
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);

  let currentTime = new Date(startDate);
  const description = descriptionTemplate.replace('{channel}', channelName);

  while (currentTime < endDate) {
    const nextTime = new Date(currentTime);
    nextTime.setHours(nextTime.getHours() + durationHours);

    const programme = `  <programme channel="${escapeXML(channelId)}" start="${formatXMLTVTimestamp(currentTime)}" stop="${formatXMLTVTimestamp(nextTime)}">
    <title lang="en">${escapeXML(title)}</title>
    <desc lang="en">${escapeXML(description)}</desc>
  </programme>`;

    programmes.push(programme);
    currentTime = nextTime;
  }

  return programmes;
}

/**
 * Add dummy programming to XML content using efficient string manipulation
 * This approach avoids rebuilding the entire XML tree in memory
 */
export async function addDummyProgramming(
  xmlContent: string,
  options: DummyProgrammingOptions,
  hdhomerunHost: string
): Promise<string> {
  try {
    const durationHours = parseDuration(options.duration);
    const title = options.title || 'No Information';
    const descriptionTemplate = options.description || 'No program information is currently available for {channel}.';

    // Parse XML to identify channels needing dummy programming
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      parseTagValue: false,
    });

    const parsed = parser.parse(xmlContent) as TVRoot;

    if (!parsed.tv) {
      throw new Error('Invalid XMLTV structure');
    }

    // Fetch HDHomeRun lineup
    let lineup: LineupItem[] = [];
    try {
      const lineupUrl = `http://${hdhomerunHost}/lineup.json`;
      const response = await axios.get<LineupItem[]>(lineupUrl, { timeout: 5000 });
      lineup = response.data;
    } catch (error) {
      console.warn('Failed to fetch HDHomeRun lineup for dummy programming');
    }

    // Normalize to arrays
    const channels: Channel[] = Array.isArray(parsed.tv.channel)
      ? parsed.tv.channel
      : parsed.tv.channel
        ? [parsed.tv.channel]
        : [];

    const programmes: Programme[] = Array.isArray(parsed.tv.programme)
      ? parsed.tv.programme
      : parsed.tv.programme
        ? [parsed.tv.programme]
        : [];

    // Identify channels with and without programming
    const channelsWithPrograms = new Set<string>();
    for (const programme of programmes) {
      if (programme['@_channel']) {
        channelsWithPrograms.add(programme['@_channel']);
      }
    }

    const existingChannels = new Set<string>();
    for (const channel of channels) {
      if (channel['@_id']) {
        existingChannels.add(channel['@_id']);
      }
    }

    // Find channels needing dummy programming
    const missingChannels: LineupItem[] = [];
    const channelsNeedingDummy: string[] = [];

    for (const lineupItem of lineup) {
      const channelId = lineupItem.GuideNumber;
      if (channelId && !existingChannels.has(channelId)) {
        missingChannels.push(lineupItem);
      }
    }

    for (const channelId of existingChannels) {
      if (!channelsWithPrograms.has(channelId)) {
        channelsNeedingDummy.push(channelId);
      }
    }

    // If no changes needed, return original
    if (missingChannels.length === 0 && channelsNeedingDummy.length === 0) {
      console.log('No dummy programming needed - all channels have EPG data');
      return xmlContent;
    }

    // Build XML additions as strings (memory efficient)
    const newChannelXML: string[] = [];
    const newProgrammeXML: string[] = [];

    // Add missing channel definitions
    for (const lineupItem of missingChannels) {
      const channelXML = `  <channel id="${escapeXML(lineupItem.GuideNumber)}">
    <display-name lang="en">${escapeXML(lineupItem.GuideName)}</display-name>
  </channel>`;
      newChannelXML.push(channelXML);
    }

    // Generate dummy programmes for all channels without EPG
    const allChannelsNeedingDummy = [...channelsNeedingDummy, ...missingChannels.map((item) => item.GuideNumber)];

    for (const channelId of allChannelsNeedingDummy) {
      const channelName = getChannelName(channelId, lineup);
      const programmes = generateDummyProgrammes(channelId, channelName, durationHours, title, descriptionTemplate);
      newProgrammeXML.push(...programmes);
    }

    // Insert new content into existing XML
    let modifiedXML = xmlContent;

    // Insert new channels before first <programme> tag
    if (newChannelXML.length > 0) {
      const firstProgrammeIndex = modifiedXML.indexOf('<programme');
      if (firstProgrammeIndex !== -1) {
        modifiedXML =
          modifiedXML.slice(0, firstProgrammeIndex) +
          newChannelXML.join('\n') +
          '\n' +
          modifiedXML.slice(firstProgrammeIndex);
      }
    }

    // Append new programmes before closing </tv> tag
    if (newProgrammeXML.length > 0) {
      const closingTagIndex = modifiedXML.lastIndexOf('</tv>');
      if (closingTagIndex !== -1) {
        modifiedXML =
          modifiedXML.slice(0, closingTagIndex) + newProgrammeXML.join('\n') + '\n' + modifiedXML.slice(closingTagIndex);
      }
    }

    const durationStr =
      durationHours >= 1 ? `${durationHours.toFixed(1)} hour` : `${Math.round(durationHours * 60)} minute`;
    console.log(
      `Added ${missingChannels.length} channel definitions and ${durationStr} dummy programming for ${allChannelsNeedingDummy.length} channels`
    );

    return modifiedXML;
  } catch (error) {
    console.error('Error adding dummy programming:', error);
    // Return original content on error
    return xmlContent;
  }
}
