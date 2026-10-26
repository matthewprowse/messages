// Graph names time zones the Windows way ("South Africa Standard Time") unless asked otherwise. This turns
// one into the IANA name Intl understands, from the Unicode CLDR table (each zone's main territory). Only the
// zones people are likely to have are listed; an IANA name passes through, and anything else is unknown.

const WINDOWS_TO_IANA: Record<string, string> = {
  "utc": "UTC",
  "coordinated universal time": "UTC",
  "tzone://microsoft/utc": "UTC",
  // Africa
  "south africa standard time": "Africa/Johannesburg",
  "namibia standard time": "Africa/Windhoek",
  "e. africa standard time": "Africa/Nairobi",
  "w. central africa standard time": "Africa/Lagos",
  "egypt standard time": "Africa/Cairo",
  "morocco standard time": "Africa/Casablanca",
  "mauritius standard time": "Indian/Mauritius",
  "sudan standard time": "Africa/Khartoum",
  "libya standard time": "Africa/Tripoli",
  // Europe
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "e. europe standard time": "Europe/Chisinau",
  "fle standard time": "Europe/Kiev",
  "gtb standard time": "Europe/Bucharest",
  "turkey standard time": "Europe/Istanbul",
  "russian standard time": "Europe/Moscow",
  // Middle East and Asia
  "israel standard time": "Asia/Jerusalem",
  "arab standard time": "Asia/Riyadh",
  "arabian standard time": "Asia/Dubai",
  "iran standard time": "Asia/Tehran",
  "pakistan standard time": "Asia/Karachi",
  "india standard time": "Asia/Calcutta",
  "sri lanka standard time": "Asia/Colombo",
  "bangladesh standard time": "Asia/Dhaka",
  "se asia standard time": "Asia/Bangkok",
  "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore",
  "taipei standard time": "Asia/Taipei",
  "tokyo standard time": "Asia/Tokyo",
  "korea standard time": "Asia/Seoul",
  // Oceania
  "w. australia standard time": "Australia/Perth",
  "aus central standard time": "Australia/Darwin",
  "cen. australia standard time": "Australia/Adelaide",
  "e. australia standard time": "Australia/Brisbane",
  "aus eastern standard time": "Australia/Sydney",
  "tasmania standard time": "Australia/Hobart",
  "new zealand standard time": "Pacific/Auckland",
  // The Americas
  "hawaiian standard time": "Pacific/Honolulu",
  "alaskan standard time": "America/Anchorage",
  "pacific standard time": "America/Los_Angeles",
  "us mountain standard time": "America/Phoenix",
  "mountain standard time": "America/Denver",
  "central standard time": "America/Chicago",
  "eastern standard time": "America/New_York",
  "atlantic standard time": "America/Halifax",
  "newfoundland standard time": "America/St_Johns",
  "sa pacific standard time": "America/Bogota",
  "pacific sa standard time": "America/Santiago",
  "e. south america standard time": "America/Sao_Paulo",
  "argentina standard time": "America/Buenos_Aires",
  "central standard time (mexico)": "America/Mexico_City",
};

/** Whether this runtime knows an IANA zone. */
function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The IANA zone for a Windows or IANA time zone name, or null when it is not one this knows. */
export function ianaZone(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const mapped = WINDOWS_TO_IANA[trimmed.toLowerCase()];
  if (mapped) return mapped;
  return trimmed.includes("/") && knownZone(trimmed) ? trimmed : null;
}
