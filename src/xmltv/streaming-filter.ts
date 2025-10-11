/**
 * Streaming EPG Filter
 * Filters programmes by date range using streams
 */

import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

export interface FilterOptions {
  days?: number;
}

/**
 * Filter EPG programmes by days using streaming
 * Only includes programmes that start within the specified number of days
 */
export async function streamFilterEPG(
  inputPath: string,
  outputPath: string,
  options: FilterOptions
): Promise<void> {
  if (!options.days) {
    // No filtering needed, just copy
    const { copyFile } = await import('fs/promises');
    await copyFile(inputPath, outputPath);
    return;
  }

  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() + options.days);
  const cutoffTimestamp = cutoffDate.getTime();

  let buffer = '';
  let insideProgramme = false;
  let currentProgramme = '';
  let programmeStart = '';

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      const data = chunk.toString();
      buffer += data;

      let output = '';
      let pos = 0;

      while (true) {
        if (!insideProgramme) {
          // Look for start of programme tag
          const programmeStartIdx = buffer.indexOf('<programme', pos);
          if (programmeStartIdx === -1) {
            // No more programme tags in buffer, output everything before position
            if (pos < buffer.length - 1000) {
              output += buffer.slice(0, -1000);
              buffer = buffer.slice(-1000);
            }
            break;
          }

          // Output everything before the programme tag
          output += buffer.slice(pos, programmeStartIdx);
          insideProgramme = true;
          currentProgramme = '';
          programmeStart = '';
          pos = programmeStartIdx;
        }

        // Find end of opening tag to extract start time
        const openTagEnd = buffer.indexOf('>', pos);
        if (openTagEnd === -1) {
          // Need more data
          break;
        }

        // Extract start attribute if we don't have it yet
        if (!programmeStart) {
          const openTag = buffer.slice(pos, openTagEnd + 1);
          const startMatch = openTag.match(/start="([^"]+)"/);
          if (startMatch) {
            programmeStart = startMatch[1];
          }
        }

        // Look for end of programme tag
        const programmeEndIdx = buffer.indexOf('</programme>', pos);
        if (programmeEndIdx === -1) {
          // Need more data
          break;
        }

        // Found complete programme
        currentProgramme = buffer.slice(pos, programmeEndIdx + 12); // +12 for '</programme>'
        pos = programmeEndIdx + 12;
        insideProgramme = false;

        // Filter by date
        if (programmeStart) {
          // Parse XMLTV timestamp (YYYYMMDDHHmmss +ZZZZ)
          const year = parseInt(programmeStart.slice(0, 4));
          const month = parseInt(programmeStart.slice(4, 6)) - 1;
          const day = parseInt(programmeStart.slice(6, 8));
          const hours = parseInt(programmeStart.slice(8, 10));
          const minutes = parseInt(programmeStart.slice(10, 12));
          const seconds = parseInt(programmeStart.slice(12, 14));

          const programmeDate = new Date(year, month, day, hours, minutes, seconds);

          if (programmeDate.getTime() < cutoffTimestamp) {
            output += currentProgramme;
          }
        } else {
          // No start time, keep it
          output += currentProgramme;
        }

        currentProgramme = '';
        programmeStart = '';
      }

      // Output accumulated data
      if (output) {
        this.push(output);
      }

      // Keep unprocessed data in buffer
      buffer = buffer.slice(pos);
      callback();
    },
    flush(callback) {
      // Output remaining buffer
      if (buffer) {
        this.push(buffer);
      }
      callback();
    },
  });

  const writeStream = createWriteStream(outputPath, { encoding: 'utf-8' });
  await pipeline(createReadStream(inputPath, { encoding: 'utf-8' }), transform, writeStream);
}
