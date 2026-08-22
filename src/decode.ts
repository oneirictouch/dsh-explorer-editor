/**
 * Text decoding for workspace files: UTF-8 when valid, otherwise GBK/GB2312
 * (common for Windows-generated logs/exports). The editor saves as UTF-8, so
 * opening a GBK file and saving it normalizes the file to UTF-8.
 */
export function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Full-ICU TextDecoder (Node ships it by default) supports 'gbk'.
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      // 'gbk' unavailable (non full-ICU build): last-resort single-byte decode.
      return new TextDecoder('latin1').decode(buf);
    }
  }
}
