const toPositiveNumber = (value) => (
  Number.isFinite(value) && value > 0 ? value : 0
);

const toFiniteNumber = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : null
);

const getRectEdge = (rect, primary, fallback) => {
  const value = toFiniteNumber(rect?.[primary]);
  if (value !== null) return value;

  const alternate = toFiniteNumber(rect?.[fallback]);
  return alternate;
};

const getRectDimensions = (rect) => {
  const width = toPositiveNumber(toFiniteNumber(rect?.width));
  const height = toPositiveNumber(toFiniteNumber(rect?.height));

  if (width === 0 || height === 0) return null;

  const left = getRectEdge(rect, 'left', 'x');
  const top = getRectEdge(rect, 'top', 'y');
  const right = getRectEdge(rect, 'right', null) ?? left + width;
  const bottom = getRectEdge(rect, 'bottom', null) ?? top + height;

  if (
    left === null
    || top === null
    || right === null
    || bottom === null
    || !Number.isFinite(right - left)
    || !Number.isFinite(bottom - top)
  ) {
    return null;
  }

  return { left, top, right, bottom, width, height };
};

const clampUnit = (value) => Math.min(1, Math.max(0, value));

/**
 * Normalizes a child DOM rectangle against its visible stage.
 *
 * The returned region is the intersection with the stage, so callers never
 * receive coordinates outside the [0, 1] normalized source frame.
 */
export const normalizeChildRectWithinStage = ({ stageRect, childRect } = {}) => {
  const stage = getRectDimensions(stageRect);
  const child = getRectDimensions(childRect);

  if (!stage || !child) return null;

  const left = Math.max(stage.left, child.left);
  const top = Math.max(stage.top, child.top);
  const right = Math.min(stage.right, child.right);
  const bottom = Math.min(stage.bottom, child.bottom);

  if (right <= left || bottom <= top) return null;

  const region = {
    x: (left - stage.left) / stage.width,
    y: (top - stage.top) / stage.height,
    width: (right - left) / stage.width,
    height: (bottom - top) / stage.height,
  };

  if (Object.values(region).some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: clampUnit(region.x),
    y: clampUnit(region.y),
    width: clampUnit(region.width),
    height: clampUnit(region.height),
  };
};

export const normalizeRectWithinStage = normalizeChildRectWithinStage;

/**
 * Adds padding relative to the measured ROI dimensions and clamps it to the
 * normalized source frame. The default is 5% of each ROI dimension per side.
 */
export const expandNormalizedRoi = (region, paddingRatio = 0.05) => {
  const normalized = normalizeRegion(region);
  const safePaddingRatio = Number(paddingRatio);

  if (
    !normalized
    || !Number.isFinite(safePaddingRatio)
    || safePaddingRatio < 0
  ) {
    return null;
  }

  const paddingX = normalized.width * safePaddingRatio;
  const paddingY = normalized.height * safePaddingRatio;
  const left = clampUnit(normalized.x - paddingX);
  const top = clampUnit(normalized.y - paddingY);
  const right = clampUnit(normalized.x + normalized.width + paddingX);
  const bottom = clampUnit(normalized.y + normalized.height + paddingY);

  if (right <= left || bottom <= top) return null;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

export const padNormalizedRoi = expandNormalizedRoi;

/**
 * Maps a normalized region to an intrinsic video source rectangle.
 */
export const mapNormalizedRegionToSource = (
  region,
  sourceWidth,
  sourceHeight,
) => {
  const normalized = normalizeRegion(region);
  const width = toPositiveNumber(Number(sourceWidth));
  const height = toPositiveNumber(Number(sourceHeight));

  if (!normalized || width === 0 || height === 0) return null;

  const left = Math.max(0, Math.min(width, Math.floor(normalized.x * width)));
  const top = Math.max(0, Math.min(height, Math.floor(normalized.y * height)));
  const right = Math.max(
    left + 1,
    Math.min(width, Math.ceil((normalized.x + normalized.width) * width)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(height, Math.ceil((normalized.y + normalized.height) * height)),
  );

  if (right > width || bottom > height || right <= left || bottom <= top) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

export const mapNormalizedRegionToSourceRect = mapNormalizedRegionToSource;

const normalizeRegion = (region) => {
  if (!region || typeof region !== 'object') return null;

  const values = ['x', 'y', 'width', 'height'].map((key) => (
    toFiniteNumber(region[key])
  ));

  if (
    values.some((value) => value === null)
    || values[2] <= 0
    || values[3] <= 0
  ) {
    return null;
  }

  const [x, y, width, height] = values;
  const right = x + width;
  const bottom = y + height;

  if (
    x < 0
    || y < 0
    || right > 1
    || bottom > 1
    || !Number.isFinite(right)
    || !Number.isFinite(bottom)
  ) {
    return null;
  }

  return { x, y, width, height };
};

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
