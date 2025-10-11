/**
 * XMLTV Generator
 * Transforms HDHomeRun JSON data to XMLTV format
 */

import { XMLBuilder } from 'fast-xml-parser';
import type { EPGResponse, ChannelLineupItem } from '../types/hdhomerun';
import {
  sanitizeText,
  cleanDescription,
  parseEpisodeNumber,
  isNewEpisode,
} from '../utils/text-sanitizer';

interface XMLTVChannel {
  '@_id': string;
  'display-name': {
    '@_lang': string;
    '#text': string;
  };
  icon?: {
    '@_src': string;
  };
}

interface XMLTVProgramme {
  '@_channel': string;
  '@_start': string;
  '@_stop': string;
  title: {
    '@_lang': string;
    '#text': string;
  };
  desc?: {
    '@_lang': string;
    '#text': string;
  };
  'sub-title'?: {
    '@_lang': string;
    '#text': string;
  };
  icon?: {
    '@_src': string;
  };
  'episode-num'?: Array<{
    '@_system': string;
    '#text': string;
  }>;
  category?: Array<{
    '@_lang': string;
    '#text': string;
  }>;
  new?: string;
  'previously-shown'?: {
    '@_start'?: string;
  };
}

export class XMLTVGenerator {
  /**
   * Generate XMLTV XML from HDHomeRun EPG data
   */
  generate(
    epgData: EPGResponse,
    lineup: ChannelLineupItem[],
    deviceUrl: string
  ): string {
    const channels: XMLTVChannel[] = [];
    const programmes: XMLTVProgramme[] = [];

    // Build channels
    for (const channelData of epgData) {
      // Get channel name from lineup (more accurate than guide data)
      const lineupChannel = lineup.find(
        (l) => l.GuideNumber === channelData.GuideNumber
      );
      const channelName = lineupChannel?.GuideName || channelData.GuideName;

      const channel: XMLTVChannel = {
        '@_id': channelData.GuideNumber,
        'display-name': {
          '@_lang': 'en',
          '#text': sanitizeText(channelName),
        },
      };

      if (channelData.ImageURL) {
        channel.icon = {
          '@_src': channelData.ImageURL,
        };
      }

      channels.push(channel);

      // Build programmes for this channel
      for (const program of channelData.Guide) {
        const programme = this.buildProgramme(program, channelData.GuideNumber);
        programmes.push(programme);
      }
    }

    // Build XML structure
    const xmlObj = {
      '?xml': {
        '@_version': '1.0',
        '@_encoding': 'UTF-8',
      },
      tv: {
        '@_generator-info-name': 'HDHomeRun',
        '@_generator-info-url': deviceUrl,
        channel: channels,
        programme: programmes,
      },
    };

    // Generate XML
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: '  ',
      suppressEmptyNode: true,
    });

    return builder.build(xmlObj);
  }

  /**
   * Build a single programme element
   */
  private buildProgramme(program: EPGResponse[0]['Guide'][0], channelId: string): XMLTVProgramme {
    // Format timestamps in XMLTV format: YYYYMMDDHHmmss +ZZZZ
    const startTime = this.formatTimestamp(program.StartTime);
    const stopTime = this.formatTimestamp(program.EndTime);

    const programme: XMLTVProgramme = {
      '@_channel': channelId,
      '@_start': startTime,
      '@_stop': stopTime,
      title: {
        '@_lang': 'en',
        '#text': sanitizeText(program.Title),
      },
    };

    // Add description if present
    if (program.Synopsis) {
      programme.desc = {
        '@_lang': 'en',
        '#text': cleanDescription(program.Synopsis),
      };
    }

    // Add episode title if present
    if (program.EpisodeTitle) {
      programme['sub-title'] = {
        '@_lang': 'en',
        '#text': sanitizeText(program.EpisodeTitle),
      };
    }

    // Add icon if present
    if (program.ImageURL) {
      programme.icon = {
        '@_src': program.ImageURL,
      };
    }

    // Add episode numbers if present
    if (program.EpisodeNumber) {
      const episodeInfo = parseEpisodeNumber(program.EpisodeNumber);

      if (episodeInfo) {
        programme['episode-num'] = [
          {
            '@_system': 'xmltv_ns',
            '#text': episodeInfo.xmltvNs,
          },
          {
            '@_system': 'onscreen',
            '#text': episodeInfo.onscreen,
          },
        ];

        // Determine if new or previously-shown
        if (program.OriginalAirdate) {
          if (isNewEpisode(program.OriginalAirdate)) {
            programme.new = '';
          } else {
            const airDate = this.formatTimestamp(program.OriginalAirdate);
            programme['previously-shown'] = {
              '@_start': airDate.split(' ')[0], // Just the date part
            };
          }
        } else {
          // No original air date - assume previously shown
          programme['previously-shown'] = {};
        }
      }
    }

    // Add categories if present
    if (program.Filter && program.Filter.length > 0) {
      programme.category = program.Filter.map((cat) => ({
        '@_lang': 'en',
        '#text': sanitizeText(cat),
      }));
    }

    return programme;
  }

  /**
   * Format Unix timestamp to XMLTV format
   * XMLTV format: YYYYMMDDHHmmss +ZZZZ
   * Example: 20250915143000 -0500
   */
  private formatTimestamp(unixTimestamp: number): string {
    const date = new Date(unixTimestamp * 1000);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // Get timezone offset
    const tzOffset = -date.getTimezoneOffset(); // Minutes
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
    const tzMinutes = String(Math.abs(tzOffset) % 60).padStart(2, '0');
    const timezone = `${tzSign}${tzHours}${tzMinutes}`;

    return `${year}${month}${day}${hours}${minutes}${seconds} ${timezone}`;
  }
}
