// this will make sure its safe: blocking local files and private IPs

// checking if host is a local machine or private network address
export function isPrivateOrLocalHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return true;

  const host = hostname.trim().toLowerCase();

  // blocking localhost and loopback names
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  ) {
    return true;
  }

  // blocking internal domain suffixes
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return true;
  }

  // checking ipv4 octets against private ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const o1 = parseInt(ipv4Match[1], 10);
    const o2 = parseInt(ipv4Match[2], 10);
    const o3 = parseInt(ipv4Match[3], 10);
    const o4 = parseInt(ipv4Match[4], 10);

    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return true;

    // 127.0.0.0/8 (loopback)
    if (o1 === 127) return true;

    // 10.0.0.0/8 (private network)
    if (o1 === 10) return true;

    // 172.16.0.0/12 (private network 172.16 - 172.31)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;

    // 192.168.0.0/16 (private network)
    if (o1 === 192 && o2 === 168) return true;

    // 169.254.0.0/16 (link-local and cloud metadata)
    if (o1 === 169 && o2 === 254) return true;

    // 0.0.0.0/8 (broadcast/this network)
    if (o1 === 0) return true;
  }

  return false;
}

// validating that a url only uses http, https, or ftp and does not target private IPs
export function validateSafeUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  const trimmed = urlString.trim();
  const lower = trimmed.toLowerCase();

  // this will make sure its safe: strictly reject local file schemes, drive letters, and relative/absolute filesystem paths
  if (
    lower.startsWith('file:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    trimmed.startsWith('.') ||
    /^[a-zA-Z]:/i.test(trimmed)
  ) {
    throw new Error('Local file paths and file:// schemes are strictly prohibited');
  }

  // enforcing that connection url must be a valid absolute URI with http://, https://, or ftp://
  if (
    !lower.startsWith('http://') &&
    !lower.startsWith('https://') &&
    !lower.startsWith('ftp://')
  ) {
    throw new Error('URL must be a valid absolute URI starting strictly with http://, https://, or ftp://');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(`Invalid URL format: ${err.message}`);
  }

  // allow only http, https, and ftp protocols
  const allowed = ['http:', 'https:', 'ftp:'];
  if (!allowed.includes(parsed.protocol.toLowerCase())) {
    throw new Error(`Protocol '${parsed.protocol}' is not allowed. Only http://, https://, and ftp:// are supported.`);
  }

  // ensuring a valid hostname exists
  if (!parsed.hostname) {
    throw new Error('URL must contain a valid hostname');
  }

  // reject private or internal hostnames and IP addresses
  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error(`Access to private, localhost, or internal host '${parsed.hostname}' is blocked for security.`);
  }

  return true;
}
