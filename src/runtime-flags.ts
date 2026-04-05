export function isPostingPaused(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.POSTING_PAUSED || '').toLowerCase());
}
