/**
 * XML Validation
 * Ensures generated XML is well-formed before serving
 *
 * Critical lesson from Python version:
 * - NEVER write unvalidated XML
 * - Parse generated XML to verify well-formedness
 */

import { XMLParser } from 'fast-xml-parser';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate XML string is well-formed
 * Uses fast-xml-parser to attempt parsing
 */
export function validateXML(xmlString: string): ValidationResult {
  if (!xmlString || xmlString.trim().length === 0) {
    return {
      valid: false,
      error: 'XML string is empty',
    };
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
    });

    // Attempt to parse - will throw if malformed
    parser.parse(xmlString);

    // Additional checks
    if (!xmlString.includes('<tv')) {
      return {
        valid: false,
        error: 'Missing root <tv> element',
      };
    }

    if (!xmlString.includes('</tv>')) {
      return {
        valid: false,
        error: 'Missing closing </tv> tag',
      };
    }

    // Check for XML declaration
    if (!xmlString.trim().startsWith('<?xml')) {
      return {
        valid: false,
        error: 'Missing XML declaration',
      };
    }

    return {
      valid: true,
    };
  } catch (error) {
    return {
      valid: false,
      error: `XML parsing failed: ${error}`,
    };
  }
}

/**
 * Validate XMLTV structure
 * Checks for required elements
 */
export function validateXMLTV(xmlString: string): ValidationResult {
  // First check if well-formed
  const basicValidation = validateXML(xmlString);
  if (!basicValidation.valid) {
    return basicValidation;
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
    });

    const parsed = parser.parse(xmlString);

    // Check for tv root element
    if (!parsed.tv) {
      return {
        valid: false,
        error: 'Missing <tv> root element',
      };
    }

    // Check for at least one channel
    if (!parsed.tv.channel) {
      return {
        valid: false,
        error: 'No channels found in XMLTV',
      };
    }

    // Check for at least one programme
    if (!parsed.tv.programme) {
      return {
        valid: false,
        error: 'No programmes found in XMLTV',
      };
    }

    return {
      valid: true,
    };
  } catch (error) {
    return {
      valid: false,
      error: `XMLTV validation failed: ${error}`,
    };
  }
}
