const toPositiveNumber = (value) => (
  Number.isFinite(value) && value > 0 ? value : 0
);

/**
 * Returns the rectangle produced by fitting a source video inside a container
 * with CSS object-fit: contain semantics.
 *
 * When either dimension is unavailable, the container is returned as a safe
 * fallback. The caller can use isFallback to wait for media metadata before
 * positioning geometry-sensitive overlays.
 */
export const getContainedVideoRect = ({
  containerWidth,
  containerHeight,
  videoWidth,
  videoHeight,
}) => {
  const safeContainerWidth = toPositiveNumber(containerWidth);
  const safeContainerHeight = toPositiveNumber(containerHeight);
  const safeVideoWidth = toPositiveNumber(videoWidth);
  const safeVideoHeight = toPositiveNumber(videoHeight);

  if (
    safeContainerWidth === 0
    || safeContainerHeight === 0
    || safeVideoWidth === 0
    || safeVideoHeight === 0
  ) {
    return {
      width: safeContainerWidth,
      height: safeContainerHeight,
      x: 0,
      y: 0,
      isFallback: true,
    };
  }

  const scale = Math.min(
    safeContainerWidth / safeVideoWidth,
    safeContainerHeight / safeVideoHeight,
  );
  const width = Math.min(safeContainerWidth, safeVideoWidth * scale);
  const height = Math.min(safeContainerHeight, safeVideoHeight * scale);

  return {
    width,
    height,
    x: Math.max(0, (safeContainerWidth - width) / 2),
    y: Math.max(0, (safeContainerHeight - height) / 2),
    isFallback: false,
  };
};
