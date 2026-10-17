/** Letterbox an image into a square viewport (CSS object-fit: contain). */
export function coverArtContainRect(
  containerSize: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(containerSize / imageWidth, containerSize / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerSize - width) / 2,
    y: (containerSize - height) / 2,
    width,
    height,
  };
}
