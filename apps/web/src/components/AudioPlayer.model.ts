export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return minutes < 60
    ? `${minutes}:${rest}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`;
}

export function audioErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1:
      return '音频加载已中断，请重试。';
    case 2:
      return '音频暂时无法加载，请检查网络后重试。';
    case 3:
      return '音频无法解码，文件可能不完整。';
    case 4:
      return '音频不存在，或浏览器不支持此格式。';
    default:
      return '音频暂时无法播放，请重试。';
  }
}
