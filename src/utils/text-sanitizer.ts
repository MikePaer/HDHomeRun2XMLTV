/**
 * Text Sanitization Utilities
 * Ensures text is safe for XML inclusion
 *
 * Lessons from Python version:
 * - clean_text() only removed Unicode category "C" - insufficient
 * - Missing null bytes, XML entities, certain Unicode ranges
 * - Use whitelist approach instead of blacklist
 */

/**
 * Sanitize text for XML
 * - Remove control characters (except tab, newline, carriage return)
 * - Remove null bytes
 * - Normalize Unicode
 * - XML entities are handled by fast-xml-parser automatically
 */
export function sanitizeText(text: string): string {
  if (!text) {
    return '';
  }

  // Normalize Unicode to NFC form for consistency
  let sanitized = text.normalize('NFC');

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove control characters except tab (0x09), LF (0x0A), CR (0x0D)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Clean program description text
 * Removes feature tags and episode info that HDHomeRun sometimes includes
 * Based on Python version's clean_text() function
 */
export function cleanDescription(text: string): string {
  if (!text) {
    return '';
  }

  let cleaned = sanitizeText(text);

  // Remove feature tags: [S], [S,SL], [AD], [HD], etc.
  cleaned = cleaned.replace(/\[[A-Z,]+\]/g, '');

  // Remove season/episode information embedded in descriptions
  // Patterns: "S1 Ep3", "Ep4", "S01E05", etc.
  cleaned = cleaned.replace(/\(?[SE]?\d+\s?Ep\s?\d+[\d/]*\)?/gi, '');

  // Clean up any double spaces created by removals
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return cleaned.trim();
}

/**
 * Parse episode number from HDHomeRun format (e.g., "S01E05")
 * Returns xmltv_ns format: "season.episode.part"
 * xmltv_ns uses 0-based indexing
 */
export function parseEpisodeNumber(episodeNumber: string): {
  xmltvNs: string;
  onscreen: string;
} | null {
  if (!episodeNumber) {
    return null;
  }

  // Match patterns like "S01E05", "S1E5", etc.
  const match = episodeNumber.match(/S(\d+)E(\d+)/i);

  if (!match) {
    return null;
  }

  const season = parseInt(match[1], 10);
  const episode = parseInt(match[2], 10);

  // xmltv_ns uses 0-based indexing
  const xmltvNs = `${season - 1}.${episode - 1}.0`;
  const onscreen = episodeNumber.toUpperCase();

  return { xmltvNs, onscreen };
}

/**
 * Check if an episode is "new" (aired yesterday or later)
 * Based on Python version's is_new_episode() function
 */
export function isNewEpisode(originalAirdate: number | undefined): boolean {
  if (!originalAirdate) {
    return false;
  }

  const yesterdayMs = Date.now() - 86400000; // 24 hours in milliseconds
  const airdateMs = originalAirdate * 1000; // Convert Unix timestamp to ms

  return airdateMs >= yesterdayMs;
}
